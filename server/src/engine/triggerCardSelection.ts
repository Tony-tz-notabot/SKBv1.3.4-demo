import type { LoadedRuleset } from "../ruleset/types.js";
import { shuffleWithSource } from "./random.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import {
  matchTriggeredEffects,
  type MatchedTriggerCandidate,
  type TriggerEventFact,
} from "./triggerRegistry.js";
import type { DomainEvent, JsonValue } from "./types.js";
import { moveCardInTransaction, type MoveKind } from "./zoneMovement.js";

type JsonRecord = Record<string, JsonValue>;
const activeEquipmentZones = new Set([
  "weaponSlot",
  "thirdWeaponSlot",
  "armorSlot",
  "mountOffenseSlot",
  "mountDefenseSlot",
  "talentZone",
  "bossSlot",
]);
const record = (value: JsonValue | undefined): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
const selectionEffect = (
  candidate: MatchedTriggerCandidate,
): JsonRecord | null => {
  for (const raw of candidate.effects) {
    const effect = record(raw);
    if (effect.op === "selectCards") return effect;
  }
  return null;
};
const damageSourceSeat = (
  state: AuthoritativeGameState,
  event: TriggerEventFact,
): Seat | null => {
  for (const key of ["sourceSeat", "attackerSeat"])
    if (typeof event.payload[key] === "number")
      return event.payload[key] as Seat;
  const attack = state.combat.attack;
  return attack &&
    typeof attack === "object" &&
    !Array.isArray(attack) &&
    typeof attack.attackerSeat === "number"
    ? (attack.attackerSeat as Seat)
    : null;
};

export function legalTriggerCardSelections(
  state: AuthoritativeGameState,
  candidate: MatchedTriggerCandidate,
  event: TriggerEventFact,
): string[] {
  const effect = selectionEffect(candidate);
  if (!effect) return [];
  const params = record(effect.params),
    selector = record(params.selector);
  if (selector.zone === "weaponSlot" && selector.category === "weapon")
    return Object.values(state.zones)
      .filter(
        (zone) =>
          zone.ownerSeat === candidate.controllerSeat &&
          zone.zoneType === "weaponSlot",
      )
      .flatMap((zone) => zone.orderedCardRefs)
      .filter((cardRef) =>
        state.cards[cardRef]?.templateId.startsWith("weapon."),
      );
  if (selector.owner === "$damage.source" && selector.dismantlable === true) {
    const ownerSeat = damageSourceSeat(state, event);
    if (ownerSeat === null) return [];
    return Object.values(state.zones)
      .filter(
        (zone) =>
          zone.ownerSeat === ownerSeat &&
          activeEquipmentZones.has(zone.zoneType),
      )
      .flatMap((zone) => zone.orderedCardRefs);
  }
  return [];
}

export function triggerUsesSupportedCardSelection(
  candidate: MatchedTriggerCandidate,
): boolean {
  const effect = selectionEffect(candidate);
  if (!effect || candidate.costs.length > 0) return false;
  const opAfterSelection = candidate.effects
    .map(record)
    .find((item) => item.op === "discardCard" || item.op === "dismantleCard");
  return Boolean(opAfterSelection);
}

export function openTriggerCardSelectionWindow(
  state: AuthoritativeGameState,
  candidate: MatchedTriggerCandidate,
  event: TriggerEventFact,
  deadlineAt: number,
) {
  if (state.pendingWindows.length) throw new Error("TRIGGER_WINDOW_CONFLICT");
  if (!triggerUsesSupportedCardSelection(candidate))
    throw new Error("TRIGGER_CARD_SELECTION_UNSUPPORTED");
  const current = matchTriggeredEffects(state, [candidate], event).find(
    (item) =>
      item.triggerId === candidate.triggerId &&
      item.sourceRef === candidate.sourceRef,
  );
  if (!current) throw new Error("TRIGGER_NO_LONGER_MATCHES");
  const effect = selectionEffect(candidate)!,
    params = record(effect.params),
    minimum = Number(params.min ?? (candidate.optional ? 0 : 1)),
    legalCardRefs = legalTriggerCardSelections(state, candidate, event);
  if (minimum > 0 && legalCardRefs.length < minimum)
    throw new Error("TRIGGER_CARD_SELECTION_HAS_NO_LEGAL_CARD");
  const canPass = candidate.optional || minimum === 0,
    promptId = `prompt:trigger-card:${candidate.triggerId}:${candidate.sourceRef}:${state.stateRevision + 1}`,
    legalOfferIds = [
      ...(canPass ? ["offer:trigger-card:pass"] : []),
      ...legalCardRefs.map((_, index) => `offer:trigger-card:${index}`),
    ],
    tx = new EngineTransaction(state);
  tx.draft.pendingWindows.push({
    promptId,
    kind: "triggerCardSelection",
    prioritySeat: candidate.controllerSeat,
    mandatory: !canPass,
    deadlineAt,
    timeoutPolicy: canPass ? "pass" : "randomLegal",
    legalOfferIds,
    context: {
      candidate: candidate as unknown as JsonValue,
      event: event as unknown as JsonValue,
      legalCardRefs,
      minimum,
      maximum: Number(params.max ?? 1),
    },
  });
  tx.emit("choice.requested", {
    kind: "triggerCardSelection",
    promptId,
    seat: candidate.controllerSeat,
    triggerId: candidate.triggerId,
    legalCardRefs,
    minimum,
    maximum: Number(params.max ?? 1),
  });
  const committed = tx.commit();
  committed.state.history.domainEvents.push(...committed.events);
  validateAuthoritativeState(committed.state);
  return committed;
}

