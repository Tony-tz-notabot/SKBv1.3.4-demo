import type { LoadedRuleset } from "../ruleset/types.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import { moveCardInTransaction } from "./zoneMovement.js";
import { drawCardsInTransaction } from "./deck.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import type { DomainEvent } from "./types.js";
import { beginJudgment, type BeginJudgmentInput } from "./judgment.js";
import { openPreJudgmentWindow } from "./preJudgment.js";

const CHARACTER = "character.interdimensional_traveler";
const SKILL = "skill.interdimensional_traveler.deadly_curse";
const playWindow = (s: AuthoritativeGameState, seat: Seat) =>
  s.pendingWindows.find((w) => w.kind === "playPhaseAction" && w.prioritySeat === seat);

function ownedCards(s: AuthoritativeGameState, seat: Seat) {
  return Object.values(s.zones)
    .filter((z) => z.ownerSeat === seat)
    .flatMap((z) => z.orderedCardRefs);
}

function discardableCards(s: AuthoritativeGameState, seat: Seat) {
  return ownedCards(s, seat).filter((ref) => {
    const card = s.cards[ref]!, zone = s.zones[card.zoneRef]!;
    return zone.zoneType !== "bossSlot" || card.templateId === "boss.iron_pirate_king";
  });
}

export interface DeadlyCurseOffer {
  offerId: "offer:skill.interdimensional_traveler.deadly_curse";
  abilityId: typeof SKILL;
  legalTargetRefs: string[];
  ownedCardCount: number;
  discardableCardRefs: string[];
  stateRevision: number;
}

export function buildDeadlyCurseOffers(s: AuthoritativeGameState, r: LoadedRuleset, seat: Seat): DeadlyCurseOffer[] {
  const p = s.players.find((x) => x.seat === seat), w = playWindow(s, seat), cards = ownedCards(s, seat);
  if (!p || p.characterId !== CHARACTER || !p.skillIds.includes(SKILL) || p.lifeState !== "alive" ||
      p.presence !== "inPlay" || p.markers["traveler.deadlyCurseUsed"] === true ||
      s.activeSeat !== seat || s.phase !== "play" || s.phaseBoundary !== "body" || !w || s.combat.attack ||
      Number(p.limits[r.settings.combat.attackCountLimitId] ?? 0) <= 0 ||
      cards.length < r.settings.character.traveler.deadlyCurse.minimumOwnedCardCount) return [];
  const legalTargetRefs = s.players.filter((x) => x.presence === "inPlay" && x.lifeState !== "eliminated").map((x) => `character:${x.seat}`);
  if (!legalTargetRefs.length) return [];
  return [{ offerId: "offer:skill.interdimensional_traveler.deadly_curse", abilityId: SKILL,
    legalTargetRefs, ownedCardCount: cards.length, discardableCardRefs: discardableCards(s, seat), stateRevision: s.stateRevision }];
}

export function isTravelerOffField(p: AuthoritativeGameState["players"][number]) {
  return p.characterId === CHARACTER && p.presence === "leftPlay" && p.markers["traveler.deadlyCurseUsed"] === true;
}

export function parallelTraversalController(s: AuthoritativeGameState, sourceSeat: Seat | null, targetSeat: Seat): Seat | null {
  const eligible = (seat: Seat | null) => {
    if (!seat) return false;
    const p=s.players.find((x)=>x.seat===seat)!;
    return p.characterId===CHARACTER && p.presence==="inPlay" && p.lifeState!=="eliminated" &&
      p.initialTalentIds.includes("talent.parallel_traversal") && p.markers.parallelTraversalDisabled!==true;
  };
  return eligible(sourceSeat) ? sourceSeat : eligible(targetSeat) ? targetSeat : null;
}

export function beginParallelTraversalJudgment(s: AuthoritativeGameState, r: LoadedRuleset, input: {
  controllerSeat: Seat; occurrenceKey: string; attackId?: string; scheduledId?: string; targetRef: string; deadlineAt: number;
}) {
  const judgment: BeginJudgmentInput={ controllerSeat:input.controllerSeat, sourceRef:`character:${input.controllerSeat}`,
    purpose:"talent.parallel_traversal.damagePrevention", matchColors:["green","blue"], context:{
      parallelTraversalDamage:true, occurrenceKey:input.occurrenceKey, targetRef:input.targetRef,
      ...(input.attackId?{attackId:input.attackId,resumeAttackStatus:"targetHit"}:{}),
      ...(input.scheduledId?{scheduledId:input.scheduledId}:{}),
    }};
  return openPreJudgmentWindow(s,r,judgment,input.deadlineAt) ?? beginJudgment(s,r,judgment,input.deadlineAt);
}

export function recordTravelerOffFieldTurnStart(tx: EngineTransaction<AuthoritativeGameState>, r: LoadedRuleset, seat: Seat) {
  const p = tx.draft.players.find((x) => x.seat === seat)!;
  if (!isTravelerOffField(p)) return false;
  const count = Number(p.markers["traveler.offFieldOwnTurnCount"] ?? 0) + 1;
  p.markers["traveler.offFieldOwnTurnCount"] = count;
  tx.emit("counter.changed", { seat, counterId: "traveler.offFieldOwnTurnCount", value: count, reason: SKILL });
  if (count >= r.settings.character.traveler.deadlyCurse.offFieldOwnTurnsUntilReturn)
    p.markers["traveler.deadlyCurseReturnAtEnd"] = true;
  return p.markers["traveler.deadlyCurseReturnAtEnd"] === true;
}

