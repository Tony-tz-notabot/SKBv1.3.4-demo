// 退出本局 E2E：任一玩家 FORFEIT 后，四名玩家都应收到 LOBBY_SNAPSHOT 回到大厅（真 WS）
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
const settings={roomName:"FORFEIT-E2E",allowGuests:true,allowSpectators:false,turnTimeSeconds:60,responseTimeSeconds:30,reserveTimeSeconds:30,rulesetVersion:"1.3.4" as const,dismantleBossEnabled:true};
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
type WireEntry={type:"MESSAGE"|"COMMAND_RESULT"|"PONG";channel?:"room"|"game";message?:any;seq:number};
class TestClient{
 readonly messages:WireEntry[]=[];private seq=0;
 readonly open:Promise<void>;
 constructor(private readonly socket:WebSocket){this.open=new Promise((resolve,reject)=>{socket.once("open",()=>resolve());socket.once("error",reject);});socket.on("message",raw=>this.accept(String(raw)));}
 send(message:unknown){this.socket.send(JSON.stringify(message));}
 close(){if(this.socket.readyState===this.socket.OPEN)this.socket.close();else this.socket.terminate();}
 private accept(raw:string){const wire=JSON.parse(raw) as WireEntry;wire.seq=++this.seq;this.messages.push(wire);}
}
type WaitStart={client:TestClient;index:number};
const starts=(clients:TestClient[])=>clients.map(client=>({client,index:client.messages.length}));
async function waitFor(clients:TestClient[],start:WaitStart[],predicate:(entry:WireEntry)=>boolean,timeout=12000){const deadline=Date.now()+timeout;while(Date.now()<deadline){for(const item of start){const entry=item.client.messages.slice(item.index).find(predicate);if(entry)return entry;}await delay(20);}throw new Error(`FORFEIT-E2E wait timeout`);}
async function command(client:TestClient,message:any,channel:"room"|"game"){const start=starts([client]);client.send({type:"COMMAND",channel,command:message});const entry=await waitFor([client],start,item=>item.type==="COMMAND_RESULT"&&item.channel===channel&&item.message.commandId===message.commandId);if(!String(entry.message.type).endsWith("ACCEPTED"))throw new Error(`FORFEIT-E2E command rejected: ${entry.message.reasonCode}`);return entry.message;}

