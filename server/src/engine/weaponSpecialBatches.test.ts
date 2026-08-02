import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { buildAttackOffer, commitAttack } from "./attack.js";
import { ParticleEagleFollowUpSession } from "./attackLifecycle.js";
import { resolveCurrentAttackTarget } from "./damage.js";
import { setWeaponPreselection } from "./preselection.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import type { JsonValue } from "./types.js";
import { startScheduledWeaponAttackAtPrepare } from "./weaponScheduled.js";

let ruleset: LoadedRuleset;
beforeAll(async () => { ruleset = await loadFrozenRuleset(resolve(import.meta.dirname, "../../../rulesets/v1.3.4")); });
function relocate(state: AuthoritativeGameState, ref: string, zoneRef: string): void { const card = state.cards[ref]!; state.zones[card.zoneRef]!.orderedCardRefs.splice(state.zones[card.zoneRef]!.orderedCardRefs.indexOf(ref), 1); state.zones[zoneRef]!.orderedCardRefs.push(ref); Object.assign(card, { zoneRef, ownerSeat: state.zones[zoneRef]!.ownerSeat, controllerSeat: state.zones[zoneRef]!.ownerSeat, faceUp: true }); }
function ready(weaponId: string) {
  let state = createInitialSetup(ruleset, { gameId: `special-${weaponId}`, firstSeat: 1, seed: 717, usersBySeat: { 1: "u1", 2: "u2", 3: "u3", 4: "u4" }, characterIdsBySeat: { 1: "character.knight", 2: "character.wizard", 3: "character.ranger", 4: "character.alchemist" } });
  for (const seat of [1, 2, 3, 4] as const) state = resolveInitialRedraw(state, seat, false, ruleset).state;
  Object.assign(state, { lifecycle: "inProgress", phase: "play", phaseBoundary: "body", phaseMode: "manual", activeSeat: 1 }); state.players[0]!.limits.attackCountRemaining = 1;
  const weapon = Object.values(state.cards).find((card) => card.templateId === weaponId)!.cardRef, kills = Object.values(state.cards).filter((card) => card.templateId.startsWith("basic.kill.")).map((card) => card.cardRef);
  relocate(state, weapon, "weapon:1:1"); relocate(state, kills[0]!, "hand:1"); state = setWeaponPreselection(state, 1, "weapon:1:1", null, ruleset).state;
  return { state, weapon, kills };
}

describe("special weapon batches", () => {
  it("offers W07's single non-chaining follow-up only after the original attack misses", () => {
    let { state, kills } = ready("weapon.w07"); state = commitAttack(state, ruleset, { attackerSeat: 1, targetRefs: ["character:2"], killCardRefs: [kills[0]!] }).state;
    const attack = state.combat.attack as Record<string, JsonValue>; attack.currentTargetHit = false; attack.currentTargetResult = "miss"; attack.status = "targetMiss";
    state = resolveCurrentAttackTarget(state, ruleset).state;
    const window = state.pendingWindows[0]!; expect(window.kind).toBe("weaponParticleEagleFollowUp"); expect(window.legalOfferIds).toContain("offer:weapon-w07-follow-up:character:1");
    const session = new ParticleEagleFollowUpSession(state); session.handle({ commandId: "follow", gameId: state.gameId, expectedStateRevision: state.stateRevision, actorUserId: "u1", promptId: window.promptId, offerId: "offer:weapon-w07-follow-up:character:1", targetRef: "character:1" });
    expect(session.state.combat.attack).toMatchObject({ targetRefs: ["character:1"], killCardRefs: [], status: "committed", tags: expect.arrayContaining(["particleEagleFollowUp"]) });
  });

  it("schedules W18 charge-2 once and starts its no-cost snapshot at the owner's next prepare", () => {
    let { state, weapon, kills } = ready("weapon.w18"); state.cards[weapon]!.runtime.chargeProgress = 2;
    state = commitAttack(state, ruleset, { attackerSeat: 1, targetRefs: ["character:2"], killCardRefs: [kills[0]!] }).state;
    expect(state.scheduledEffects).toHaveLength(1);
    state.combat.attack = null; state.combat.targetQueue = []; state.combat.currentTargetRef = null;
    const tx = new EngineTransaction(state); expect(startScheduledWeaponAttackAtPrepare(tx, ruleset, 1)).toBe(true); state = tx.commit().state;
    expect(state.combat.attack).toMatchObject({ weaponId: "weapon.w18", modeId: "charge_2", targetRefs: ["character:2"], killCardRefs: [], damageSegments: [{ amount: 3, repeat: 2 }] });
    expect(state.scheduledEffects).toHaveLength(0);
  });

  it.each(["weapon.w62", "weapon.w63"])("waives attack count from the second paid attempt for %s", (weaponId) => {
    let { state, kills } = ready(weaponId); state = commitAttack(state, ruleset, { attackerSeat: 1, targetRefs: ["character:2"], killCardRefs: [kills[0]!] }).state;
    state.combat.attack = null; state.combat.targetQueue = []; state.combat.currentTargetRef = null; relocate(state, kills[1]!, "hand:1");
    expect(buildAttackOffer(state, 1, ruleset)).toMatchObject({ attackCountAvailable: 0, attackCountCost: 0, payable: true });
    state.round += 1; expect(buildAttackOffer(state, 1, ruleset).attackCountCost).toBe(1);
  });
});
