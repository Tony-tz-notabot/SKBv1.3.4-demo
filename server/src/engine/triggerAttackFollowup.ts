import type { LoadedRuleset } from "../ruleset/types.js";
import { calculateTargetOffer } from "./targets.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import {
  compileTriggerRegistry,
  matchTriggeredEffects,
  type MatchedTriggerCandidate,
  type TriggerEventFact,
} from "./triggerRegistry.js";
import type { DomainEvent, JsonValue, TransactionCommit } from "./types.js";
import { moveCardInTransaction } from "./zoneMovement.js";
import {
  evaluateKillInvalidation,
  revealMatchedRoundShield,
  type KillPrintedColor,
} from "./killInvalidation.js";

type AttackRecord = Record<string, JsonValue>;
interface CardFact {
  cardId: string;
  color: KillPrintedColor;
}
const record = (value: JsonValue | null): AttackRecord | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as AttackRecord)
    : null;
const targetSeat = (ref: string): Seat => {
  const match = /^character:([1-4])$/.exec(ref);
  if (!match) throw new Error("TARGET_REF_INVALID");
  return Number(match[1]) as Seat;
};
export const isCriticalPenetrationTrigger = (
  candidate: MatchedTriggerCandidate,
) => candidate.familyId === "talent.critical_penetration";

export interface CriticalPenetrationOffer {
  legalKillCardRefs: string[];
  legalTargetRefs: string[];
  attackId: string;
  weaponRef: string | null;
  modeId: string;
  payable: boolean;
}
export function buildCriticalPenetrationOffer(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  candidate: MatchedTriggerCandidate,
  event: TriggerEventFact,
): CriticalPenetrationOffer {
  if (!isCriticalPenetrationTrigger(candidate))
    throw new Error("CRITICAL_PENETRATION_TRIGGER_REQUIRED");
  const current = matchTriggeredEffects(state, [candidate], event).find(
    (item) =>
      item.triggerId === candidate.triggerId &&
      item.sourceRef === candidate.sourceRef,
  );
  if (!current) throw new Error("TRIGGER_NO_LONGER_MATCHES");
  const attack = record(state.combat.attack);
  if (!attack || Number(attack.attackerSeat) !== candidate.controllerSeat)
    throw new Error("CRITICAL_PENETRATION_ATTACK_MISSING");
  const attacker = state.players.find(
    (player) => player.seat === candidate.controllerSeat,
  )!;
  if (attacker.lifeState === "eliminated" || attacker.presence !== "inPlay")
    return {
      legalKillCardRefs: [],
      legalTargetRefs: [],
      attackId: String(attack.attackId),
      weaponRef: typeof attack.weaponRef === "string" ? attack.weaponRef : null,
      modeId: String(attack.modeId),
      payable: false,
    };
  const legalKillCardRefs = state.zones[
      `hand:${candidate.controllerSeat}`
    ]!.orderedCardRefs.filter((ref) =>
      state.cards[ref]!.templateId.startsWith(
        ruleset.settings.combat.killTemplatePrefix,
      ),
    ),
    range = attack.range === "unlimited" ? "unlimited" : Number(attack.range),
    targets = calculateTargetOffer(state, candidate.controllerSeat, {
      kind: "character",
      min: 1,
      max: 1,
      distinct: true,
      includeSelf: true,
      team: "any",
      presence: "inPlay",
      maxDistance: range,
    }),
    priorTargets = new Set(
      Array.isArray(attack.targetRefs)
        ? attack.targetRefs.filter(
            (ref): ref is string => typeof ref === "string",
          )
        : [],
    ),
    legalTargetRefs = targets.legalTargetRefs.filter(
      (ref) => !priorTargets.has(ref),
    );
  return {
    legalKillCardRefs,
    legalTargetRefs,
    attackId: String(attack.attackId),
    weaponRef: typeof attack.weaponRef === "string" ? attack.weaponRef : null,
    modeId: String(attack.modeId),
    payable: legalKillCardRefs.length > 0 && legalTargetRefs.length > 0,
  };
}