describe("forfeit returns every player to the lobby",()=>{
 it("disbands the room and pushes LOBBY_SNAPSHOT to all four players",async()=>{const dir=await mkdtemp(join(tmpdir(),"skb-forfeit-e2e-")),persistence=new JsonPersistence(join(dir,"state.json")),rooms=new RoomService(ruleset,persistence);dirs.push(dir);await rooms.restore();const server=new SkbApplicationServer(rooms,ruleset);await server.listen(0);const port=(server.http.address() as AddressInfo).port,base=`http://127.0.0.1:${port}`;
  const sessions:Array<{token:string;userId:string;displayName:string}>=[];for(let i=0;i<4;i++){const response=await fetch(`${base}/api/session`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:`退出玩家${i+1}`,password:"test123"})});sessions.push(await response.json() as {token:string;userId:string;displayName:string});}
  const clients=sessions.map(session=>new TestClient(new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(session.token)}`)));await Promise.all(clients.map(client=>client.open));
  try{
   await command(clients[0]!,{type:"ROOM_COMMAND",commandId:"create",command:"CREATE_ROOM",payload:{settings,password:null}},"room");
   const roomSnap=(await waitFor([clients[0]!],[{client:clients[0]!,index:0}],entry=>entry.type==="MESSAGE"&&entry.channel==="room"&&entry.message.type==="ROOM_SNAPSHOT")).message,roomCode=roomSnap.roomCode;
   for(let i=1;i<4;i++)await command(clients[i]!,{type:"ROOM_COMMAND",commandId:`join${i}`,command:"JOIN_ROOM",payload:{roomCode,password:null,asSpectator:false}},"room");
   const latestRoom=(client:TestClient)=>{const snaps=client.messages.filter(entry=>entry.type==="MESSAGE"&&entry.channel==="room"&&entry.message.type==="ROOM_SNAPSHOT").map(entry=>entry.message);return snaps.sort((a,b)=>b.roomRevision-a.roomRevision)[0]!;};
   for(let i=0;i<4;i++){const latest=latestRoom(clients[i]!);await command(clients[i]!,{type:"ROOM_COMMAND",commandId:`ready${i}`,roomId:latest.roomId,expectedRoomRevision:latest.roomRevision,command:"SET_READY",payload:{ready:true}},"room");}
   await command(clients[0]!,{type:"ROOM_COMMAND",commandId:"start",roomId:latestRoom(clients[0]!).roomId,expectedRoomRevision:latestRoom(clients[0]!).roomRevision,command:"START_GAME",payload:{}},"room");
   for(let i=0;i<4;i++)await waitFor([clients[i]!],[{client:clients[i]!,index:0}],entry=>entry.type==="MESSAGE"&&entry.channel==="room"&&entry.message.type==="ROOM_SNAPSHOT"&&entry.message.phase==="characterSelection");
   // 锁定角色 → 进入红换阶段
   const selectionSnaps:any[]=[];for(let i=0;i<4;i++)selectionSnaps.push((await waitFor([clients[i]!],[{client:clients[i]!,index:0}],entry=>entry.type==="MESSAGE"&&entry.channel==="room"&&entry.message.type==="ROOM_SNAPSHOT"&&entry.message.phase==="characterSelection"&&entry.message.characterSelection)).message);
   for(let i=0;i<4;i++){const latest=latestRoom(clients[i]!),candidates=selectionSnaps[i]!.characterSelection.candidates as Array<{characterId:string}>,avoid=["character.punching_bag","character.interdimensional_traveler"],pick=candidates.find(candidate=>!avoid.includes(candidate.characterId))??candidates[0]!;await command(clients[i]!,{type:"ROOM_COMMAND",commandId:`lock${i}`,roomId:latest.roomId,expectedRoomRevision:latest.roomRevision,command:"LOCK_CHARACTER",payload:{characterId:pick.characterId}},"room");}
   for(let i=0;i<4;i++)await waitFor([clients[i]!],[{client:clients[i]!,index:0}],entry=>entry.type==="MESSAGE"&&entry.channel==="game"&&entry.message.type==="SETUP_SNAPSHOT");
   // 对局已开始：确认房间 inGame、有 game 快照
   const roomBefore=rooms.roomForUser(sessions[0]!.userId)!;
   expect(roomBefore.phase).toBe("inGame");
   expect(roomBefore.game!.lifecycle).toBe("setupRedraw");
   const setupSnap=(await waitFor([clients[0]!],[{client:clients[0]!,index:0}],entry=>entry.type==="MESSAGE"&&entry.channel==="game"&&entry.message.type==="SETUP_SNAPSHOT")).message;
   // 玩家 1 在红换阶段直接退出本局
   const gameRevision=roomBefore.game!.stateRevision;
   await command(clients[0]!,{type:"GAME_COMMAND",commandId:"forfeit",gameId:setupSnap.gameId,expectedStateRevision:gameRevision,command:"FORFEIT",payload:{}},"game");
   // FORFEIT 应立即解散房间
   expect(roomBefore.phase).toBe("closed");
   expect(roomBefore.players).toHaveLength(0);
   expect(roomBefore.game!.lifecycle).toBe("ended");
   expect(roomBefore.game!.forfeited).toBe(true);
   for(const session of sessions)expect(rooms.roomForUser(session.userId)).toBeNull();
   // 四名玩家都应收到 LOBBY_SNAPSHOT，回到大厅
   for(let i=0;i<4;i++){const lobby=await waitFor([clients[i]!],[{client:clients[i]!,index:0}],entry=>entry.type==="MESSAGE"&&entry.channel==="room"&&entry.message.type==="LOBBY_SNAPSHOT");expect(lobby?.message.type).toBe("LOBBY_SNAPSHOT");}
  }finally{for(const client of clients)client.close();await server.close();}
 },120000);
});
