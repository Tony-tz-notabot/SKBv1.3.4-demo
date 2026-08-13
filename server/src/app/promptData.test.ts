import {resolve} from "node:path";
import {beforeAll,describe,expect,it} from "vitest";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {createInitialSetup,resolveInitialRedraw} from "../engine/setup.js";
import type {AuthoritativeGameState,Seat} from "../engine/state.js";
import {GameProjector} from "./projection.js";
import {validateProtocol} from "./protocol.js";
import type {AppRoom,AppSettings,AppUser} from "./types.js";

// S2：窗口 promptData 投影——attackResponse 攻击快照（脱敏）、dyingRescue 血量、
// 判定颜色、弃牌超限。数据由投影层从 state.combat.attack / 玩家状态 / context 构造。

let ruleset:LoadedRuleset;
const settings:AppSettings={roomName:"窗口提示数据",allowGuests:true,allowSpectators:false,turnTimeSeconds:60,responseTimeSeconds:20,reserveTimeSeconds:30,rulesetVersion:"1.3.4",dismantleBossEnabled:true};
const users:Record<Seat,AppUser>={1:{userId:"u1",displayName:"一"},2:{userId:"u2",displayName:"二"},3:{userId:"u3",displayName:"三"},4:{userId:"u4",displayName:"四"}};
beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});
function engineState(seed=401):AuthoritativeGameState{let state=createInitialSetup(ruleset,{gameId:`prompt-data-${seed}`,firstSeat:1,seed,usersBySeat:{1:users[1]!.userId,2:users[2]!.userId,3:users[3]!.userId,4:users[4]!.userId},characterIdsBySeat:{1:"character.knight",2:"character.ranger",3:"character.paladin",4:"character.wizard"}});for(const seat of[1,2,3,4]as const)state=resolveInitialRedraw(state,seat,false,ruleset).state;return state;}
function makeRoom(state:AuthoritativeGameState):AppRoom{return{roomId:state.gameId,roomCode:"PDATA",revision:1,phase:"inGame",settings,passwordHash:null,players:state.players.map(player=>({userId:player.userId,displayName:users[player.seat]!.displayName,seat:player.seat,team:player.team,isHost:player.seat===1,ready:true,connection:"online",latencyMs:null,selectionState:"revealed",candidates:[],preselectedCharacterId:null,lockedCharacterId:null,selectionDeadlineAt:null})),spectators:[],chat:[],gameChat:[],game:state,createdAt:0,updatedAt:0};}
function window(state:AuthoritativeGameState,w:Partial<AuthoritativeGameState["pendingWindows"][number]> & {kind:string;prioritySeat:Seat;legalOfferIds:string[]}){const win:any={promptId:w.promptId??"prompt:test:1",kind:w.kind,mandatory:w.mandatory??false,deadlineAt:w.deadlineAt??900,prioritySeat:w.prioritySeat,timeoutPolicy:w.timeoutPolicy??"pass",legalOfferIds:w.legalOfferIds};if(w.context!==undefined)win.context=w.context;state.pendingWindows=[win];}
function projected(state:AuthoritativeGameState,seat:Seat=1):any{return new GameProjector(ruleset).game(makeRoom(state),users[seat]!.userId) as any;}