export function openCriticalPenetrationWindow(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  candidate: MatchedTriggerCandidate,
  event: TriggerEventFact,
  deadlineAt: number,
) {
  if (state.pendingWindows.length) throw new Error("TRIGGER_WINDOW_CONFLICT");
  const offer = buildCriticalPenetrationOffer(state, ruleset, candidate, event),
    promptId = `prompt:critical-penetration:${offer.attackId}:${state.stateRevision + 1}`,
    tx = new EngineTransaction(state);
  tx.draft.pendingWindows.push({
    promptId,
    kind: "criticalPenetration",
    prioritySeat: candidate.controllerSeat,
    mandatory: false,
    deadlineAt,
    timeoutPolicy: "pass",
    legalOfferIds: [
      "offer:critical-penetration:pass",
      ...(offer.payable ? ["offer:critical-penetration:activate"] : []),
    ],
    context: {
      candidate: candidate as unknown as JsonValue,
      event: event as unknown as JsonValue,
      ...offer,
    },
  });
  tx.emit("choice.requested", {
    kind: "criticalPenetration",
    promptId,
    seat: candidate.controllerSeat,
    triggerId: candidate.triggerId,
    ...offer,
  });
  const committed = tx.commit();
  committed.state.history.domainEvents.push(...committed.events);
  validateAuthoritativeState(committed.state);
  return committed;
}

export function processCriticalPenetrationHitEvents(
  committed: TransactionCommit<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  deadlineAt: number,
): TransactionCommit<AuthoritativeGameState> {
  let current = committed.state;
  const events = [...committed.events],
    registry = compileTriggerRegistry(ruleset).filter(
      (candidate) => candidate.familyId === "talent.critical_penetration",
    );
  for (const domainEvent of committed.events) {
    if (domainEvent.eventType !== "attack.hit") continue;
    const payload =
        domainEvent.payload &&
        typeof domainEvent.payload === "object" &&
        !Array.isArray(domainEvent.payload)
          ? domainEvent.payload
          : {},
      event: TriggerEventFact = {
        eventType: domainEvent.eventType,
        payload: {
          ...payload,
          __triggerEventKey: `event:${domainEvent.eventSeq}`,
        },
      },
      candidate = matchTriggeredEffects(current, registry, event)[0];
    if (!candidate) continue;
    const opened = openCriticalPenetrationWindow(
      current,
      ruleset,
      candidate,
      event,
      deadlineAt,
    );
    current = opened.state;
    events.push(...opened.events);
    break;
  }
  return {
    previousRevision: committed.previousRevision,
    state: current,
    events,
  };
}

export interface CriticalPenetrationCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  killCardRef?: string;
  targetRef?: string;
}
export type CriticalPenetrationResult =
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

const resetFollowup = (source: AttackRecord): AttackRecord => {
  const followup = structuredClone(source);
  for (const key of [
    "currentTargetHit",
    "currentTargetResult",
    "currentTargetMissReason",
    "currentTargetDamage",
    "pendingJudgmentEffects",
    "judgmentResults",
    "armorResponseAttempts",
    "afterAttackQueue",
    "continuationQueue",
    "resumePlayDeadlineAt",
    "critical",
    "guaranteedCritical",
    "criticalGrantId",
    "wizardSpellStrikeOffered",
    "pendingWizardSpellStrike",
  ])
    delete followup[key];
  return followup;
};