export interface TriggerCardSelectionCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
}
export type TriggerCardSelectionResult =
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

export class TriggerCardSelectionSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, TriggerCardSelectionResult>();
  constructor(
    state: AuthoritativeGameState,
    private readonly ruleset: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(command: TriggerCardSelectionCommand): TriggerCardSelectionResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (
      reasonCode: string,
      refreshRequired: boolean,
    ): TriggerCardSelectionResult => {
      const result = {
        accepted: false as const,
        commandId: command.commandId,
        stateRevision: this.#state.stateRevision,
        reasonCode,
        refreshRequired,
      };
      this.#results.set(command.commandId, result);
      return structuredClone(result);
    };
    if (command.gameId !== this.#state.gameId)
      return reject("GAME_NOT_FOUND", false);
    if (command.expectedStateRevision !== this.#state.stateRevision)
      return reject("STALE_REVISION", true);
    const window = this.#state.pendingWindows.find(
      (item) => item.kind === "triggerCardSelection",
    );
    if (!window || window.promptId !== command.promptId)
      return reject("PROMPT_CLOSED", true);
    const actor = this.#state.players.find(
      (player) => player.userId === command.actorUserId,
    );
    if (!actor || actor.seat !== window.prioritySeat)
      return reject("NOT_YOUR_PRIORITY", false);
    const offerIndex = window.legalOfferIds.indexOf(command.offerId);
    if (offerIndex < 0) return reject("OFFER_EXPIRED", true);
    const candidate = window.context
        ?.candidate as unknown as MatchedTriggerCandidate,
      event = window.context?.event as unknown as TriggerEventFact,
      eventKey = event.payload.__triggerEventKey,
      pass = command.offerId === "offer:trigger-card:pass";
    const current = matchTriggeredEffects(this.#state, [candidate], event).find(
      (item) =>
        item.triggerId === candidate.triggerId &&
        item.sourceRef === candidate.sourceRef,
    );
    if (!current) return reject("TRIGGER_NO_LONGER_MATCHES", true);
    const legalCardRefs = legalTriggerCardSelections(
        this.#state,
        candidate,
        event,
      ),
      selectedCardRef = pass
        ? null
        : legalCardRefs[
            window.legalOfferIds
              .filter((offerId) => offerId !== "offer:trigger-card:pass")
              .indexOf(command.offerId)
          ];
    if (!pass && !selectedCardRef) return reject("OFFER_EXPIRED", true);
    const tx = new EngineTransaction(this.#state);
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (item) => item.promptId !== window.promptId,
    );
    if (pass) {
      tx.emit("trigger.passed", {
        triggerId: candidate.triggerId,
        sourceRef: candidate.sourceRef,
        controllerSeat: candidate.controllerSeat,
        eventKey: typeof eventKey === "string" ? eventKey : null,
      });
    } else {
      const selected = selectedCardRef!,
        followup = candidate.effects
          .map(record)
          .find(
            (item) => item.op === "discardCard" || item.op === "dismantleCard",
          )!,
        moveKind: MoveKind =
          followup.op === "dismantleCard" ? "dismantle" : "discard";
      tx.emit("trigger.execution.before", {
        triggerId: candidate.triggerId,
        sourceRef: candidate.sourceRef,
        controllerSeat: candidate.controllerSeat,
        eventType: event.eventType,
        eventKey: typeof eventKey === "string" ? eventKey : null,
      });
      moveCardInTransaction(tx, {
        cardRef: selected,
        toZoneRef: "discardPile",
        moveKind,
      });
      tx.emit(moveKind === "dismantle" ? "card.dismantled" : "card.discarded", {
        cardRef: selected,
        reason: `trigger:${candidate.triggerId}`,
      });
      tx.emit("trigger.resolved", {
        triggerId: candidate.triggerId,
        sourceRef: candidate.sourceRef,
        controllerSeat: candidate.controllerSeat,
        eventType: event.eventType,
        eventKey: typeof eventKey === "string" ? eventKey : null,
      });
    }
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    this.#state = committed.state;
    const result = {
      accepted: true as const,
      commandId: command.commandId,
      previousRevision: committed.previousRevision,
      stateRevision: committed.state.stateRevision,
      events: committed.events,
    };
    this.#results.set(command.commandId, result);
    return structuredClone(result);
  }
  handleTimeout(commandId: string): TriggerCardSelectionResult {
    const window = this.#state.pendingWindows.find(
      (item) => item.kind === "triggerCardSelection",
    );
    if (!window)
      return {
        accepted: false,
        commandId,
        stateRevision: this.#state.stateRevision,
        reasonCode: "PROMPT_CLOSED",
        refreshRequired: true,
      };
    let offerId = window.legalOfferIds.find((item) => item.endsWith(":pass"));
    if (!offerId) {
      const candidates = [...window.legalOfferIds],
        randomSeq = this.#state.randomSource.nextRandomSeq,
        shuffled = shuffleWithSource(candidates, this.#state.randomSource);
      this.#state.randomSource = shuffled.source;
      offerId = shuffled.value[0]!;
      this.#state.randomHistory.push({
        randomSeq,
        purpose: "timeout.triggerCardSelection",
        candidateRefs: candidates,
        resultRefs: [offerId],
      });
    }
    return this.handle({
      commandId,
      gameId: this.#state.gameId,
      expectedStateRevision: this.#state.stateRevision,
      actorUserId: this.#state.players.find(
        (player) => player.seat === window.prioritySeat,
      )!.userId,
      promptId: window.promptId,
      offerId,
    });
  }
}
