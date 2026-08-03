// 真实四人完整牌局 E2E：四客户端通过真实 WS 命令自动推进多回合对局，
// 覆盖出牌攻击/装备/合成、攻击响应、濒死、弃牌与回合推进，直到合法胜负。
// 与 e2e.test.ts（篡改权威状态）不同：本测试不修改任何引擎状态。
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
const settings={roomName:"FULL",allowGuests:true,allowSpectators:true,turnTimeSeconds:60,responseTimeSeconds:30,reserveTimeSeconds:30,rulesetVersion:"1.3.4" as const,dismantleBossEnabled:true};
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
type WireEntry={type:"MESSAGE"|"COMMAND_RESULT"|"PONG";channel?:"room"|"game";message?:any;seq:number};

class TestClient{
 readonly messages:WireEntry[]=[];private seq=0;
 readonly open:Promise<void>;
 constructor(private readonly socket:WebSocket){this.open=new Promise((resolve,reject)=>{socket.once("open",()=>resolve());socket.once("error",reject);});socket.on("message",raw=>this.accept(String(raw)));}
 send(message:unknown){this.socket.send(JSON.stringify(message));}
 close(){if(this.socket.readyState===this.socket.OPEN)this.socket.close();else this.socket.terminate();}
 private accept(raw:string){const wire=JSON.parse(raw) as WireEntry;wire.seq=++this.seq;if(wire.type==="MESSAGE"||wire.type==="COMMAND_RESULT"){const result=validateProtocol(wire.channel!,wire.message);if(!result.ok)throw new Error(`FULL protocol invalid: ${result.errors.join("; ")} :: RAW=${raw.slice(0,600)}`);}if(wire.type==="MESSAGE"&&wire.channel==="game"&&wire.message?.type==="GAME_SNAPSHOT"&&wire.message.interaction?.prompt){if(wire.message.interaction.prompt.deadlineAt<=wire.message.serverTime)throw new Error(`FULL zero-deadline window: kind=${wire.message.interaction.prompt.kind} deadlineAt=${wire.message.interaction.prompt.deadlineAt} serverTime=${wire.message.serverTime} RAW=${raw.slice(0,300)}`);}this.messages.push(wire);}
}

const starts=(clients:TestClient[])=>clients.map(client=>({client,index:client.messages.length}));
async function waitFor(clients:TestClient[],start:{client:TestClient;index:number}[],predicate:(entry:WireEntry)=>boolean,timeout=15000){const deadline=Date.now()+timeout;while(Date.now()<deadline){for(const item of start){const entry=item.client.messages.slice(item.index).find(predicate);if(entry)return entry;}await delay(20);}throw new Error(`FULL wait timeout: ${JSON.stringify(clients.flatMap(client=>client.messages.map(entry=>({type:entry.type,channel:entry.channel,messageType:entry.message?.type,commandId:entry.message?.commandId}))))}`);}
async function command(client:TestClient,message:any,channel:"room"|"game"){const start=starts([client]);client.send({type:"COMMAND",channel,command:message});const entry=await waitFor([client],start,item=>item.type==="COMMAND_RESULT"&&item.channel===channel&&item.message.commandId===message.commandId);if(!String(entry.message.type).endsWith("ACCEPTED"))throw new Error(`FULL command rejected: ${entry.message.reasonCode} cmd=${message.command} win=${message.promptId?.slice(0,12)}`);return entry.message;}

function latestRoom(client:TestClient){const snaps=client.messages.filter(entry=>entry.type==="MESSAGE"&&entry.channel==="room"&&entry.message.type==="ROOM_SNAPSHOT").map(entry=>entry.message);return snaps.sort((a,b)=>b.roomRevision-a.roomRevision)[0]!;}
function latestSnapFor(client:TestClient,seat:number,promptId:string){const snaps=client.messages.filter(entry=>entry.type==="MESSAGE"&&entry.channel==="game"&&entry.message.type==="GAME_SNAPSHOT"&&entry.message.viewer.seat===seat&&entry.message.interaction.prompt?.promptId===promptId);return snaps.at(-1)?.message;}

