import type { LoadedRuleset } from "../ruleset/types.js";
import type { AuthoritativeGameState } from "./state.js";
import { executeMatchedTrigger } from "./triggerEffects.js";
import {
  compileTriggerRegistry,
  matchTriggeredEffects,
  type CompiledTriggerDefinition,
  type MatchedTriggerCandidate,
  type TriggerEventFact,
} from "./triggerRegistry.js";
import {
  openOptionalTriggerWindow,
  openTriggerOrderingWindow,
  optionalTriggerCanResolveWithoutSelections,
  triggerCanResolveWithoutSelections,
} from "./triggerWindows.js";
import type { DomainEvent, JsonValue, TransactionCommit } from "./types.js";
import {
  openTriggerCardSelectionWindow,
  triggerUsesSupportedCardSelection,
} from "./triggerCardSelection.js";
import {
  isCriticalPenetrationTrigger,
  openCriticalPenetrationWindow,
} from "./triggerAttackFollowup.js";

export type TriggerBridgeStopReason =
  | "complete"
  | "optionalWindow"
  | "controllerOrdering"
  | "specializedSelection"
  | "safetyLimit";
export interface TriggerBridgeResult {
  state: AuthoritativeGameState;
  events: DomainEvent[];
  steps: number;
  stoppedReason: TriggerBridgeStopReason;
  pendingCandidates: MatchedTriggerCandidate[];
}
export interface TriggeredCommitResult extends TransactionCommit<AuthoritativeGameState> {
  triggerSteps: number;
  triggerStopReason: TriggerBridgeStopReason;
  pendingTriggerIds: string[];
}
const cache = new WeakMap<LoadedRuleset, CompiledTriggerDefinition[]>();
const registryFor = (ruleset: LoadedRuleset) => {
  const prior = cache.get(ruleset);
  if (prior) return prior;
  const compiled = compileTriggerRegistry(ruleset);
  cache.set(ruleset, compiled);
  return compiled;
};
const payloadRecord = (payload: JsonValue): Record<string, JsonValue> =>
  payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload
    : {};
const handledKey = (eventKey: string, candidate: MatchedTriggerCandidate) =>
  `${eventKey}|${candidate.triggerId}|${candidate.sourceRef}`;
