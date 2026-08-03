import {resolve} from "node:path";
import {beforeAll,describe,expect,it} from "vitest";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {createInitialSetup,resolveInitialRedraw} from "./setup.js";
import type {AuthoritativeGameState} from "./state.js";
import {commitAttack} from "./attack.js";
import {runCombatUntilBlocked} from "./combatScheduler.js";
import {grantBombsAfterAttack} from "./trapMaster.js";
import {setWeaponPreselection} from "./preselection.js";

let ruleset:LoadedRuleset;
beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});

function trapAttackerReady(seed:number){let s=createInitialSetup(ruleset,{gameId:`trap-siphon-${seed}`,firstSeat:1,seed,usersBySeat:{1:"u1",2:"u2",3:"u3",4:"u4"},characterIdsBySeat:{1:"character.trap_master",2:"character.knight",3:"character.ranger",4:"character.wizard"}});for(const seat of[1,2,3,4]as const)s=resolveInitialRedraw(s,seat,false,ruleset).state;Object.assign(s,{activeSeat:1,phase:"play",phaseBoundary:"body",phaseMode:"manual",phaseBodyResolved:false});s.players[0]!.limits.attackCountRemaining=1;s.players[1]!.hp=8;s.players[1]!.shield=0;const kill=Object.values(s.cards).find(card=>card.templateId.startsWith("basic.kill."))!.cardRef;relocate(s,kill,"hand:1");s=setWeaponPreselection(s,1,"weapon:1:1",null,ruleset).state;return{s,kill};}
function relocate(state:AuthoritativeGameState,ref:string,to:string){const card=state.cards[ref]!,from=state.zones[card.zoneRef]!;from.orderedCardRefs.splice(from.orderedCardRefs.indexOf(ref),1);state.zones[to]!.orderedCardRefs.push(ref);card.zoneRef=to;card.ownerSeat=state.zones[to]!.ownerSeat;card.controllerSeat=state.zones[to]!.ownerSeat;card.faceUp=!(["drawPile","hand"].includes(state.zones[to]!.zoneType));}

describe("trap master bomb siphon (R038)",()=>{
 it("grants bombs from a full real attack without crashing on cleared combat.attack",async()=>{const {s,kill}=trapAttackerReady(61);
  let state=commitAttack(s,ruleset,{attackerSeat:1,targetRefs:["character:2"],killCardRefs:[kill]}).state;
  let result=runCombatUntilBlocked(state,ruleset,()=>900);
  while(result.stoppedReason==="responseWindow"){
   const w=result.state.pendingWindows[0]!,response=new (await import("./response.js")).AttackResponseSession(result.state);
   const out=response.handle({commandId:`pass-${result.state.stateRevision}`,gameId:result.state.gameId,expectedStateRevision:result.state.stateRevision,actorUserId:"u2",promptId:w.promptId,offerId:w.legalOfferIds.find((id:string)=>id.includes(":pass:"))!});
   if(!out.accepted)throw new Error(`response rejected: ${out.reasonCode}`);
   state=response.state;result=runCombatUntilBlocked(state,ruleset,()=>900);
  }
  expect(result.stoppedReason).toBe("combatComplete");
  expect(result.state.combat.attack).toBeNull();
  const bombs=Number(result.state.players[0]!.markers["trap.bombs"]??0);
  expect(bombs).toBeGreaterThan(0);
 });
 it("does not crash when a target.after event arrives while combat.attack is already cleared",async()=>{const {s}=trapAttackerReady(71);
  const txState={...s,combat:{...s.combat,attack:null,targetQueue:[],currentTargetRef:null}};
  const commit={previousRevision:s.stateRevision,state:txState,events:[{eventType:"attack.target.after" as const,payload:{attackId:"attack:9:1",attackerSeat:1,targetRef:"character:2",actualHpLoss:2},eventSeq:1,stateRevision:s.stateRevision},{eventType:"attack.resolved" as const,payload:{attackId:"attack:9:1"},eventSeq:2,stateRevision:s.stateRevision}]};
  const out=grantBombsAfterAttack(commit as never);
  expect(Number(out.state.players[0]!.markers["trap.bombs"]??0)).toBe(1);
 });
 it("still accumulates bombs when the attack is present in combat",async()=>{const {s}=trapAttackerReady(81);
  const attackRecord={attackId:"attack:10:1",attackerSeat:1,status:"targetHit" as const};
  const txState={...s,combat:{...s.combat,attack:attackRecord,targetQueue:["character:2"],currentTargetRef:"character:2"}};
  const commit={previousRevision:s.stateRevision,state:txState,events:[{eventType:"attack.target.after" as const,payload:{attackId:"attack:10:1",attackerSeat:1,targetRef:"character:2",actualHpLoss:2},eventSeq:1,stateRevision:s.stateRevision}]};
  const out=grantBombsAfterAttack(commit as never);
  expect(Number(out.state.players[0]!.markers["trap.bombs"]??0)).toBe(1);
  expect((out.state.players[0]!.markers["trap.bombHpAccum"] as {attackId:string;value:number}).attackId).toBe("attack:10:1");
 });
 it("resets the accumulator for a new attack id",async()=>{const {s}=trapAttackerReady(91);
  const txState={...s,players:s.players.map((p,i)=>i===0?{...p,markers:{...p.markers,"trap.bombHpAccum":{attackId:"attack:1:1",value:3}}}:p) as typeof s.players,combat:{...s.combat,attack:null,targetQueue:[],currentTargetRef:null}};
  const commit={previousRevision:s.stateRevision,state:txState,events:[{eventType:"attack.target.after" as const,payload:{attackId:"attack:2:1",attackerSeat:1,targetRef:"character:2",actualHpLoss:2},eventSeq:1,stateRevision:s.stateRevision}]};
  const out=grantBombsAfterAttack(commit as never);
  // 新 attackId：从 0 起算 floor(2/2)=1，不含旧攻击的 3
  expect(Number(out.state.players[0]!.markers["trap.bombs"]??0)).toBe(1);
  expect((out.state.players[0]!.markers["trap.bombHpAccum"] as {attackId:string;value:number})).toEqual({attackId:"attack:2:1",value:2});
 });
});
