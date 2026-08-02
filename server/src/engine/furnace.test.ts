import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import {
  buildOriginFurnaceOffers,
  OriginFurnaceSession,
  ReforgeFurnaceSelectionSession,
  ReforgeFurnaceSession,
} from "./furnace.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import type { AuthoritativeGameState } from "./state.js";

let ruleset: LoadedRuleset;
beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});

function relocate(
  state: AuthoritativeGameState,
  ref: string,
  toZoneRef: string,
) {
  const card = state.cards[ref]!,
    source = state.zones[card.zoneRef]!,
    target = state.zones[toZoneRef]!;
  source.orderedCardRefs.splice(source.orderedCardRefs.indexOf(ref), 1);
  target.orderedCardRefs.push(ref);
  card.zoneRef = toZoneRef;
  card.ownerSeat = target.ownerSeat;
  card.controllerSeat = target.ownerSeat;
  card.faceUp = !toZoneRef.startsWith("hand:");
}

function ready(color: string, slot = "weapon:1:1") {
  let state = createInitialSetup(ruleset, {
    gameId: `origin-furnace:${color}`,
    firstSeat: 1,
    seed: 605,
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
  const facts = new Map(
      (
        ruleset.documents.get("cards.json") as {
          items: Array<{ cardId: string; category: string; color: string }>;
        }
      ).items.map((item) => [item.cardId, item]),
    ),
    furnace = Object.values(state.cards).find(
      (card) => card.templateId === "special.sp06",
    )!,
    weapon = Object.values(state.cards).find((card) => {
      const fact = facts.get(card.templateId);
      return fact?.category === "weapon" && fact.color === color;
    })!;
  relocate(state, furnace.cardRef, "hand:1");
  relocate(state, weapon.cardRef, slot);
  state.activeSeat = 1;
  state.phase = "play";
  state.phaseBoundary = "body";
  state.phaseMode = "manual";
  state.phaseBodyResolved = false;
  state.pendingWindows = [
    {
      promptId: "play:origin-furnace",
      kind: "playPhaseAction",
      prioritySeat: 1,
      mandatory: false,
      deadlineAt: 900,
      timeoutPolicy: "pass",
      legalOfferIds: ["offer:playPhaseAction:finish"],
      context: {},
    },
  ];
  return { state, furnace: furnace.cardRef, weapon: weapon.cardRef };
}

function command(
  state: AuthoritativeGameState,
  furnace: string,
  weapon: string,
) {
  return {
    commandId: `origin:${state.stateRevision}`,
    gameId: state.gameId,
    expectedStateRevision: state.stateRevision,
    actorUserId: "u1",
    promptId: "play:origin-furnace",
    offerId: `offer:special.sp06:${furnace}`,
    cardRef: furnace,
    weaponRef: weapon,
  };
}

describe("Origin Furnace", () => {
  it.each([
    ["white", 2],
    ["green", 2],
    ["blue", 3],
    ["orange", 3],
    ["red", 4],
  ])("draws the frozen configured count for a %s weapon", (color, count) => {
    const prepared = ready(color),
      before = prepared.state.zones["hand:1"]!.orderedCardRefs.length,
      session = new OriginFurnaceSession(prepared.state, ruleset),
      cmd = command(prepared.state, prepared.furnace, prepared.weapon),
      result = session.handle(cmd);
    expect(result.accepted).toBe(true);
    expect(session.handle(cmd)).toEqual(result);
    expect(session.state.zones["hand:1"]!.orderedCardRefs).toHaveLength(
      before - 1 + count,
    );
    expect(session.state.cards[prepared.furnace]!.zoneRef).toBe("discardPile");
    expect(session.state.cards[prepared.weapon]!.zoneRef).toBe("discardPile");
    expect(
      result.accepted &&
        result.events.find((event) => event.eventType === "card.drawn")
          ?.payload,
    ).toMatchObject({ requestedCount: count, actualCount: count });
  });

  it("accepts the third-weapon slot and publishes the exact legal cost choices", () => {
    const prepared = ready("blue", "thirdWeapon:1"),
      offers = buildOriginFurnaceOffers(prepared.state, ruleset, 1);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      legalWeaponRefs: [prepared.weapon],
      drawCountByWeaponRef: { [prepared.weapon]: 3 },
    });
    const session = new OriginFurnaceSession(prepared.state, ruleset);
    expect(
      session.handle(
        command(prepared.state, prepared.furnace, prepared.weapon),
      ),
    ).toMatchObject({ accepted: true });
  });

  it("pays the weapon before drawing, so it may enter a reshuffle while the Furnace stays resolving", () => {
    const prepared = ready("white");
    for (const zoneRef of ["drawPile", "discardPile"])
      for (const ref of [...prepared.state.zones[zoneRef]!.orderedCardRefs])
        relocate(prepared.state, ref, "outsideDeck");
    const session = new OriginFurnaceSession(prepared.state, ruleset),
      result = session.handle(
        command(prepared.state, prepared.furnace, prepared.weapon),
      );
    expect(result.accepted).toBe(true);
    expect(session.state.cards[prepared.weapon]!.zoneRef).toBe("hand:1");
    expect(session.state.cards[prepared.furnace]!.zoneRef).toBe("discardPile");
    expect(
      result.accepted && result.events.map((event) => event.eventType),
    ).toContain("deck.reshuffled");
    expect(
      result.accepted &&
        result.events.find((event) => event.eventType === "card.drawn")
          ?.payload,
    ).toMatchObject({ requestedCount: 2, actualCount: 1 });
  });

  it("rejects missing or stale weapon choices without mutation", () => {
    const prepared = ready("red"),
      session = new OriginFurnaceSession(prepared.state, ruleset),
      revision = prepared.state.stateRevision,
      result = session.handle({
        ...command(prepared.state, prepared.furnace, prepared.weapon),
        weaponRef: "card:missing",
      });
    expect(result).toMatchObject({
      accepted: false,
      reasonCode: "WEAPON_NO_LONGER_LEGAL",
    });
    expect(session.state.stateRevision).toBe(revision);
    expect(session.state.cards[prepared.furnace]!.zoneRef).toBe("hand:1");
    expect(session.state.cards[prepared.weapon]!.zoneRef).toBe("weapon:1:1");
  });
});