export function resolveDeadlyCurseReturnAtEnd(tx: EngineTransaction<AuthoritativeGameState>, r: LoadedRuleset, seat: Seat) {
  const p = tx.draft.players.find((x) => x.seat === seat)!;
  if (!isTravelerOffField(p) || p.markers["traveler.deadlyCurseReturnAtEnd"] !== true) return false;
  const cfg = r.settings.character.traveler.deadlyCurse,
    targetRef = typeof p.markers["traveler.deadlyCurseTargetRef"] === "string" ? p.markers["traveler.deadlyCurseTargetRef"] : "",
    target = tx.draft.players.find((x) => `character:${x.seat}` === targetRef);
  tx.emit("ability.effect.started", { seat, abilityId: SKILL, effect: "returnAndExecute", targetRef });
  if (target?.presence === "inPlay" && target.lifeState !== "eliminated") {
    const before = { hp: target.hp, shield: target.shield, healthFloor: target.markers.healthFloor ?? null };
    target.shield = cfg.executionTargetShield;
    target.hp = cfg.executionTargetHp;
    target.markers.healthFloor = cfg.executionTargetHealthFloor;
    tx.emit("values.modified", { seat: target.seat, sourceSeat: seat, sourceRef: SKILL, before, after: { hp: target.hp, shield: target.shield, healthFloor: target.markers.healthFloor } });
  } else tx.emit("ability.effect.skipped", { seat, abilityId: SKILL, effect: "executeMarkedTarget", targetRef, reason: "targetNotInPlay" });
  p.presence = "inPlay";
  p.hp = cfg.returnHp;
  p.shield = cfg.returnShield;
  delete p.markers["traveler.deadlyCurseReturnAtEnd"];
  delete p.markers["traveler.offFieldOwnTurnCount"];
  delete p.markers["traveler.deadlyCurseTargetRef"];
  tx.emit("character.presence.changed", { seat, from: "leftPlay", to: "inPlay", reason: SKILL });
  tx.emit("values.modified", { seat, sourceSeat: seat, sourceRef: SKILL, after: { hp: p.hp, shield: p.shield } });
  drawCardsInTransaction(tx, seat, cfg.returnDrawCount, "skill.deadlyCurse.return");
  return true;
}

export interface DeadlyCurseCommand { commandId: string; gameId: string; expectedStateRevision: number; actorUserId: string; promptId: string; offerId: string; targetRef: string }
type Result = { accepted: true; commandId: string; previousRevision: number; stateRevision: number; events: DomainEvent[] } |
  { accepted: false; commandId: string; stateRevision: number; reasonCode: string; refreshRequired: boolean };
export class DeadlyCurseSession {
  #state: AuthoritativeGameState; #results = new Map<string, Result>();
  constructor(state: AuthoritativeGameState, private r: LoadedRuleset) { this.#state = state; }
  get state() { return this.#state; }
  handle(c: DeadlyCurseCommand): Result {
    const prior = this.#results.get(c.commandId); if (prior) return structuredClone(prior);
    const reject = (reasonCode: string, refreshRequired: boolean): Result => { const x = { accepted: false as const, commandId: c.commandId, stateRevision: this.#state.stateRevision, reasonCode, refreshRequired }; this.#results.set(c.commandId, x); return structuredClone(x); };
    if (c.gameId !== this.#state.gameId) return reject("GAME_NOT_FOUND", false);
    if (c.expectedStateRevision !== this.#state.stateRevision) return reject("STALE_REVISION", true);
    const actor = this.#state.players.find((p) => p.userId === c.actorUserId), w = actor ? playWindow(this.#state, actor.seat) : undefined;
    if (!actor || !w) return reject("NOT_YOUR_PRIORITY", false);
    if (w.promptId !== c.promptId) return reject("PROMPT_CLOSED", true);
    const offer = buildDeadlyCurseOffers(this.#state, this.r, actor.seat).find((x) => x.offerId === c.offerId);
    if (!offer) return reject("OFFER_EXPIRED", true);
    if (!offer.legalTargetRefs.includes(c.targetRef)) return reject("TARGET_NO_LONGER_LEGAL", true);
    const tx = new EngineTransaction(this.#state), p = tx.draft.players.find((x) => x.seat === actor.seat)!;
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter((x) => x.promptId !== w.promptId);
    for (const ref of discardableCards(tx.draft, actor.seat)) moveCardInTransaction(tx, { cardRef: ref, toZoneRef: "discardPile", moveKind: "discard", faceUp: true });
    p.markers["traveler.deadlyCurseUsed"] = true;
    p.markers["traveler.deadlyCurseTargetRef"] = c.targetRef;
    p.markers["traveler.offFieldOwnTurnCount"] = 0;
    p.markers.parallelTraversalDisabled = true;
    p.presence = "leftPlay";
    tx.draft.phaseBodyResolved = true;
    tx.emit("ability.activation.committed", { seat: actor.seat, abilityId: SKILL, targetRef: c.targetRef, discardedCardRefs: offer.discardableCardRefs });
    tx.emit("character.presence.changed", { seat: actor.seat, from: "inPlay", to: "leftPlay", reason: SKILL });
    const committed = tx.commit(); committed.state.history.domainEvents.push(...committed.events); validateAuthoritativeState(committed.state); this.#state = committed.state;
    const result = { accepted: true as const, commandId: c.commandId, previousRevision: committed.previousRevision, stateRevision: committed.state.stateRevision, events: committed.events }; this.#results.set(c.commandId, result); return structuredClone(result);
  }
}
