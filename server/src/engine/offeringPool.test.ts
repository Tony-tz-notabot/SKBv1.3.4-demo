import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import {
  buildOfferingPoolOffers,
  OfferingPoolSession,
} from "./offeringPool.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";

let ruleset: LoadedRuleset;
beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});

function relocate(state: AuthoritativeGameState, ref: string, zoneRef: string) {
  const card = state.cards[ref]!,
    source = state.zones[card.zoneRef]!,
    target = state.zones[zoneRef]!;
  source.orderedCardRefs.splice(source.orderedCardRefs.indexOf(ref), 1);
  target.orderedCardRefs.push(ref);
  Object.assign(card, {
    zoneRef,
    ownerSeat: target.ownerSeat,
    controllerSeat: target.ownerSeat,
    faceUp: !zoneRef.startsWith("hand:"),
  });
}

function ready(weaponCount = 1) {
  let state = createInitialSetup(ruleset, {
    gameId: "offering-pool",
    firstSeat: 1,
    seed: 1010,
    usersBySeat: { 1: "u1", 2: "u2", 3: "u3", 4: "u4" },
    characterIdsBySeat: {
      1: "character.knight",
      2: "character.alchemist",
      3: "character.ranger",
      4: "character.wizard",
    },
  });
  for (const seat of [1, 2, 3, 4] as const)
    state = resolveInitialRedraw(state, seat, false, ruleset).state;
  const pool = Object.values(state.cards).find(
      (card) => card.templateId === "special.sp10",
    )!,
    weapons = Object.values(state.cards)
      .filter((card) => card.templateId.startsWith("weapon."))
      .slice(0, weaponCount);
  relocate(state, pool.cardRef, "hand:1");
  weapons.forEach((weapon, index) =>
    relocate(state, weapon.cardRef, `weapon:1:${index + 1}`),
  );
  Object.assign(state, {
    activeSeat: 1,
    phase: "play",
    phaseBoundary: "body",
    phaseMode: "manual",
    phaseBodyResolved: false,
  });
  state.pendingWindows = [
    {
      promptId: "play:pool",
      kind: "playPhaseAction",
      prioritySeat: 1,
      mandatory: false,
      deadlineAt: 900,
      timeoutPolicy: "pass",
      legalOfferIds: ["offer:playPhaseAction:finish"],
      context: {},
    },
  ];
  return {
    state,
    pool: pool.cardRef,
    weapons: weapons.map((card) => card.cardRef),
  };
}

function command(
  prepared: ReturnType<typeof ready>,
  confirmOnlyWeapon?: boolean,
) {
  return {
    commandId: "pool-use",
    gameId: prepared.state.gameId,
    expectedStateRevision: prepared.state.stateRevision,
    actorUserId: "u1",
    promptId: "play:pool",
    offerId: `offer:special.sp10:${prepared.pool}`,
    cardRef: prepared.pool,
    weaponRef: prepared.weapons[0]!,
    ...(confirmOnlyWeapon === undefined ? {} : { confirmOnlyWeapon }),
  };
}

describe("Offering Pool", () => {
  it("is illegal without an equipped weapon", () => {
    const prepared = ready(0);
    expect(buildOfferingPoolOffers(prepared.state, ruleset, 1)).toEqual([]);
  });

  it("requires explicit confirmation when the selected weapon is the only one", () => {
    const prepared = ready(),
      offer = buildOfferingPoolOffers(prepared.state, ruleset, 1)[0]!;
    expect(offer.requiresOnlyWeaponConfirmation).toBe(true);
    const session = new OfferingPoolSession(prepared.state, ruleset),
      result = session.handle(command(prepared));
    expect(result).toMatchObject({
      accepted: false,
      reasonCode: "ONLY_WEAPON_CONFIRMATION_REQUIRED",
    });
    expect(session.state.cards[prepared.pool]!.zoneRef).toBe("hand:1");
    expect(session.state.cards[prepared.weapons[0]!]!.zoneRef).toBe(
      "weapon:1:1",
    );
  });

  it("pays one weapon and selects a configured no-effect line reproducibly", () => {
    const prepared = ready(),
      session = new OfferingPoolSession(prepared.state, ruleset),
      cmd = command(prepared, true),
      result = session.handle(cmd);
    expect(result.accepted).toBe(true);
    expect(session.handle(cmd)).toEqual(result);
    expect(session.state.cards[prepared.pool]!.zoneRef).toBe("discardPile");
    expect(session.state.cards[prepared.weapons[0]!]!.zoneRef).toBe(
      "discardPile",
    );
    expect(ruleset.settings.special.sp10.flavorLines).toContain(
      result.accepted && result.flavorLine,
    );
    expect(session.state.randomHistory.at(-1)).toMatchObject({
      purpose: "special.sp10.flavorLine",
      resultRefs: [result.accepted && result.flavorLine],
    });
    expect(
      result.accepted &&
        result.events.find(
          (event) => event.eventType === "random.choice.resolved",
        )?.payload,
    ).toMatchObject({ resultHasNoRulesEffect: true });
  });

  it("does not require the only-weapon confirmation when multiple choices exist", () => {
    const prepared = ready(2),
      session = new OfferingPoolSession(prepared.state, ruleset);
    expect(
      buildOfferingPoolOffers(prepared.state, ruleset, 1)[0]!
        .requiresOnlyWeaponConfirmation,
    ).toBe(false);
    expect(session.handle(command(prepared))).toMatchObject({ accepted: true });
    expect(session.state.cards[prepared.weapons[1]!]!.zoneRef).toBe(
      "weapon:1:2",
    );
  });
});