// AI 决策：优先攻击（选对手目标），其次装备/合成，最后 pass/finish。
function choose(snap:any):{offerId:string;selections:Record<string,unknown[]>}|null{
 const offers=snap.interaction.offers as any[];if(!offers.length)return null;
 const seat=snap.viewer.seat;
 const attack=offers.find((o:any)=>String(o.offerId).includes("attack"));
 if(attack){const specs=attack.selectionSpecs as any[],kill=specs.find((s:any)=>s.key==="killCards"),targets=specs.find((s:any)=>s.key==="targets"),confirm=specs.find((s:any)=>s.key==="confirm");const enemy=targets?.legalRefs?.find((r:string)=>!r.endsWith(`seat_${seat}`))??targets?.legalRefs?.[0];if(kill?.legalRefs?.[0]&&enemy){const selections:Record<string,unknown[]>={killCards:[kill.legalRefs[0]],targets:[enemy]};if(confirm)selections.confirm=[true];return{offerId:attack.offerId,selections};}}
 const gain=offers.find((o:any)=>String(o.offerId).includes("equip")||String(o.offerId).includes("synthesis"));
 if(gain){const spec=gain.selectionSpecs?.find((s:any)=>s.legalRefs?.length);if(spec){const count=Math.min(Number(spec.min??1)||1,spec.legalRefs.length);const selections:Record<string,unknown[]>={[spec.key]:spec.legalRefs.slice(0,count)};return{offerId:gain.offerId,selections};}}
 const pass=offers.find((o:any)=>String(o.offerId).includes(":pass:")||String(o.offerId).includes("finish"));
 if(pass)return{offerId:pass.offerId,selections:{}};
 const first=offers.find((o:any)=>o.selectionSpecs?.length);
 if(first){const spec=first.selectionSpecs.find((s:any)=>s.legalRefs?.length);if(spec)return{offerId:first.offerId,selections:{[spec.key]:spec.legalRefs.slice(0,Math.min(Number(spec.min??1)||1,spec.legalRefs.length))}};return{offerId:first.offerId,selections:{}};}
 return{offerId:offers[0]!.offerId,selections:{}};
}
// 选择预选武器槽：优先已有武器的槽，全空则选第一个空槽（手刀）。
function pickPreselectSlot(snap:any):string|null{
 const slots=snap.privateView?.preselectableWeaponSlots as string[]|undefined;
 if(!slots?.length)return null;
 const me=snap.publicView?.players?.find((p:any)=>p.seat===snap.viewer.seat);
 const slotKeyOf=(slot:string)=>{if(slot.startsWith("thirdWeapon:"))return"thirdWeapon";const match=/^weapon:(\d):/.exec(slot);return match?`weapon${match[1]}`:null;};
 for(const slot of slots){const key=slotKeyOf(slot);if(key&&me?.equipmentSlots?.[key]?.cardRef)return slot;}
 return slots[0]??null;
}

