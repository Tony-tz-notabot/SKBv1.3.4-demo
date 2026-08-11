import {mkdtemp,rm} from "node:fs/promises";
import type {AddressInfo} from "node:net";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {afterEach,beforeAll,describe,expect,it} from "vitest";
import WebSocket from "ws";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {createInitialSetup,resolveInitialRedraw} from "../engine/setup.js";
import {runAutomaticScheduler} from "../engine/automaticScheduler.js";
import {JsonPersistence} from "./persistence.js";
import {RoomService} from "./roomService.js";
import {SkbApplicationServer} from "./server.js";

let ruleset:LoadedRuleset;const dirs:string[]=[];
beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});
afterEach(async()=>{await Promise.all(dirs.splice(0).map(path=>rm(path,{recursive:true,force:true,maxRetries:5,retryDelay:100})));});
const settings={roomName:"T-E2E",allowGuests:true,allowSpectators:true,turnTimeSeconds:60,responseTimeSeconds:30,reserveTimeSeconds:30,rulesetVersion:"1.3.4" as const,dismantleBossEnabled:true};
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
type WireEntry={type:"MESSAGE"|"COMMAND_RESULT"|"PONG";channel?:"room"|"game";message?:any;seq:number};
class TestClient{
 readonly messages:WireEntry[]=[];private seq=0;
 readonly open:Promise<void>;
 constructor(private readonly socket:WebSocket){this.open=new Promise((res,rej)=>{socket.once("open",()=>res());socket.once("error",rej);});socket.on("message",raw=>this.accept(String(raw)));}
 send(message:unknown){this.socket.send(JSON.stringify(message));}
 close(){if(this.socket.readyState===this.socket.OPEN)this.socket.close();else this.socket.terminate();}
 private accept(raw:string){this.messages.push(JSON.parse(raw) as WireEntry);}
}
type WaitStart={client:TestClient;index:number};
const starts=(clients:TestClient[])=>clients.map(client=>({client,index:client.messages.length}));
async function waitFor(clients:TestClient[],start:WaitStart[],predicate:(e:WireEntry)=>boolean,timeout=12000){const deadline=Date.now()+timeout;while(Date.now()<deadline){for(const item of start){const entry=item.client.messages.slice(item.index).find(predicate);if(entry)return entry;}await delay(20);}throw new Error("timeout-e2e wait timeout");}
async function command(client:TestClient,message:any,channel:"room"|"game"){const start=starts([client]);client.send({type:"COMMAND",channel,command:message});const entry=await waitFor([client],start,item=>item.type==="COMMAND_RESULT"&&item.channel===channel&&item.message.commandId===message.commandId);if(!String(entry.message.type).endsWith("ACCEPTED"))throw new Error(`timeout-e2e rejected: ${entry.message.reasonCode}`);return entry.message;}
async function openSocket(base:string,token:string){const socket=new WebSocket(`ws://127.0.0.1:${new URL(base).port}/ws?token=${encodeURIComponent(token)}`);const client=new TestClient(socket);await new Promise<void>((res,rej)=>{socket.once("open",()=>res());socket.once("error",rej);});return client;}

