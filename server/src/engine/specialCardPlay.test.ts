import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFrozenRuleset } from "../ruleset/loadRuleset.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { createInitialSetup, resolveInitialRedraw } from "./setup.js";
import {
  commitSpecialPlay,
  onSpecialPlayOwnerTurnStart,
  resetSpecialPlayPrepareBefore,
  specialPlayOffers,
} from "./specialCardPlay.js";
import type { AuthoritativeGameState } from "./state.js";
import { EngineTransaction } from "./transaction.js";

let ruleset: LoadedRuleset;
beforeAll(async () => {
  ruleset = await loadFrozenRuleset(
    resolve(import.meta.dirname, "../../../rulesets/v1.3.4"),
  );
});

function relocate(s: AuthoritativeGameState, ref: string, to: string) {
  const card = s.cards[ref]!;
  s.zones[card.zoneRef]!.orderedCardRefs.splice(
    s.zones[card.zoneRef]!.orderedCardRefs.indexOf(ref),
    1,
  );
  s.zones[to]!.orderedCardRefs.push(ref);
  card.zoneRef = to;
  card.ownerSeat = s.zones[to]!.ownerSeat;
  card.controllerSeat = s.zones[to]!.ownerSeat;
}

function ready() {
  let s = createInitialSetup(ruleset, {
    gameId: "special-play",
    firstSeat: 1,
    seed: 307,
    usersBySeat: { 1: "u1", 2: "u2", 3: "u3", 4: "u4" },
    characterIdsBySeat: {
      1: "character.knight",
      2: "character.ranger",
      3: "character.assassin",
      4: "character.wizard",
    },
  });
  for (const seat of [1, 2, 3, 4] as const)
    s = resolveInitialRedraw(s, seat, false, ruleset).state;
  return s;
}

const cardColors = () =>
  new Map(
    (
      ruleset.documents.get("cards.json") as {
        items: Array<{ cardId: string; color: string }>;
      }
    ).items.map((card) => [card.cardId, card.color]),
  );

describe("specified-card special play conversions", () => {
  it("lets Ranger spend one orange hand card as Dodge and arms the next own turn", () => {
    const s = ready(),
      colors = cardColors(),
      orange = Object.values(s.cards).find(
        (card) => colors.get(card.templateId) === "orange",
      )!.cardRef;
    relocate(s, orange, "hand:2");
    const offer = specialPlayOffers(s, ruleset, 2, "dodge", "offer:test").find(
      (item) => item.kind === "rangerRoll",
    )!;
    const tx = new EngineTransaction(s);
    commitSpecialPlay(tx, ruleset, {
      seat: 2,
      family: "dodge",
      offerId: offer.offerId,
      prefix: "offer:test",
      sourceRef: "source:test",
    });
    expect(tx.draft.cards[offer.cardRefs[0]!]!.zoneRef).toBe("discardPile");
    expect(tx.draft.players[1]!.markers["ranger.rollPendingNextTurn"]).toBe(
      true,
    );
    onSpecialPlayOwnerTurnStart(tx, 2);
    expect(
      tx.draft.players[1]!.markers["ranger.rollPendingNextTurn"],
    ).toBeUndefined();
    expect(tx.draft.players[1]!.markers.guaranteedCriticalGrants).toEqual([
      expect.objectContaining({
        sourceRef: "skill.ranger.roll",
        appliesTo: "killAttack",
        consumePolicy: "retainUntilExpiry",
        expiryPoint: "owner.currentTurn.end",
      }),
    ]);
  });

  it("lets Assassin spend a same-color pair once and expires defense distance at prepare before", () => {
    const s = ready(),
      colors = cardColors(),
      byColor = new Map<string, string[]>();
    for (const card of Object.values(s.cards)) {
      const color = colors.get(card.templateId)!;
      byColor.set(color, [...(byColor.get(color) ?? []), card.cardRef]);
    }
    const pair = [...byColor.values()]
      .find((refs) => refs.length >= 2)!
      .slice(0, 2);
    pair.forEach((ref) => relocate(s, ref, "hand:3"));
    const offer = specialPlayOffers(s, ruleset, 3, "dodge", "offer:test").find(
      (item) => item.kind === "assassinCreedDodge",
    )!;
    const tx = new EngineTransaction(s);
    commitSpecialPlay(tx, ruleset, {
      seat: 3,
      family: "dodge",
      offerId: offer.offerId,
      prefix: "offer:test",
      sourceRef: "source:test",
    });
    const assassin = tx.draft.players[2]!;
    expect(offer.cardRefs.map((ref) => tx.draft.cards[ref]!.zoneRef)).toEqual([
      "discardPile",
      "discardPile",
    ]);
    expect(assassin.limits.defenseDistanceModifier).toBe(1);
    expect(
      specialPlayOffers(tx.draft, ruleset, 3, "dodge", "offer:again").some(
        (item) => item.kind === "assassinCreedDodge",
      ),
    ).toBe(false);
    resetSpecialPlayPrepareBefore(tx, 3);
    expect(assassin.limits.defenseDistanceModifier).toBe(0);
    expect(assassin.markers["assassin.creedDodgeUsed"]).toBeUndefined();
  });
});
