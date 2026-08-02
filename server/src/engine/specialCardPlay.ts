import type { LoadedRuleset } from "../ruleset/types.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import { moveCardInTransaction } from "./zoneMovement.js";
import type { JsonValue } from "./types.js";
import { handleMinerOffTurnActivePlay } from "./miner.js";
export type RequestedCardFamily = "kill" | "dodge";
export interface SpecialPlayOffer {
  offerId: string;
  kind: "physical" | "rangerRoll" | "assassinCreedDodge";
  cardRefs: string[];
  abilityId?: string;
}
const colorMap = (ruleset: LoadedRuleset) =>
  new Map(
    (
      ruleset.documents.get("cards.json") as {
        items: Array<{ cardId: string; color: string }>;
      }
    ).items.map((c) => [c.cardId, c.color]),
  );
export function specialPlayOffers(
  s: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  seat: Seat,
  family: RequestedCardFamily,
  prefix: string,
): SpecialPlayOffer[] {
  const hand = s.zones[`hand:${seat}`]!.orderedCardRefs,
    offers: SpecialPlayOffer[] = hand
      .filter((ref) => s.cards[ref]!.templateId.startsWith(`basic.${family}.`))
      .map((ref) => ({
        offerId: `${prefix}:play:${ref}`,
        kind: "physical",
        cardRefs: [ref],
      })),
    player = s.players.find((p) => p.seat === seat)!;
  if (family === "dodge" && player.markers.cannotDodgeUntilTurnEnd === true)
    return [];
  if (family !== "dodge") return offers;
  const colors = colorMap(ruleset);
  if (player.skillIds.includes("skill.ranger.roll"))
    for (const ref of hand)
      if (colors.get(s.cards[ref]!.templateId) === "orange")
        offers.push({
          offerId: `${prefix}:skill:ranger.roll:${ref}`,
          kind: "rangerRoll",
          abilityId: "skill.ranger.roll",
          cardRefs: [ref],
        });
  if (
    player.skillIds.includes("skill.assassin.creed_dodge") &&
    player.markers["assassin.creedDodgeUsed"] !== true
  ) {
    for (let i = 0; i < hand.length; i++)
      for (let j = i + 1; j < hand.length; j++) {
        const a = hand[i]!,
          b = hand[j]!,
          color = colors.get(s.cards[a]!.templateId);
        if (color && color === colors.get(s.cards[b]!.templateId))
          offers.push({
            offerId: `${prefix}:skill:assassin.creed_dodge:${a}:${b}`,
            kind: "assassinCreedDodge",
            abilityId: "skill.assassin.creed_dodge",
            cardRefs: [a, b],
          });
      }
  }
  return offers;
}
export function commitSpecialPlay(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  input: {
    seat: Seat;
    family: RequestedCardFamily;
    offerId: string;
    prefix: string;
    sourceRef: string;
    deadlineAt?: number;
  },
) {
  const current = specialPlayOffers(
      tx.draft,
      ruleset,
      input.seat,
      input.family,
      input.prefix,
    ),
    offer = current.find((x) => x.offerId === input.offerId);
  if (!offer) throw new Error("SPECIAL_PLAY_NO_LONGER_LEGAL");
  for (const ref of offer.cardRefs)
    moveCardInTransaction(tx, {
      cardRef: ref,
      toZoneRef: "discardPile",
      moveKind: "respond",
      faceUp: true,
    });
  const player = tx.draft.players.find((p) => p.seat === input.seat)!;
  if (offer.kind === "rangerRoll") {
    player.markers["ranger.rollPendingNextTurn"] = true;
    tx.emit("ability.activation.committed", {
      seat: input.seat,
      abilityId: "skill.ranger.roll",
      sourceRef: input.sourceRef,
      cardRefs: offer.cardRefs,
      treatedAs: "dodge",
    });
  } else if (offer.kind === "assassinCreedDodge") {
    player.markers["assassin.creedDodgeUsed"] = true;
    player.limits.defenseDistanceModifier =
      Number(player.limits.defenseDistanceModifier ?? 0) + 1;
    player.markers["assassin.creedDodgeDistanceContribution"] =
      Number(player.markers["assassin.creedDodgeDistanceContribution"] ?? 0) +
      1;
    tx.emit("ability.activation.committed", {
      seat: input.seat,
      abilityId: "skill.assassin.creed_dodge",
      sourceRef: input.sourceRef,
      cardRefs: offer.cardRefs,
      treatedAs: "dodge",
    });
  }
  for (const ref of offer.cardRefs)
    tx.emit("card.responded", {
      cardRef: ref,
      seat: input.seat,
      requestedFamily: input.family,
      sourceRef: input.sourceRef,
      conversionAbilityId: offer.abilityId ?? null,
    });
  handleMinerOffTurnActivePlay(tx, ruleset, {
    seat: input.seat,
    respondsToAttackOrDamage: true,
    sourceRef: input.sourceRef,
    ...(input.deadlineAt === undefined ? {} : { deadlineAt: input.deadlineAt }),
    reason: `specialPlay.${input.family}`,
  });
  return offer;
}
export function onSpecialPlayOwnerTurnStart(
  tx: EngineTransaction<AuthoritativeGameState>,
  seat: Seat,
) {
  const player = tx.draft.players.find((p) => p.seat === seat)!;
  if (player.markers["ranger.rollPendingNextTurn"] === true) {
    delete player.markers["ranger.rollPendingNextTurn"];
    const grants = Array.isArray(player.markers.guaranteedCriticalGrants)
      ? player.markers.guaranteedCriticalGrants
      : [];
    player.markers.guaranteedCriticalGrants = [
      ...grants,
      {
        grantId: `critical-grant:ranger-roll:${tx.draft.round}:${seat}`,
        sourceRef: "skill.ranger.roll",
        ownerSeat: seat,
        appliesTo: "killAttack",
        consumePolicy: "retainUntilExpiry",
        expiryPoint: "owner.currentTurn.end",
      },
    ] as JsonValue;
    tx.emit("critical.armed", {
      seat,
      sourceRef: "skill.ranger.roll",
      expiryPoint: "owner.currentTurn.end",
    });
  }
}
export function resetSpecialPlayPrepareBefore(
  tx: EngineTransaction<AuthoritativeGameState>,
  seat: Seat,
) {
  const player = tx.draft.players.find((p) => p.seat === seat)!;
  delete player.markers["assassin.creedDodgeUsed"];
  const contribution = Number(
    player.markers["assassin.creedDodgeDistanceContribution"] ?? 0,
  );
  if (contribution) {
    player.limits.defenseDistanceModifier =
      Number(player.limits.defenseDistanceModifier ?? 0) - contribution;
    delete player.markers["assassin.creedDodgeDistanceContribution"];
    tx.emit("distance.modified", {
      seat,
      kind: "defense",
      delta: -contribution,
      reason: "skill.assassin.creed_dodge.expiry",
    });
  }
}
