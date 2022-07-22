
const   _       = require('underscore'),
        fs      = require('fs'),
        argv = require("optimist").argv,
        columnify = require('columnify'),
        colors = require('colors'),
        logger  = require('node-logger')("GB-Module")
;

import { GreatBuilding, FoeAgent, Player, FoeResponseBody } from "../foe_agent";
import { FoeService } from "./FoeService";
import * as readline from 'readline'


export class GbModule extends FoeService {
    _result: Array<any> = new Array();

    playerCounter: number = 0;
    playersLength: number = 0;
    buildingCounter: number = 0;

    constructor(parent: FoeAgent) {
        super(parent);

        let rawResult: string = fs.readFileSync("conf/" + this.parent.world + ".result.json").toString();
        this._result = JSON.parse(rawResult);

    }



    async scan() {
        let self = this;
        if (argv.result) 
            return this.printResult();

        if (argv.clear) {
            logger.info("Clearing result for world " + this.parent.world);
            this._result = [];
        }

        let players = this.sortByGbCounter(this.parent.model.players);

        this.playersLength = Object.keys(players).length;
        logger.info("Scanning list of " + this.playersLength + " players with arc_bonus: " + this.parent.arcBonus);

        let skipping = false;
        if (argv["start-from"]) {
            logger.info("Starting from player " + argv["start-from"]);
            skipping = true;
        }

        for (const name of Object.keys(players)) {
            if (skipping && name != argv["start-from"]) {
                logger.debug("Skip player " + name + ": argv['start-from'] other");
                continue;
            }

            skipping = false;
            let player = players[name];
            player.name = name;

            await self.scanPlayer(player);        
        };

        this.printResult();
    }

    isIterable(obj: Object) {
        // checks for null and undefined
        if (obj == null) {
          return false;
        }
        return typeof obj[Symbol.iterator] === 'function';
    }

    buildingUnchanged(player: Player, building: GreatBuilding): boolean{
        if(!("buildings" in this.parent.model.players[player.name]))
            return false;

        let history: GreatBuilding = this.parent.model.players[player.name].buildings.filter((b: GreatBuilding) => b.entity_id == building.entity_id)[0];

        if(history == null || history == undefined)
            return false;

        // console.log(history);
        // console.log(building);

        // Fix, not present = 0
        if(!("current_progress" in building))
            building.current_progress = 0;

        return !history.isProfitable && history.level == building.level && history.current_progress == building.current_progress;
    }

    async scanPlayer(player: Player, fetchOnly: boolean = false): Promise<Array<GreatBuilding> | void> {
        this.playerCounter++;

        let self = this;
        this.printStatusLine(player, null);

        return new Promise(async (resolve, reject) => {
            let requestData = self.parent.serverRequestBody("GreatBuildingsService", "getOtherPlayerOverview", [player.player_id]);

            let response: Array<FoeResponseBody> = await self.parent.serverRequest(requestData);

            let buildings: Array<GreatBuilding> = self.parent.extractResponseData(requestData, response);

            if(fetchOnly)
                return resolve(buildings);

            for (const building of buildings) {
                if(!self.buildingUnchanged(player, building)){
                    await self.scanBuilding(player, building);
                }
            }

            self.updatePlayer(player.name, buildings);
            return resolve();
        });
    }



    async scanBuilding(player: Player, building: GreatBuilding): Promise<void> {
        let self = this;
        this.buildingCounter++;
        this.printStatusLine(player, building.name);

        return new Promise(async (resolve, reject) => {
            let requestData = self.parent.serverRequestBody("GreatBuildingsService", "getConstruction", [building.entity_id, player.player_id]);
            let response: Array<FoeResponseBody> = await self.parent.serverRequest(requestData);

            // console.log(response);
            building.isProfitable = false; // Reset
            building.state = self.parent.extractResponseData({requestMethod: "updateEntity", requestClass: "CityMapService"}, response);
            building.rankings = self.parent.extractResponseData(requestData, response).rankings;

            self.calculateProfit(player, building);

            return resolve();
        });
    }

    calculateProfit(player: Player, building: GreatBuilding){
        let self = this;

        if (building.current_progress == undefined) {
            building.current_progress = 0;
        }

        // console.log(building);
        logger.debug("Calculating potentional profit for building " + building.name + ", level " + building.level + " (" + building.current_progress + "/" + building.max_progress + ")");

        if (building.rankings != undefined) {
            let already_contributed = building.rankings.map(r => r.player.name).includes("smoothie");
            building.rankings.forEach((r) => {
                self.calculatePosition(r, building, player, already_contributed);
            });
        } else {
            logger.error("Rankings: " + building.rankings);
        }
    }

