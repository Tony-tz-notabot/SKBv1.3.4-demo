import {mkdir,readFile,rename,writeFile} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import type {PersistedApplication} from "./types.js";

export class JsonPersistence {
  readonly path:string;
  constructor(path=resolve(process.cwd(),"data","skb-state.json")){this.path=resolve(path)}
  async load():Promise<PersistedApplication>{try{const parsed=JSON.parse(await readFile(this.path,"utf8")) as PersistedApplication;return parsed?.version===1&&Array.isArray(parsed.rooms)?parsed:{version:1,rooms:[]};}catch{return{version:1,rooms:[]}}}
  async save(state:PersistedApplication){await mkdir(dirname(this.path),{recursive:true});const temporary=`${this.path}.tmp`;await writeFile(temporary,JSON.stringify(state),"utf8");await rename(temporary,this.path);}
}