function readyReforge(color: string) {
  const prepared = ready(color),
    reforge = Object.values(prepared.state.cards).find(
      (card) => card.templateId === "special.sp05",
    )!;
  relocate(prepared.state, prepared.furnace, "outsideDeck");
  relocate(prepared.state, reforge.cardRef, "hand:1");
  return { ...prepared, furnace: reforge.cardRef };
}

function reforgeCommand(
  state: AuthoritativeGameState,
  furnace: string,
  weapon: string,
) {
  return {
    commandId: `reforge:${state.stateRevision}`,
    gameId: state.gameId,
    expectedStateRevision: state.stateRevision,
    actorUserId: "u1",
    promptId: "play:origin-furnace",
    offerId: `offer:special.sp05:${furnace}`,
    cardRef: furnace,
    weaponRef: weapon,
  };
}

function putOnTop(state: AuthoritativeGameState, refs: string[]) {
  for (const ref of refs) {
    const card = state.cards[ref]!,
      source = state.zones[card.zoneRef]!;
    source.orderedCardRefs.splice(source.orderedCardRefs.indexOf(ref), 1);
    Object.assign(card, {
      zoneRef: "drawPile",
      ownerSeat: null,
      controllerSeat: null,
      faceUp: false,
    });
  }
  state.zones.drawPile!.orderedCardRefs.unshift(...refs);
}

function cardOf(
  state: AuthoritativeGameState,
  category: string,
  color: string,
) {
  const facts = new Map(
    (
      ruleset.documents.get("cards.json") as {
        items: Array<{ cardId: string; category: string; color: string }>;
      }
    ).items.map((item) => [item.cardId, item]),
  );
  return Object.values(state.cards).find((card) => {
    const fact = facts.get(card.templateId);
    return fact?.category === category && fact.color === color;
  })!.cardRef;
}

