import {mkdir,readFile,rename,writeFile} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import type {PersistedApplication} from "./types.js";

export class JsonPersistence {
  readonly path:string;
  #queue:Promise<void>=Promise.resolve();
  constructor(path=resolve(process.cwd(),"data","skb-state.json")){this.path=resolve(path)}
  async load():Promise<PersistedApplication>{try{const parsed=JSON.parse(await readFile(this.path,"utf8")) as PersistedApplication;return parsed?.version===1&&Array.isArray(parsed.rooms)?{...parsed,sessions:parsed.sessions??{},accounts:parsed.accounts??{},roomCommandResults:parsed.roomCommandResults??{},gameCommandResults:parsed.gameCommandResults??{}}:{version:1,rooms:[],sessions:{},accounts:{},roomCommandResults:{},gameCommandResults:{}};}catch{return{version:1,rooms:[],sessions:{},accounts:{},roomCommandResults:{},gameCommandResults:{}};}}
  async save(state:PersistedApplication){const write=this.#queue.then(async()=>{await mkdir(dirname(this.path),{recursive:true});const temporary=`${this.path}.tmp`;await writeFile(temporary,JSON.stringify(state),"utf8");try{await rename(temporary,this.path);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}});this.#queue=write.catch(()=>{});return write;}
}
