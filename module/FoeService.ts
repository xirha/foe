import { FoeAgent } from "../foe_agent";



export class FoeService {
    parent: FoeAgent;

    constructor(parent: FoeAgent){
        this.parent = parent;
    }
}