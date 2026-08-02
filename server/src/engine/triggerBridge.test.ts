import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { runAutomaticScheduler } from "./automaticScheduler.js";
import { executeNextImmediateDamageEffect } from "./directDamage.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";
import { processEventTriggers } from "./triggerBridge.js";

let ruleset: LoadedRuleset;
const users = { 1: "u1", 2: "u2", 3: "u3", 4: "u4" } as const,
  characters = { 1: "character.knight", 2: "character.alchemist", 3: "character.ranger", 4: "character.wizard" } as const;
beforeAll(async () => { ruleset = await loadFrozenRuleset(resolve(import.meta.dirname, "../../../rulesets/v1.3.4")); });
function started() { let state = createInitialSetup(ruleset, { gameId: "trigger-bridge", firstSeat: 1, seed: 109, usersBySeat: users, characterIdsBySeat: characters }); for (const seat of [1, 2, 3, 4] as const) state = resolveInitialRedraw(state, seat, false, ruleset).state; return state; }
function equip(state: AuthoritativeGameState, templateId: string, zoneRef: string) { const card = Object.values(state.cards).find((item) => item.templateId === templateId)!, from = state.zones[card.zoneRef]!; from.orderedCardRefs.splice(from.orderedCardRefs.indexOf(card.cardRef), 1); state.zones[zoneRef]!.orderedCardRefs.push(card.cardRef); card.zoneRef = zoneRef; card.ownerSeat = state.zones[zoneRef]!.ownerSeat; card.controllerSeat = state.zones[zoneRef]!.ownerSeat; card.faceUp = true; return card; }

describe("trigger event bridge", () => {
  it("automatically executes one matching frozen trigger and deduplicates the same event", () => {
    const state = started(); state.players[0]!.hp = 2; equip(state, "talent.blood_box", "talent:1");
    const event = { eventType: "card.lost", payload: { cardRef: "armor:test", seat: 1, fromZoneRef: "armor:1" } } as const, first = processEventTriggers(state, ruleset, event, 900, "loss:1");
    expect(first.stoppedReason).toBe("complete");
    expect(first.state.players[0]!.hp).toBe(4);
    expect(first.events.some((item) => item.eventType === "trigger.resolved")).toBe(true);
    const repeated = processEventTriggers(first.state, ruleset, event, 900, "loss:1");
    expect(repeated.steps).toBe(0);
    expect(repeated.state.players[0]!.hp).toBe(4);
  });
  it("queues and recursively drains generated event facts without looping", () => {
    const state = started(); state.players[1]!.initialTalentIds = ["talent.ice_shield"]; state.players[0]!.shield = 5;
    const result = processEventTriggers(state, ruleset, { eventType: "status.applied", payload: { statusId: "status.frozen", result: "applied", sourceSeat: 2, targetRef: "character:1" } }, 900, "freeze:1");
    expect(result.stoppedReason).toBe("complete");
    expect(result.state.scheduledEffects).toHaveLength(1);
    expect(result.steps).toBe(1);
    const completed = executeNextImmediateDamageEffect(result.state);
    expect(completed.state.players[0]!.shield).toBe(4);
  });
  it("stops explicitly when the first matching trigger needs specialized costs or selections", () => {
    const state = started(); equip(state, "talent.critical_penetration", "talent:1");
    state.combat.attack = { attackId: "attack:critical", attackerSeat: 1, weaponRef: "weapon:test", attackTypes: ["ranged"], critical: true, tags: [], targetRefs: ["character:2"], status: "targetHit" };
    const result = processEventTriggers(state, ruleset, { eventType: "attack.hit", payload: { sourceSeat: 1, targetRef: "character:2" } }, 900, "hit:1");
    expect(result.stoppedReason).toBe("specializedSelection");
    expect(result.pendingCandidates[0]).toMatchObject({ familyId: "talent.critical_penetration", optional: true });
    expect(result.state.stateRevision).toBe(state.stateRevision + 1);
    expect(result.state.pendingWindows[0]).toMatchObject({ kind: "criticalPenetration", prioritySeat: 1, mandatory: false });
  });
});
