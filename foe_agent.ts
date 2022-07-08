const fs = require('fs');
const md5 = require('./src/md5');
const argv = require("optimist").argv;
const logger  = require('node-logger')("Foe-Agent");
const request = require('request');
const zlib = require('zlib');

import { City, CityService } from "./module/CityService";
import { FoeService } from "./module/FoeService";
import { GbModule } from "./module/GbService";
import { UtilsModule } from "./module/utils";

export interface FoeRequestBody {
    __class__?: string,
    requestData?: Array<any>,
    requestClass: string,
    requestMethod: string,
    requestId?: number
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
    state?: any;
    rankings?: any;
    current_progress: number;
    max_progress: number;
    level: number;
    isProfitable: boolean;
}

export class FoeAgent {
    _defaultHeader: any;
    _configuration: any;
    _model: any;
    world: string = argv.world || "sk3";

    requestId: number;
    req: any;
    modules: Map<String, FoeService> = new Map();

    city: City = new City();

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
            timeout: 30000,
            time : true
        });

        this.requestId = Math.round(this.getRandomArbitrary(10, 30));


        this.modules["gb"] = new GbModule(this);
        this.modules["util"] = new UtilsModule(this);
        this.modules["city"] = new CityService(this);
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
            case "city":
                this.modules["city"].start();
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

    async serverRequest(body: FoeRequestBody): Promise<Array<FoeResponseBody>> {
        let self = this;
        let _url = "/game/json?h=" + self.configuration.session;

        let _options = {
            url: _url, 
            headers: self._headers([body], _url), 
            body: [body], 
            encoding: null
        }

        // console.log(_options);
        await self.sleep();
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

    get configuration(): any{
        let conf = this._configuration[this.world];
        conf.secret = this._configuration["secret"];
        conf.version = this._configuration["version"];
        return conf;
    }
    get model(){ return this._model }
    get arcBonus(): number { return this.configuration.arc_bonus }
    get minimalProfit(): number { return this.world == "sk3" ? 20 : 20 }
    get minimalRatio(): number { return this.world == "sk3" ? 0 : 0.04 }
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

    serverRequestBody(service: string, method: string, data: Array<any> = []): FoeRequestBody {
        return {
            __class__: "ServerRequest",
            requestData: data,
            requestClass: service,
            requestMethod: method,
            requestId: 16
        };
    }

    extractResponseData(request: FoeRequestBody, response: Array<FoeResponseBody>): any {
        return response.find(subResp => {return subResp.requestClass === request.requestClass && subResp.requestMethod == request.requestMethod}).responseData;
    }

}

let agent = new FoeAgent();
