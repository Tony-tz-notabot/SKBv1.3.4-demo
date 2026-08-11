import type { LoadedRuleset } from "../ruleset/types.js";
import { drawCardsInTransaction } from "./deck.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent } from "./types.js";
import { moveCardInTransaction } from "./zoneMovement.js";
import { clearElectricMarkInTransaction } from "./electricMark.js";
import { applyTalentEquipContribution, resolveTalentContribution } from "./talentContributions.js";
const PREFIX = "talent.";
function player(s: AuthoritativeGameState, n: Seat) {
  return s.players.find((x) => x.seat === n)!;
}
export function hasTalentFamily(
  s: AuthoritativeGameState,
  n: Seat,
  id: string,
) {
  const p = player(s, n);
  return (
    p.initialTalentIds.includes(id) ||
    (s.zones[`talent:${n}`]?.orderedCardRefs ?? []).some(
      (ref) => s.cards[ref]?.templateId === id,
    )
  );
}
export function buildTalentEquipOffers(s: AuthoritativeGameState, seat: Seat) {
  const p = player(s, seat),
    w = s.pendingWindows.find(
      (x) => x.kind === "playPhaseAction" && x.prioritySeat === seat,
    );
  if (
    s.activeSeat !== seat ||
    s.phase !== "play" ||
    s.phaseBoundary !== "body" ||
    !w ||
    s.combat.attack ||
    p.lifeState !== "alive"
  )
    return [];
  const equipped = s.zones[`talent:${seat}`]?.orderedCardRefs ?? [];
  type SlotOffer = {
    offerId: string;
    cardRef: string;
    slot: number;
    replacedCardRef: string | null;
    duplicate: boolean;
  };
  const slotOffers = (
    ref: string,
    slot: number,
    replacedCardRef: string | null,
  ): SlotOffer => ({
    offerId: `offer:talent-equip:${ref}:slot:${slot}`,
    cardRef: ref,
    slot,
    replacedCardRef,
    duplicate: hasTalentFamily(s, seat, s.cards[ref]!.templateId),
  });
  return (s.zones[`hand:${seat}`]?.orderedCardRefs ?? [])
    .filter((ref) => s.cards[ref]!.templateId.startsWith(PREFIX))
    .flatMap((ref) => {
      const offers = equipped.map((occupantRef, slot) =>
        slotOffers(ref, slot, occupantRef),
      );
      if (equipped.length < 3)
        offers.push(slotOffers(ref, equipped.length, null));
      return offers;
    });
}
export function buildTalentDiscardOffers(s: AuthoritativeGameState, seat: Seat) {
  const canAct =
    s.activeSeat === seat &&
    s.phase === "play" &&
    s.phaseBoundary === "body" &&
    !s.combat.attack &&
    s.pendingWindows.some(
      (x) => x.kind === "playPhaseAction" && x.prioritySeat === seat,
    );
  return canAct
    ? (s.zones[`talent:${seat}`]?.orderedCardRefs ?? []).map((cardRef) => ({
        offerId: `offer:talent-discard:${cardRef}`,
        cardRef,
      }))
    : [];
}
export interface TalentEquipCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  cardRef: string;
}
type Result =
  | {
      accepted: true;
      commandId: string;
      previousRevision: number;
      stateRevision: number;
      events: DomainEvent[];
    }
  | {
      accepted: false;
      commandId: string;
      stateRevision: number;
      reasonCode: string;
      refreshRequired: boolean;
    };