export class CriticalPenetrationSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, CriticalPenetrationResult>();
  constructor(
    state: AuthoritativeGameState,
    private readonly ruleset: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(command: CriticalPenetrationCommand): CriticalPenetrationResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (
      reasonCode: string,
      refreshRequired: boolean,
    ): CriticalPenetrationResult => {
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
      (item) => item.kind === "criticalPenetration",
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
      eventKey = event.payload.__triggerEventKey,
      pass = command.offerId.endsWith(":pass");
    let offer: CriticalPenetrationOffer;
    try {
      offer = buildCriticalPenetrationOffer(
        this.#state,
        this.ruleset,
        candidate,
        event,
      );
    } catch (error) {
      return reject(
        error instanceof Error ? error.message : "TRIGGER_NO_LONGER_MATCHES",
        true,
      );
    }
    if (
      !pass &&
      (!command.killCardRef ||
        !offer.legalKillCardRefs.includes(command.killCardRef))
    )
      return reject("CRITICAL_PENETRATION_KILL_INVALID", false);
    if (
      !pass &&
      (!command.targetRef || !offer.legalTargetRefs.includes(command.targetRef))
    )
      return reject("CRITICAL_PENETRATION_TARGET_INVALID", false);
    const tx = new EngineTransaction(this.#state),
      draft = tx.draft;
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (item) => item.promptId !== window.promptId,
    );
    if (pass)
      tx.emit("trigger.passed", {
        triggerId: candidate.triggerId,
        sourceRef: candidate.sourceRef,
        controllerSeat: candidate.controllerSeat,
        eventKey: typeof eventKey === "string" ? eventKey : null,
      });
    else {
      const killCardRef = command.killCardRef!,
        selectedTarget = command.targetRef!,
        attack = record(draft.combat.attack)!;
      tx.emit("trigger.execution.before", {
        triggerId: candidate.triggerId,
        sourceRef: candidate.sourceRef,
        controllerSeat: candidate.controllerSeat,
        eventType: event.eventType,
        eventKey: typeof eventKey === "string" ? eventKey : null,
      });
      moveCardInTransaction(tx, {
        cardRef: killCardRef,
        toZoneRef: "resolving",
        moveKind: "play",
        faceUp: true,
      });
      tx.emit("card.played", {
        cardRef: killCardRef,
        seat: candidate.controllerSeat,
        purpose: "talent.critical_penetration.killCost",
      });
      tx.emit("cost.paid", {
        kind: "playCardFromHand",
        cardFamilyId: "basic.kill",
        cardRefs: [killCardRef],
        triggerId: candidate.triggerId,
      });
      const cardFacts = new Map(
          (
            this.ruleset.documents.get("cards.json") as { items: CardFact[] }
          ).items.map((item) => [item.cardId, item]),
        ),
        color = cardFacts.get(draft.cards[killCardRef]!.templateId)?.color,
        invalidation = evaluateKillInvalidation(
          draft,
          [targetSeat(selectedTarget)],
          color ? [color] : [],
          Array.isArray(attack.attackTypes) &&
            attack.attackTypes.includes("field"),
        );
      const followupId = `attack:critical-penetration:${String(attack.attackId)}:${draft.stateRevision + 1}`;
      tx.emit("attack.killInvalidation.check", {
        attackId: followupId,
        result: invalidation.invalidated ? "invalidated" : "notInvalidated",
        sourceKind: invalidation.sourceKind,
        sourceRef: invalidation.sourceRef,
        matchedColor: invalidation.matchedColor,
      });
      if (invalidation.invalidated) {
        if (
          invalidation.sourceKind === "roundShield" &&
          invalidation.sourceRef &&
          invalidation.matchedColor
        )
          revealMatchedRoundShield(
            tx,
            invalidation.sourceRef,
            invalidation.matchedColor,
          );
        moveCardInTransaction(tx, {
          cardRef: killCardRef,
          toZoneRef: "discardPile",
          moveKind: "systemMove",
        });
        tx.emit("attack.invalidated", {
          attackId: followupId,
          sourceKind: invalidation.sourceKind,
          sourceRef: invalidation.sourceRef,
          costsRemainPaid: true,
          attackCountSpent: 0,
          parentAttackId: String(attack.attackId),
        });
      } else {
        const followup = resetFollowup(attack),
          tags = Array.isArray(attack.tags)
            ? attack.tags.filter(
                (tag): tag is string => typeof tag === "string",
              )
            : [];
        followup.attackId = followupId;
        followup.targetRefs = [selectedTarget];
        followup.killCardRefs = [killCardRef];
        followup.status = "committed";
        followup.tags = [...new Set([...tags, "criticalPenetrationFollowup"])];
        followup.generatedByAttackId = String(attack.attackId);
        followup.attackCountCost = 0;
        followup.killCostAlreadyPaid = true;
        const queue = Array.isArray(attack.afterAttackQueue)
          ? attack.afterAttackQueue
          : [];
        attack.afterAttackQueue = [...queue, followup] as unknown as JsonValue;
        tx.emit("attack.queued", {
          attackId: followupId,
          parentAttackId: String(attack.attackId),
          kind: "criticalPenetration",
          attackerSeat: candidate.controllerSeat,
          targetRef: selectedTarget,
          weaponRef: followup.weaponRef ?? null,
          modeId: followup.modeId ?? null,
          attackCountCost: 0,
        });
      }
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
  handleTimeout(commandId: string): CriticalPenetrationResult {
    const window = this.#state.pendingWindows.find(
      (item) => item.kind === "criticalPenetration",
    );
    if (!window)
      return {
        accepted: false,
        commandId,
        stateRevision: this.#state.stateRevision,
        reasonCode: "PROMPT_CLOSED",
        refreshRequired: true,
      };
    return this.handle({
      commandId,
      gameId: this.#state.gameId,
      expectedStateRevision: this.#state.stateRevision,
      actorUserId: this.#state.players.find(
        (player) => player.seat === window.prioritySeat,
      )!.userId,
      promptId: window.promptId,
      offerId: "offer:critical-penetration:pass",
    });
  }
}
