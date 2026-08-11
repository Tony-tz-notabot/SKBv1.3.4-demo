import {resolve} from "node:path";
import {beforeAll,describe,expect,it} from "vitest";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {createInitialSetup,resolveInitialRedraw} from "./setup.js";
import type {AuthoritativeGameState,Seat} from "./state.js";
import {EngineTransaction} from "./transaction.js";
import type {TransactionCommit} from "./types.js";
import {
  ELECTRIC_MARK,
  addElectricMarkInTransaction,
  applyElectricMarkOnAttackHit,
  clearElectricMarkInTransaction,
  electricMarkCount,
  hasElectricShield,
  settleElectricMarks,
} from "./electricMark.js";
import {moveCardInTransaction} from "./zoneMovement.js";
import {runAutomaticScheduler} from "./automaticScheduler.js";

let ruleset:LoadedRuleset;
beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});
function base(seed=701):AuthoritativeGameState{let state=createInitialSetup(ruleset,{gameId:`em-${seed}`,firstSeat:1,seed,usersBySeat:{1:"u1",2:"u2",3:"u3",4:"u4"},characterIdsBySeat:{1:"character.knight",2:"character.alchemist",3:"character.ranger",4:"character.wizard"}});for(const seat of[1,2,3,4]as Seat[])state=resolveInitialRedraw(state,seat,false,ruleset).state;for(const p of state.players){p.hp=10;p.shield=10;}return state;}
function setMark(state:AuthoritativeGameState,seat:Seat,n:number){state.players.find(p=>p.seat===seat)!.markers[ELECTRIC_MARK]=n;return state;}
function addMark(state:AuthoritativeGameState,seat:Seat,amount=1):AuthoritativeGameState{const tx=new EngineTransaction(state);addElectricMarkInTransaction(tx,seat,amount);const out=tx.commit();out.state.history.domainEvents.push(...out.events);return out.state;}

