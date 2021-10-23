import { FoeAgent } from "../foe_agent";



export class FoeModule {
    parent: FoeAgent;

    constructor(parent: FoeAgent){
        this.parent = parent;
    }
}