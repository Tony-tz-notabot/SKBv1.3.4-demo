import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { runAutomaticScheduler } from "./automaticScheduler.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";
import { executeMatchedTrigger } from "./triggerEffects.js";
import { compileTriggerRegistry, matchTriggeredEffects, type CompiledTriggerDefinition } from "./triggerRegistry.js";

let ruleset: LoadedRuleset;
const users = { 1: "u1", 2: "u2", 3: "u3", 4: "u4" } as const,
  characters = { 1: "character.knight", 2: "character.alchemist", 3: "character.ranger", 4: "character.wizard" } as const;
beforeAll(async () => { ruleset = await loadFrozenRuleset(resolve(import.meta.dirname, "../../../rulesets/v1.3.4")); });
function started() { let state = createInitialSetup(ruleset, { gameId: "trigger-effects", firstSeat: 1, seed: 103, usersBySeat: users, characterIdsBySeat: characters }); for (const seat of [1, 2, 3, 4] as const) state = resolveInitialRedraw(state, seat, false, ruleset).state; return state; }
function equip(state: AuthoritativeGameState, templateId: string, zoneRef: string) { const card = Object.values(state.cards).find((item) => item.templateId === templateId)!, from = state.zones[card.zoneRef]!; from.orderedCardRefs.splice(from.orderedCardRefs.indexOf(card.cardRef), 1); state.zones[zoneRef]!.orderedCardRefs.push(card.cardRef); card.zoneRef = zoneRef; card.ownerSeat = state.zones[zoneRef]!.ownerSeat; card.controllerSeat = state.zones[zoneRef]!.ownerSeat; card.faceUp = true; return card; }
const custom = (effects: CompiledTriggerDefinition["effects"], optional = false): CompiledTriggerDefinition => ({ triggerId: "custom", sourceFile: "test", sourcePath: "custom", familyId: "talent.custom", eventType: "test.event", mandatory: !optional, optional, timing: null, scope: null, priorityName: optional ? "optionalModifier" : "mandatoryModifier", priority: optional ? 600 : 700, filter: {}, costs: [], effects });

describe("trigger effect dispatcher", () => {
  it("executes the frozen Blood Box recovery trigger after revalidation", () => {
    const state = started();
    state.players[0]!.hp = 2;
    const talent = equip(state, "talent.blood_box", "talent:1"), event = { eventType: "card.lost", payload: { cardRef: "lost-armor", seat: 1, fromZoneRef: "armor:1" } } as const;
    const candidate = matchTriggeredEffects(state, compileTriggerRegistry(ruleset), event)[0]!;
    expect(candidate).toMatchObject({ familyId: "talent.blood_box", sourceRef: talent.cardRef, controllerSeat: 1 });
    const result = executeMatchedTrigger(state, ruleset, candidate, event);
    expect(result.state.players[0]!.hp).toBe(4);
    expect(result.events.map((item) => item.eventType)).toEqual(expect.arrayContaining(["trigger.execution.before", "health.recovered", "trigger.resolved"]));
  });
  it("dispatches draw, marker and status effects in one atomic trigger", () => {
    const state = started(), before = state.zones["hand:1"]!.orderedCardRefs.length;
    state.players[0]!.initialTalentIds.push("talent.custom");
    const registry = [custom([{ op: "drawCards", target: "$controller", params: { count: 1 } }, { op: "addMarker", target: "$controller", params: { markerId: "test.marker", amount: 2 } }, { op: "applyStatus", target: "$controller", params: { statusId: "status.frozen" } }])], event = { eventType: "test.event", payload: {} } as const, candidate = matchTriggeredEffects(state, registry, event)[0]!;
    const result = executeMatchedTrigger(state, ruleset, candidate, event);
    expect(result.state.zones["hand:1"]!.orderedCardRefs).toHaveLength(before + 1);
    expect(result.state.players[0]!.markers["test.marker"]).toBe(2);
    expect(result.state.players[0]!.statuses.some((status) => status.statusId === "status.frozen")).toBe(true);
  });
  it("schedules direct damage and lets the automatic scheduler consume it", () => {
    const state = started();
    state.players[0]!.initialTalentIds.push("talent.custom");
    state.players[1]!.shield = 5;
    const event = { eventType: "test.event", payload: { targetRef: "character:2" } } as const, candidate = matchTriggeredEffects(state, [custom([{ op: "createDamage", target: "$event.target", params: { amount: 2, damageType: "normal", element: "none", isAdditional: true } }])], event)[0]!;
    const triggered = executeMatchedTrigger(state, ruleset, candidate, event);
    expect(triggered.state.scheduledEffects).toHaveLength(1);
    const completed = runAutomaticScheduler(triggered.state, ruleset, () => 800);
    expect(completed.state.players[1]!.shield).toBe(3);
    expect(completed.state.scheduledEffects).toHaveLength(0);
  });
  it("rejects optional triggers until a choice window accepts them", () => {
    const state = started(); state.players[0]!.initialTalentIds.push("talent.custom");
    const event = { eventType: "test.event", payload: {} } as const, candidate = matchTriggeredEffects(state, [custom([], true)], event)[0]!;
    expect(() => executeMatchedTrigger(state, ruleset, candidate, event)).toThrow("TRIGGER_OPTIONAL_REQUIRES_WINDOW");
  });
  it("rolls back completely when an effect operation is unsupported", () => {
    const state = started(); state.players[0]!.initialTalentIds.push("talent.custom"); const before = structuredClone(state), event = { eventType: "test.event", payload: {} } as const, candidate = matchTriggeredEffects(state, [custom([{ op: "selectTargets" }])], event)[0]!;
    expect(() => executeMatchedTrigger(state, ruleset, candidate, event)).toThrow("TRIGGER_EFFECT_UNSUPPORTED:selectTargets");
    expect(state).toEqual(before);
  });
});