function historyHandled(state: AuthoritativeGameState): Set<string> {
  const result = new Set<string>();
  for (const event of state.history.domainEvents) {
    if (
      event.eventType !== "trigger.resolved" &&
      event.eventType !== "trigger.passed"
    )
      continue;
    const payload = payloadRecord(event.payload),
      eventKey = payload.eventKey,
      triggerId = payload.triggerId,
      sourceRef = payload.sourceRef;
    if (
      typeof eventKey === "string" &&
      typeof triggerId === "string" &&
      typeof sourceRef === "string"
    )
      result.add(`${eventKey}|${triggerId}|${sourceRef}`);
  }
  return result;
}
export function processEventTriggers(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  event: DomainEvent | TriggerEventFact,
  deadlineAt: number,
  eventKeyOverride?: string,
): TriggerBridgeResult {
  let current = state,
    steps = 0;
  const emitted: DomainEvent[] = [],
    registry = registryFor(ruleset),
    max = ruleset.settings.engine.autoAdvanceMaxSteps,
    handled = historyHandled(state),
    initialKey =
      eventKeyOverride ??
      ("eventSeq" in event
        ? `event:${event.eventSeq}`
        : `event:${state.stateRevision}:${event.eventType}`),
    initialPayload = {
      ...payloadRecord(event.payload),
      __triggerEventKey: initialKey,
    },
    queue: Array<{ event: TriggerEventFact; eventKey: string }> = [
      {
        event: { eventType: event.eventType, payload: initialPayload },
        eventKey: initialKey,
      },
    ];
  while (queue.length && steps < max) {
    const currentEntry = queue[0]!,
      all = matchTriggeredEffects(current, registry, currentEntry.event).filter(
        (candidate) =>
          !handled.has(handledKey(currentEntry.eventKey, candidate)),
      );
    if (!all.length) {
      queue.shift();
      continue;
    }
    const first = all[0]!,
      sameController = all.filter(
        (candidate) =>
          candidate.priority === first.priority &&
          candidate.controllerSeat === first.controllerSeat,
      );
    if (sameController.length > 1) {
      const opened = openTriggerOrderingWindow(
        current,
        sameController,
        currentEntry.event,
        deadlineAt,
      );
      current = opened.state;
      emitted.push(...opened.events);
      return {
        state: opened.state,
        events: emitted,
        steps: steps + 1,
        stoppedReason: "controllerOrdering",
        pendingCandidates: sameController,
      };
    }
    if (isCriticalPenetrationTrigger(first)) {
      const opened = openCriticalPenetrationWindow(
        current,
        ruleset,
        first,
        currentEntry.event,
        deadlineAt,
      );
      current = opened.state;
      emitted.push(...opened.events);
      return {
        state: current,
        events: emitted,
        steps: steps + 1,
        stoppedReason: "specializedSelection",
        pendingCandidates: [first],
      };
    }
    if (triggerUsesSupportedCardSelection(first)) {
      const opened = openTriggerCardSelectionWindow(
        current,
        first,
        currentEntry.event,
        deadlineAt,
      );
      current = opened.state;
      emitted.push(...opened.events);
      return {
        state: current,
        events: emitted,
        steps: steps + 1,
        stoppedReason: "specializedSelection",
        pendingCandidates: [first],
      };
    }
    if (first.optional) {
      if (!optionalTriggerCanResolveWithoutSelections(first))
        return {
          state: current,
          events: emitted,
          steps,
          stoppedReason: "specializedSelection",
          pendingCandidates: [first],
        };
      const opened = openOptionalTriggerWindow(
        current,
        first,
        currentEntry.event,
        deadlineAt,
      );
      current = opened.state;
      emitted.push(...opened.events);
      return {
        state: current,
        events: emitted,
        steps: steps + 1,
        stoppedReason: "optionalWindow",
        pendingCandidates: [first],
      };
    }
    if (!triggerCanResolveWithoutSelections(first))
      return {
        state: current,
        events: emitted,
        steps,
        stoppedReason: "specializedSelection",
        pendingCandidates: [first],
      };
    const committed = executeMatchedTrigger(
      current,
      ruleset,
      first,
      currentEntry.event,
      { eventKey: currentEntry.eventKey },
    );
    handled.add(handledKey(currentEntry.eventKey, first));
    current = committed.state;
    emitted.push(...committed.events);
    for (const generated of committed.events) {
      const generatedKey = `event:${generated.eventSeq}`;
      queue.push({
        event: {
          eventType: generated.eventType,
          payload: {
            ...payloadRecord(generated.payload),
            __triggerEventKey: generatedKey,
          },
        },
        eventKey: generatedKey,
      });
    }
    steps++;
  }
  return {
    state: current,
    events: emitted,
    steps,
    stoppedReason: queue.length ? "safetyLimit" : "complete",
    pendingCandidates: [],
  };
}
export function processCommittedEventTriggers(
  committed: TransactionCommit<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  deadlineAt: number,
): TriggeredCommitResult {
  let current = committed.state,
    triggerSteps = 0,
    triggerStopReason: TriggerBridgeStopReason = "complete";
  const events = [...committed.events],
    pendingTriggerIds: string[] = [];
  for (const event of committed.events) {
    const processed = processEventTriggers(current, ruleset, event, deadlineAt);
    current = processed.state;
    triggerSteps += processed.steps;
    events.push(...processed.events);
    if (processed.stoppedReason !== "complete") {
      triggerStopReason = processed.stoppedReason;
      pendingTriggerIds.push(
        ...processed.pendingCandidates.map((candidate) => candidate.triggerId),
      );
      break;
    }
  }
  return {
    previousRevision: committed.previousRevision,
    state: current,
    events,
    triggerSteps,
    triggerStopReason,
    pendingTriggerIds,
  };
}
