import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";
import { advanceTimeline } from "./timeline.js";
import { buildDeadlyCurseOffers, DeadlyCurseSession } from "./traveler.js";
import { executeNextImmediateDamageEffect } from "./directDamage.js";
import { finalizeJudgment } from "./judgment.js";
import { resolveCurrentAttackTarget } from "./damage.js";

let ruleset: LoadedRuleset;
beforeAll(async () => { ruleset = await loadFrozenRuleset(resolve(import.meta.dirname, "../../../rulesets/v1.3.4")); });
function ready() {
  let s = createInitialSetup(ruleset, { gameId: "traveler", firstSeat: 1, seed: 401,
    usersBySeat: { 1: "u1", 2: "u2", 3: "u3", 4: "u4" },
    characterIdsBySeat: { 1: "character.interdimensional_traveler", 2: "character.knight", 3: "character.shaman", 4: "character.wizard" } });
  for (const seat of [1,2,3,4] as const) s = resolveInitialRedraw(s, seat, false, ruleset).state;
  s.players[2]!.markers.defyFateUsed = true;
  s.activeSeat=1; s.phase="play"; s.phaseMode="manual"; s.phaseBoundary="body"; s.phaseBodyResolved=false;
  s.players[0]!.limits.attackCountRemaining=1;
  s.pendingWindows=[{promptId:"play",kind:"playPhaseAction",prioritySeat:1,mandatory:false,deadlineAt:99,timeoutPolicy:"pass",legalOfferIds:[]}];
  while (s.zones["hand:1"]!.orderedCardRefs.length < 8) {
    const ref=s.zones.drawPile!.orderedCardRefs.shift()!; s.zones["hand:1"]!.orderedCardRefs.push(ref);
    s.cards[ref]!.zoneRef="hand:1"; s.cards[ref]!.ownerSeat=1; s.cards[ref]!.controllerSeat=1;
  }
  return s;
}
function activate(s: AuthoritativeGameState) {
  const offer=buildDeadlyCurseOffers(s,ruleset,1)[0]!, session=new DeadlyCurseSession(s,ruleset);
  const result=session.handle({commandId:"curse",gameId:s.gameId,expectedStateRevision:s.stateRevision,actorUserId:"u1",promptId:"play",offerId:offer.offerId,targetRef:"character:2"});
  expect(result.accepted).toBe(true); return session.state;
}
function endTurnInto(s: AuthoritativeGameState, nextSeat: 1|2|3|4) {
  s.activeSeat = nextSeat === 1 ? 4 : ((nextSeat - 1) as 1|2|3|4); s.phase="end"; s.phaseMode="automatic"; s.phaseBoundary="body"; s.phaseBodyResolved=true;
  return advanceTimeline(s,{kind:"normal"},ruleset).state;
}
describe("Traveler deadly curse",()=>{
  it("requires eight owned cards and a positive remaining attack count",()=>{
    const s=ready(); expect(buildDeadlyCurseOffers(s,ruleset,1)).toHaveLength(1);
    s.players[0]!.limits.attackCountRemaining=0; expect(buildDeadlyCurseOffers(s,ruleset,1)).toHaveLength(0);
    s.players[0]!.limits.attackCountRemaining=1;
    const ref=s.zones["hand:1"]!.orderedCardRefs.pop()!; s.zones.drawPile!.orderedCardRefs.push(ref); s.cards[ref]!.zoneRef="drawPile"; s.cards[ref]!.ownerSeat=null;
    expect(buildDeadlyCurseOffers(s,ruleset,1)).toHaveLength(0);
  });
  it("discards all discardable cards, leaves play and permanently disables the talent",()=>{
    const s=ready(), boss=s.zones.drawPile!.orderedCardRefs.find((ref)=>s.cards[ref]!.templateId.startsWith("boss."));
    if (boss) { const i=s.zones.drawPile!.orderedCardRefs.indexOf(boss); s.zones.drawPile!.orderedCardRefs.splice(i,1); s.zones["boss:1"]!.orderedCardRefs.push(boss); Object.assign(s.cards[boss]!,{zoneRef:"boss:1",ownerSeat:1,controllerSeat:1}); }
    const out=activate(s), p=out.players[0]!;
    expect(p).toMatchObject({presence:"leftPlay",markers:{parallelTraversalDisabled:true,"traveler.deadlyCurseUsed":true,"traveler.offFieldOwnTurnCount":0}});
    expect(out.zones["hand:1"]!.orderedCardRefs).toHaveLength(0);
    if (boss) expect(out.zones["boss:1"]!.orderedCardRefs).toContain(boss);
  });
  it("skips the first two own turns and returns at the third end start before other end effects",()=>{
    let s=activate(ready());
    s=endTurnInto(s,1); expect(s).toMatchObject({activeSeat:1,phase:"prepare",phaseBoundary:"after"});
    expect(s.players[0]!.markers["traveler.offFieldOwnTurnCount"]).toBe(1);
    s.phase="end";s.phaseBoundary="body";s.phaseBodyResolved=true;s=endTurnInto(s,1);
    expect(s.players[0]!.markers["traveler.offFieldOwnTurnCount"]).toBe(2);
    s.phase="end";s.phaseBoundary="body";s.phaseBodyResolved=true;s=endTurnInto(s,1);
    expect(s).toMatchObject({activeSeat:1,phase:"end"});
    expect(s.players[0]).toMatchObject({presence:"inPlay",hp:3,shield:2});
    expect(s.players[1]).toMatchObject({hp:-1,shield:0,markers:{healthFloor:-99}});
    expect(s.zones["hand:1"]!.orderedCardRefs).toHaveLength(3);
    const types=s.history.domainEvents.slice(-10).map((e)=>e.eventType);
    expect(types.indexOf("ability.effect.started")).toBeLessThan(types.indexOf("phase.before"));
  });
  it("still returns when the marked target is no longer in play",()=>{
    let s=activate(ready()); s.players[1]!.presence="leftPlay"; s.players[0]!.markers["traveler.deadlyCurseReturnAtEnd"]=true;
    s.activeSeat=1;s.phase="discard";s.phaseBoundary="body";s.phaseBodyResolved=true;
    s=advanceTimeline(s,{kind:"normal"},ruleset).state;
    expect(s.players[0]!.presence).toBe("inPlay"); expect(s.players[1]!.hp).not.toBe(-1);
    expect(s.history.domainEvents.at(-1)?.eventType).not.toBe("game.ended");
  });
});

