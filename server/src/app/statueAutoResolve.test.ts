import {resolve} from "node:path";
import {beforeAll,describe,expect,it} from "vitest";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {runAutomaticScheduler} from "../engine/automaticScheduler.js";
import {createInitialSetup,resolveInitialRedraw} from "../engine/setup.js";
import type {AuthoritativeGameState,Seat} from "../engine/state.js";
import {GameService} from "./gameService.js";
import {GameProjector} from "./projection.js";
import {playOffers} from "./playRegistry.js";
import {validateProtocol} from "./protocol.js";
import type {AppRoom,AppSettings,AppUser} from "./types.js";

let ruleset:LoadedRuleset;
const settings:AppSettings={roomName:"雕像自动结算",allowGuests:true,allowSpectators:false,turnTimeSeconds:60,responseTimeSeconds:20,reserveTimeSeconds:30,rulesetVersion:"1.3.4",dismantleBossEnabled:true};
const users:Record<Seat,AppUser>={1:{userId:"u1",displayName:"一"},2:{userId:"u2",displayName:"二"},3:{userId:"u3",displayName:"三"},4:{userId:"u4",displayName:"四"}};
beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});
function openedState(seed=601):AuthoritativeGameState{let state=createInitialSetup(ruleset,{gameId:`statue-auto-${seed}`,firstSeat:1,seed,usersBySeat:{1:users[1]!.userId,2:users[2]!.userId,3:users[3]!.userId,4:users[4]!.userId},characterIdsBySeat:{1:"character.wizard",2:"character.knight",3:"character.ranger",4:"character.alchemist"}});for(const seat of[1,2,3,4]as Seat[])state=resolveInitialRedraw(state,seat,false,ruleset).state;const scheduled=runAutomaticScheduler(state,ruleset,()=>21000);state=scheduled.state;if(state.phase!=="play")throw new Error(`expected play phase, got ${state.phase}`);return state;}
function moveCard(state:AuthoritativeGameState,cardRef:string,toZoneRef:string,owner:Seat){const card=state.cards[cardRef]!,from=state.zones[card.zoneRef]!,index=from.orderedCardRefs.indexOf(cardRef);if(index<0)throw new Error("card not in source zone");from.orderedCardRefs.splice(index,1);const to=state.zones[toZoneRef]!;to.orderedCardRefs.push(cardRef);card.zoneRef=toZoneRef;card.ownerSeat=to.ownerSeat??owner;card.controllerSeat=to.ownerSeat??owner;card.faceUp=!toZoneRef.startsWith("hand:");}
function makeRoom(state:AuthoritativeGameState):AppRoom{return{roomId:state.gameId,roomCode:"STA",revision:1,phase:"inGame",settings,passwordHash:null,players:state.players.map(player=>({userId:player.userId,displayName:users[player.seat]!.displayName,seat:player.seat,team:player.team,isHost:player.seat===1,ready:true,connection:"online",latencyMs:null,selectionState:"revealed",candidates:[],preselectedCharacterId:null,lockedCharacterId:null,selectionDeadlineAt:null})),spectators:[],chat:[],gameChat:[],game:state,createdAt:0,updatedAt:0};}
function refsByTemplate(state:AuthoritativeGameState,prefix:string):string[]{return Object.values(state.cards).filter(card=>card.templateId.startsWith(prefix)).map(card=>card.cardRef);}
function playStatue(room:AppRoom,service:GameService,statuePrefix:string):string{const state=room.game!;const card=refsByTemplate(state,statuePrefix).find(ref=>!state.zones[`hand:1`]!.orderedCardRefs.includes(ref))!;moveCard(state,card,"hand:1",1);const raw=playOffers(state,ruleset,1,"u1",()=>Date.now()+20000).find(o=>o.offerId.includes("statue-play")&&String(o.cardRef).includes(card))!;const command={type:"GAME_COMMAND" as const,commandId:`statue-${card}`,gameId:state.gameId,expectedStateRevision:state.stateRevision,promptId:state.pendingWindows[0]!.promptId,offerId:raw.offerId,command:"EXECUTE_OFFER" as const,payload:{selections:{}}};const out=service.handle(room,users[1]!,command);expect(out.accepted,`雕像打出被拒:${JSON.stringify(out)}`).toBe(true);return card;}

describe("无需选择的雕像（法师/狂战士/牧师/刺客）自动结算",()=>{
 it("法师雕像：打出后自动抽牌，不再出现空的选目标/确认窗口",()=>{
  let state=openedState(601);
  // 移除圣骑士雕像（避免响应窗口干扰断言）
  for(const c of Object.values(state.cards).filter(x=>x.templateId.startsWith("statue.paladin.")))moveCard(state,c.cardRef,"drawPile",1);
  const room=makeRoom(state),service=new GameService(ruleset,()=>1000),handBefore=room.game!.zones["hand:1"]!.orderedCardRefs.length;
  const card=playStatue(room,service,"statue.wizard.");
  const w=room.game!.pendingWindows.find(x=>x.kind==="statueResolutionChoice");
  expect(w,"法师雕像无需选择，不应出现雕像效果窗口").toBeUndefined();
  expect(room.game!.zones.resolving!.orderedCardRefs,"法师雕像应已结算离场").not.toContain(card);
  expect(room.game!.zones["hand:1"]!.orderedCardRefs.length,`法师雕像应自动抽2（moveCard+1 打出-1 抽2，手牌 ${handBefore}->${handBefore+2}）`).toBe(handBefore+2);
  snapshotValid(room,"u1");
 });
 it("狂战士雕像：打出后自动增加攻击次数，无确认窗口",()=>{
  let state=openedState(602);
  for(const c of Object.values(state.cards).filter(x=>x.templateId.startsWith("statue.paladin.")))moveCard(state,c.cardRef,"drawPile",1);
  const room=makeRoom(state),service=new GameService(ruleset,()=>1000);
  const card=playStatue(room,service,"statue.berserker.");
  const w=room.game!.pendingWindows.find(x=>x.kind==="statueResolutionChoice");
  expect(w,"狂战士雕像无需选择，不应出现雕像效果窗口").toBeUndefined();
  expect(room.game!.zones.resolving!.orderedCardRefs).not.toContain(card);
  const limitId=ruleset.settings.combat.attackCountLimitId,limit=room.game!.players.find(p=>p.seat===1)!.limits[limitId];
  expect(limit,"狂战士雕像应自动+1攻击次数").toBeGreaterThan(0);
 });
 it("狼人雕像（需要选择）：仍应打开带目标的结算窗口",()=>{
  let state=openedState(603);
  for(const c of Object.values(state.cards).filter(x=>x.templateId.startsWith("statue.paladin.")))moveCard(state,c.cardRef,"drawPile",1);
  const room=makeRoom(state),service=new GameService(ruleset,()=>1000);
  playStatue(room,service,"statue.werewolf.");
  const w=room.game!.pendingWindows.find(x=>x.kind==="statueResolutionChoice");
  expect(w,"狼人雕像需要选目标+模式，应保留效果窗口").toBeTruthy();
  const ctx=w!.context??{};
  expect(Array.isArray(ctx.legalTargetRefs)&&(ctx.legalTargetRefs as string[]).length>0,"狼人窗口应提供目标列表").toBe(true);
 });
});
function snapshotValid(room:AppRoom,userId:string){expect(validateProtocol("game",new GameProjector(ruleset).game(room,userId))).toEqual({ok:true});}
