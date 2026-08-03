import {mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,describe,expect,it} from "vitest";
import {JsonPersistence} from "./persistence.js";
import type {PersistedApplication} from "./types.js";

const dirs:string[]=[];
afterEach(async()=>{await Promise.all(dirs.splice(0).map(path=>rm(path,{recursive:true,force:true,maxRetries:5,retryDelay:100})));});
const base:PersistedApplication={version:1,rooms:[],sessions:{},accounts:{},roomCommandResults:{},gameCommandResults:{}};

describe("JsonPersistence",()=>{
 it("serializes concurrent saves without rename races",async()=>{const dir=await mkdtemp(join(tmpdir(),"skb-persist-")),persistence=new JsonPersistence(join(dir,"state.json"));dirs.push(dir);
  const payloads=Array.from({length:20},(_,i)=>({...base,rooms:[{roomId:`r${i}`} as never]}) as PersistedApplication);
  await Promise.all(payloads.map(p=>persistence.save(p)));
  const parsed=JSON.parse(await readFile(join(dir,"state.json"),"utf8")) as {rooms:Array<{roomId:string}>};
  expect(parsed.rooms).toHaveLength(1);expect(parsed.rooms[0]!.roomId).toBe("r19");
 });
 it("survives interleaved saves from a tick loop and command handlers",async()=>{const dir=await mkdtemp(join(tmpdir(),"skb-persist-")),persistence=new JsonPersistence(join(dir,"state.json"));dirs.push(dir);
  const writer=async(i:number)=>{for(let n=0;n<10;n+=1)await persistence.save({...base,rooms:[{roomId:`w${i}-${n}`} as never]} as PersistedApplication);};
  await Promise.all([writer(1),writer(2),writer(3)]);
  const parsed=JSON.parse(await readFile(join(dir,"state.json"),"utf8")) as {rooms:Array<{roomId:string}>};
  expect(parsed.rooms).toHaveLength(1);expect(parsed.rooms[0]!.roomId).toMatch(/^w[123]-9$/);
 });
});
