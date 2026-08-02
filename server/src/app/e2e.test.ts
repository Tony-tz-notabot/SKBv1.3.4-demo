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
import {validateProtocol} from "./protocol.js";

let ruleset:LoadedRuleset;const dirs:string[]=[];
beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});
afterEach(async()=>{await Promise.all(dirs.splice(0).map(path=>rm(path,{recursive:true,force:true,maxRetries:5,retryDelay:100})));});
const settings={roomName:"E2E",allowGuests:true,allowSpectators:true,turnTimeSeconds:60,responseTimeSeconds:30,reserveTimeSeconds:30,rulesetVersion:"1.3.4" as const,dismantleBossEnabled:true};
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
type WireEntry={type:"MESSAGE"|"COMMAND_RESULT"|"PONG";channel?:"room"|"game";message?:any;seq:number};

class TestClient{
 readonly messages:WireEntry[]=[];private seq=0;
 readonly open:Promise<void>;
 constructor(private readonly socket:WebSocket){this.open=new Promise((resolve,reject)=>{socket.once("open",()=>resolve());socket.once("error",reject);});socket.on("message",raw=>this.accept(String(raw)));}
 send(message:unknown){this.socket.send(JSON.stringify(message));}
 close(){if(this.socket.readyState===this.socket.OPEN)this.socket.close();else this.socket.terminate();}
 private accept(raw:string){const wire=JSON.parse(raw) as WireEntry;wire.seq=++this.seq;if(wire.type==="MESSAGE"||wire.type==="COMMAND_RESULT"){const result=validateProtocol(wire.channel!,wire.message);if(!result.ok)throw new Error(`E2E protocol invalid: ${result.errors.join("; ")}`);}this.messages.push(wire);}
}

type WaitStart={client:TestClient;index:number};
const starts=(clients:TestClient[])=>clients.map(client=>({client,index:client.messages.length}));
async function waitFor(clients:TestClient[],start:WaitStart[],predicate:(entry:WireEntry)=>boolean,timeout=12000){const deadline=Date.now()+timeout;while(Date.now()<deadline){for(const item of start){const entry=item.client.messages.slice(item.index).find(predicate);if(entry)return entry;}await delay(20);}throw new Error(`E2E wait timeout: ${JSON.stringify(clients.flatMap(client=>client.messages.map(entry=>({type:entry.type,channel:entry.channel,messageType:entry.message?.type,commandId:entry.message?.commandId}))))}`);}
async function command(client:TestClient,message:any,channel:"room"|"game"){const start=starts([client]);client.send({type:"COMMAND",channel,command:message});const entry=await waitFor([client],start,item=>item.type==="COMMAND_RESULT"&&item.channel===channel&&item.message.commandId===message.commandId);if(!String(entry.message.type).endsWith("ACCEPTED"))throw new Error(`E2E command rejected: ${entry.message.reasonCode}`);return entry.message;}
async function snapshotFor(clients:TestClient[],channel:"room"|"game",predicate:(message:any)=>boolean){const existing=clients.flatMap(client=>client.messages.filter(entry=>entry.type==="MESSAGE"&&entry.channel===channel&&predicate(entry.message)));if(existing.length)return existing[0]!;const start=starts(clients);return waitFor(clients,start,entry=>entry.type==="MESSAGE"&&entry.channel===channel&&predicate(entry.message));}
let drainSeq=0;
async function drainWindows(clients:TestClient[],rooms:RoomService,userId:string,gameId:string){
 for(let guard=0;guard<60;guard+=1){
  const room=rooms.roomForUser(userId)!;if(!room.game)return;
  const window=room.game.pendingWindows[0];if(!window)return;
  if(window.kind==="playPhaseAction"||window.kind==="discardPhaseAction")return;
  const seat=window.prioritySeat,client=clients[seat-1];
  if(!client)throw new Error(`E2E drain no client for seat ${seat}`);
  const matches=client.messages.filter(entry=>entry.type==="MESSAGE"&&entry.channel==="game"&&entry.message.type==="GAME_SNAPSHOT"&&entry.message.viewer.seat===seat&&entry.message.interaction.prompt?.promptId===window.promptId);
  let snap:any=matches.at(-1)?.message;
  if(!snap){const start=starts([client]);snap=(await waitFor([client],start,entry=>entry.type==="MESSAGE"&&entry.channel==="game"&&entry.message.type==="GAME_SNAPSHOT"&&entry.message.viewer.seat===seat&&entry.message.interaction.prompt?.promptId===window.promptId)).message;}
  const offers=snap.interaction.offers as any[],offer=offers.find((item:any)=>item.offerId.includes(":pass:"))??offers[0];
  if(!offer)throw new Error(`E2E drain no offer for window ${window.kind}`);
  await command(client,{type:"GAME_COMMAND",commandId:`drain${drainSeq++}`,gameId,expectedStateRevision:room.game.stateRevision,promptId:snap.interaction.prompt.promptId,offerId:offer.offerId,command:"EXECUTE_OFFER",payload:{selections:{}}},"game");
 }
 throw new Error("E2E drain guard exceeded");
}

