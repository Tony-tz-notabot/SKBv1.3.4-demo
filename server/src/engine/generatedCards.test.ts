import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { copyTemporaryCardToHandInTransaction } from "./generatedCards.js";
import { createInitialSetup } from "./setup.js";
import { EngineTransaction } from "./transaction.js";
import { moveCardInTransaction } from "./zoneMovement.js";

let ruleset: LoadedRuleset;
beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});

describe("temporary generated cards", () => {
  it("creates an independent hand instance and redirects discard to outside deck", () => {
    const state = createInitialSetup(ruleset, {
        gameId: "generated",
        firstSeat: 1,
        seed: 337,
        usersBySeat: { 1: "u1", 2: "u2", 3: "u3", 4: "u4" },
        characterIdsBySeat: {
          1: "character.knight",
          2: "character.alchemist",
          3: "character.ranger",
          4: "character.wizard",
        },
      }),
      original = Object.values(state.cards).find(
        (card) => card.templateId === "boss.iron_pirate_king",
      )!,
      tx = new EngineTransaction(state),
      copyRef = copyTemporaryCardToHandInTransaction(tx, {
        templateId: original.templateId,
        ownerSeat: 2,
        sourceRef: original.cardRef,
        generatedBy: "boss.valkyrie",
      });
    expect(tx.draft.cards[copyRef]).toMatchObject({
      templateId: original.templateId,
      zoneRef: "hand:2",
      runtime: {
        generated: true,
        generatedBy: "boss.valkyrie",
        generatedExitZoneRef: "outsideDeck",
      },
    });
    expect(tx.draft.cards[copyRef]!.runtime).not.toEqual(original.runtime);
    moveCardInTransaction(tx, {
      cardRef: copyRef,
      toZoneRef: "discardPile",
      moveKind: "discard",
    });
    expect(tx.draft.cards[copyRef]!.zoneRef).toBe("outsideDeck");
    expect(tx.draft.zones.discardPile!.orderedCardRefs).not.toContain(copyRef);
  });
});