export class TalentEquipSession {
  #state: AuthoritativeGameState;
  #results = new Map<string, Result>();
  constructor(
    s: AuthoritativeGameState,
    private r: LoadedRuleset,
  ) {
    this.#state = s;
  }
  get state() {
    return this.#state;
  }
  handle(c: TalentEquipCommand): Result {
    const old = this.#results.get(c.commandId);
    if (old) return structuredClone(old);
    const reject = (reasonCode: string, refreshRequired: boolean): Result => ({
      accepted: false,
      commandId: c.commandId,
      stateRevision: this.#state.stateRevision,
      reasonCode,
      refreshRequired,
    });
    if (c.gameId !== this.#state.gameId) return reject("GAME_NOT_FOUND", false);
    if (c.expectedStateRevision !== this.#state.stateRevision)
      return reject("STALE_REVISION", true);
    const p = this.#state.players.find((x) => x.userId === c.actorUserId),
      w = p
        ? this.#state.pendingWindows.find(
            (x) => x.promptId === c.promptId && x.prioritySeat === p.seat,
          )
        : undefined,
      o = p
        ? buildTalentEquipOffers(this.#state, p.seat).find(
            (x) => x.offerId === c.offerId && x.cardRef === c.cardRef,
          )
        : undefined;
    if (!p || !w) return reject("NOT_YOUR_PRIORITY", false);
    if (!o) return reject("OFFER_EXPIRED", true);
    const tx = new EngineTransaction(this.#state),
      id = tx.draft.cards[c.cardRef]!.templateId;
    if (o.duplicate) {
      moveCardInTransaction(tx, {
        cardRef: c.cardRef,
        toZoneRef: "discardPile",
        moveKind: "lose",
        faceUp: true,
      });
      drawCardsInTransaction(tx, p.seat, 1, "talent.duplicateCompensation");
      tx.emit("talent.equip.rejected", {
        seat: p.seat,
        cardRef: c.cardRef,
        talentId: id,
        reason: "duplicate",
        lost: true,
        draw: 1,
      });
    } else {
      if (o.replacedCardRef)
        moveCardInTransaction(tx, {
          cardRef: o.replacedCardRef,
          toZoneRef: "discardPile",
          moveKind: "replace",
          faceUp: true,
        });
      moveCardInTransaction(tx, {
        cardRef: c.cardRef,
        toZoneRef: `talent:${p.seat}`,
        moveKind: "equip",
        faceUp: true,
      });
      if (id === "talent.electric_shield")
        clearElectricMarkInTransaction(tx, p.seat);
      const talentZone = tx.draft.zones[`talent:${p.seat}`]!,
        fromIndex = talentZone.orderedCardRefs.indexOf(c.cardRef);
      if (fromIndex >= 0) talentZone.orderedCardRefs.splice(fromIndex, 1);
      talentZone.orderedCardRefs.splice(
        Math.min(o.slot, talentZone.orderedCardRefs.length),
        0,
        c.cardRef,
      );
      const draftPlayer = tx.draft.players.find((x) => x.seat === p.seat)!,
        contribution = resolveTalentContribution(this.r, id),
        equipmentEnabled =
          draftPlayer.markers.equipmentEffectsDisabled !== true &&
          !draftPlayer.statuses.some(
            (status) => status.statusId === "status.equipmentDisabled",
          );
      tx.draft.cards[c.cardRef]!.runtime.talentContribution = contribution;
      tx.draft.cards[c.cardRef]!.runtime.talentContributionActive =
        equipmentEnabled &&
        applyTalentEquipContribution(tx, p.seat, id, 1, contribution);
      tx.emit("talent.equipped", {
        seat: p.seat,
        cardRef: c.cardRef,
        talentId: id,
        slot: o.slot,
        replacedCardRef: o.replacedCardRef,
      });
    }
    const out = tx.commit();
    out.state.history.domainEvents.push(...out.events);
    validateAuthoritativeState(out.state);
    this.#state = out.state;
    const result = {
      accepted: true as const,
      commandId: c.commandId,
      previousRevision: out.previousRevision,
      stateRevision: out.state.stateRevision,
      events: out.events,
    };
    this.#results.set(c.commandId, result);
    return structuredClone(result);
  }
}

export class TalentDiscardSession {
  #state: AuthoritativeGameState;
  #results = new Map<string, Result>();
  constructor(s: AuthoritativeGameState) {
    this.#state = s;
  }
  get state() {
    return this.#state;
  }
  handle(c: TalentEquipCommand): Result {
    const old = this.#results.get(c.commandId);
    if (old) return structuredClone(old);
    const reject = (reasonCode: string, refreshRequired: boolean): Result => ({
      accepted: false,
      commandId: c.commandId,
      stateRevision: this.#state.stateRevision,
      reasonCode,
      refreshRequired,
    });
    if (c.gameId !== this.#state.gameId) return reject("GAME_NOT_FOUND", false);
    if (c.expectedStateRevision !== this.#state.stateRevision)
      return reject("STALE_REVISION", true);
    const p = this.#state.players.find((x) => x.userId === c.actorUserId),
      w = p
        ? this.#state.pendingWindows.find(
            (x) => x.promptId === c.promptId && x.prioritySeat === p.seat,
          )
        : undefined,
      offer = p
        ? buildTalentDiscardOffers(this.#state, p.seat).find(
            (x) => x.offerId === c.offerId && x.cardRef === c.cardRef,
          )
        : undefined;
    if (!p || !w) return reject("NOT_YOUR_PRIORITY", false);
    if (!offer) return reject("OFFER_EXPIRED", true);
    const tx = new EngineTransaction(this.#state);
    moveCardInTransaction(tx, {
      cardRef: c.cardRef,
      toZoneRef: "discardPile",
      moveKind: "discard",
      faceUp: true,
    });
    tx.emit("talent.discarded", {
      seat: p.seat,
      cardRef: c.cardRef,
      talentId: tx.draft.cards[c.cardRef]!.templateId,
    });
    const out = tx.commit();
    out.state.history.domainEvents.push(...out.events);
    validateAuthoritativeState(out.state);
    this.#state = out.state;
    const result: Result = {
      accepted: true,
      commandId: c.commandId,
      previousRevision: out.previousRevision,
      stateRevision: out.state.stateRevision,
      events: out.events,
    };
    this.#results.set(c.commandId, result);
    return structuredClone(result);
  }
}
