import {existsSync} from "node:fs";
import {mkdtemp,rm} from "node:fs/promises";
import type {AddressInfo} from "node:net";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {afterEach,beforeAll,describe,expect,it} from "vitest";
import WebSocket from "ws";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {JsonPersistence} from "./persistence.js";
import {RoomService} from "./roomService.js";
import {SkbApplicationServer} from "./server.js";

let ruleset:LoadedRuleset;const dirs:string[]=[];
beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});
afterEach(async()=>{await Promise.all(dirs.splice(0).map(path=>rm(path,{recursive:true,force:true,maxRetries:5,retryDelay:100})));});
const settings={roomName:"重连",allowGuests:true,allowSpectators:true,turnTimeSeconds:60,responseTimeSeconds:30,reserveTimeSeconds:30,rulesetVersion:"1.3.4" as const,dismantleBossEnabled:true};
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

class TestClient{
 readonly messages:any[]=[];
 constructor(private readonly socket:WebSocket){socket.on("message",raw=>this.messages.push(JSON.parse(String(raw))));}
 send(message:unknown){this.socket.send(JSON.stringify(message));}
 close(){if(this.socket.readyState===this.socket.OPEN)this.socket.close();else this.socket.terminate();}
}
async function openClient(base:string,token:string){const socket=new WebSocket(`ws://127.0.0.1:${new URL(base).port}/ws?token=${encodeURIComponent(token)}`);const client=new TestClient(socket);await new Promise<void>((res,rej)=>{socket.once("open",()=>res());socket.once("error",rej);});return client;}
async function waitMessage(client:TestClient,predicate:(m:any)=>boolean,timeout=8000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const hit=client.messages.find(predicate);if(hit)return hit;await delay(20);}throw new Error(`reconnect test wait timeout: ${JSON.stringify(client.messages.map(m=>({type:m.type,messageType:m.message?.type,commandId:m.message?.commandId})))}`);}
async function command(client:TestClient,message:any,channel:"room"|"game"){client.send({type:"COMMAND",channel,command:message});const entry=await waitMessage(client,m=>m.type==="COMMAND_RESULT"&&m.channel===channel&&m.message.commandId===message.commandId);if(!String(entry.message.type).endsWith("ACCEPTED"))throw new Error(`reconnect rejected: ${entry.message.reasonCode}`);return entry.message;}

describe("reconnect and static hosting",()=>{
 it("restores the room snapshot after reconnecting with the same session token",async()=>{const dir=await mkdtemp(join(tmpdir(),"skb-reconnect-")),persistence=new JsonPersistence(join(dir,"state.json")),rooms=new RoomService(ruleset,persistence);dirs.push(dir);await rooms.restore();const server=new SkbApplicationServer(rooms,ruleset);await server.listen(0);const port=(server.http.address() as AddressInfo).port,base=`http://127.0.0.1:${port}`;
  const response=await fetch(`${base}/api/session`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:"重连玩家",password:"test123"})});const session=await response.json() as {token:string;userId:string;displayName:string};expect(session.token).toBeTruthy();
  const first=await openClient(base,session.token);
  try{
   await command(first,{type:"ROOM_COMMAND",commandId:"create",command:"CREATE_ROOM",payload:{settings,password:null}},"room");
   const snap=await waitMessage(first,m=>m.type==="MESSAGE"&&m.channel==="room"&&m.message.type==="ROOM_SNAPSHOT"),roomCode=snap.message.roomCode;
   first.close();
   await delay(150);
   const offline=rooms.roomForUser(session.userId)!;expect(offline.players[0]!.connection).toBe("reconnecting");expect(offline.players[0]!.disconnectDeadlineAt).toBeTruthy();
   const second=await openClient(base,session.token);
   try{
    const restored=await waitMessage(second,m=>m.type==="MESSAGE"&&m.channel==="room"&&m.message.type==="ROOM_SNAPSHOT");
    expect(restored.message.roomCode).toBe(roomCode);expect(rooms.roomForUser(session.userId)!.players[0]!.connection).toBe("online");
   }finally{second.close();}
  }finally{first.close();await server.close();}
 },30000);
 it("serves health and the built client SPA when dist exists and static hosting is enabled",async()=>{const dir=await mkdtemp(join(tmpdir(),"skb-static-")),persistence=new JsonPersistence(join(dir,"state.json")),rooms=new RoomService(ruleset,persistence);dirs.push(dir);await rooms.restore();const server=new SkbApplicationServer(rooms,ruleset,{}, {serveStatic:true});await server.listen(0);const port=(server.http.address() as AddressInfo).port,base=`http://127.0.0.1:${port}`;
  try{
   const health=await fetch(`${base}/health`);expect(health.status).toBe(200);expect((await health.json()).ok).toBe(true);
   const distIndex=resolve(import.meta.dirname,"../../../client/dist/index.html");
   const page=await fetch(`${base}/`);
   if(existsSync(distIndex)){expect(page.status).toBe(200);expect((await page.text()).toLowerCase()).toContain("<div");}
   else expect(page.status).toBe(404);
   const spaFallback=await fetch(`${base}/some/client/route`);expect(spaFallback.status).toBe(existsSync(distIndex)?200:404);
  }finally{await server.close();}
 },30000);
});
