import type { LoadedRuleset } from "../ruleset/types.js";
import type { AuthoritativeGameState } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import { executeMatchedTrigger } from "./triggerEffects.js";
import {
  matchTriggeredEffects,
  type MatchedTriggerCandidate,
  type TriggerEventFact,
} from "./triggerRegistry.js";
import type { DomainEvent, JsonValue } from "./types.js";
import { shuffleWithSource } from "./random.js";

const supportedOps = new Set([
  "recoverHp",
  "recoverShield",
  "drawCards",
  "createDamage",
  "applyStatus",
  "addMarker",
  "modifyMarker",
  "consumeLimit",
  "scheduleEffect",
  "sequence",
]);
function effectNeedsSelection(value: JsonValue): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return true;
  const op = typeof value.op === "string" ? value.op : "";
  if (!supportedOps.has(op)) return true;
  const children = Array.isArray(value.effects)
    ? value.effects
    : value.params &&
        typeof value.params === "object" &&
        !Array.isArray(value.params) &&
        Array.isArray(value.params.effects)
      ? value.params.effects
      : [];
  return children.some(effectNeedsSelection);
}
export function triggerCanResolveWithoutSelections(
  candidate: MatchedTriggerCandidate,
): boolean {
  return (
    candidate.costs.length === 0 &&
    !candidate.effects.some(effectNeedsSelection)
  );
}
export function optionalTriggerCanResolveWithoutSelections(
  candidate: MatchedTriggerCandidate,
): boolean {
  return candidate.optional && triggerCanResolveWithoutSelections(candidate);
}
export function openOptionalTriggerWindow(
  state: AuthoritativeGameState,
  candidate: MatchedTriggerCandidate,
  event: TriggerEventFact,
  deadlineAt: number,
) {
  if (state.pendingWindows.length) throw new Error("TRIGGER_WINDOW_CONFLICT");
  if (!optionalTriggerCanResolveWithoutSelections(candidate))
    throw new Error("TRIGGER_REQUIRES_SPECIALIZED_SELECTION");
  const current = matchTriggeredEffects(state, [candidate], event).find(
    (item) =>
      item.triggerId === candidate.triggerId &&
      item.sourceRef === candidate.sourceRef,
  );
  if (!current) throw new Error("TRIGGER_NO_LONGER_MATCHES");
  const tx = new EngineTransaction(state),
    promptId = `prompt:optional-trigger:${candidate.triggerId}:${candidate.sourceRef}:${state.stateRevision + 1}`;
  tx.draft.pendingWindows.push({
    promptId,
    kind: "optionalTrigger",
    prioritySeat: candidate.controllerSeat,
    mandatory: false,
    deadlineAt,
    timeoutPolicy: "pass",
    legalOfferIds: [
      `offer:optional-trigger:pass:${candidate.triggerId}`,
      `offer:optional-trigger:activate:${candidate.triggerId}`,
    ],
    context: {
      candidate: candidate as unknown as JsonValue,
      event: event as unknown as JsonValue,
    },
  });
  tx.emit("choice.requested", {
    kind: "optionalTrigger",
    promptId,
    seat: candidate.controllerSeat,
    triggerId: candidate.triggerId,
    sourceRef: candidate.sourceRef,
  });
  const committed = tx.commit();
  committed.state.history.domainEvents.push(...committed.events);
  validateAuthoritativeState(committed.state);
  return committed;
}
export function openTriggerOrderingWindow(
  state: AuthoritativeGameState,
  candidates: MatchedTriggerCandidate[],
  event: TriggerEventFact,
  deadlineAt: number,
) {
  if (state.pendingWindows.length) throw new Error("TRIGGER_WINDOW_CONFLICT");
  if (candidates.length < 2)
    throw new Error("TRIGGER_ORDERING_REQUIRES_MULTIPLE");
  const controllerSeat = candidates[0]!.controllerSeat,
    priority = candidates[0]!.priority;
  if (
    candidates.some(
      (candidate) =>
        candidate.controllerSeat !== controllerSeat ||
        candidate.priority !== priority,
    )
  )
    throw new Error("TRIGGER_ORDERING_GROUP_INVALID");
  for (const candidate of candidates) {
    const current = matchTriggeredEffects(state, [candidate], event).find(
      (item) =>
        item.triggerId === candidate.triggerId &&
        item.sourceRef === candidate.sourceRef,
    );
    if (!current) throw new Error("TRIGGER_NO_LONGER_MATCHES");
  }
  const tx = new EngineTransaction(state),
    promptId = `prompt:trigger-order:${controllerSeat}:${state.stateRevision + 1}`,
    legalOfferIds = candidates.map(
      (_, index) => `offer:trigger-order:${index}`,
    );
  tx.draft.pendingWindows.push({
    promptId,
    kind: "triggerOrdering",
    prioritySeat: controllerSeat,
    mandatory: true,
    deadlineAt,
    timeoutPolicy: "randomLegal",
    legalOfferIds,
    context: {
      candidates: candidates as unknown as JsonValue,
      event: event as unknown as JsonValue,
    },
  });
  tx.emit("choice.requested", {
    kind: "triggerOrdering",
    promptId,
    seat: controllerSeat,
    triggerIds: candidates.map((candidate) => candidate.triggerId),
  });
  const committed = tx.commit();
  committed.state.history.domainEvents.push(...committed.events);
  validateAuthoritativeState(committed.state);
  return committed;
}
export interface OptionalTriggerCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
}
export type OptionalTriggerResult =
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
export class OptionalTriggerSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, OptionalTriggerResult>();
  constructor(
    state: AuthoritativeGameState,
    private readonly ruleset: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(command: OptionalTriggerCommand): OptionalTriggerResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (
      reasonCode: string,
      refreshRequired: boolean,
    ): OptionalTriggerResult => {
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
      (item) => item.kind === "optionalTrigger",
    );
    if (!window || window.promptId !== command.promptId)
      return reject("PROMPT_CLOSED", true);
    const actor = this.#state.players.find(
      (player) => player.userId === command.actorUserId,
    );
    if (!actor || actor.seat !== window.prioritySeat)
      return reject("NOT_YOUR_PRIORITY", false);
    if (!window.legalOfferIds.includes(command.offerId))
      return reject("OFFER_EXPIRED", true);
    const candidate = window.context
        ?.candidate as unknown as MatchedTriggerCandidate,
      event = window.context?.event as unknown as TriggerEventFact,
      activate = command.offerId.includes(":activate:");
    let committed;
    if (activate) {
      try {
        const eventKey = event.payload.__triggerEventKey;
        committed = executeMatchedTrigger(
          this.#state,
          this.ruleset,
          candidate,
          event,
          {
            allowOptional: true,
            closePromptId: window.promptId,
            ...(typeof eventKey === "string" ? { eventKey } : {}),
          },
        );
      } catch (error) {
        return reject(
          error instanceof Error ? error.message : "TRIGGER_EXECUTION_FAILED",
          true,
        );
      }
    } else {
      const tx = new EngineTransaction(this.#state);
      tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
        (item) => item.promptId !== window.promptId,
      );
      tx.emit("trigger.passed", {
        triggerId: candidate.triggerId,
        sourceRef: candidate.sourceRef,
        controllerSeat: candidate.controllerSeat,
        eventKey:
          typeof event.payload.__triggerEventKey === "string"
            ? event.payload.__triggerEventKey
            : null,
      });
      committed = tx.commit();
      committed.state.history.domainEvents.push(...committed.events);
      validateAuthoritativeState(committed.state);
    }
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
  handleTimeout(commandId: string): OptionalTriggerResult {
    const window = this.#state.pendingWindows.find(
      (item) => item.kind === "optionalTrigger",
    );
    if (!window)
      return {
        accepted: false,
        commandId,
        stateRevision: this.#state.stateRevision,
        reasonCode: "PROMPT_CLOSED",
        refreshRequired: true,
      };
    const actor = this.#state.players.find(
      (player) => player.seat === window.prioritySeat,
    )!;
    return this.handle({
      commandId,
      gameId: this.#state.gameId,
      expectedStateRevision: this.#state.stateRevision,
      actorUserId: actor.userId,
      promptId: window.promptId,
      offerId: window.legalOfferIds.find((id) => id.includes(":pass:"))!,
    });
  }
}
export type TriggerOrderingCommand = OptionalTriggerCommand;
export type TriggerOrderingResult = OptionalTriggerResult;
export class TriggerOrderingSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, TriggerOrderingResult>();
  constructor(
    state: AuthoritativeGameState,
    private readonly ruleset: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(command: TriggerOrderingCommand): TriggerOrderingResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (
      reasonCode: string,
      refreshRequired: boolean,
    ): TriggerOrderingResult => {
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
      (item) => item.kind === "triggerOrdering",
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
    const candidates = window.context
        ?.candidates as unknown as MatchedTriggerCandidate[],
      event = window.context?.event as unknown as TriggerEventFact,
      candidate = candidates[offerIndex];
    if (!candidate) return reject("OFFER_EXPIRED", true);
    let committed;
    try {
      const eventKey = event.payload.__triggerEventKey;
      committed = executeMatchedTrigger(
        this.#state,
        this.ruleset,
        candidate,
        event,
        {
          closePromptId: window.promptId,
          ...(typeof eventKey === "string" ? { eventKey } : {}),
        },
      );
    } catch (error) {
      return reject(
        error instanceof Error ? error.message : "TRIGGER_EXECUTION_FAILED",
        true,
      );
    }
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
  handleTimeout(commandId: string): TriggerOrderingResult {
    const window = this.#state.pendingWindows.find(
      (item) => item.kind === "triggerOrdering",
    );
    if (!window)
      return {
        accepted: false,
        commandId,
        stateRevision: this.#state.stateRevision,
        reasonCode: "PROMPT_CLOSED",
        refreshRequired: true,
      };
    const candidates = [...window.legalOfferIds],
      randomSeq = this.#state.randomSource.nextRandomSeq,
      shuffled = shuffleWithSource(candidates, this.#state.randomSource);
    this.#state.randomSource = shuffled.source;
    const offerId = shuffled.value[0]!;
    this.#state.randomHistory.push({
      randomSeq,
      purpose: "timeout.triggerOrdering",
      candidateRefs: candidates,
      resultRefs: [offerId],
    });
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