describe("窗口 promptData 投影（S2）",()=>{
 it("attackResponse 投影脱敏攻击快照（来源/武器/距离/伤害段，无私有引用）",()=>{
  let state=engineState();state.pendingWindows=[];
  state.combat.attack={attackId:"attack:1",attackerSeat:1,targetRefs:["character:2"],sourceKind:"weapon",weaponRef:"card:weapon:1",weaponId:"weapon.w08",modeId:"default",range:2,attackTypes:["ranged"],damageSegments:[{segmentId:"base",deliveryType:"attack",attackType:"ranged",damageType:"normal",element:"none",amount:2,repeat:1,isAdditional:false,overflowPolicy:"normal"}],status:"awaitingResponse"} as any;
  window(state,{kind:"attackResponse",prioritySeat:2,legalOfferIds:["offer:attack-response:pass:attack:1","offer:attack-response:dodge:attack:1"],context:{attackId:"attack:1",targetRef:"character:2",legalDodgeCardRefs:["card:dodge:1"]}});
  const snap=projected(state,2),data=snap.interaction.prompt.promptData;
  expect(data.attackerSeat).toBe(1);
  expect(data.targetSeat).toBe(2);
  expect(data.weaponLabel).toBe("剧毒之鹰");
  expect(data.range).toBe(2);
  expect(data.attackTypes).toEqual(["ranged"]);
  expect(Array.isArray(data.damageSegments)).toBe(true);
  expect(data.damageSegments[0]).toMatchObject({amount:2,repeat:1,element:"none",damageType:"normal",deliveryType:"attack"});
  expect(JSON.stringify(data)).not.toContain("legalDodgeCardRefs");
  expect(JSON.stringify(data)).not.toContain("card:dodge");
  expect(validateProtocol("game",snap)).toEqual({ok:true});
 });
 it("dyingRescue 投影濒死血量与伤害来源",()=>{
  let state=engineState(402);state.pendingWindows=[];state.players.find(p=>p.seat===3)!.hp=0;
  state.combat.attack={attackerSeat:1,weaponId:"weapon.w08",mode:{range:2}} as any;
  window(state,{kind:"dyingRescue",prioritySeat:1,legalOfferIds:["offer:dying:pass:character:3"],context:{dyingRef:"character:3",eligibleSeats:[1],passedSeats:[]}});
  const data=projected(state).interaction.prompt.promptData;
  expect(data.dyingSeat).toBe(3);
  expect(data.dyingHp).toBe(0);
  expect(data.damageSourceSeat).toBe(1);
  expect(validateProtocol("game",projected(state))).toEqual({ok:true});
 });
 it("判定窗口投影颜色选项（judgmentDesignation/preJudgment）",()=>{
  let state=engineState(403);state.pendingWindows=[];
  window(state,{kind:"judgmentDesignation",prioritySeat:1,legalOfferIds:["offer:judgment-designation:red:j1"],context:{judgmentId:"j1",legalColors:["red","blue"]}});
  expect(projected(state).interaction.prompt.promptData.colors).toEqual(["red","blue"]);
  state.pendingWindows=[];
  window(state,{kind:"preJudgment",prioritySeat:1,legalOfferIds:["offer:pre-judgment:pass:j2"],context:{judgmentId:"j2",matchColors:["white","green"],purpose:"spellStrike"}});
  const data=projected(state).interaction.prompt.promptData;
  expect(data.colors).toEqual(["white","green"]);
  expect(data.purpose).toBe("spellStrike");
  expect(validateProtocol("game",projected(state))).toEqual({ok:true});
 });
 it("discardPhaseAction 投影需弃数与手牌数",()=>{
  let state=engineState(404);state.pendingWindows=[];
  window(state,{kind:"discardPhaseAction",prioritySeat:1,legalOfferIds:["offer:discardPhaseAction:submit"],context:{requiredCount:2}});
  const data=projected(state).interaction.prompt.promptData;
  expect(typeof data.requiredCount).toBe("number");
  expect(typeof data.handCount).toBe("number");
  expect(typeof data.handLimit).toBe("number");
  expect(validateProtocol("game",projected(state))).toEqual({ok:true});
 });
 it("playPhaseAction 投影手牌数/上限（报价级数据走 preview）",()=>{
  let state=engineState(405);state.pendingWindows=[];
  window(state,{kind:"playPhaseAction",prioritySeat:1,legalOfferIds:["offer:playPhaseAction:finish"]});
  const data=projected(state).interaction.prompt.promptData;
  expect(typeof data.handCount).toBe("number");
  expect(typeof data.handLimit).toBe("number");
 });
 it("trapBombDetonation 投影炸弹数",()=>{
  let state=engineState(406);state.pendingWindows=[];
  window(state,{kind:"trapBombDetonation",prioritySeat:1,legalOfferIds:["offer:trap-detonation:pass","offer:trap-detonation:card:1"],context:{bombs:3}});
  const data=projected(state).interaction.prompt.promptData;
  expect(data.bombs).toBe(3);
  expect(validateProtocol("game",projected(state))).toEqual({ok:true});
 });
 it("weaponW61Choice 投影扳手耐久与 purpose",()=>{
  let state=engineState(407);state.pendingWindows=[];const wRef="card:w61-test";
  state.cards[wRef]={cardRef:wRef,templateId:"weapon.w61",zoneRef:"weapon:1:1",ownerSeat:1,controllerSeat:1,faceUp:true,runtime:{durabilityCurrent:4}} as any;
  state.zones["weapon:1:1"]!.orderedCardRefs.push(wRef);
  window(state,{kind:"weaponW61Choice",prioritySeat:1,legalOfferIds:["offer:w61:damage","offer:w61:dismantle"],context:{weaponRef:wRef}});
  const data=projected(state).interaction.prompt.promptData;
  expect(data.durability).toBe(4);
  expect(data.purpose).toBe("扳手二选一");
  expect(validateProtocol("game",projected(state))).toEqual({ok:true});
 });
 it("darkKnightFinalStrike 投影剩余黑剑数",()=>{
  let state=engineState(408);state.pendingWindows=[];state.players.find(p=>p.seat===2)!.markers["darkKnight.blackSword"]=2;
  window(state,{kind:"darkKnightFinalStrike",prioritySeat:2,legalOfferIds:["offer:dark-knight-final-strike:pass:2"],context:{ownerSeat:2}});
  const data=projected(state,2).interaction.prompt.promptData;
  expect(data.blackSwords).toBe(2);
  expect(validateProtocol("game",projected(state,2))).toEqual({ok:true});
 });
 it("statueCardSelection 按雕像族推导 purpose（拿牌/拆牌）",()=>{
  let state=engineState(409);state.pendingWindows=[];
  window(state,{kind:"statueCardSelection",prioritySeat:1,legalOfferIds:["offer:statue-card:0"],context:{statueRef:"card:statue-rogue",statueFamily:"statue.rogue",targetRef:"character:2",legalCardRefs:["card:x"],publicCardRefs:["card:x"]}});
  expect(projected(state).interaction.prompt.promptData.purpose).toBe("拿牌");
  state.pendingWindows=[];
  window(state,{kind:"statueCardSelection",prioritySeat:1,legalOfferIds:["offer:statue-card:0"],context:{statueRef:"card:statue-elf",statueFamily:"statue.elf",targetRef:"character:2",legalCardRefs:["card:x"],publicCardRefs:["card:x"]}});
  expect(projected(state).interaction.prompt.promptData.purpose).toBe("拆牌");
 });
 it("optionalTrigger 投影效果ID、playPhaseAction 投影手牌数",()=>{
  let state=engineState(410);state.pendingWindows=[];
  window(state,{kind:"optionalTrigger",prioritySeat:1,legalOfferIds:["offer:optional-trigger:pass:t:1","offer:optional-trigger:activate:t:1"],context:{candidate:{triggerId:"talent.critical_penetration"}}});
  expect(projected(state).interaction.prompt.promptData.effectId).toBe("talent.critical_penetration");
  state.pendingWindows=[];
  window(state,{kind:"playPhaseAction",prioritySeat:1,legalOfferIds:["offer:playPhaseAction:finish"]});
  const data=projected(state).interaction.prompt.promptData;
  expect(typeof data.handCount).toBe("number");
  expect(typeof data.handLimit).toBe("number");
  expect(validateProtocol("game",projected(state))).toEqual({ok:true});
 });
 it("engineerMechChoice 投影机甲选项、valkyrie 投影BOSS模板",()=>{
  let state=engineState(411);state.pendingWindows=[];
  window(state,{kind:"engineerMechChoice",prioritySeat:1,legalOfferIds:["offer:engineer-mech:prototype","offer:engineer-mech:vitaminC"]});
  expect(projected(state).interaction.prompt.promptData.options).toEqual(["prototype","vitaminC"]);
  state.pendingWindows=[];
  window(state,{kind:"valkyrieBossResponse",prioritySeat:2,legalOfferIds:["offer:valkyrie:pass:2","offer:valkyrie:use:card:b"],context:{originalTemplateId:"boss.dark_grand_knight"}});
  expect(projected(state,2).interaction.prompt.promptData.templateId).toBe("boss.dark_grand_knight");
 });
});
