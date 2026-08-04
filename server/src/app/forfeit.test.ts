// 退出本局：任一玩家 FORFEIT 后结束对局，不做胜负评判，全员看到"未完成"
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
// 构造 seat2 血量 1、被 seat1 用一张杀牌攻击后进入 dying 的状态；救援全部超时即可触发胜利
function dyingState():AuthoritativeGameState{let state=createInitialSetup(ruleset,{gameId:"timeout-dying",firstSeat:1,seed:31,usersBySeat:{1:"u1",2:"u2",3:"u3",4:"u4"},characterIdsBySeat:{1:"character.knight",2:"character.alchemist",3:"character.ranger",4:"character.wizard"}});for(const seat of[1,2,3,4]as Seat[])state=resolveInitialRedraw(state,seat,false,ruleset).state;state.phase="play";state.phaseMode="manual";state.players[0]!.limits.attackCountRemaining=1;state.players[1]!.shield=0;state.players[1]!.hp=1;const kill=refFor(state,"basic.kill.");relocate(state,kill,"hand:1");state=setWeaponPreselection(state,1,"weapon:1:1",null,ruleset).state;state=commitAttack(state,ruleset,{attackerSeat:1,targetRefs:["character:2"],killCardRefs:[kill]}).state;state=openAttackResponse(state,ruleset,500).state;const responseWindow=state.pendingWindows[0]!,response=new AttackResponseSession(state);response.handle({commandId:"hit",gameId:state.gameId,expectedStateRevision:state.stateRevision,actorUserId:"u2",promptId:responseWindow.promptId,offerId:responseWindow.legalOfferIds.find(id=>id.includes(":pass:"))!});return resolveCurrentAttackTarget(response.state).state;}

describe("game forfeit",()=>{
 it("ends the game as unfinished without a winner and notifies every viewer",()=>{
  const room=makeRoom(openedState(301)),service=new GameService(ruleset,()=>1000);
  const result=service.handle(room,users[1]!,{type:"GAME_COMMAND",commandId:"forfeit-1",gameId:room.game!.gameId,expectedStateRevision:room.game!.stateRevision,command:"FORFEIT",payload:{}});
  expect(result.accepted).toBe(true);
  expect(room.game!.lifecycle).toBe("ended");
  expect(room.game!.forfeited).toBe(true);
  expect(room.game!.forfeitedBySeat).toBe(1);
  expect(room.game!.winnerTeam).toBeNull();
  expect(room.game!.pendingWindows).toHaveLength(0);
  expect(room.game!.history.domainEvents.some(e=>e.eventType==="game.aborted")).toBe(true);
  // 对局结束后房间解散：玩家被移出、房间 closed，服务器才不会再推 GAME_SNAPSHOT，客户端才能回到大厅
  expect(room.phase).toBe("closed");
  expect(room.players).toHaveLength(0);
  expect(room.spectators).toHaveLength(0);
  for(const seat of[1,2,3,4]as Seat[]){const snap=new GameProjector(ruleset).game(room,users[seat]!.userId) as any;expect(snap.publicView.headline,`seat ${seat} must see 未完成`).toBe("未完成");expect(snap.publicView.winnerTeam).toBeNull();expect(snap.interaction.prompt).toBeNull();expect(validateProtocol("game",snap)).toEqual({ok:true});}
 });
 it("rejects forfeit from a stale revision without changing state",()=>{
  const room=makeRoom(openedState(302)),service=new GameService(ruleset,()=>1000),before=room.game!.stateRevision;
  const stale=service.handle(room,users[2]!,{type:"GAME_COMMAND",commandId:"forfeit-stale",gameId:room.game!.gameId,expectedStateRevision:before-1,command:"FORFEIT",payload:{}});
  expect(stale.accepted).toBe(false);expect((stale as any).reasonCode).toBe("STALE_REVISION");
  expect(room.game!.stateRevision).toBe(before);expect(room.game!.lifecycle).not.toBe("ended");
 });
 it("disbands the room when a game ends through the tick timeout path (all rescue passes)",()=>{
  // 预淘汰 seat3、seat4（seat2 同队），使 seat2 救援全部超时即触发全队淘汰 → 胜利
  const engineState=dyingState();
  for(const seat of[3,4]as Seat[]){const player=engineState.players.find(item=>item.seat===seat)!;player.lifeState="eliminated";player.hp=null;player.shield=null;}
  // 打开救援窗口（引擎级 commit），窗口 deadline=1000
  const state=openDyingRescue(engineState,1000).state;
  expect(state.combat.dyingStack).not.toHaveLength(0);
  expect(state.pendingWindows[0]!.kind).toBe("dyingRescue");
  const room=makeRoom(state);
  // 可变时钟驱动超时；responseTimeSeconds=20s，故新窗口 deadline=now+20000
  let now=1000;const service=new GameService(ruleset,()=>now);
  // 第一次 tick：seat1（prioritySeat）救援超时放弃，串联到下一窗口 prioritySeat=2，房间仍在 inGame
  expect(service.timeout(room)).toBe(true);
  expect(room.game!.lifecycle).toBe("inProgress");
  expect(room.game!.pendingWindows[0]!.kind).toBe("dyingRescue");
  expect(room.phase).toBe("inGame");
  expect(room.players).toHaveLength(4);
  // 时钟越过窗口2 deadline=21000，第二次 tick：seat2 救援超时放弃 → 全队淘汰 → 对局结束
  now=22000;
  expect(service.timeout(room)).toBe(true);
  expect(room.game!.lifecycle).toBe("ended");
  expect(room.game!.winnerTeam).toBe("A");
  // timeout() 修复点：ended 后解散房间，玩家才能回到大厅
  expect(room.phase).toBe("closed");
  expect(room.players).toHaveLength(0);
  expect(room.spectators).toHaveLength(0);
 });
 it("leaves the room open when timeout advances but the game keeps running",()=>{
  // 只预淘汰 seat4（不同队），pass 一次救援后仍 inProgress，房间不得解散
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
});
