import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { runAutomaticScheduler } from "./automaticScheduler.js";
import { executeNextImmediateDamageEffect } from "./directDamage.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";
import { applyStatus } from "./status.js";
import { processStatusAppliedTriggerEvents } from "./statusTriggerBridge.js";

let ruleset: LoadedRuleset;
const users = { 1: "u1", 2: "u2", 3: "u3", 4: "u4" } as const,
  characters = { 1: "character.knight", 2: "character.alchemist", 3: "character.ranger", 4: "character.wizard" } as const;
beforeAll(async () => { ruleset = await loadFrozenRuleset(resolve(import.meta.dirname, "../../../rulesets/v1.3.4")); });
function started() {
  let state = createInitialSetup(ruleset, { gameId: "direct-damage", firstSeat: 1, seed: 97, usersBySeat: users, characterIdsBySeat: characters });
  for (const seat of [1, 2, 3, 4] as const) state = resolveInitialRedraw(state, seat, false, ruleset).state;
  return state;
}
function schedule(state: AuthoritativeGameState, targetRef: string, amount: number, element = "none") {
  state.scheduledEffects.push({ scheduledId: `scheduled:test:${state.scheduledEffects.length}`, sourceRef: "character:2", controllerSeat: 2, executeAt: "immediate.damagePipeline", effect: { op: "createDamage", targetRef, amount, damageType: "normal", element, isAdditional: true }, cancelled: false });
  return state;
}
function relocate(state: AuthoritativeGameState, cardRef: string, zoneRef: string) {
  const card = state.cards[cardRef]!, from = state.zones[card.zoneRef]!;
  from.orderedCardRefs.splice(from.orderedCardRefs.indexOf(cardRef), 1);
  state.zones[zoneRef]!.orderedCardRefs.push(cardRef);
  card.zoneRef = zoneRef;
  card.ownerSeat = state.zones[zoneRef]!.ownerSeat;
  card.controllerSeat = state.zones[zoneRef]!.ownerSeat;
  card.faceUp = true;
}

describe("immediate direct damage pipeline", () => {
  it("consumes an out-of-attack Ice Shield poison schedule through the shared damage pipeline", () => {
    let state = started();
    state.players[1]!.initialTalentIds = ["talent.ice_shield"];
    state.players[0]!.shield = 5;
    state = processStatusAppliedTriggerEvents(applyStatus(state, ruleset, { ownerSeat: 1, statusId: "status.frozen", sourceRef: "character:2" }), ruleset, 500).state;
    expect(state.scheduledEffects).toHaveLength(1);
    const result = executeNextImmediateDamageEffect(state);
    expect(result.state.scheduledEffects).toHaveLength(0);
    expect(result.state.players[0]!.shield).toBe(4);
    expect(result.events.map((event) => event.eventType)).toEqual(expect.arrayContaining(["damage.received", "effect.executed"]));
  });
  it("reuses element immunity, iron shield and special-layer routing", () => {
    let immune = started();
    immune.players[0]!.initialTalentIds = ["talent.fire_shield"];
    immune.players[0]!.shield = 5;
    const prevented = executeNextImmediateDamageEffect(schedule(immune, "character:1", 3, "fire"));
    expect(prevented.state.players[0]!.shield).toBe(5);
    expect(prevented.events.find((event) => event.eventType === "damage.prevented")?.payload).toMatchObject({ reason: "elementImmunity" });
    let layered = started();
    layered.players[0]!.markers["punchingBag.extraHp"] = 2;
    layered.players[0]!.ironShield = 1;
    layered.players[0]!.shield = 5;
    const routed = executeNextImmediateDamageEffect(schedule(layered, "character:1", 5));
    expect(routed.state.players[0]).toMatchObject({ shield: 3, markers: { "punchingBag.extraHp": 0 } });
  });
  it("enters the shared dying stack and the automatic scheduler opens rescue", () => {
    const state = schedule(started(), "character:1", 2);
    state.players[0]!.shield = 0;
    state.players[0]!.hp = 1;
    const result = runAutomaticScheduler(state, ruleset, () => 700);
    expect(result.stoppedReason).toBe("manualWindow");
    expect(result.state.players[0]!.lifeState).toBe("dying");
    expect(result.state.combat.dyingStack).toEqual(["character:1"]);
    expect(result.state.pendingWindows[0]).toMatchObject({ kind: "dyingRescue", deadlineAt: 700 });
  });
  it("cancels safely when the scheduled target is no longer in play", () => {
    const state = schedule(started(), "character:1", 2);
    state.players[0]!.presence = "leftPlay";
    const result = executeNextImmediateDamageEffect(state);
    expect(result.state.scheduledEffects).toHaveLength(0);
    expect(result.events.find((event) => event.eventType === "effect.cancelled")?.payload).toMatchObject({ reason: "targetUnavailable" });
  });
  it("preserves a Trap Box counterattack created by direct damage", () => {
    const state = started(), armor = Object.values(state.cards).find((card) => card.templateId === "armor.a02")!;
    armor.templateId = "armor.a09";
    relocate(state, armor.cardRef, "armor:1");
    state.players[0]!.shield = 5;
    const result = executeNextImmediateDamageEffect(schedule(state, "character:1", 2));
    expect(result.state.players[0]!.shield).toBe(5);
    expect(result.state.combat.attack).toMatchObject({ weaponId: "armor.a09", modeId: "trapCounter", targetRefs: ["character:2"], status: "committed" });
    const scheduled = runAutomaticScheduler(result.state, ruleset, () => 800);
    expect(scheduled.stoppedReason).toBe("manualWindow");
    expect(scheduled.state.pendingWindows[0]).toMatchObject({ kind: "attackResponse", prioritySeat: 2 });
  });
});
