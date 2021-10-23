
const   _       = require('underscore'),
        fs      = require('fs'),
        argv = require("optimist").argv,
        columnify = require('columnify'),
        colors = require('colors'),
        logger  = require('node-logger')("GB-Module")
;

import { GreatBuilding, FoeAgent, Player, FoeResponseBody } from "../foe_agent";
import { FoeModule } from "./foe_module";


export class GbModule extends FoeModule {
    _result: Array<any> = new Array();

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

        logger.info("Scanning list of " + Object.keys(players).length + " players");

        let skipping = false;
        if (argv["start-from"]) {
            logger.info("Starting from player " + argv["start-from"]);
            skipping = true;
        }

        for (const name of Object.keys(players)) {
            if(!players[name].active){
                logger.warn("Skip player " + name + ": player inactive");
                continue;
            }

            if(players[name].vip){
                logger.warn("Skip player " + name + ": player VIP");
                continue;
            }

            if(players[name].member_of == "Guild members"){
                logger.warn("Skip player " + name + ": Guild player");
                continue;
            }
            
            if (skipping && name != argv["start-from"]) {
                logger.warn("Skip player " + name + ": argv['start-from'] other");
                continue;
            }

            skipping = false;
            let player = players[name];
            player.name = name;

            await self.scanPlayer(player);
            await self.parent.sleep();            
        };

        this.printResult();
    }

    async scanPlayer(player: Player): Promise<void> {
        let self = this;
        logger.info("Scanning player #" + player.rank + " " + player.name + " (" + player.member_of + ", gb_counter: " + player.gb_counter + ")");

        return new Promise(async (resolve, reject) => {

            let response: Array<FoeResponseBody> = await self.parent.foeRequest(self.parent.request_gb_list(player));              
            let buildings: Array<GreatBuilding> = response[1].responseData;

            for (const building of buildings) {
                await self.parent.sleep();
                await self.scanBuilding(player, building);
            }

            logger.debug("Player " + player.name + " scanned, continue\n");
            return resolve();
        });
    }

    async scanBuilding(player: Player, building: GreatBuilding): Promise<void> {
        let self = this;
        logger.debug(player.name + ": Scanning building " + building.name);

        return new Promise(async (resolve, reject) => {

            let response: Array<FoeResponseBody> = await self.parent.foeRequest(self.parent.request_gb_detail(player, building));

            building.state = response[1].responseData;
            building.rankings = response[2].responseData.rankings;

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
           
                logger.warn(colors.bold(colors.green(player.name) + " (" + player.rank + ")" + " -> " + building.name + ":\t Position " + r.rank + ": \t" + colors.yellow.bold(points_to_lock) + " / " + target
                    + "\t" + colors.green.bold('+' + profit) + ", will remain: " + (remaining - points_to_lock)));
                this.updatePlayerGbCounter(player.name);
                this.savePosition({
                    player_name: player.name,
                    member_of: player.member_of,
                    player_rank: player.rank,
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
            order.push(players[name]);
        }
        console.log(order);

        order.sort((a: Player, b: Player) => {
            return b.gb_counter - a.gb_counter;
        });
        console.log(order);
        
        for(const p of order){
            res[p.name] = players[p.name];
        }
        console.log(res);

        return res;
    }

    savePosition(position: any){
        this._result.push(position);
        this.saveResult();
    }

    updatePlayerGbCounter(name: string){
        if("gb_counter" in this.parent.model.players[name]){
            this.parent.model.players[name].gb_counter++;
        } else {
            this.parent.model.players[name].gb_counter = 1;
        }
        this.parent.saveModel();
    }
    
    saveResult(){
        fs.writeFileSync("conf/" + this.parent.world + ".result.json", JSON.stringify(this._result, null, 2));
    }

    printResult() {
        this._result.sort((a, b) => (b.ratio > a.ratio) ? 1 : -1);

        var columns = columnify(this._result, {minWidth: 5, config: {
            points_to_lock: {
                dataTransform: function(data) {
                    return colors.yellow.bold(data);
                },
                align: "right"
            },
            profit: {
                dataTransform: function(data) {
                    return colors.green.bold('+' + data);
                },
                align: "right"
            }
        }});

        console.log(columns)
    }
}
