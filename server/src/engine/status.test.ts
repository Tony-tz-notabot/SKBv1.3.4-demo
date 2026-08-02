import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { applyStatus } from "./status.js";
import { processStatusAppliedTriggerEvents } from "./statusTriggerBridge.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import { advanceTimeline } from "./timeline.js";
let ruleset: LoadedRuleset;
const users = { 1: "u1", 2: "u2", 3: "u3", 4: "u4" } as const,
  characters = {
    1: "character.knight",
    2: "character.alchemist",
    3: "character.ranger",
    4: "character.wizard",
  } as const;
beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});
function started() {
  let state = createInitialSetup(ruleset, {
    gameId: "status",
    firstSeat: 1,
    seed: 41,
    usersBySeat: users,
    characterIdsBySeat: characters,
  });
  for (const seat of [1, 2, 3, 4] as const)
    state = resolveInitialRedraw(state, seat, false, ruleset).state;
  return state;
}
describe("status and duration", () => {
  it("refreshes a unique status instead of stacking it", () => {
    let state = started();
    state = applyStatus(state, ruleset, {
      ownerSeat: 1,
      statusId: "status.frozen",
      sourceRef: "character:2",
    }).state;
    const firstRef = state.players[0]!.statuses[0]!.statusRef;
    const result = applyStatus(state, ruleset, {
      ownerSeat: 1,
      statusId: "status.frozen",
      sourceRef: "character:3",
    });
    expect(result.state.players[0]!.statuses).toHaveLength(1);
    expect(result.state.durations).toHaveLength(1);
    expect(result.state.players[0]!.statuses[0]!.statusRef).not.toBe(firstRef);
    expect(result.events.map((event) => event.eventType)).toContain(
      "status.refreshed",
    );
  });
  it("skips the next play phase and expires even though it was skipped", () => {
    let state = started();
    state.phase = "draw";
    state.phaseBoundary = "body";
    state.phaseMode = "automatic";
    state.phaseBodyResolved = true;
    state = applyStatus(state, ruleset, {
      ownerSeat: 1,
      statusId: "status.frozen",
    }).state;
    const result = advanceTimeline(state);
    expect(result.state.phase).toBe("play");
    expect(result.state.phaseBoundary).toBe("after");
    expect(result.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        "phase.skip",
        "status.expired",
        "duration.expired",
      ]),
    );
    expect(result.state.players[0]!.statuses).toHaveLength(0);
  });
  it("skips and consumes electrified at the next draw boundary", () => {
    let state = started();
    state.phase = "judgment";
    state.phaseBoundary = "body";
    state.phaseMode = "automatic";
    state.phaseBodyResolved = true;
    state = applyStatus(state, ruleset, {
      ownerSeat: 1,
      statusId: "status.electrified",
    }).state;
    const result = advanceTimeline(state);
    expect(result.state.phase).toBe("draw");
    expect(result.state.phaseBoundary).toBe("after");
    expect(result.state.players[0]!.statuses).toHaveLength(0);
  });
  it("prevents frozen and electrified through their matching initial talents even while equipment is disabled", () => {
    let state = started();
    state.players[0]!.initialTalentIds = ["talent.ice_shield"];
    state.players[0]!.markers.equipmentEffectsDisabled = true;
    const frozen = applyStatus(state, ruleset, { ownerSeat: 1, statusId: "status.frozen", sourceRef: "character:2" });
    expect(frozen.state.players[0]!.statuses).toHaveLength(0);
    expect(frozen.events[0]?.payload).toMatchObject({ statusId: "status.frozen", reason: "talentImmunity" });
    state = started();
    state.players[0]!.initialTalentIds = ["talent.electric_shield"];
    const electrified = applyStatus(state, ruleset, { ownerSeat: 1, statusId: "status.electrified", sourceRef: "character:2" });
    expect(electrified.state.players[0]!.statuses).toHaveLength(0);
  });
  it("adds ice-shield poison only after frozen is actually applied or refreshed", () => {
    let state = started();
    state.players[1]!.initialTalentIds = ["talent.ice_shield"];
    state.combat.attack = { attackId: "attack:ice", attackerSeat: 2, targetRefs: ["character:1"], damageSegments: [], status: "targetHit" };
    const applied = processStatusAppliedTriggerEvents(applyStatus(state, ruleset, { ownerSeat: 1, statusId: "status.frozen", sourceRef: "weapon:test", metadata: { attackId: "attack:ice" } }), ruleset, 500);
    expect(applied.state.combat.attack).toMatchObject({ damageSegments: [{ element: "poison", amount: 1, isAdditional: true }] });
    state = started();
    state.players[0]!.initialTalentIds = ["talent.ice_shield"];
    state.players[1]!.initialTalentIds = ["talent.ice_shield"];
    state.combat.attack = { attackId: "attack:immune", attackerSeat: 2, targetRefs: ["character:1"], damageSegments: [], status: "targetHit" };
    const prevented = applyStatus(state, ruleset, { ownerSeat: 1, statusId: "status.frozen", metadata: { attackId: "attack:immune" } });
    expect(prevented.state.combat.attack).toMatchObject({ damageSegments: [] });
    expect(prevented.events.some((event) => event.eventType === "damage.segment.added")).toBe(false);
  });
});
