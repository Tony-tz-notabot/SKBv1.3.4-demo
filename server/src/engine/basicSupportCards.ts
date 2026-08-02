import type { LoadedRuleset } from "../ruleset/types.js";
import { grantGuaranteedCriticalInTransaction } from "./guaranteedCritical.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import { moveCardInTransaction } from "./zoneMovement.js";
const strong = (s: AuthoritativeGameState, n: Seat) => {
  const p = s.players.find((x) => x.seat === n)!;
  return (
    p.initialTalentIds.includes("talent.strong_potion") ||
    (p.markers.equipmentEffectsDisabled !== true &&
      !p.statuses.some((status) => status.statusId === "status.equipmentDisabled") &&
      (s.zones[`talent:${n}`]?.orderedCardRefs ?? []).some(
        (ref) => s.cards[ref]?.templateId === "talent.strong_potion",
      ))
  );
};
export function strongPotionBonus(r: LoadedRuleset): number {
  const doc=r.documents.get("nonboss-rules.json") as {effectFamilies:Array<{familyId:string;modifiers?:Array<{query?:string;operation?:{add?:number}}>} >},
    family=doc.effectFamilies.find(x=>x.familyId==="talent.strong_potion"),
    modifier=family?.modifiers?.find(x=>x.query==="recovery.amount");
  return Number(modifier?.operation?.add??0);
}
export function buildBasicSupportOffers(
  s: AuthoritativeGameState,
  r: LoadedRuleset,
  n: Seat,
) {
  const p = s.players.find((x) => x.seat === n),
    w = s.pendingWindows.find(
      (x) => x.kind === "playPhaseAction" && x.prioritySeat === n,
    );
  if (
    !p ||
    !w ||
    s.activeSeat !== n ||
    s.phase !== "play" ||
    s.phaseBoundary !== "body" ||
    s.combat.attack
  )
    return [];
  return (s.zones[`hand:${n}`]?.orderedCardRefs ?? []).flatMap((ref) => {
    const id = s.cards[ref]!.templateId;
    if (id.startsWith("basic.potion."))
      return [
        {
          offerId: `offer:basic-support:potion:${ref}`,
          cardRef: ref,
          mode: "heal" as const,
          amount: 2 + (strong(s, n) ? strongPotionBonus(r) : 0),
        },
      ];
    if (id.startsWith("basic.horn."))
      return [
        {
          offerId: `offer:basic-support:horn-heal:${ref}`,
          cardRef: ref,
          mode: "heal" as const,
          amount: 1 + (strong(s, n) ? strongPotionBonus(r) : 0),
        },
        {
          offerId: `offer:basic-support:horn-critical:${ref}`,
          cardRef: ref,
          mode: "critical" as const,
          amount: 0,
        },
      ];
    return [];
  });
}
export class BasicSupportCardSession {
  #state: AuthoritativeGameState;
  constructor(
    s: AuthoritativeGameState,
    private r: LoadedRuleset,
  ) {
    this.#state = s;
  }
  get state() {
    return this.#state;
  }
  handle(c: {
    commandId: string;
    gameId: string;
    expectedStateRevision: number;
    actorUserId: string;
    promptId: string;
    offerId: string;
    cardRef: string;
  }) {
    const p = this.#state.players.find((x) => x.userId === c.actorUserId),
      w = p
        ? this.#state.pendingWindows.find(
            (x) => x.promptId === c.promptId && x.prioritySeat === p.seat,
          )
        : undefined,
      o = p
        ? buildBasicSupportOffers(this.#state, this.r, p.seat).find(
            (x) => x.offerId === c.offerId && x.cardRef === c.cardRef,
          )
        : undefined;
    if (!p || !w || !o)
      return {
        accepted: false as const,
        commandId: c.commandId,
        stateRevision: this.#state.stateRevision,
        reasonCode: "OFFER_EXPIRED",
        refreshRequired: true,
      };
    const tx = new EngineTransaction(this.#state),
      d = tx.draft.players.find((x) => x.seat === p.seat)!;
    moveCardInTransaction(tx, {
      cardRef: c.cardRef,
      toZoneRef: "discardPile",
      moveKind: "use",
      faceUp: true,
    });
    if (o.mode === "heal" && d.hp !== null && d.maxHp !== null) {
      const before = d.hp;
      d.hp = Math.min(d.maxHp, d.hp + o.amount);
      tx.emit("hp.recovered", {
        seat: p.seat,
        amount: d.hp - before,
        requestedAmount: o.amount,
        sourceRef: c.cardRef,
      });
    } else
      grantGuaranteedCriticalInTransaction(tx, {
        ownerSeat: p.seat,
        sourceRef: c.cardRef,
        appliesTo: "weaponAttack",
        consumePolicy: "onFirstCommittedApplicableAttack",
        expiryPoint: "owner.currentTurn.end",
      });
    const out = tx.commit();
    out.state.history.domainEvents.push(...out.events);
    validateAuthoritativeState(out.state);
    this.#state = out.state;
    return {
      accepted: true as const,
      commandId: c.commandId,
      previousRevision: out.previousRevision,
      stateRevision: out.state.stateRevision,
      events: out.events,
    };
  }
}