describe("Reforge Furnace", () => {
  it("reveals until the configured color rank is reached and offers every revealed weapon", () => {
    const prepared = readyReforge("green"),
      white = cardOf(prepared.state, "weapon", "white"),
      basic = cardOf(prepared.state, "basic", "red"),
      blue = cardOf(prepared.state, "weapon", "blue");
    putOnTop(prepared.state, [white, basic, blue]);
    const session = new ReforgeFurnaceSession(prepared.state, ruleset),
      result = session.handle(
        reforgeCommand(prepared.state, prepared.furnace, prepared.weapon),
      );
    expect(result).toMatchObject({
      accepted: true,
      selectionRequired: true,
      revealedCardRefs: [white, basic, blue],
      legalWeaponRefs: [white, blue],
    });
    expect(session.state.pendingWindows[0]).toMatchObject({
      kind: "reforgeFurnaceSelection",
      mandatory: true,
      timeoutPolicy: "randomLegal",
    });
  });

  it("gains one selected weapon, discards the other reveals, and restores play", () => {
    const prepared = readyReforge("green"),
      white = cardOf(prepared.state, "weapon", "white"),
      blue = cardOf(prepared.state, "weapon", "blue");
    putOnTop(prepared.state, [white, blue]);
    const use = new ReforgeFurnaceSession(prepared.state, ruleset);
    use.handle(
      reforgeCommand(prepared.state, prepared.furnace, prepared.weapon),
    );
    const window = use.state.pendingWindows[0]!,
      selection = new ReforgeFurnaceSelectionSession(use.state),
      cmd = {
        commandId: "reforge-select",
        gameId: use.state.gameId,
        expectedStateRevision: use.state.stateRevision,
        actorUserId: "u1",
        promptId: window.promptId,
        offerId: `offer:reforge-furnace:${white}`,
        selectedWeaponRef: white,
      },
      result = selection.handle(cmd);
    expect(result.accepted).toBe(true);
    expect(selection.handle(cmd)).toEqual(result);
    expect(selection.state.cards[white]!.zoneRef).toBe("hand:1");
    expect(selection.state.cards[blue]!.zoneRef).toBe("discardPile");
    expect(selection.state.cards[prepared.furnace]!.zoneRef).toBe(
      "discardPile",
    );
    expect(selection.state.pendingWindows[0]).toMatchObject({
      kind: "playPhaseAction",
      prioritySeat: 1,
    });
  });

  it("stops at eight and finishes directly when none of the reveals is a weapon", () => {
    const prepared = readyReforge("red"),
      basics = Object.values(prepared.state.cards)
        .filter(
          (card) =>
            card.templateId.startsWith("basic.") && card.zoneRef !== "hand:1",
        )
        .slice(0, 8)
        .map((card) => card.cardRef);
    putOnTop(prepared.state, basics);
    const session = new ReforgeFurnaceSession(prepared.state, ruleset),
      result = session.handle(
        reforgeCommand(prepared.state, prepared.furnace, prepared.weapon),
      );
    expect(result).toMatchObject({
      accepted: true,
      selectionRequired: false,
      revealedCardRefs: basics,
      legalWeaponRefs: [],
    });
    expect(session.state.pendingWindows[0]).toMatchObject({
      kind: "playPhaseAction",
    });
    expect(
      basics.every(
        (ref) => session.state.cards[ref]!.zoneRef === "discardPile",
      ),
    ).toBe(true);
  });

  it("pays before reveal, can rediscover the paid weapon, and resolves timeout deterministically", () => {
    const prepared = readyReforge("red");
    for (const zoneRef of ["drawPile", "discardPile"])
      for (const ref of [...prepared.state.zones[zoneRef]!.orderedCardRefs])
        relocate(prepared.state, ref, "outsideDeck");
    const use = new ReforgeFurnaceSession(prepared.state, ruleset),
      result = use.handle(
        reforgeCommand(prepared.state, prepared.furnace, prepared.weapon),
      );
    expect(result).toMatchObject({
      accepted: true,
      selectionRequired: true,
      revealedCardRefs: [prepared.weapon],
      legalWeaponRefs: [prepared.weapon],
    });
    const selection = new ReforgeFurnaceSelectionSession(use.state),
      timed = selection.handleTimeout("reforge-timeout");
    expect(timed.accepted).toBe(true);
    expect(selection.state.cards[prepared.weapon]!.zoneRef).toBe("hand:1");
    expect(selection.state.randomHistory.at(-1)).toMatchObject({
      purpose: "special.sp05.selection.timeout",
      candidateRefs: [prepared.weapon],
      resultRefs: [prepared.weapon],
    });
  });
});
