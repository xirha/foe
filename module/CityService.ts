import { FoeAgent, FoeResponseBody, GreatBuilding } from "foe_agent";
import { resolve } from "path";
import { FoeService } from "./FoeService";

const   _       = require('underscore'),
    fs          = require('fs'),
    argv        = require("optimist").argv,
    columnify   = require('columnify'),
    colors      = require('colors'),
    logger      = require('node-logger')("CityProduction")
;

export enum ProductionTime {
    MIN_5 = 1,
    MIN_15 = 2,
    H_1 = 3,
    H_4 = 4,
    H_8 = 5,
    H_24 = 6
}
export class City {
    activeTasks: any;   // Active challenges in city (daily, story, recurring, event)
    tavernSittingPlayers: any;  // Sitting players count, ex: [848966614, 4, 1]
    otherTavernStates: any; // Friends tavern's states
    incidents: any; 
    researchProgress: any; // Technology tree
    resourceDefinitions: any;
    resources: any; // All resources
    metadata: any; // Links to static datas, as quests, rewards, battlegrounds, etc...
    data: any; // City data

    get buildings(): any { return this.data.city_map.entities; }
    get userData(): any { return this.data.user_data; }
    get friends(): any { return this.data.socialbar_list; }
}

export class CityService extends FoeService {
    _har: any;
    _model: any;

    constructor(parent: FoeAgent) {
        super(parent);


    }

    async start() {
        setInterval(() => this.rescan(), 6 * 60 * 1000);
        this.rescan();
    } 

    async rescan() {
        await this.getData();
        await this.collectProduction();

        await this.investFP();

        // Actualise
        await this.getData();
        await this.startProductionSupplies();
    }

    getData(): Promise<void>{
        let self = this;

        return new Promise(async (resolve, reject) => {
            let requestData = self.parent.serverRequestBody("StartupService", "getData");
            let response: Array<FoeResponseBody> = await self.parent.serverRequest(requestData);              


            self.parent.city.activeTasks            = self.parent.extractResponseData({requestMethod: "getActiveChallenges", requestClass: "ChallengeService"}, response);
            self.parent.city.tavernSittingPlayers   = self.parent.extractResponseData({requestMethod: "getSittingPlayersCount", requestClass: "FriendsTavernService"}, response);
            self.parent.city.otherTavernStates      = self.parent.extractResponseData({requestMethod: "getOtherTavernStates", requestClass: "FriendsTavernService"}, response);
            self.parent.city.incidents              = self.parent.extractResponseData({requestMethod: "getOverview", requestClass: "HiddenRewardService"}, response);
            self.parent.city.researchProgress       = self.parent.extractResponseData({requestMethod: "getProgress", requestClass: "ResearchService"}, response);
            self.parent.city.resourceDefinitions    = self.parent.extractResponseData({requestMethod: "getResourceDefinitions", requestClass: "ResourceService"}, response);
            self.parent.city.resources              = self.parent.extractResponseData({requestMethod: "getPlayerResources", requestClass: "ResourceService"}, response).resources;
            self.parent.city.data                   = self.parent.extractResponseData({requestMethod: "getData", requestClass: "StartupService"}, response);

            return resolve();
        });
    }

    async startProductionSupplies() {
        let self = this;

		function checkProductionBuilding(b: any): boolean {
			return (b.type === 'production' || b.type === 'goods' || b.type === 'residential' || b.type === 'random_production');
		};

        // Get only connected and idle production buildings
        let buildings = this.parent.city.buildings.filter((b: any) => checkProductionBuilding(b) && b.connected && b.state.__class__ === 'IdleState');

        for(let b of buildings){
            await self.startProduction(b);
        }
    }

	async collectProduction() {
        let self = this;

        let buildings = this.parent.city.buildings.filter((b: any) => b.state.__class__ === 'ProductionFinishedState');
        let ids = buildings.map((b: any) => b.id);
        
        if(ids.length)
            await self.pickupProduction(ids);
	};

    async investFP(): Promise<void>  {
        let self = this;
        let fp = self.parent.city.resources.strategy_points;
        
        if(fp < 1)
            return;

        let player = {
            name: "smoothie",
            rank: 0,
            player_id: 848906028,
            member_of: "Self",
            gb_counter: 0,
        };

        let myBuildings = await this.parent.modules["gb"].scanPlayer(player, true);

        let building = myBuildings.filter((b: GreatBuilding) => b.entity_id == 2867)[0]; // Obluk
    

        return new Promise(async (resolve, reject) => {
            logger.info("Investing " + fp + " forge points to building '" + building.name + "' of player " + player.name);
            let requestData = self.parent.serverRequestBody("GreatBuildingsService", "contributeForgePoints", [building.entity_id, player.player_id, building.level, fp, false]);  
            let response: Array<FoeResponseBody> = await self.parent.serverRequest(requestData);     

            return resolve();
        });
    }

    startProduction(building: any, time: ProductionTime = ProductionTime.MIN_5): Promise<void> {
        let self = this;

        return new Promise(async (resolve, reject) => {
            logger.info("Starting 5-min production in building " + building.cityentity_id + " (id: " + building.id + ")");
            let requestData = self.parent.serverRequestBody("CityProductionService", "startProduction", [building.id, time]);
            let response: Array<FoeResponseBody> = await self.parent.serverRequest(requestData);              

            return resolve();
        });
    }

    pickupProduction(buildings: any): Promise<void> {
        let self = this;

        return new Promise(async (resolve, reject) => {
            logger.info("Picking up production of " + buildings.length + " buildings.");
            let requestData = self.parent.serverRequestBody("CityProductionService", "pickupProduction", [buildings]);
            let response: Array<FoeResponseBody> = await self.parent.serverRequest(requestData);              

            return resolve();
        });
    }
}


