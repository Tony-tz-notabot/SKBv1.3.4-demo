import type { AuthoritativeGameState, Seat } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import { moveCardInTransaction } from "./zoneMovement.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import type { DomainEvent, TransactionCommit } from "./types.js";
type A = Record<string, any>;
export function openWrenchChoiceAfterHit(
  commit: TransactionCommit<AuthoritativeGameState>,
  deadlineAt: number,
) {
  const a = commit.state.combat.attack as A | null;
  if (
    !a ||
    a.weaponId !== "weapon.w61" ||
    a.status !== "targetHit" ||
    a.wrenchChoiceOpened
  )
    return commit;
  const tx = new EngineTransaction(commit.state),
    attack = tx.draft.combat.attack as A;
  attack.wrenchChoiceOpened = true;
  attack.status = "awaitingWrenchChoice";
  const seat = Number(attack.attackerSeat) as Seat,
    promptId = `prompt:w61:${attack.attackId}:${tx.draft.stateRevision + 1}`;
  tx.draft.pendingWindows.push({
    promptId,
    kind: "weaponW61Choice",
    prioritySeat: seat,
    mandatory: false,
    deadlineAt,
    timeoutPolicy: "useDefault",
    legalOfferIds: ["offer:w61:damage", "offer:w61:dismantle"],
    context: { weaponRef: attack.weaponRef },
  });
  tx.emit("choice.requested", {
    promptId,
    kind: "weaponW61Choice",
    seat,
    options: ["dealDamage", "replaceWithDismantle"],
  });
  const out = tx.commit();
  out.state.history.domainEvents.push(...out.events);
  return { ...out, events: [...commit.events, ...out.events] };
}
export function openWrenchChoiceFromState(state:AuthoritativeGameState,deadlineAt:number){const attack=state.combat.attack as A|null;if(!attack||attack.weaponId!=="weapon.w61"||attack.status!=="targetHit"||attack.wrenchChoiceOpened)return null;return openWrenchChoiceAfterHit({state,events:[{eventSeq:0,stateRevision:state.stateRevision,eventType:"attack.hit",payload:{}}],previousRevision:state.stateRevision} as TransactionCommit<AuthoritativeGameState>,deadlineAt);}
type C = {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
};
type R =
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
export class WrenchChoiceSession {
  #state: AuthoritativeGameState;
  constructor(s: AuthoritativeGameState) {
    this.#state = s;
  }
  get state() {
    return this.#state;
  }
  handle(c: C): R {
    const bad = (reasonCode: string): R => ({
      accepted: false,
      commandId: c.commandId,
      stateRevision: this.#state.stateRevision,
      reasonCode,
      refreshRequired: true,
    });
    if (
      c.gameId !== this.#state.gameId ||
      c.expectedStateRevision !== this.#state.stateRevision
    )
      return bad("STALE_REVISION");
    const w = this.#state.pendingWindows.find(
        (x) => x.promptId === c.promptId && x.kind === "weaponW61Choice",
      ),
      actor = this.#state.players.find((x) => x.userId === c.actorUserId);
    if (
      !w ||
      !actor ||
      w.prioritySeat !== actor.seat ||
      !w.legalOfferIds.includes(c.offerId)
    )
      return bad("OFFER_EXPIRED");
    const tx = new EngineTransaction(this.#state),
      a = tx.draft.combat.attack as A;
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (x) => x.promptId !== w.promptId,
    );
    if (c.offerId === "offer:w61:dismantle") {
      a.damageSegments = [];
      const ref = String(a.weaponRef),
        card = tx.draft.cards[ref],
        before = Number(card?.runtime.durabilityCurrent ?? 0),
        after = Math.max(0, before - 1);
      if (card) card.runtime.durabilityCurrent = after;
      tx.emit("weapon.durability.changed", { weaponRef: ref, before, after });
      if (card && after === 0)
        moveCardInTransaction(tx, {
          cardRef: ref,
          toZoneRef:
            card.runtime.generated === true ? "outsideDeck" : "discardPile",
          moveKind: "lose",
          faceUp: true,
        });
      tx.emit("weapon.w61.damage.replaced", {
        attackId: a.attackId,
        targetRef: tx.draft.combat.currentTargetRef,
      });
    }
    a.status = "targetHit";
    const out = tx.commit();
    out.state.history.domainEvents.push(...out.events);
    validateAuthoritativeState(out.state);
    this.#state = out.state;
    return {
      accepted: true,
      commandId: c.commandId,
      previousRevision: out.previousRevision,
      stateRevision: out.state.stateRevision,
      events: out.events,
    };
  }
  handleTimeout(commandId: string) {
    const w = this.#state.pendingWindows.find(
      (x) => x.kind === "weaponW61Choice",
    )!;
    return this.handle({
      commandId,
      gameId: this.#state.gameId,
      expectedStateRevision: this.#state.stateRevision,
      actorUserId: this.#state.players.find((x) => x.seat === w.prioritySeat)!
        .userId,
      promptId: w.promptId,
      offerId: "offer:w61:damage",
    });
  }
}
