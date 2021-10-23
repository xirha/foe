const fs = require('fs');
const md5 = require('./src/md5');
const argv = require("optimist").argv;
const logger  = require('node-logger')("Foe-Agent");
const request = require('request');
const zlib = require('zlib');

import { FoeModule } from "./module/foe_module";
import { GbModule } from "./module/great_buildings";
import { UtilsModule } from "./module/utils";

export interface FoeRequestBody {
    __class__: string,
    requestData: Array<any>,
    requestClass: string,
    requestMethod: string,
    requestId: number
}

export interface FoeResponseBody {
    __class__: string,
    requestData: Array<any>,
    requestClass: string,
    requestMethod: string,
    requestId: number,
    url: string,
    message: string,
    header: string,
    responseData: any
}

export interface Player {
    name: string;
    rank: number;
    player_id: number;
    member_of: string;
    gb_counter: number;
}

export interface GreatBuilding {
    name: string;
    entity_id: number;
    state: any;
    rankings: any;
    current_progress: number;
    max_progress: number;
    level: number;
}

export class FoeAgent {
    _defaultHeader: any;
    _configuration: any;
    _model: any;
    world: string = argv.world || "sk3";

    requestId: number;
    req: any;
    modules: Map<String, FoeModule> = new Map();

    constructor() {
        let self = this;

        let rawHeaders: string = fs.readFileSync("conf/request_headers.json").toString();
        this._defaultHeader = JSON.parse(rawHeaders);

        let rawConfig: string = fs.readFileSync("conf/configuration.json").toString();
        this._configuration = JSON.parse(rawConfig);


        let rawModel: string = fs.readFileSync("conf/" + this.world + ".model.json").toString();
        this._model = JSON.parse(rawModel);


        this.req = request.defaults({
            baseUrl: self.baseUrl,
            json: true,
            timeout: 15000,
            time : true
        });

        this.requestId = Math.round(this.getRandomArbitrary(30, 50));


        this.modules["gb"] = new GbModule(this);
        this.modules["util"] = new UtilsModule(this);
        this.init();
    }

    saveModel(){
        fs.writeFileSync("conf/"+ this.world + ".model.json", JSON.stringify(this._model, null, 2));
    }

    init() {
        switch (argv._[0]){
            case "scan":
                this.modules["gb"].scan();
                break;
            case "har":
                this.modules["util"].processHarFile();
                break;
        }
    }

    _headers(body: any, url: string){
        let self = this;
        let _headers = this.defaultHeader;
        
        let bodyString: string = JSON.stringify(body).replace(' ', '');
        let signature: string = md5.hash(this.configuration.session + this.configuration.secret + bodyString).substr(0, 10);
        
        _headers["signature"] = signature;
        // _headers[":authority"] = "sk3.forgeofempires.com";
        // _headers[":path"] = url;
        // _headers[":method"] = "POST";
        // _headers[":scheme"] = "https";

        _headers["client-identification"] = "version=" + this.configuration.version + "; requiredVersion=" + this.configuration.version + "; platform=bro; platformType=html5; platformVersion=web";

        const cookiesCopy = JSON.parse(JSON.stringify(_headers.cookie));
        _headers.cookie = "";

        Object.keys(cookiesCopy).forEach(function (key) {
            _headers.cookie += key + "=" + cookiesCopy[key] + "; ";
        });

        Object.keys(self.configuration.cookies).forEach(function (key) {
            _headers.cookie += key + "=" + self.configuration.cookies[key] + "; ";
        });

        return _headers;

    }

    get defaultHeader(){
        const copy = JSON.parse(JSON.stringify(this._defaultHeader[this.world]));
        return copy;
    }

    foeRequest(body: FoeRequestBody): Promise<Array<FoeResponseBody>> {
        let self = this;
        let _url = "/game/json?h=" + self.configuration.session;

        let _options = {
            url: _url, 
            headers: self._headers([body], _url), 
            body: [ body ], 
            encoding: null
        }

        // console.log(_options);

        return new Promise((resolve, reject) => {
            self.req.post(_options, function (err: any, res: any) {
                logger.logRequest(this, res, err);

                zlib.brotliDecompress(res.body, (err: any, result: any) => {
                    if (err) {
                        return reject(new Error(err));
                    } else {
                        let response = JSON.parse(result.toString());
                        self.catchRequestError(response[0]);

                        return resolve(response);
                    }
                });
                
            });
        });
    }

    get configuration(){ return this._configuration[this.world] }
    get model(){ return this._model }
    get arcBonus(): number { return this.world == "sk3" ? 1.9 : 1.3 }
    get minimalProfit(): number { return this.world == "sk3" ? 15 : 0 }
    get minimalRatio(): number { return this.world == "sk3" ? 0.04 : 0 }
    get baseUrl() { return "https://" + this.world + ".forgeofempires.com" }

    catchRequestError(response: FoeResponseBody){
        if (response.__class__ == "Error" || response.__class__ == "Redirect") {
            logger.error(response.header + ": " + response.message);
            process.exit(0);
        }
    }

    getRandomArbitrary(min: number, max: number): number {
        return Math.random() * (max - min) + min;
    }

    async sleep(): Promise<void> {
        let self = this;
        if(argv.faster){
            return new Promise(resolve => setTimeout(resolve, self.getRandomArbitrary(250, 1000)));
        } else if (argv.fast) {
            return new Promise(resolve => setTimeout(resolve, self.getRandomArbitrary(0, 1)));
        } else {
            return new Promise(resolve => setTimeout(resolve, self.getRandomArbitrary(750, 2500)));
        }
    }

    request_gb_list(player: Player): FoeRequestBody {
        return {
                __class__: "ServerRequest",
                requestData: [player.player_id],
                requestClass: "GreatBuildingsService",
                requestMethod: "getOtherPlayerOverview",
                requestId: 16
            };
    }

    request_gb_detail(player: Player, building: GreatBuilding): FoeRequestBody {
        return {
                __class__: "ServerRequest",
                requestData: [building.entity_id, player.player_id],
                requestClass: "GreatBuildingsService",
                requestMethod: "getConstruction",
                requestId: 16
            };
    }

}

let agent = new FoeAgent();