describe("real four-player full match without state mutation",()=>{
 it("plays multi-round match through real commands to a legal winner",async()=>{const dir=await mkdtemp(join(tmpdir(),"skb-full-")),persistence=new JsonPersistence(join(dir,"state.json")),rooms=new RoomService(ruleset,persistence);dirs.push(dir);await rooms.restore();const server=new SkbApplicationServer(rooms,ruleset);await server.listen(0);const port=(server.http.address() as AddressInfo).port,base=`http://127.0.0.1:${port}`;
  const sessions:Array<{token:string;userId:string;displayName:string}>=[];for(let i=0;i<4;i++){const response=await fetch(`${base}/api/session`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:`牌局玩家${i+1}`,password:"test123"})});sessions.push(await response.json() as {token:string;userId:string;displayName:string});}
  const clients=sessions.map(session=>new TestClient(new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(session.token)}`)));
  await Promise.all(clients.map(client=>client.open));
  try{
   const created=await command(clients[0]!,{type:"ROOM_COMMAND",commandId:"create",command:"CREATE_ROOM",payload:{settings,password:null}},"room");expect(created.type).toBe("ROOM_COMMAND_ACCEPTED");
   const roomSnap=(await waitFor([clients[0]!],[{client:clients[0]!,index:0}],entry=>entry.type==="MESSAGE"&&entry.channel==="room"&&entry.message.type==="ROOM_SNAPSHOT")).message,roomCode=roomSnap.roomCode;
   for(let i=1;i<4;i++)await command(clients[i]!,{type:"ROOM_COMMAND",commandId:`join${i}`,command:"JOIN_ROOM",payload:{roomCode,password:null,asSpectator:false}},"room");
   for(let i=0;i<4;i++){const latest=latestRoom(clients[i]!);await command(clients[i]!,{type:"ROOM_COMMAND",commandId:`ready${i}`,roomId:latest.roomId,expectedRoomRevision:latest.roomRevision,command:"SET_READY",payload:{ready:true}},"room");}
   await command(clients[0]!,{type:"ROOM_COMMAND",commandId:"start",roomId:latestRoom(clients[0]!).roomId,expectedRoomRevision:latestRoom(clients[0]!).roomRevision,command:"START_GAME",payload:{}},"room");
   const selectionSnaps:any[]=[];for(let i=0;i<4;i++)selectionSnaps.push((await waitFor([clients[i]!],[{client:clients[i]!,index:0}],entry=>entry.type==="MESSAGE"&&entry.channel==="room"&&entry.message.type==="ROOM_SNAPSHOT"&&entry.message.phase==="characterSelection"&&entry.message.characterSelection)).message);
   const avoid=new Set(["character.punching_bag","character.interdimensional_traveler","character.general","character.engineer","character.giant_slime"]);
   for(let i=0;i<4;i++){const latest=latestRoom(clients[i]!),candidates=selectionSnaps[i]!.characterSelection.candidates as Array<{characterId:string}>,pick=candidates.find(candidate=>!avoid.has(candidate.characterId))??candidates[0]!;await command(clients[i]!,{type:"ROOM_COMMAND",commandId:`lock${i}`,roomId:latest.roomId,expectedRoomRevision:latest.roomRevision,command:"LOCK_CHARACTER",payload:{characterId:pick.characterId}},"room");}
   const setupSnaps:any[]=[];for(let i=0;i<4;i++)setupSnaps.push((await waitFor([clients[i]!],[{client:clients[i]!,index:0}],entry=>entry.type==="MESSAGE"&&entry.channel==="game"&&entry.message.type==="SETUP_SNAPSHOT")).message);
   const room=rooms.roomForUser(sessions[0]!.userId)!;for(let i=0;i<4;i++){await command(clients[i]!,{type:"GAME_COMMAND",commandId:`redraw${i}`,gameId:setupSnaps[i]!.gameId,expectedStateRevision:room.game!.stateRevision,promptId:setupSnaps[i]!.interaction.prompt.promptId,offerId:setupSnaps[i]!.interaction.offers[0]!.offerId,command:"EXECUTE_OFFER",payload:{selections:{confirm:[false]}}},"game");}
   // ---- 自动对局主循环（纯真实命令，不改状态） ----
   const deadline=Date.now()+240000;let guard=0,totalCommands=0,attackCount=0,lastRevision=-1,stall=0;
   for(;Date.now()<deadline&&guard<8000;guard+=1){
    const current=rooms.roomForUser(sessions[0]!.userId)!.game!;
    if(current.winnerTeam)break;
    const w=current.pendingWindows[0];
    if(!w){await delay(20);continue;}
    const seat=w.prioritySeat,client=clients[seat-1]!;
    let snap=latestSnapFor(client,seat,w.promptId);
    if(!snap){const start=starts([client]);snap=(await waitFor([client],start,entry=>entry.type==="MESSAGE"&&entry.channel==="game"&&entry.message.type==="GAME_SNAPSHOT"&&entry.message.viewer.seat===seat&&entry.message.interaction.prompt?.promptId===w.promptId)).message;}
    const decision=choose(snap);
    if(!decision)throw new Error(`FULL no offer for window ${w.kind} seat ${seat}: ${JSON.stringify(snap.interaction.offers.map((o:any)=>o.offerId))}`);
    const before=current.stateRevision;
    // 出牌阶段且尚未预选武器时，先预选（G021：无合法预选不能发起攻击）
    if(w.kind==="playPhaseAction"&&snap.privateView?.preselectedWeaponSlot==null){
     const slot=pickPreselectSlot(snap);
     if(slot){await command(client,{type:"GAME_COMMAND",commandId:`fullpresel${guard}`,gameId:current.gameId,expectedStateRevision:before,command:"SET_PRESELECTION",payload:{weaponSlot:slot,modeId:null}},"game");continue;}
    }
    const result=await command(client,{type:"GAME_COMMAND",commandId:`full${guard}`,gameId:current.gameId,expectedStateRevision:before,promptId:w.promptId,offerId:decision.offerId,command:"EXECUTE_OFFER",payload:{selections:decision.selections}},"game");
    totalCommands+=1;if(String(decision.offerId).includes("attack"))attackCount+=1;
    if(result.stateRevision===lastRevision)stall+=1;else stall=0;
    lastRevision=result.stateRevision;
    if(stall>25)throw new Error(`FULL stalled: repeated stateRevision ${lastRevision} at window ${w.kind} seat ${seat} offer ${decision.offerId}`);
   }
   const finalGame=rooms.roomForUser(sessions[0]!.userId)!.game!;
   expect(finalGame.winnerTeam,`expected a legal winner after ${guard} loops / ${totalCommands} commands / ${attackCount} attacks, last window=${finalGame.pendingWindows[0]?.kind}`).toBeTruthy();
   expect(["A","B"]).toContain(finalGame.winnerTeam);
   const eventSeqs=clients.flatMap(client=>client.messages.filter(entry=>entry.type==="MESSAGE"&&entry.channel==="game"&&entry.message.type==="PRESENTATION_EVENT").map(entry=>entry.message.eventSeq));
   expect(eventSeqs.length).toBeGreaterThan(0);
   for(const client of clients){const seqs=client.messages.filter(entry=>entry.type==="MESSAGE"&&entry.channel==="game"&&entry.message.type==="PRESENTATION_EVENT").map(entry=>entry.message.eventSeq);for(let i=1;i<seqs.length;i+=1)expect(seqs[i]!).toBeGreaterThan(seqs[i-1]!);}
   // 至少发生过一次实际伤害（攻防链路真实发生）
   const damageEvents=clients[0]!.messages.filter(entry=>entry.type==="MESSAGE"&&entry.channel==="game"&&entry.message.type==="PRESENTATION_EVENT"&&entry.message.eventType==="DAMAGE_SEGMENT_APPLIED");
   expect(damageEvents.length,`expected at least one damage segment, attacks=${attackCount}`).toBeGreaterThan(0);
  }finally{for(const client of clients)client.close();await server.close();}
 },300000);
});
