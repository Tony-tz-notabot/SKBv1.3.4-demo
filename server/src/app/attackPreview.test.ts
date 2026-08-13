import {resolve} from "node:path";
import {beforeAll,describe,expect,it} from "vitest";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {runAutomaticScheduler} from "../engine/automaticScheduler.js";
import {createInitialSetup,resolveInitialRedraw} from "../engine/setup.js";
import {setWeaponPreselection} from "../engine/preselection.js";
import type {AuthoritativeGameState,Seat} from "../engine/state.js";
import {GameProjector} from "./projection.js";
import {validateProtocol} from "./protocol.js";
import type {AppRoom,AppSettings,AppUser} from "./types.js";

// S1：攻击报价（declareAttack）投影 preview 补结构化伤害段/费用/目标距离。
// 依据设计稿 128 §6.1：damageStructure=DamageSegmentView[]、costs、costSummary、distanceByTarget。

let ruleset:LoadedRuleset;
const settings:AppSettings={roomName:"攻击报价预览",allowGuests:true,allowSpectators:false,turnTimeSeconds:60,responseTimeSeconds:20,reserveTimeSeconds:30,rulesetVersion:"1.3.4",dismantleBossEnabled:true};
const users:Record<Seat,AppUser>={1:{userId:"u1",displayName:"一"},2:{userId:"u2",displayName:"二"},3:{userId:"u3",displayName:"三"},4:{userId:"u4",displayName:"四"}};
beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});
function openedState(seed=301):AuthoritativeGameState{let state=createInitialSetup(ruleset,{gameId:`attack-preview-${seed}`,firstSeat:1,seed,usersBySeat:{1:users[1]!.userId,2:users[2]!.userId,3:users[3]!.userId,4:users[4]!.userId},characterIdsBySeat:{1:"character.knight",2:"character.alchemist",3:"character.ranger",4:"character.wizard"}});for(const seat of[1,2,3,4]as Seat[])state=resolveInitialRedraw(state,seat,false,ruleset).state;const scheduled=runAutomaticScheduler(state,ruleset,()=>21000);state=scheduled.state;if(state.phase!=="play")throw new Error(`expected play phase, got ${state.phase}`);return state;}
function refsByTemplate(state:AuthoritativeGameState,prefix:string):string[]{return Object.values(state.cards).filter(card=>card.templateId.startsWith(prefix)).map(card=>card.cardRef);}
function moveCard(state:AuthoritativeGameState,cardRef:string,toZoneRef:string,owner:Seat=1){const card=state.cards[cardRef]!,from=state.zones[card.zoneRef]!,index=from.orderedCardRefs.indexOf(cardRef);if(index<0)throw new Error("card not in source zone");from.orderedCardRefs.splice(index,1);const to=state.zones[toZoneRef]!;to.orderedCardRefs.push(cardRef);card.zoneRef=toZoneRef;card.ownerSeat=to.ownerSeat??owner;card.controllerSeat=to.ownerSeat??owner;card.faceUp=!toZoneRef.startsWith("hand:");}
function makeRoom(state:AuthoritativeGameState):AppRoom{return{roomId:state.gameId,roomCode:"ATK",revision:1,phase:"inGame",settings,passwordHash:null,players:state.players.map(player=>({userId:player.userId,displayName:users[player.seat]!.displayName,seat:player.seat,team:player.team,isHost:player.seat===1,ready:true,connection:"online",latencyMs:null,selectionState:"revealed",candidates:[],preselectedCharacterId:null,lockedCharacterId:null,selectionDeadlineAt:null})),spectators:[],chat:[],gameChat:[],game:state,createdAt:0,updatedAt:0};}
function projectedAttack(room:AppRoom):any{const snap=new GameProjector(ruleset).game(room,"u1") as any;return (snap.interaction.offers as any[]).find((o:any)=>o.kind==="declareAttack");}

describe("攻击报价投影 preview（S1）",()=>{
 it("declareAttack 报价带结构化伤害段/费用/目标距离且过协议校验",()=>{
  let state=openedState(301);const weapon=refsByTemplate(state,"weapon.")[0]!,kill=refsByTemplate(state,"basic.kill.")[0]!;
  moveCard(state,weapon,"weapon:1:1");moveCard(state,kill,"hand:1");state=setWeaponPreselection(state,1,"weapon:1:1",null,ruleset).state;
  const room=makeRoom(state),snap=new GameProjector(ruleset).game(room,"u1") as any,offer=projectedAttack(room);
  expect(offer,`no declareAttack offer; got ${(snap.interaction.offers as any[]).map((o:any)=>o.offerId).join(",")}`).toBeTruthy();
  const preview=offer.preview;
  expect(Array.isArray(preview.damageStructure)).toBe(true);
  expect(preview.damageStructure.length).toBeGreaterThan(0);
  const seg=preview.damageStructure[0];
  expect(typeof seg.amount).toBe("number");
  expect(typeof seg.repeat).toBe("number");
  expect(typeof seg.element).toBe("string");
  expect(typeof seg.damageType).toBe("string");
  expect(typeof seg.deliveryType).toBe("string");
  expect(preview.costs.killCards).toBe(1);
  expect(typeof preview.costs.attackCountCost).toBe("number");
  expect(typeof preview.costs.attackCountAvailable).toBe("number");
  expect(typeof preview.costSummary).toBe("string");
  expect(preview.costSummary).toContain("杀×");
  expect(preview.range).toBeGreaterThan(0);
  expect(typeof preview.distanceByTarget).toBe("object");
  expect(Object.keys(preview.distanceByTarget).length).toBeGreaterThan(0);
  expect(validateProtocol("game",snap)).toEqual({ok:true});
 });
 it("目标距离来自 calculateEffectiveDistance（本座距离 0）",()=>{
  let state=openedState(302);const weapon=refsByTemplate(state,"weapon.")[0]!,kill=refsByTemplate(state,"basic.kill.")[0]!;
  moveCard(state,weapon,"weapon:1:1");moveCard(state,kill,"hand:1");state=setWeaponPreselection(state,1,"weapon:1:1",null,ruleset).state;
  const offer=projectedAttack(makeRoom(state)),distance=offer.preview.distanceByTarget;
  expect(distance["public:seat_1"]).toBe(0);
  for(const seat of[2,3,4]as const)expect(typeof distance[`public:seat_${seat}`]).toBe("number");
 });
});
