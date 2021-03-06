
const   _       = require('underscore'),
fs      = require('fs'),
argv = require("optimist").argv,
columnify = require('columnify'),
colors = require('colors'),
logger  = require('node-logger')("Utils")
;

import { GreatBuilding, FoeAgent, Player, FoeResponseBody } from "../foe_agent";
import { FoeService } from "./FoeService";

const JSON_REQUEST_REGEX = "json?h=";

export class UtilsModule extends FoeService {
    _har: any;
    _model: any;

    constructor(parent: FoeAgent) {
        super(parent);

        let rawResult: string = fs.readFileSync("conf/" + this.parent.world + ".forgeofempires.com.har").toString();
        this._har = JSON.parse(rawResult);

        let rawdata: string = fs.readFileSync("conf/"+ this.parent.world + ".model.json");
        this._model = JSON.parse(rawdata);
    }
    
    processHarFile() {
        logger.debug("Har file entries: " + this._har.log.entries.length);

        for(let name of Object.keys(this._model.players)){
            this._model.players[name].active = false;

            if(argv["clear"]){
                delete this._model.players[name].buildings;
            }
        }
        
        for(let entry of this._har.log.entries){
            if(entry.request.url.includes(JSON_REQUEST_REGEX)){
                try {
                    // logger.info("URL: " + entry.request.url);
                    let req = JSON.parse(entry.request.postData.text);
                    let rsp = JSON.parse(entry.response.content.text);
    
                    for(let rq of rsp){
                        logger.debug("Class: '" + rq.requestClass + "', requestMethod: '" + rq.requestMethod + "'");
    
                        // if(rq.requestClass == "StartupService" && rq.requestMethod == "getData"){
						// 	logger.info(rq.responseData.neighbours);
                        //     for (let player of rq.responseData.socialbar_list){
                        //         this.processPlayer(player);
                        //     }
                        // }
    
                        if(rq.requestClass == "OtherPlayerService" && rq.requestMethod == "getSocialList"){
                            for (let player of rq.responseData.neighbours){
                                this.processPlayer(player);
                            }
							for (let player of rq.responseData.friends){
                                this.processPlayer(player);
                            }
                        }
    
                    }
                } catch(e) {
                    logger.error(e);
                }
            }
        }

        this.fini();
    }

    processPlayer(p: any){
        let res = this._model.players[p.name] || {};
        res.name        = p.name;
        res.rank        = p.rank;
        res.member_of   = (p.is_guild_member ? "Guild members" : (p.is_friend ? "Friends" : "Neighbors"));
        res.player_id   = p.player_id;
        res.active      = true;
        if(!("gb_counter" in res)){
            res.gb_counter = 0;
        }
        
        if(!p.is_self){
            logger.info((p.name in this._model.players ? "Updating" : "Inserting") + " player '" + p.name + "' from " + res.member_of + " #" + p.rank);
            this._model.players[p.name] = res;
        }
    }

    fini(){
        logger.info("Done, saving to " + "conf/"+ this.parent.world + ".model.json");
        
        fs.writeFileSync("conf/"+ this.parent.world + ".model.json", JSON.stringify(this._model, null, 2));
    }
}