describe("感电标记（electricMark）",()=>{
 it("叠标记累加并记录事件",()=>{let s=base();s=addMark(s,1);expect(electricMarkCount(s,1)).toBe(1);s=addMark(s,1);expect(electricMarkCount(s,1)).toBe(2);});
 it("电盾角色不获得标记",()=>{let s=base();const talent=Object.values(s.cards).find(c=>c.templateId==="talent.electric_shield")!.cardRef;const tx=new EngineTransaction(s);moveCardInTransaction(tx,{cardRef:talent,toZoneRef:"talent:1",moveKind:"equip",faceUp:true});const committed=tx.commit();committed.state.history.domainEvents.push(...committed.events);s=committed.state;expect(hasElectricShield(s,1)).toBe(true);const tx2=new EngineTransaction(s);expect(addElectricMarkInTransaction(tx2,1,1)).toBe(false);const out2=tx2.commit();out2.state.history.domainEvents.push(...out2.events);s=out2.state;expect(electricMarkCount(s,1)).toBe(0);});
 it("装备电盾清除已有标记",()=>{let s=base();s=setMark(s,1,2);expect(electricMarkCount(s,1)).toBe(2);const tx=new EngineTransaction(s);clearElectricMarkInTransaction(tx,1);const out=tx.commit();out.state.history.domainEvents.push(...out.events);expect(electricMarkCount(out.state,1)).toBe(0);});
 it("单人3层结算：-3并受2点真实伤害（无来源，先盾后血、无视铁盾）",()=>{let s=base();s=setMark(s,1,3);const hpBefore=s.players[0]!.hp,shieldBefore=s.players[0]!.shield ?? 0;const settled=settleElectricMarks(s,ruleset);expect(settled).not.toBeNull();const st=settled!.state;expect(electricMarkCount(st,1)).toBe(0);expect(st.players[0]!.hp).toBe(hpBefore);expect(st.players[0]!.shield).toBe((shieldBefore ?? 0)-2);expect(st.players[0]!.lifeState).toBe("alive");expect(settled!.events.some(e=>e.eventType==="marker.changed")).toBe(true);});
 it("多人2层结算：≥2名角色各-2并受2点真实伤害",()=>{let s=base();s=setMark(s,1,2);s=setMark(s,2,2);s=setMark(s,3,3);const sh1=s.players[0]!.shield ?? 0,sh2=s.players[1]!.shield ?? 0,sh3=s.players[2]!.shield ?? 0;const settled=settleElectricMarks(s,ruleset);expect(settled).not.toBeNull();const st=settled!.state;expect(electricMarkCount(st,1)).toBe(0);expect(electricMarkCount(st,2)).toBe(0);expect(electricMarkCount(st,3)).toBe(1);expect(st.players[0]!.shield).toBe(sh1-2);expect(st.players[1]!.shield).toBe(sh2-2);expect(st.players[2]!.shield).toBe(sh3-2);});
 it("多人优先：多人结算全部完成后才检查单人",()=>{let s=base();s=setMark(s,1,2);s=setMark(s,2,2);s=setMark(s,3,4);const sh3=s.players[2]!.shield ?? 0;const settled=settleElectricMarks(s,ruleset);const st=settled!.state;expect(electricMarkCount(st,3)).toBe(2);expect(st.players[2]!.shield).toBe(sh3-2);});
 it("无满足条件时不产生结算",()=>{let s=base();s=setMark(s,1,1);s=setMark(s,2,1);expect(settleElectricMarks(s,ruleset)).toBeNull();});
 it("4名角色各2层：多人一轮全部结算后停止",()=>{let s=base();for(const seat of[1,2,3,4]as Seat[])s=setMark(s,seat,2);const settled=settleElectricMarks(s,ruleset);const st=settled!.state;for(const seat of[1,2,3,4]as Seat[])expect(electricMarkCount(st,seat)).toBe(0);});
 it("攻击命中叠标记：带感电元素的攻击对命中目标叠加",()=>{let s=base();const hitCommit:TransactionCommit<AuthoritativeGameState>={previousRevision:s.stateRevision,state:{...s,combat:{...s.combat,attack:{attackId:"a:1",attackerSeat:1,targetRefs:["character:2"],damageSegments:[{segmentId:"s",element:"electric",amount:1,repeat:1}]} as never}},events:[{eventSeq:0,stateRevision:s.stateRevision,eventType:"attack.hit",payload:{targetRef:"character:2"}}]};const out=applyElectricMarkOnAttackHit(hitCommit,ruleset);expect(electricMarkCount(out.state,2)).toBe(1);});
 it("攻击命中叠标记：无感电元素的攻击不叠加",()=>{let s=base();const hitCommit:TransactionCommit<AuthoritativeGameState>={previousRevision:s.stateRevision,state:{...s,combat:{...s.combat,attack:{attackId:"a:1",attackerSeat:1,targetRefs:["character:2"],damageSegments:[{segmentId:"s",element:"none",amount:1,repeat:1}]} as never}},events:[{eventSeq:0,stateRevision:s.stateRevision,eventType:"attack.hit",payload:{targetRef:"character:2"}}]};const out=applyElectricMarkOnAttackHit(hitCommit,ruleset);expect(electricMarkCount(out.state,2)).toBe(0);});
 it("automaticScheduler 在稳定状态执行感电结算（调度器接入生效）",()=>{let s=base();s=setMark(s,1,3);s.pendingWindows=[];const ran=runAutomaticScheduler(s,ruleset,()=>Date.now()+30000);expect(electricMarkCount(ran.state,1)).toBe(0);expect(ran.state.players[0]!.shield).toBe(8);expect(ran.state.history.domainEvents.some(e=>e.eventType==="marker.changed")).toBe(true);});
 it("多人优先语义锁定：3角色各5层在多人两轮后各剩1层（单人优先会结算到0）",()=>{let s=base();for(const seat of[1,2,3]as Seat[])s=setMark(s,seat,5);const settled=settleElectricMarks(s,ruleset);expect(settled).not.toBeNull();for(const seat of[1,2,3]as Seat[])expect(electricMarkCount(settled!.state,seat),"多人优先：5-2-2=1").toBe(1);});
 it("真实伤害先盾后血：护盾为0时溢出扣血",()=>{let s=base();s.players[0]!.shield=0;s.players[0]!.hp=10;s=setMark(s,1,3);const settled=settleElectricMarks(s,ruleset);expect(settled).not.toBeNull();expect(settled!.state.players[0]!.hp).toBe(8);expect(settled!.state.players[0]!.shield).toBe(0);});
});
