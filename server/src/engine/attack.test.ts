import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import {
  buildAttackOffer,
  commitAttack,
  resolvePreselectedAttackSource,
} from "./attack.js";
import { setWeaponPreselection } from "./preselection.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";
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
    gameId: "attack",
    firstSeat: 1,
    seed: 21,
    usersBySeat: users,
    characterIdsBySeat: characters,
  });
  for (const seat of [1, 2, 3, 4] as const)
    state = resolveInitialRedraw(state, seat, false, ruleset).state;
  state.phase = "play";
  state.phaseMode = "manual";
  state.phaseBoundary = "body";
  state.phaseBodyResolved = false;
  state.players[0]!.limits.attackCountRemaining = 1;
  return state;
}
function relocate(state: AuthoritativeGameState, cardRef: string, to: string) {
  const card = state.cards[cardRef]!,
    from = state.zones[card.zoneRef]!;
  from.orderedCardRefs.splice(from.orderedCardRefs.indexOf(cardRef), 1);
  state.zones[to]!.orderedCardRefs.push(cardRef);
  card.zoneRef = to;
  card.ownerSeat = state.zones[to]!.ownerSeat;
  card.controllerSeat = state.zones[to]!.ownerSeat;
  card.faceUp = !["drawPile", "hand"].includes(state.zones[to]!.zoneType);
}
function refFor(state: AuthoritativeGameState, prefix: string) {
  return Object.values(state.cards).find((card) =>
    card.templateId.startsWith(prefix),
  )!.cardRef;
}
describe("weapon preselection and attack commit", () => {
  it("uses an empty selected slot as hand knife only when every weapon slot is empty", () => {
    let state = started();
    state = setWeaponPreselection(state, 1, "weapon:1:1", null, ruleset).state;
    expect(resolvePreselectedAttackSource(state, 1, ruleset)).toMatchObject({
      kind: "handKnife",
      mode: { range: 1 },
    });
    const weapon = refFor(state, "weapon.w01");
    relocate(state, weapon, "weapon:2:1");
    expect(() => resolvePreselectedAttackSource(state, 1, ruleset)).toThrow(
      "ATTACK_EMPTY_SLOT_INVALID",
    );
  });
  it("resolves a preselected weapon and hides no public domain event for selection", () => {
    let state = started(),
      weapon = refFor(state, "weapon.w01");
    relocate(state, weapon, "weapon:1:1");
    const beforeEvents = state.lastEventSeq,
      result = setWeaponPreselection(
        state,
        1,
        "weapon:1:1",
        "default",
        ruleset,
      );
    expect(result.events).toHaveLength(0);
    expect(result.state.lastEventSeq).toBe(beforeEvents);
    expect(
      resolvePreselectedAttackSource(result.state, 1, ruleset),
    ).toMatchObject({
      kind: "weapon",
      weaponId: "weapon.w01",
      mode: { modeId: "default", range: 2 },
    });
  });
  it("pays kill and attack count then creates a committed attack", () => {
    let state = started(),
      kill = refFor(state, "basic.kill.");
    relocate(state, kill, "hand:1");
    state = setWeaponPreselection(state, 1, "weapon:1:1", null, ruleset).state;
    const offer = buildAttackOffer(state, 1, ruleset);
    expect(offer.payable).toBe(true);
    const result = commitAttack(state, ruleset, {
      attackerSeat: 1,
      targetRefs: ["character:2"],
      killCardRefs: [kill],
    });
    expect(result.state.cards[kill]!.zoneRef).toBe("resolving");
    expect(result.state.players[0]!.limits.attackCountRemaining).toBe(0);
    expect(result.state.combat.attack).toMatchObject({
      status: "committed",
      modeId: "handKnife",
    });
    expect(result.events.map((event) => event.eventType)).toContain(
      "attack.commit",
    );
  });
  it("suspends the play window while an attack is resolving", () => {
    let state = started(),
      kill = refFor(state, "basic.kill.");
    relocate(state, kill, "hand:1");
    state = setWeaponPreselection(state, 1, "weapon:1:1", null, ruleset).state;
    state.pendingWindows.push({
      promptId: "play",
      kind: "playPhaseAction",
      prioritySeat: 1,
      mandatory: false,
      deadlineAt: 900,
      timeoutPolicy: "pass",
      legalOfferIds: ["finish"],
      context: {},
    });
    const result = commitAttack(state, ruleset, {
      attackerSeat: 1,
      targetRefs: ["character:2"],
      killCardRefs: [kill],
    }).state;
    expect(result.pendingWindows).toHaveLength(0);
    expect(result.combat.attack).toMatchObject({ resumePlayDeadlineAt: 900 });
  });
  it("rejects an ineffective equipped weapon without enabling hand knife", () => {
    let state = started(),
      weapon = refFor(state, "weapon.w01");
    relocate(state, weapon, "weapon:1:1");
    state.preselection[1] = { weaponSlot: "weapon:1:1", modeId: "default" };
    state.players[0]!.markers.equipmentEffectsDisabled = true;
    expect(() => buildAttackOffer(state, 1, ruleset)).toThrow(
      "ATTACK_WEAPON_INEFFECTIVE",
    );
  });
  it("applies only effective explicit combo/scatter dimensions", () => {
    for (const [weaponId, talentId, expected] of [
      ["weapon.w09", "talent.scatter_up", 4],
      ["weapon.w19", "talent.combo_up", 4],
    ] as const) {
      let state = started(),
        weapon = refFor(state, weaponId),
        talent = refFor(state, talentId);
      relocate(state, weapon, "weapon:1:1");
      relocate(state, talent, "talent:1");
      state = setWeaponPreselection(
        state,
        1,
        "weapon:1:1",
        null,
        ruleset,
      ).state;
      expect(
        resolvePreselectedAttackSource(state, 1, ruleset).mode
          .damageSegments[0]!.repeat,
      ).toBe(expected);
      state.players[0]!.markers.equipmentEffectsDisabled = true;
      expect(() => resolvePreselectedAttackSource(state, 1, ruleset)).toThrow(
        "ATTACK_WEAPON_INEFFECTIVE",
      );
    }
  });
  it("adds melee range and reduces charge requirements", () => {
    let state = started(),
      weapon = refFor(state, "weapon.w13"),
      range = refFor(state, "talent.melee_range_up");
    relocate(state, weapon, "weapon:1:1");
    relocate(state, range, "talent:1");
    state = setWeaponPreselection(state, 1, "weapon:1:1", null, ruleset).state;
    expect(resolvePreselectedAttackSource(state, 1, ruleset).mode.range).toBe(
      2,
    );
    state = started();
    weapon = refFor(state, "weapon.w11");
    const charge = refFor(state, "talent.charge_acceleration");
    relocate(state, weapon, "weapon:1:1");
    relocate(state, charge, "talent:1");
    state = setWeaponPreselection(state, 1, "weapon:1:1", null, ruleset).state;
    expect(resolvePreselectedAttackSource(state, 1, ruleset).mode.modeId).toBe(
      "charge_1",
    );
  });
});
