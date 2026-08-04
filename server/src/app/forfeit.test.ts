// 退出本局：任一玩家 FORFEIT = 自愿离开对局 → 该角色被淘汰（不判胜负、房间不结束）。
// 若己方（本队）全部淘汰则对方获胜、对局结束；剩余玩家仍留在房间里继续。
import {resolve} from "node:path";
import {beforeAll,describe,expect,it} from "vitest";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {runAutomaticScheduler} from "../engine/automaticScheduler.js";
import {commitAttack} from "../engine/attack.js";
import {resolveCurrentAttackTarget} from "../engine/damage.js";
import {openDyingRescue} from "../engine/dying.js";
import {setWeaponPreselection} from "../engine/preselection.js";
import {AttackResponseSession,openAttackResponse} from "../engine/response.js";
import {createInitialSetup,resolveInitialRedraw} from "../engine/setup.js";
import type {AuthoritativeGameState,Seat} from "../engine/state.js";
import {GameService} from "./gameService.js";
import {GameProjector} from "./projection.js";
import {validateProtocol} from "./protocol.js";
import type {AppRoom,AppSettings,AppUser} from "./types.js";

let ruleset:LoadedRuleset;
const settings:AppSettings={roomName:"退出局",allowGuests:true,allowSpectators:false,turnTimeSeconds:60,responseTimeSeconds:20,reserveTimeSeconds:30,rulesetVersion:"1.3.4",dismantleBossEnabled:true};
const users:Record<Seat,AppUser>={1:{userId:"u1",displayName:"一"},2:{userId:"u2",displayName:"二"},3:{userId:"u3",displayName:"三"},4:{userId:"u4",displayName:"四"}};
beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});
function openedState(seed=301):AuthoritativeGameState{let state=createInitialSetup(ruleset,{gameId:`forfeit-${seed}`,firstSeat:1,seed,usersBySeat:{1:"u1",2:"u2",3:"u3",4:"u4"},characterIdsBySeat:{1:"character.knight",2:"character.alchemist",3:"character.ranger",4:"character.wizard"}});for(const seat of[1,2,3,4]as Seat[])state=resolveInitialRedraw(state,seat,false,ruleset).state;const scheduled=runAutomaticScheduler(state,ruleset,()=>21000);state=scheduled.state;if(state.phase!=="play")throw new Error(`expected play phase, got ${state.phase}`);return state;}
function makeRoom(state:AuthoritativeGameState):AppRoom{return{roomId:state.gameId,roomCode:"QUIT",revision:1,phase:"inGame",settings,passwordHash:null,players:state.players.map(player=>({userId:player.userId,displayName:users[player.seat]!.displayName,seat:player.seat,team:player.team,isHost:player.seat===1,ready:true,connection:"online",latencyMs:null,selectionState:"revealed",candidates:[],preselectedCharacterId:null,lockedCharacterId:null,selectionDeadlineAt:null})),spectators:[],chat:[],gameChat:[],game:state,createdAt:0,updatedAt:0};}
function relocate(state:AuthoritativeGameState,ref:string,to:string){const card=state.cards[ref]!,from=state.zones[card.zoneRef]!;from.orderedCardRefs.splice(from.orderedCardRefs.indexOf(ref),1);state.zones[to]!.orderedCardRefs.push(ref);card.zoneRef=to;card.ownerSeat=state.zones[to]!.ownerSeat;card.controllerSeat=state.zones[to]!.ownerSeat;card.faceUp=!["drawPile","hand"].includes(state.zones[to]!.zoneType);}
function refFor(state:AuthoritativeGameState,prefix:string){return Object.values(state.cards).find(card=>card.templateId.startsWith(prefix))!.cardRef;}
function dyingState():AuthoritativeGameState{let state=createInitialSetup(ruleset,{gameId:"timeout-dying",firstSeat:1,seed:31,usersBySeat:{1:"u1",2:"u2",3:"u3",4:"u4"},characterIdsBySeat:{1:"character.knight",2:"character.alchemist",3:"character.ranger",4:"character.wizard"}});for(const seat of[1,2,3,4]as Seat[])state=resolveInitialRedraw(state,seat,false,ruleset).state;state.phase="play";state.phaseMode="manual";state.players[0]!.limits.attackCountRemaining=1;state.players[1]!.shield=0;state.players[1]!.hp=1;const kill=refFor(state,"basic.kill.");relocate(state,kill,"hand:1");state=setWeaponPreselection(state,1,"weapon:1:1",null,ruleset).state;state=commitAttack(state,ruleset,{attackerSeat:1,targetRefs:["character:2"],killCardRefs:[kill]}).state;state=openAttackResponse(state,ruleset,500).state;const responseWindow=state.pendingWindows[0]!,response=new AttackResponseSession(state);response.handle({commandId:"hit",gameId:state.gameId,expectedStateRevision:state.stateRevision,actorUserId:"u2",promptId:responseWindow.promptId,offerId:responseWindow.legalOfferIds.find(id=>id.includes(":pass:"))!});return resolveCurrentAttackTarget(response.state).state;}