    calculatePosition(r: any, building: GreatBuilding, player: Player, already_contributed: boolean){
        let own = r.rank == null || r.reward == undefined;
        let target = own ? building.max_progress - building.current_progress : Math.ceil(r.reward.strategy_point_amount * this.parent.arcBonus);
        let points = r.forge_points != undefined ? r.forge_points : 0;
        let diff = points - target;
        let isMore = diff > 0, isLess = diff < 0;
        let remaining = building.max_progress - building.current_progress;
    
        let might_be_profitable = diff < 0 && !own && building.state[0].level < building.state[0].max_level;
    
        logger.debug((own ? '-' : r.rank) + ": " + colors.cyan(points) + "\t" + target + "\t" + (isMore ? colors.green('+' + diff) : (isLess ? colors.red(diff) : '')));
    
        if(argv.blueprints && remaining <= 4)
            logger.info((own ? '-' : r.rank) + ": " + colors.cyan(points) + "\t" + target + "\t" + (isMore ? colors.green('+' + diff) : (isLess ? colors.red(diff) : '')));
    
        if(might_be_profitable){
            let my_contribution = 0; // TODO: get somehow
            let points_to_lock = Math.ceil((remaining + points - my_contribution) / 2);
            let profit = target - points_to_lock;
            let ratio = Math.round((profit / points_to_lock) * 100) / 100;

            if(points_to_lock < remaining && target > points_to_lock && profit >= this.parent.minimalProfit && ratio >= this.parent.minimalRatio){
                if(already_contributed)
                    return;
           
                this.updatePlayerGbCounter(player.name);
                building.isProfitable = true;
                this.savePosition({
                    player_name: player.name,
                    member_of: player.member_of,
                    player_rank: player.rank,
                    counter: player.gb_counter,
                    building_name: building.name,
                    rank: r.rank,
                    points_to_lock: points_to_lock,
                    target: target,
                    profit: profit,
                    remaining: remaining,
                    ratio:  ratio
                });
            }
        }
    }

    sortByGbCounter(players: any) {
        const order: Array<Player> = [], res = {};
        for(const name of Object.keys(players)){
            // Filter players
            if(this.playerScannable(name))
                order.push(players[name]);
        }
        // console.log(order);

        order.sort((a: Player, b: Player) => {
            return b.gb_counter - a.gb_counter;
        });
        // console.log(order);
        
        for(const p of order){
            res[p.name] = players[p.name];
        }
        // console.log(res);

        return res;
    }

    playerScannable(name: any): boolean{
        let py = this.parent.model.players as Object;
        if(!py[name].active){
            logger.debug("Skip player " + name + ": player inactive");
            return false;
        }

        if(py[name].vip){
            logger.debug("Skip player " + name + ": player VIP");
            return false;
        }

        if(py[name].member_of == "Guild members" && this.parent.world == "sk3"){
            logger.debug("Skip player " + name + ": Guild player");
            return false;
        }

        return true;
    }

    savePosition(position: any){
        this._result.push(position);
        this.printResult([position]);
        this.saveResult();
    }

    updatePlayer(name: string, buildings: Array<GreatBuilding>){
        this.parent.model.players[name].buildings = buildings.map(b => new Object({
                entity_id: b.entity_id,
                name: b.name,
                level: b.level,
                current_progress: b.current_progress,
                isProfitable: b.isProfitable
            })
        );

        this.parent.saveModel();
    }

    updatePlayerGbCounter(name: string){
        if("gb_counter" in this.parent.model.players[name]){
            this.parent.model.players[name].gb_counter++;
        } else {
            this.parent.model.players[name].gb_counter = 1;
        }
    }
    
    saveResult(){
        fs.writeFileSync("conf/" + this.parent.world + ".result.json", JSON.stringify(this._result, null, 2));
    }

    printResult(line: any = null) {
        if(line == null)
            this._result.sort((a, b) => (b.ratio > a.ratio) ? 1 : -1);

        var columns = columnify(line || this._result, {minWidth: 5, config: {
            points_to_lock: {
                dataTransform: function(data: number) {
                    return colors.yellow.bold(data);
                },
                align: "right"
            },
            profit: {
                dataTransform: function(data: number) {
                    return colors.green.bold('+' + data);
                },
                align: "right"
            }
        }});

        console.log("\n");
        console.log(columns)
        console.log("\n");

        if(line == null)
            logger.info("Scanned " + this.playerCounter + " players and " + this.buildingCounter + " buildings.");
    }

    printStatusLine(player: Player, buildingName: string){
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(`\r Scanning player '${player.name}' #${player.rank}/${player.member_of}, counter = ${player.gb_counter} -- (${this.playerCounter}/${this.playersLength}) -- building '${buildingName}'`);
    }
}