describe("timeout and reconnect within one E2E script",()=>{
 it("reconnects a disconnected player, resumes the snapshot, and times out a pending play window",async()=>{const dir=await mkdtemp(join(tmpdir(),"skb-te2e-")),persistence=new JsonPersistence(join(dir,"state.json")),rooms=new RoomService(ruleset,persistence);dirs.push(dir);await rooms.restore();const server=new SkbApplicationServer(rooms,ruleset);await server.listen(0);const port=(server.http.address() as AddressInfo).port,base=`http://127.0.0.1:${port}`;
  const sessions:Array<{token:string;userId:string;displayName:string}>=[];for(let i=0;i<5;i++){const response=await fetch(`${base}/api/session`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:`玩家${i+1}`,password:"test123"})});sessions.push(await response.json() as {token:string;userId:string;displayName:string});}
  const clients=sessions.map(session=>new TestClient(new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(session.token)}`)));await Promise.all(clients.map(client=>client.open));
  try{
   await command(clients[0]!,{type:"ROOM_COMMAND",commandId:"create",command:"CREATE_ROOM",payload:{settings,password:null}},"room");
   const roomSnap=(await waitFor([clients[0]!],[{client:clients[0]!,index:0}],e=>e.type==="MESSAGE"&&e.channel==="room"&&e.message.type==="ROOM_SNAPSHOT")).message,roomCode=roomSnap.roomCode;
   for(let i=1;i<5;i++)await command(clients[i]!,{type:"ROOM_COMMAND",commandId:`join${i}`,command:"JOIN_ROOM",payload:{roomCode,password:null,asSpectator:i===4}},"room");
   const latestRoom=(client:TestClient)=>{const snaps=client.messages.filter(e=>e.type==="MESSAGE"&&e.channel==="room"&&e.message.type==="ROOM_SNAPSHOT").map(e=>e.message);return snaps.sort((a,b)=>b.roomRevision-a.roomRevision)[0]!;};
   for(let i=0;i<4;i++){const latest=latestRoom(clients[i]!);await command(clients[i]!,{type:"ROOM_COMMAND",commandId:`ready${i}`,roomId:latest.roomId,expectedRoomRevision:latest.roomRevision,command:"SET_READY",payload:{ready:true}},"room");}
   await command(clients[0]!,{type:"ROOM_COMMAND",commandId:"start",roomId:latestRoom(clients[0]!).roomId,expectedRoomRevision:latestRoom(clients[0]!).roomRevision,command:"START_GAME",payload:{}},"room");
   const selectionSnaps:any[]=[];for(let i=0;i<4;i++)selectionSnaps.push((await waitFor([clients[i]!],[{client:clients[i]!,index:0}],e=>e.type==="MESSAGE"&&e.channel==="room"&&e.message.type==="ROOM_SNAPSHOT"&&e.message.phase==="characterSelection"&&e.message.characterSelection)).message);
   for(let i=0;i<4;i++){const latest=latestRoom(clients[i]!),candidates=selectionSnaps[i]!.characterSelection.candidates,avoid=["character.punching_bag","character.interdimensional_traveler","character.general","character.engineer","character.shaman","character.berserker"],pick=candidates.find((c:any)=>!avoid.includes(c.characterId))??candidates[0]!;await command(clients[i]!,{type:"ROOM_COMMAND",commandId:`lock${i}`,roomId:latest.roomId,expectedRoomRevision:latest.roomRevision,command:"LOCK_CHARACTER",payload:{characterId:pick.characterId}},"room");}
   const setupSnaps:any[]=[];for(let i=0;i<4;i++)setupSnaps.push((await waitFor([clients[i]!],[{client:clients[i]!,index:0}],e=>e.type==="MESSAGE"&&e.channel==="game"&&e.message.type==="SETUP_SNAPSHOT")).message);
   const room=rooms.roomForUser(sessions[0]!.userId)!;let gameRevision=room.game!.stateRevision;for(let i=0;i<4;i++){await command(clients[i]!,{type:"GAME_COMMAND",commandId:`redraw${i}`,gameId:setupSnaps[i]!.gameId,expectedStateRevision:gameRevision,promptId:setupSnaps[i]!.interaction.prompt.promptId,offerId:setupSnaps[i]!.interaction.offers[0]!.offerId,command:"EXECUTE_OFFER",payload:{selections:{confirm:[false]}}},"game");gameRevision=room.game!.stateRevision;}
   const game=room.game!;const kills=Object.values(game.cards).filter(card=>card.templateId.startsWith("basic.kill.")).slice(0,2);for(const card of kills){const from=game.zones[card.zoneRef]!;if(from.zoneRef!=="hand:1"){from.orderedCardRefs.splice(from.orderedCardRefs.indexOf(card.cardRef),1);game.zones["hand:1"]!.orderedCardRefs.push(card.cardRef);Object.assign(card,{zoneRef:"hand:1",ownerSeat:1,controllerSeat:1,faceUp:false});}}
   const target=game.players.find(p=>p.seat===2)!;target.hp=1;target.shield=0;for(const ref of[...game.zones["hand:2"]!.orderedCardRefs]){game.zones["hand:2"]!.orderedCardRefs.splice(game.zones["hand:2"]!.orderedCardRefs.indexOf(ref),1);game.zones.drawPile!.orderedCardRefs.push(ref);Object.assign(game.cards[ref]!,{zoneRef:"drawPile",ownerSeat:null,controllerSeat:null,faceUp:false});}
   game.players[0]!.limits.attackCountRemaining=2;
   await command(clients[0]!,{type:"GAME_COMMAND",commandId:"preselect",gameId:game.gameId,expectedStateRevision:game.stateRevision,command:"SET_PRESELECTION",payload:{weaponSlot:"weapon:1:1",modeId:null}},"game");
   const hostSnap=(await waitFor([clients[0]!],[{client:clients[0]!,index:0}],e=>e.type==="MESSAGE"&&e.channel==="game"&&e.message.type==="GAME_SNAPSHOT"&&e.message.viewer.seat===1&&e.message.interaction.offers.some((o:any)=>o.kind==="declareAttack"))).message,offer=hostSnap.interaction.offers.find((o:any)=>o.kind==="declareAttack"),killSpec=offer.selectionSpecs.find((s:any)=>s.key==="killCards")??offer.selectionSpecs.find((s:any)=>s.kind==="cards"),killRef=killSpec?.legalRefs?.[0];
   await command(clients[0]!,{type:"GAME_COMMAND",commandId:"attack2",gameId:hostSnap.gameId,expectedStateRevision:rooms.roomForUser(sessions[0]!.userId)!.game!.stateRevision,promptId:hostSnap.interaction.prompt.promptId,offerId:offer.offerId,command:"EXECUTE_OFFER",payload:{selections:{killCards:[killRef],targets:["public:seat_2"]}}},"game");
   const responseSnap=(await waitFor([clients[1]!],[{client:clients[1]!,index:0}],e=>e.type==="MESSAGE"&&e.channel==="game"&&e.message.type==="GAME_SNAPSHOT"&&e.message.viewer.seat===2&&e.message.interaction.prompt?.kind==="attackResponse")).message,pass=responseSnap.interaction.offers.find((o:any)=>o.offerId.includes(":pass:"));
   await command(clients[1]!,{type:"GAME_COMMAND",commandId:"pass2",gameId:responseSnap.gameId,expectedStateRevision:rooms.roomForUser(sessions[0]!.userId)!.game!.stateRevision,promptId:responseSnap.interaction.prompt.promptId,offerId:pass.offerId,command:"EXECUTE_OFFER",payload:{selections:{}}},"game");
   // 断线重连：seat2 玩家断开后用同 token 重连，应收到恢复的房间与对局快照
   clients[1]!.close();await delay(250);
   expect(rooms.roomForUser(sessions[1]!.userId)!.players.find(p=>p.userId===sessions[1]!.userId)!.connection).toBe("reconnecting");
   const reconnected=await openSocket(base,sessions[1]!.token);
   const restoredRoom=await waitFor([reconnected],[{client:reconnected,index:0}],e=>e.type==="MESSAGE"&&e.channel==="room"&&e.message.type==="ROOM_SNAPSHOT"&&e.message.roomCode===roomCode);
   expect(restoredRoom).toBeTruthy();await waitFor([reconnected],[{client:reconnected,index:0}],e=>e.type==="MESSAGE"&&e.channel==="game"&&e.message.type==="GAME_SNAPSHOT"&&e.message.viewer.seat===2);
   expect(rooms.roomForUser(sessions[1]!.userId)!.players.find(p=>p.userId===sessions[1]!.userId)!.connection).toBe("online");
   // 阶段超时：把当前 playPhaseAction 窗口 deadline 设为过去，等待服务器 tick 超时处理
   const beforeTimeout=rooms.roomForUser(sessions[0]!.userId)!.game!.pendingWindows[0]!;
   beforeTimeout.deadlineAt=Date.now()-1;
   const beforePrompt=beforeTimeout.promptId,waitDeadline=Date.now()+8000;
   let afterTimeout=rooms.roomForUser(sessions[0]!.userId)!.game!.pendingWindows[0]!;
   while(afterTimeout.promptId===beforePrompt&&Date.now()<waitDeadline){await delay(50);afterTimeout=rooms.roomForUser(sessions[0]!.userId)!.game!.pendingWindows[0]!;}
   expect(afterTimeout.promptId).not.toBe(beforePrompt);
   reconnected.close();
  }finally{for(const client of clients)client.close();await server.close();}
 },120000);
 it("shaman foresight draw window blocks automatic advance to the play phase (why the E2E must avoid it)",async()=>{
  let state=createInitialSetup(ruleset,{gameId:"shaman-block",firstSeat:1,seed:42,usersBySeat:{1:"u1",2:"u2",3:"u3",4:"u4"},characterIdsBySeat:{1:"character.shaman",2:"character.knight",3:"character.ranger",4:"character.wizard"}});
  for(const seat of[1,2,3,4]as const)state=resolveInitialRedraw(state,seat,false,ruleset).state;
  const ran=runAutomaticScheduler(state,ruleset,()=>Date.now()+30000);
  expect(ran.state.pendingWindows[0]?.kind).toBe("foresightDrawChoice");
  expect(ran.state.phase).toBe("draw");
 });
 it("engineer does not block the first turn advance (mech window only opens on later prepares)",async()=>{
  let state=createInitialSetup(ruleset,{gameId:"engineer-block",firstSeat:1,seed:43,usersBySeat:{1:"u1",2:"u2",3:"u3",4:"u4"},characterIdsBySeat:{1:"character.engineer",2:"character.knight",3:"character.ranger",4:"character.wizard"}});
  for(const seat of[1,2,3,4]as const)state=resolveInitialRedraw(state,seat,false,ruleset).state;
  const ran=runAutomaticScheduler(state,ruleset,()=>Date.now()+30000);
  expect(ran.state.pendingWindows[0]?.kind).toBe("playPhaseAction");
 });
 it("berserker rage window blocks automatic advance before the draw phase (why the E2E must avoid it)",async()=>{
  let state=createInitialSetup(ruleset,{gameId:"berserker-block",firstSeat:1,seed:44,usersBySeat:{1:"u1",2:"u2",3:"u3",4:"u4"},characterIdsBySeat:{1:"character.berserker",2:"character.knight",3:"character.ranger",4:"character.wizard"}});
  for(const seat of[1,2,3,4]as const)state=resolveInitialRedraw(state,seat,false,ruleset).state;
  const ran=runAutomaticScheduler(state,ruleset,()=>Date.now()+30000);
  expect(ran.state.pendingWindows[0]?.kind).toBe("berserkerRage");
  expect(ran.state.phase).toBe("draw");
 });
});
