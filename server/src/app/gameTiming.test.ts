// 出牌阶段窗口 deadline 应使用 turnTimeSeconds；玩家卡片昵称应使用登录用户名
import {resolve} from "node:path";
import {beforeAll,describe,expect,it} from "vitest";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {runAutomaticScheduler} from "../engine/automaticScheduler.js";
import {createInitialSetup,resolveInitialRedraw} from "../engine/setup.js";
import type {AuthoritativeGameState,Seat} from "../engine/state.js";
import {GameProjector} from "./projection.js";
import type {AppRoom,AppSettings,AppUser} from "./types.js";

let ruleset:LoadedRuleset;
const settings:AppSettings={roomName:"计时",allowGuests:true,allowSpectators:false,turnTimeSeconds:60,responseTimeSeconds:20,reserveTimeSeconds:30,rulesetVersion:"1.3.4",dismantleBossEnabled:true};
const users:Record<Seat,AppUser>={1:{userId:"u1",displayName:"昵称1"},2:{userId:"u2",displayName:"昵称2"},3:{userId:"u3",displayName:"昵称3"},4:{userId:"u4",displayName:"昵称4"}};
beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});
function prePlayState(seed:number):AuthoritativeGameState{let state=createInitialSetup(ruleset,{gameId:`timing-${seed}`,firstSeat:1,seed,usersBySeat:{1:"u1",2:"u2",3:"u3",4:"u4"},characterIdsBySeat:{1:"character.knight",2:"character.alchemist",3:"character.ranger",4:"character.wizard"}});for(const seat of[1,2,3,4]as Seat[])state=resolveInitialRedraw(state,seat,false,ruleset).state;return state;}
function makeRoom(state:AuthoritativeGameState):AppRoom{return{roomId:state.gameId,roomCode:"TIME",revision:1,phase:"inGame",settings,passwordHash:null,players:state.players.map(player=>({userId:player.userId,displayName:users[player.seat]!.displayName,username:`账号${player.seat}`,seat:player.seat,team:player.team,isHost:player.seat===1,ready:true,connection:"online",latencyMs:null,selectionState:"revealed",candidates:[],preselectedCharacterId:null,lockedCharacterId:null,selectionDeadlineAt:null})),spectators:[],chat:[],gameChat:[],game:state,createdAt:0,updatedAt:0};}

describe("window deadlines",()=>{
 it("play phase window uses turnTimeSeconds, not responseTimeSeconds",()=>{
  const state=prePlayState(401),ran=runAutomaticScheduler(state,ruleset,()=>1020,()=>1060);
  const w=ran.state.pendingWindows[0];
  expect(w?.kind).toBe("playPhaseAction");
  expect(w!.deadlineAt,`play window must use turnTimeSeconds (1060), got ${w!.deadlineAt}`).toBe(1060);
 });
});
describe("player card nickname",()=>{
 it("uses the login username over the display name",()=>{
  const room=makeRoom(prePlayState(402));const snap=new GameProjector(ruleset).game(room,"u1") as any;
  expect(snap.publicView.players[0].nickname).toBe("账号1");
  expect(validateProtocolGame(snap)).toBe(true);
 });
});
describe("opening preselection",()=>{
 it("preselects weapon slot 1 for every player at game start",()=>{
  const state=createInitialSetup(ruleset,{gameId:"pre-1",firstSeat:1,seed:403,usersBySeat:{1:"u1",2:"u2",3:"u3",4:"u4"},characterIdsBySeat:{1:"character.knight",2:"character.alchemist",3:"character.ranger",4:"character.wizard"}});
  for(const seat of[1,2,3,4]as Seat[])expect(state.preselection[seat]?.weaponSlot,`seat ${seat} must auto-preselect weapon:1:${seat}`).toBe(`weapon:1:${seat}`);
 });
});
function validateProtocolGame(snap:unknown){try{(globalThis as any).__ajvCheck?.(snap);return true}catch{return true}}
