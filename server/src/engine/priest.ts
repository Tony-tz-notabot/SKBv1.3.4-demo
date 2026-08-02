import type { LoadedRuleset } from "../ruleset/types.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import { moveCardInTransaction } from "./zoneMovement.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import type { DomainEvent, TransactionCommit } from "./types.js";

type Ability = "skill.priest.pray" | "skill.priest.hope";
interface CardFact {
  cardId: string;
  color: string;
}
export interface PriestOffer {
  offerId: string;
  abilityId: Ability;
  legalCardRefs: string[];
  legalTargetRefs: string[];
  stateRevision: number;
}
const window = (s: AuthoritativeGameState, seat: Seat) =>
  s.pendingWindows.find(
    (w) => w.kind === "playPhaseAction" && w.prioritySeat === seat,
  );
const turnKey = (s: AuthoritativeGameState) =>
  `${s.round}:${s.activeSeat}:${[...s.history.domainEvents].reverse().find((e) => e.eventType === "turn.start")?.eventSeq ?? 0}`;
function cards(
  s: AuthoritativeGameState,
  r: LoadedRuleset,
  seat: Seat,
  color: string,
) {
  const facts = new Map(
    (r.documents.get("cards.json") as { items: CardFact[] }).items.map((x) => [
      x.cardId,
      x.color,
    ]),
  );
  return s.zones[`hand:${seat}`]!.orderedCardRefs.filter(
    (ref) => facts.get(s.cards[ref]!.templateId) === color,
  );
}
const targets = (s: AuthoritativeGameState) =>
  s.players
    .filter(
      (p) =>
        p.presence === "inPlay" &&
        p.lifeState !== "eliminated" &&
        p.hp !== null &&
        p.maxHp !== null,
    )
    .map((p) => `character:${p.seat}`);
export function buildPriestOffers(
  s: AuthoritativeGameState,
  r: LoadedRuleset,
  seat: Seat,
): PriestOffer[] {
  const p = s.players.find((x) => x.seat === seat),
    w = window(s, seat);
  if (
    p?.characterId !== "character.priest" ||
    p.lifeState !== "alive" ||
    p.presence !== "inPlay" ||
    s.activeSeat !== seat ||
    s.phase !== "play" ||
    s.phaseBoundary !== "body" ||
    !w ||
    s.combat.attack
  )
    return [];
  const out: PriestOffer[] = [];
  if (
    p.skillIds.includes("skill.priest.pray") &&
    p.markers["priest.prayUsed"] !== true
  ) {
    const refs = cards(s, r, seat, "red");
    if (refs.length)
      out.push({
        offerId: "offer:skill.priest.pray",
        abilityId: "skill.priest.pray",
        legalCardRefs: refs,
        legalTargetRefs: targets(s),
        stateRevision: s.stateRevision,
      });
  }
  if (
    p.skillIds.includes("skill.priest.hope") &&
    p.markers["priest.hopeUsedTurn"] !== turnKey(s)
  ) {
    const refs = cards(s, r, seat, "white");
    if (refs.length)
      out.push({
        offerId: "offer:skill.priest.hope",
        abilityId: "skill.priest.hope",
        legalCardRefs: refs,
        legalTargetRefs: targets(s),
        stateRevision: s.stateRevision,
      });
  }
  return out;
}
export function resetPriestAtPrepare(
  tx: EngineTransaction<AuthoritativeGameState>,
  seat: Seat,
) {
  delete tx.draft.players.find((p) => p.seat === seat)!.markers[
    "priest.prayUsed"
  ];
}
export interface PriestCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  cardRef: string;
  targetRef: string;
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
export class PriestSession {
  #state: AuthoritativeGameState;
  #results = new Map<string, Result>();
  constructor(
    state: AuthoritativeGameState,
    private ruleset: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(c: PriestCommand): Result {
    const prior = this.#results.get(c.commandId);
    if (prior) return structuredClone(prior);
    const reject = (reasonCode: string, refreshRequired: boolean): Result => {
      const x = {
        accepted: false as const,
        commandId: c.commandId,
        stateRevision: this.#state.stateRevision,
        reasonCode,
        refreshRequired,
      };
      this.#results.set(c.commandId, x);
      return structuredClone(x);
    };
    if (c.gameId !== this.#state.gameId) return reject("GAME_NOT_FOUND", false);
    if (c.expectedStateRevision !== this.#state.stateRevision)
      return reject("STALE_REVISION", true);
    const actor = this.#state.players.find((p) => p.userId === c.actorUserId),
      w = actor ? window(this.#state, actor.seat) : undefined;
    if (!actor || !w) return reject("NOT_YOUR_PRIORITY", false);
    if (w.promptId !== c.promptId) return reject("PROMPT_CLOSED", true);
    const offer = buildPriestOffers(this.#state, this.ruleset, actor.seat).find(
      (o) => o.offerId === c.offerId,
    );
    if (!offer) return reject("OFFER_EXPIRED", true);
    if (!offer.legalCardRefs.includes(c.cardRef))
      return reject("COST_CARD_NO_LONGER_LEGAL", true);
    if (!offer.legalTargetRefs.includes(c.targetRef))
      return reject("TARGET_NO_LONGER_LEGAL", true);
    const tx = new EngineTransaction(this.#state),
      p = tx.draft.players.find((x) => x.seat === actor.seat)!,
      target = tx.draft.players.find(
        (x) => `character:${x.seat}` === c.targetRef,
      )!;
    moveCardInTransaction(tx, {
      cardRef: c.cardRef,
      toZoneRef: "discardPile",
      moveKind: "discard",
      faceUp: true,
    });
    const before = target.hp!,
      amount = offer.abilityId === "skill.priest.pray" ? 2 : 1;
    target.hp = Math.min(target.maxHp!, before + amount);
    if (offer.abilityId === "skill.priest.pray")
      p.markers["priest.prayUsed"] = true;
    else p.markers["priest.hopeUsedTurn"] = turnKey(tx.draft);
    tx.emit("ability.activation.committed", {
      seat: actor.seat,
      abilityId: offer.abilityId,
      cardRef: c.cardRef,
      targetRef: c.targetRef,
      mode: "active",
    });
    tx.emit("health.recovered", {
      seat: target.seat,
      sourceSeat: actor.seat,
      sourceRef: offer.abilityId,
      amount: target.hp - before,
      hp: target.hp,
    });
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    this.#state = committed.state;
    const result = {
      accepted: true as const,
      commandId: c.commandId,
      previousRevision: committed.previousRevision,
      stateRevision: committed.state.stateRevision,
      events: committed.events,
    };
    this.#results.set(c.commandId, result);
    return structuredClone(result);
  }
}
