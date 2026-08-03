// 退出本局：任一玩家 FORFEIT 后结束对局，不做胜负评判，全员看到"未完成"
import {resolve} from "node:path";
import {beforeAll,describe,expect,it} from "vitest";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {runAutomaticScheduler} from "../engine/automaticScheduler.js";
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
  for(const seat of[1,2,3,4]as Seat[]){const snap=new GameProjector(ruleset).game(room,users[seat]!.userId) as any;expect(snap.publicView.headline,`seat ${seat} must see 未完成`).toBe("未完成");expect(snap.publicView.winnerTeam).toBeNull();expect(snap.interaction.prompt).toBeNull();expect(validateProtocol("game",snap)).toEqual({ok:true});}
 });
 it("rejects forfeit from a stale revision without changing state",()=>{
  const room=makeRoom(openedState(302)),service=new GameService(ruleset,()=>1000),before=room.game!.stateRevision;
  const stale=service.handle(room,users[2]!,{type:"GAME_COMMAND",commandId:"forfeit-stale",gameId:room.game!.gameId,expectedStateRevision:before-1,command:"FORFEIT",payload:{}});
  expect(stale.accepted).toBe(false);expect((stale as any).reasonCode).toBe("STALE_REVISION");
  expect(room.game!.stateRevision).toBe(before);expect(room.game!.lifecycle).not.toBe("ended");
 });
});