describe("real websocket four-player E2E",()=>{
 it("reaches a legal winner through real room, redraw, attack, response and elimination commands",async()=>{const dir=await mkdtemp(join(tmpdir(),"skb-e2e-")),persistence=new JsonPersistence(join(dir,"state.json")),rooms=new RoomService(ruleset,persistence);dirs.push(dir);await rooms.restore();const server=new SkbApplicationServer(rooms,ruleset);await server.listen(0);const port=(server.http.address() as AddressInfo).port,base=`http://127.0.0.1:${port}`;
  const sessions:Array<{token:string;userId:string;displayName:string}>=[];for(let i=0;i<5;i++){const response=await fetch(`${base}/api/session`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({displayName:`玩家${i+1}`})});sessions.push(await response.json() as {token:string;userId:string;displayName:string});}
  const clients=sessions.map(session=>new TestClient(new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(session.token)}`)));
  await Promise.all(clients.map(client=>client.open));
  try{
   const created=await command(clients[0]!,{type:"ROOM_COMMAND",commandId:"create",command:"CREATE_ROOM",payload:{settings,password:null}},"room");expect(created.type).toBe("ROOM_COMMAND_ACCEPTED");
   const roomSnap=(await waitFor([clients[0]!],[{client:clients[0]!,index:0}],entry=>entry.type==="MESSAGE"&&entry.channel==="room"&&entry.message.type==="ROOM_SNAPSHOT")).message,roomCode=roomSnap.roomCode;
   for(let i=1;i<5;i++)await command(clients[i]!,{type:"ROOM_COMMAND",commandId:`join${i}`,command:"JOIN_ROOM",payload:{roomCode,password:null,asSpectator:i===4}},"room");
   const latestRoom=(client:TestClient)=>{const snaps=client.messages.filter(entry=>entry.type==="MESSAGE"&&entry.channel==="room"&&entry.message.type==="ROOM_SNAPSHOT").map(entry=>entry.message);return snaps.sort((a,b)=>b.roomRevision-a.roomRevision)[0]!;};
   for(let i=0;i<4;i++){const latest=latestRoom(clients[i]!);await command(clients[i]!,{type:"ROOM_COMMAND",commandId:`ready${i}`,roomId:latest.roomId,expectedRoomRevision:latest.roomRevision,command:"SET_READY",payload:{ready:true}},"room");}
   await command(clients[0]!,{type:"ROOM_COMMAND",commandId:"start",roomId:latestRoom(clients[0]!).roomId,expectedRoomRevision:latestRoom(clients[0]!).roomRevision,command:"START_GAME",payload:{}},"room");
   const selectionSnaps:any[]=[];for(let i=0;i<4;i++)selectionSnaps.push((await waitFor([clients[i]!],[{client:clients[i]!,index:0}],entry=>entry.type==="MESSAGE"&&entry.channel==="room"&&entry.message.type==="ROOM_SNAPSHOT"&&entry.message.phase==="characterSelection"&&entry.message.characterSelection)).message);
   for(let i=0;i<4;i++){const latest=latestRoom(clients[i]!),candidates=selectionSnaps[i]!.characterSelection.candidates as Array<{characterId:string}>,avoid=["character.punching_bag","character.interdimensional_traveler",...(i===0?["character.shaman"]:[])],pick=candidates.find(candidate=>!avoid.includes(candidate.characterId))??candidates[0]!;await command(clients[i]!,{type:"ROOM_COMMAND",commandId:`lock${i}`,roomId:latest.roomId,expectedRoomRevision:latest.roomRevision,command:"LOCK_CHARACTER",payload:{characterId:pick.characterId}},"room");}
   const setupSnaps:any[]=[];for(let i=0;i<4;i++)setupSnaps.push((await waitFor([clients[i]!],[{client:clients[i]!,index:0}],entry=>entry.type==="MESSAGE"&&entry.channel==="game"&&entry.message.type==="SETUP_SNAPSHOT")).message);
   const room=rooms.roomForUser(sessions[0]!.userId)!;let gameRevision=room.game!.stateRevision;for(let i=0;i<4;i++){await command(clients[i]!,{type:"GAME_COMMAND",commandId:`redraw${i}`,gameId:setupSnaps[i]!.gameId,expectedStateRevision:gameRevision,promptId:setupSnaps[i]!.interaction.prompt.promptId,offerId:setupSnaps[i]!.interaction.offers[0]!.offerId,command:"EXECUTE_OFFER",payload:{selections:{confirm:[false]}}},"game");gameRevision=room.game!.stateRevision;}
   const game=room.game!;const kills=Object.values(game.cards).filter(card=>card.templateId.startsWith("basic.kill.")).slice(0,2);for(const card of kills){const from=game.zones[card.zoneRef]!;if(from.zoneRef!=="hand:1"){from.orderedCardRefs.splice(from.orderedCardRefs.indexOf(card.cardRef),1);game.zones["hand:1"]!.orderedCardRefs.push(card.cardRef);Object.assign(card,{zoneRef:"hand:1",ownerSeat:1,controllerSeat:1,faceUp:false});}}
   for(const seat of[2,3]as const){const target=game.players.find(player=>player.seat===seat)!;target.hp=1;target.shield=0;for(const ref of[...game.zones[`hand:${seat}`]!.orderedCardRefs]){game.zones[`hand:${seat}`]!.orderedCardRefs.splice(game.zones[`hand:${seat}`]!.orderedCardRefs.indexOf(ref),1);game.zones.drawPile!.orderedCardRefs.push(ref);const card=game.cards[ref]!;Object.assign(card,{zoneRef:"drawPile",ownerSeat:null,controllerSeat:null,faceUp:false});}}
   game.players[0]!.limits.attackCountRemaining=2;
   const preselectResult=await command(clients[0]!,{type:"GAME_COMMAND",commandId:"preselect",gameId:game.gameId,expectedStateRevision:game.stateRevision,command:"SET_PRESELECTION",payload:{weaponSlot:"weapon:1:1",modeId:null}},"game");let lastGameRevision=preselectResult.stateRevision;
   for(const targetSeat of[2,3]as const){
    const loopRoom=rooms.roomForUser(sessions[0]!.userId)!.game!;
    let playWindow=loopRoom.pendingWindows.find((w:any)=>w.kind==="playPhaseAction"&&w.prioritySeat===1);
    for(let guard=0;!playWindow&&guard<600;guard+=1){await delay(20);playWindow=rooms.roomForUser(sessions[0]!.userId)!.game!.pendingWindows.find((w:any)=>w.kind==="playPhaseAction"&&w.prioritySeat===1);}
    if(!playWindow)throw new Error("E2E no play window for attack");
    const hostClient=clients[0]!,hostPromptId=playWindow.promptId;
    let hostMsg=hostClient.messages.find(entry=>entry.type==="MESSAGE"&&entry.channel==="game"&&entry.message.type==="GAME_SNAPSHOT"&&entry.message.viewer.seat===1&&entry.message.interaction.prompt?.promptId===hostPromptId&&entry.message.interaction.offers.some((offer:any)=>offer.kind==="declareAttack"));
    if(!hostMsg)hostMsg=await waitFor([hostClient],[{client:hostClient,index:0}],entry=>entry.type==="MESSAGE"&&entry.channel==="game"&&entry.message.type==="GAME_SNAPSHOT"&&entry.message.viewer.seat===1&&entry.message.interaction.prompt?.promptId===hostPromptId&&entry.message.interaction.offers.some((offer:any)=>offer.kind==="declareAttack"));
    const hostSnap=hostMsg.message,offer=hostSnap.interaction.offers.find((item:any)=>item.kind==="declareAttack"),killSpec=offer.selectionSpecs.find((spec:any)=>spec.key==="killCards")??offer.selectionSpecs.find((spec:any)=>spec.kind==="cards"),killRef=killSpec?.legalRefs?.[0];
    const attackResult=await command(clients[0]!,{type:"GAME_COMMAND",commandId:`attack${targetSeat}`,gameId:hostSnap.gameId,expectedStateRevision:rooms.roomForUser(sessions[0]!.userId)!.game!.stateRevision,promptId:hostSnap.interaction.prompt.promptId,offerId:offer.offerId,command:"EXECUTE_OFFER",payload:{selections:{killCards:[killRef],targets:[`public:seat_${targetSeat}`]}}},"game");lastGameRevision=attackResult.stateRevision;
    const targetIndex=targetSeat-1,responseMatches=clients[targetIndex]!.messages.filter(entry=>entry.type==="MESSAGE"&&entry.channel==="game"&&entry.message.type==="GAME_SNAPSHOT"&&entry.message.viewer.seat===targetSeat&&entry.message.stateRevision>=attackResult.stateRevision&&entry.message.interaction.prompt?.kind==="attackResponse"),responseSnap=(responseMatches.at(-1)??(await waitFor([clients[targetIndex]!],[{client:clients[targetIndex]!,index:0}],entry=>entry.type==="MESSAGE"&&entry.channel==="game"&&entry.message.type==="GAME_SNAPSHOT"&&entry.message.viewer.seat===targetSeat&&entry.message.stateRevision>=attackResult.stateRevision&&entry.message.interaction.prompt?.kind==="attackResponse"))).message,pass=responseSnap.interaction.offers.find((item:any)=>item.offerId.includes(":pass:"));
    const passResult=await command(clients[targetIndex]!,{type:"GAME_COMMAND",commandId:`pass${targetSeat}`,gameId:responseSnap.gameId,expectedStateRevision:rooms.roomForUser(sessions[0]!.userId)!.game!.stateRevision,promptId:responseSnap.interaction.prompt.promptId,offerId:pass.offerId,command:"EXECUTE_OFFER",payload:{selections:{}}},"game");lastGameRevision=passResult.stateRevision;
    await drainWindows(clients,rooms,sessions[0]!.userId,responseSnap.gameId);lastGameRevision=rooms.roomForUser(sessions[0]!.userId)!.game!.stateRevision;
   }
   const ended=await snapshotFor([clients[4]!],"game",message=>message.type==="GAME_SNAPSHOT"&&message.viewer.seat===null&&message.publicView.winnerTeam==="A");expect(ended.message.publicView.winnerTeam).toBe("A");
   const eventSeqs=clients.flatMap(client=>client.messages.filter(entry=>entry.type==="MESSAGE"&&entry.channel==="game"&&entry.message.type==="PRESENTATION_EVENT").map(entry=>entry.message.eventSeq)).sort((a,b)=>a-b);
   expect(eventSeqs.length).toBeGreaterThan(0);
   for(const client of clients){const seqs=client.messages.filter(entry=>entry.type==="MESSAGE"&&entry.channel==="game"&&entry.message.type==="PRESENTATION_EVENT").map(entry=>entry.message.eventSeq);for(let i=1;i<seqs.length;i+=1)expect(seqs[i]!).toBeGreaterThan(seqs[i-1]!);expect(new Set(seqs).size).toBe(seqs.length);}
  }finally{for(const client of clients)client.close();await server.close();}
 },120000);
});
