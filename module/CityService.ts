import { FoeAgent, FoeResponseBody } from "foe_agent";
import { FoeService } from "./FoeService";

const   _       = require('underscore'),
    fs          = require('fs'),
    argv        = require("optimist").argv,
    columnify   = require('columnify'),
    colors      = require('colors'),
    logger      = require('node-logger')("CityProduction")
;



export class CityService extends FoeService {
    _har: any;
    _model: any;

    constructor(parent: FoeAgent) {
        super(parent);


    }

    async start() {
        await this.getData();
    } 

    getData(): Promise<void>{
        let self = this;

        return new Promise(async (resolve, reject) => {
            let requestData = self.parent.serverRequestBody("StartupService", "getData");
            let response: Array<FoeResponseBody> = await self.parent.serverRequest(requestData);              

            console.log(response);

            // userData.playerId = getData.user_data.player_id;
            // cityMapService.setBuildingList(getData.city_map.entities);
            // definitionService.setBuildingDefinitions(getData.city_map.city_entities);
            // cityResourcesService.setResourceList(getData.resources);

            return resolve();
        });
    }

    startProduction(): Promise<void> {
        let self = this;

        return new Promise(async (resolve, reject) => {
            let requestData = self.parent.serverRequestBody("CityProductionService", "startProduction", [69, 1]);
            let response: Array<FoeResponseBody> = await self.parent.serverRequest(requestData);              


            return resolve();
        });
    }
}