describe("Traveler parallel traversal",()=>{
  it("judges every positive attack occurrence independently and prevents only green/blue",()=>{
    let s=ready(); s.pendingWindows=[]; s.players[0]!.shield=10;
    s.combat.currentTargetRef="character:1";
    s.combat.attack={attackId:"parallel:attack",attackerSeat:2,targetRefs:["character:1"],currentTargetHit:true,status:"targetHit",attackTypes:["field"],damageSegments:[{segmentId:"multi",damageType:"normal",element:"none",amount:2,repeat:2}]};
    s=resolveCurrentAttackTarget(s,ruleset,700,true).state;
    expect(s.resolutionStack.at(-1)?.context).toMatchObject({parallelTraversalDamage:true,occurrenceKey:"parallel:attack:character:1:multi:0"});
    s=finalizeJudgment(s,"green").state;
    s=resolveCurrentAttackTarget(s,ruleset,700,true).state;
    s=resolveCurrentAttackTarget(s,ruleset,700,true).state;
    expect(s.resolutionStack.at(-1)?.context.occurrenceKey).toBe("parallel:attack:character:1:multi:1");
    s=finalizeJudgment(s,"red").state;
    s=resolveCurrentAttackTarget(s,ruleset,700,true).state;
    expect(s.players[0]!.shield).toBe(8);
    const received=s.history.domainEvents.filter((e)=>e.eventType==="damage.received");
    expect(received).toHaveLength(1);
  });
  it("also judges positive direct damage, while zero damage creates no judgment",()=>{
    let s=ready(); s.pendingWindows=[]; s.players[0]!.shield=5;
    s.scheduledEffects.push({scheduledId:"parallel:direct",sourceRef:"character:2",controllerSeat:2,executeAt:"immediate.damagePipeline",effect:{op:"createDamage",targetRef:"character:1",amount:2,damageType:"normal",element:"none"},cancelled:false});
    s=executeNextImmediateDamageEffect(s,ruleset,800).state;
    expect(s.resolutionStack.at(-1)?.context.parallelTraversalDamage).toBe(true);
    s=finalizeJudgment(s,"blue").state;
    s=executeNextImmediateDamageEffect(s,ruleset,800).state;
    expect(s.players[0]!.shield).toBe(5); expect(s.scheduledEffects).toHaveLength(0);
    s.scheduledEffects.push({scheduledId:"parallel:zero",sourceRef:"character:2",controllerSeat:2,executeAt:"immediate.damagePipeline",effect:{op:"createDamage",targetRef:"character:1",amount:0,damageType:"normal",element:"none"},cancelled:false});
    s=executeNextImmediateDamageEffect(s,ruleset,800).state;
    expect(s.resolutionStack).toHaveLength(0);
  });
});
