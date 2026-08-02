import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { buildAttackOffer, commitAttack } from "./attack.js";
import { setWeaponPreselection } from "./preselection.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import { moveCardInTransaction } from "./zoneMovement.js";

let ruleset: LoadedRuleset;
const users = { 1: "u1", 2: "u2", 3: "u3", 4: "u4" } as const;
const characters = { 1: "character.knight", 2: "character.alchemist", 3: "character.ranger", 4: "character.wizard" } as const;

beforeAll(async () => {
  ruleset = await loadFrozenRuleset(resolve(import.meta.dirname, "../../../rulesets/v1.3.4"));
});

function relocate(state: AuthoritativeGameState, cardRef: string, zoneRef: string): void {
  const card = state.cards[cardRef]!;
  const from = state.zones[card.zoneRef]!;
  from.orderedCardRefs.splice(from.orderedCardRefs.indexOf(cardRef), 1);
  state.zones[zoneRef]!.orderedCardRefs.push(cardRef);
  card.zoneRef = zoneRef;
  card.ownerSeat = state.zones[zoneRef]!.ownerSeat;
  card.controllerSeat = state.zones[zoneRef]!.ownerSeat;
  card.faceUp = true;
}

function started(weaponId: string): { state: AuthoritativeGameState; killRef: string; weaponRef: string } {
  let state = createInitialSetup(ruleset, { gameId: `mode-${weaponId}`, firstSeat: 1, seed: 404, usersBySeat: users, characterIdsBySeat: characters });
  for (const seat of [1, 2, 3, 4] as const) state = resolveInitialRedraw(state, seat, false, ruleset).state;
  Object.assign(state, { phase: "play", phaseBoundary: "body", phaseMode: "manual", activeSeat: 1 });
  state.players[0]!.limits.attackCountRemaining = 1;
  const weaponRef = Object.values(state.cards).find((card) => card.templateId === weaponId)!.cardRef;
  const killRef = Object.values(state.cards).find((card) => card.templateId.startsWith("basic.kill."))!.cardRef;
  relocate(state, weaponRef, "weapon:1:1");
  relocate(state, killRef, "hand:1");
  return { state, killRef, weaponRef };
}

describe("unified weapon mode resolver", () => {
  it.each([
    ["character:1", "range_0", 4],
    ["character:2", "range_1", 3],
    ["character:3", "range_2", 1],
  ])("selects W10's smallest covering range tier for %s", (targetRef, modeId, repeat) => {
    let { state, killRef } = started("weapon.w10");
    state = setWeaponPreselection(state, 1, "weapon:1:1", null, ruleset).state;
    expect(buildAttackOffer(state, 1, ruleset).source.mode.modeId).toBe("range_2");
    state = commitAttack(state, ruleset, { attackerSeat: 1, targetRefs: [targetRef], killCardRefs: [killRef] }).state;
    expect(state.combat.attack).toMatchObject({ modeId, damageSegments: [{ repeat }] });
  });

  it("rejects manual selection of automatic tiers", () => {
    const { state } = started("weapon.w10");
    expect(() => setWeaponPreselection(state, 1, "weapon:1:1", "range_0", ruleset)).toThrow("PRESELECTION_MODE_INVALID");
  });

  it("uses the explicit player-selected W15 attack mode", () => {
    let { state } = started("weapon.w15");
    state = setWeaponPreselection(state, 1, "weapon:1:1", "no_kill", ruleset).state;
    expect(buildAttackOffer(state, 1, ruleset).source.mode).toMatchObject({ modeId: "no_kill", costs: { killCards: 0 }, damageSegments: [{ amount: 2 }] });
  });

  it("resolves W50's public mode through instance element state", () => {
    let { state, weaponRef, killRef } = started("weapon.w50");
    state.cards[weaponRef]!.runtime.elementForm = "ice";
    state = setWeaponPreselection(state, 1, "weapon:1:1", "mode_1", ruleset).state;
    expect(buildAttackOffer(state, 1, ruleset).source.mode.modeId).toBe("mode_1_ice");
    state = commitAttack(state, ruleset, { attackerSeat: 1, targetRefs: ["character:2"], killCardRefs: [killRef] }).state;
    expect(state.cards[weaponRef]!.runtime.elementForm).toBe("fire");
    expect(state.history.domainEvents.some((event) => event.eventType === "weapon.instanceState.changed")).toBe(true);
  });

  it("transforms W30 only after commit and restores its base template when leaving equipment", () => {
    let { state, weaponRef, killRef } = started("weapon.w30");
    state.cards[weaponRef]!.runtime.chargeProgress = 3;
    state = setWeaponPreselection(state, 1, "weapon:1:1", null, ruleset).state;
    state = commitAttack(state, ruleset, { attackerSeat: 1, targetRefs: ["character:2"], killCardRefs: [killRef] }).state;
    expect(state.cards[weaponRef]!.templateId).toBe("weapon.w39");
    const tx = new EngineTransaction(state);
    moveCardInTransaction(tx, { cardRef: weaponRef, toZoneRef: "discardPile", moveKind: "discard", faceUp: true });
    state = tx.commit().state;
    expect(state.cards[weaponRef]!.templateId).toBe("weapon.w30");
    expect(state.cards[weaponRef]!.runtime.transformedBaseTemplateId).toBeUndefined();
  });
});
