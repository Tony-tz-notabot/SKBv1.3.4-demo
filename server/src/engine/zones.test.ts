import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { createInitialSetup } from "./setup.js";
import { handCards } from "./state.js";
import { moveCard, moveCardAndProcessTriggers } from "./zones.js";
let ruleset: LoadedRuleset;
const users = { 1: "u1", 2: "u2", 3: "u3", 4: "u4" } as const;
const characters = {
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
describe("normalized zone movement", () => {
  it("moves one card atomically and records its semantic move kind", () => {
    const state = createInitialSetup(ruleset, {
      gameId: "g",
      firstSeat: 1,
      seed: 2,
      usersBySeat: users,
      characterIdsBySeat: characters,
    });
    const cardRef = handCards(state, 1)[0]!;
    const result = moveCard(state, {
      cardRef,
      toZoneRef: "discardPile",
      moveKind: "discard",
    });
    expect(handCards(result.state, 1)).not.toContain(cardRef);
    expect(result.state.cards[cardRef]).toMatchObject({
      zoneRef: "discardPile",
      ownerSeat: null,
      faceUp: true,
    });
    expect(result.events[0]).toMatchObject({
      eventType: "card.moved",
      payload: { cardRef, moveKind: "discard" },
    });
    expect(state.cards[cardRef]?.zoneRef).toBe("hand:1");
  });
  it("rejects unknown destinations without changing state", () => {
    const state = createInitialSetup(ruleset, {
      gameId: "g",
      firstSeat: 1,
      seed: 2,
      usersBySeat: users,
      characterIdsBySeat: characters,
    });
    const before = structuredClone(state);
    expect(() =>
      moveCard(state, {
        cardRef: handCards(state, 1)[0]!,
        toZoneRef: "missing",
        moveKind: "systemMove",
      }),
    ).toThrow("DESTINATION_ZONE_NOT_FOUND");
    expect(state).toEqual(before);
  });
  it("forbids active Iron Pirate removal after death but external dismantle eliminates atomically", () => {
    let state = createInitialSetup(ruleset, {
      gameId: "iron-zone",
      firstSeat: 1,
      seed: 2,
      usersBySeat: users,
      characterIdsBySeat: characters,
    });
    const boss = Object.values(state.cards).find(
      (card) => card.templateId === "boss.iron_pirate_king",
    )!.cardRef;
    state = moveCard(state, {
      cardRef: boss,
      toZoneRef: "boss:1",
      moveKind: "equip",
    }).state;
    state.players[0]!.lifeState = "deadNotEliminated";
    state.players[0]!.hp = null;
    state.players[0]!.shield = null;
    expect(() =>
      moveCard(state, {
        cardRef: boss,
        toZoneRef: "discardPile",
        moveKind: "discard",
      }),
    ).toThrow("IRON_PIRATE_ACTIVE_REMOVAL_ILLEGAL_AFTER_DEATH");
    const dismantled = moveCard(state, {
      cardRef: boss,
      toZoneRef: "discardPile",
      moveKind: "dismantle",
    });
    expect(dismantled.state.players[0]!.lifeState).toBe("eliminated");
    expect(dismantled.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["card.moved", "elimination.occurred"]),
    );
  });
  it("preserves the former equipment source snapshot and resolves card.lost triggers", () => {
    let state = createInitialSetup(ruleset, {
      gameId: "lost-trigger",
      firstSeat: 1,
      seed: 22,
      usersBySeat: users,
      characterIdsBySeat: characters,
    });
    const bloodBox = Object.values(state.cards).find(
        (card) => card.templateId === "talent.blood_box",
      )!,
      armor = Object.values(state.cards).find(
        (card) => card.templateId === "armor.a01",
      )!;
    state = moveCard(state, {
      cardRef: bloodBox.cardRef,
      toZoneRef: "talent:1",
      moveKind: "equip",
    }).state;
    state = moveCard(state, {
      cardRef: armor.cardRef,
      toZoneRef: "armor:1",
      moveKind: "equip",
    }).state;
    state.players[0]!.hp = 2;
    const result = moveCardAndProcessTriggers(
      state,
      ruleset,
      {
        cardRef: armor.cardRef,
        toZoneRef: "discardPile",
        moveKind: "dismantle",
      },
      900,
    );
    expect(result.triggerStopReason).toBe("complete");
    expect(result.pendingTriggerIds).toEqual([]);
    expect(result.state.players[0]!.hp).toBe(4);
    expect(result.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        "card.moved",
        "card.lost",
        "trigger.resolved",
        "health.recovered",
      ]),
    );
    const lost = result.events.find((event) => event.eventType === "card.lost");
    expect(lost?.payload).toMatchObject({
      cardRef: armor.cardRef,
      lostFamilyId: "armor.a01",
      ownerSeat: 1,
      fromZoneRef: "armor:1",
      moveKind: "dismantle",
    });
  });
});