describe("game forfeit（离开对局=淘汰）",()=>{
 it("marks the actor eliminated and keeps the room open when the team survives",()=>{
  const room=makeRoom(openedState(301)),service=new GameService(ruleset,()=>1000);
  // seat2 离开（其队友 seat3 仍在场）→ seat2 被淘汰，但 B 队仍有人存活 → 对局继续、房间不结束
  const result=service.handle(room,users[2]!,{type:"GAME_COMMAND",commandId:"forfeit-2",gameId:room.game!.gameId,expectedStateRevision:room.game!.stateRevision,command:"FORFEIT",payload:{}});
  expect(result.accepted).toBe(true);
  const seat2=room.game!.players.find(p=>p.seat===2)!;
  expect(seat2.lifeState).toBe("eliminated");
  expect(seat2.hp).toBeNull();expect(seat2.shield).toBeNull();
  expect(room.game!.lifecycle).toBe("inProgress");
  expect(room.game!.winnerTeam).toBeNull();
  expect(room.game!.pendingWindows.every(w=>w.prioritySeat!==2)).toBe(true);
  expect(room.phase).toBe("inGame");
  expect(room.players).toHaveLength(4);
 });
 it("ends the game with a team victory when leaving eliminates the whole team",()=>{
  const room=makeRoom(openedState(302)),service=new GameService(ruleset,()=>1000);
  // 预淘汰 seat3（B 队），seat2（B 队）离开 → B 队全灭 → A 队获胜
  const player3=room.game!.players.find(p=>p.seat===3)!;player3.lifeState="eliminated";player3.hp=null;player3.shield=null;
  const result=service.handle(room,users[2]!,{type:"GAME_COMMAND",commandId:"forfeit-2",gameId:room.game!.gameId,expectedStateRevision:room.game!.stateRevision,command:"FORFEIT",payload:{}});
  expect(result.accepted).toBe(true);
  const seat2=room.game!.players.find(p=>p.seat===2)!;
  expect(seat2.lifeState).toBe("eliminated");
  expect(room.game!.lifecycle).toBe("ended");
  expect(room.game!.winnerTeam).toBe("A");
  // 对局结束后房间解散，全员回大厅
  expect(room.phase).toBe("closed");
  expect(room.players).toHaveLength(0);
 });
 it("rejects forfeit from a stale revision without changing state",()=>{
  const room=makeRoom(openedState(303)),service=new GameService(ruleset,()=>1000),before=room.game!.stateRevision;
  const stale=service.handle(room,users[2]!,{type:"GAME_COMMAND",commandId:"forfeit-stale",gameId:room.game!.gameId,expectedStateRevision:before-1,command:"FORFEIT",payload:{}});
  expect(stale.accepted).toBe(false);expect((stale as any).reasonCode).toBe("STALE_REVISION");
  expect(room.game!.stateRevision).toBe(before);expect(room.game!.lifecycle).not.toBe("ended");
 });
 it("ends the game and disbands the room when a game ends through the tick timeout path (all rescue passes)",()=>{
  const engineState=dyingState();
  for(const seat of[3,4]as Seat[]){const player=engineState.players.find(item=>item.seat===seat)!;player.lifeState="eliminated";player.hp=null;player.shield=null;}
  const state=openDyingRescue(engineState,1000).state;
  expect(state.combat.dyingStack).not.toHaveLength(0);
  expect(state.pendingWindows[0]!.kind).toBe("dyingRescue");
  const room=makeRoom(state);
  let now=1000;const service=new GameService(ruleset,()=>now);
  expect(service.timeout(room)).toBe(true);
  expect(room.game!.lifecycle).toBe("inProgress");
  expect(room.game!.pendingWindows[0]!.kind).toBe("dyingRescue");
  expect(room.phase).toBe("inGame");
  expect(room.players).toHaveLength(4);
  now=22000;
  expect(service.timeout(room)).toBe(true);
  expect(room.game!.lifecycle).toBe("ended");
  expect(room.game!.winnerTeam).toBe("A");
  expect(room.phase).toBe("closed");
  expect(room.players).toHaveLength(0);
  expect(room.spectators).toHaveLength(0);
 });
 it("leaves the room open when timeout advances but the game keeps running",()=>{
  const engineState=dyingState();
  const player4=engineState.players.find(item=>item.seat===4)!;player4.lifeState="eliminated";player4.hp=null;player4.shield=null;
  const room=makeRoom(openDyingRescue(engineState,1000).state);
  let now=1000;const service=new GameService(ruleset,()=>now);
  const before=room.game!.stateRevision;
  expect(service.timeout(room)).toBe(true);
  expect(room.game!.stateRevision).toBeGreaterThan(before);
  expect(room.game!.lifecycle).toBe("inProgress");
  expect(room.phase).toBe("inGame");
  expect(room.players).toHaveLength(4);
 });
 it("notifies every viewer of the forfeit while the room stays open",()=>{
  const room=makeRoom(openedState(304)),service=new GameService(ruleset,()=>1000);
  service.handle(room,users[2]!,{type:"GAME_COMMAND",commandId:"forfeit-2",gameId:room.game!.gameId,expectedStateRevision:room.game!.stateRevision,command:"FORFEIT",payload:{}});
  for(const seat of[1,2,3,4]as Seat[]){const snap=new GameProjector(ruleset).game(room,users[seat]!.userId) as any;expect(snap.publicView.headline,`seat ${seat} 对局未结束`).toBeUndefined();expect(snap.publicView.players.find((p:any)=>p.seat===2)!.lifeState).toBe("eliminated");expect(validateProtocol("game",snap)).toEqual({ok:true});}
 });
});
