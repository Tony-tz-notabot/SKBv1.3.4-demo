import type { LoadedRuleset } from "../ruleset/types.js";
import { applyDirectDamageInTransaction } from "./damage.js";
import { addElectricMarkInTransaction } from "./electricMark.js";
import { startNestedInternetAddictionInTransaction } from "./internetAddiction.js";
import { beginJudgment } from "./judgment.js";
import { openPreJudgmentWindow } from "./preJudgment.js";
import { commitSpecialPlay, specialPlayOffers } from "./specialCardPlay.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent, JsonValue, TransactionCommit } from "./types.js";
import { moveCardInTransaction } from "./zoneMovement.js";
import { handleMinerOffTurnActivePlay } from "./miner.js";

interface SheepContext {
  cardRef: string;
  sourceSeat: Seat;
  order: Seat[];
  index: number;
  responded: Seat[];
  armorAttempted: Seat[];
  resumeDeadlineAt: number;
}

function validateRule(ruleset: LoadedRuleset) {
  const document = ruleset.documents.get("nonboss-rules.json") as {
      effectFamilies: Array<{
        familyId: string;
        usageKind?: string;
        defaultWindow?: string;
        effects?: unknown[];
      }>;
    },
    rule = document.effectFamilies.find(
      (family) => family.familyId === "special.sp03",
    ),
    encoded = JSON.stringify(rule?.effects ?? []);
  if (
    rule?.usageKind !== "specialCard" ||
    rule.defaultWindow !== "owner.phase.play" ||
    !encoded.includes('"amount":2') ||
    !encoded.includes('"restrictionId":"cannotDodge"') ||
    !encoded.includes('"point":"currentTurn.end"') ||
    !encoded.includes('"invokeEffectFamily":"special.sp01"') ||
    !encoded.includes('"independentResponseCollection":true') ||
    !encoded.includes('"disallowUnrelatedOptionalWindowsBetweenPhases":true')
  )
    throw new Error("SHEEP_RULE_INVALID");
}
const nextSeat = (seat: Seat) => (seat === 4 ? 1 : seat + 1) as Seat;
function order(state: AuthoritativeGameState, sourceSeat: Seat) {
  const result: Seat[] = [];
  let seat = nextSeat(sourceSeat);
  for (let count = 0; count < 3; count += 1, seat = nextSeat(seat)) {
    const player = state.players.find((candidate) => candidate.seat === seat)!;
    if (player.presence === "inPlay" && player.lifeState !== "eliminated")
      result.push(seat);
  }
  return result;
}
function playWindow(state: AuthoritativeGameState, seat: Seat) {
  return state.pendingWindows.find(
    (window) =>
      window.kind === "playPhaseAction" && window.prioritySeat === seat,
  );
}
function armor(state: AuthoritativeGameState, seat: Seat, attempted: Seat[]) {
  const player = state.players.find((candidate) => candidate.seat === seat)!;
  if (
    attempted.includes(seat) ||
    player.markers.cannotDodgeUntilTurnEnd === true ||
    player.markers.equipmentEffectsDisabled === true ||
    player.statuses.some(
      (status) => status.statusId === "status.equipmentDisabled",
    )
  )
    return null;
  const ref = state.zones[`armor:${seat}`]?.orderedCardRefs[0],
    id = ref ? state.cards[ref]!.templateId : null;
  return id === "armor.a01"
    ? { ref: ref!, colors: ["orange"] as const }
    : id === "armor.a03"
      ? { ref: ref!, colors: ["blue", "orange"] as const }
      : null;
}
function openResponse(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  context: SheepContext,
  deadlineAt: number,
) {
  const seat = context.order[context.index]!,
    prefix = `offer:sheep:${context.cardRef}:${seat}`,
    plays = specialPlayOffers(tx.draft, ruleset, seat, "dodge", prefix),
    armorOption = armor(tx.draft, seat, context.armorAttempted),
    promptId = `prompt:sheep:${context.cardRef}:${seat}:${tx.draft.stateRevision + 1}`;
  tx.draft.pendingWindows.push({
    promptId,
    kind: "sheepPhaseOneDodgeRequest",
    prioritySeat: seat,
    mandatory: false,
    deadlineAt,
    timeoutPolicy: "pass",
    legalOfferIds: [
      `${prefix}:pass`,
      ...plays.map((offer) => offer.offerId),
      ...(armorOption ? [`${prefix}:armorJudgment:${armorOption.ref}`] : []),
    ],
    context: {
      ...context,
      offerPrefix: prefix,
      ...(armorOption
        ? { armorRef: armorOption.ref, armorColors: [...armorOption.colors] }
        : {}),
    },
  });
  tx.emit("response.specialRequest.opened", {
    requestId: "specialRequest.dodge",
    sourceRef: context.cardRef,
    familyId: "special.sp03",
    stage: 1,
    seat,
    promptId,
    isAttack: false,
    allowsArmor: true,
  });
}
function finish(
  tx: EngineTransaction<AuthoritativeGameState>,
  context: SheepContext,
) {
  const nonResponders = context.order.filter(
    (seat) => !context.responded.includes(seat),
  );
  nonResponders.forEach((seat, index) =>
    tx.draft.scheduledEffects.push({
      scheduledId: `scheduled:sheep:phase1:${context.cardRef}:${seat}:${index}`,
      sourceRef: context.cardRef,
      controllerSeat: context.sourceSeat,
      executeAt: "immediate.damagePipeline",
      effect: {
        op: "applySheepPhaseOneTarget",
        cardRef: context.cardRef,
        sourceSeat: context.sourceSeat,
        targetRef: `character:${seat}`,
        amount: 2,
      },
      cancelled: false,
    }),
  );
  tx.draft.scheduledEffects.push({
    scheduledId: `scheduled:sheep:phase2:${context.cardRef}`,
    sourceRef: context.cardRef,
    controllerSeat: context.sourceSeat,
    executeAt: "immediate.damagePipeline",
    effect: {
      op: "startSheepPhaseTwo",
      cardRef: context.cardRef,
      sourceSeat: context.sourceSeat,
      resumeDeadlineAt: context.resumeDeadlineAt,
    },
    cancelled: false,
  });
  tx.emit("response.specialRequest.collected", {
    sourceRef: context.cardRef,
    familyId: "special.sp03",
    stage: 1,
    eligibleSeats: context.order,
    respondedSeats: context.responded,
    nonResponderSeats: nonResponders,
  });
}
function advance(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  context: SheepContext,
  deadlineAt: number,
) {
  if (context.index + 1 < context.order.length)
    openResponse(
      tx,
      ruleset,
      { ...context, index: context.index + 1 },
      deadlineAt,
    );
  else finish(tx, context);
}

export interface SheepOffer {
  offerId: string;
  cardRef: string;
  stateRevision: number;
}
export function buildSheepOffers(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  seat: Seat,
): SheepOffer[] {
  validateRule(ruleset);
  const player = state.players.find((candidate) => candidate.seat === seat),
    window = playWindow(state, seat);
  if (
    !player ||
    player.lifeState !== "alive" ||
    player.presence !== "inPlay" ||
    state.activeSeat !== seat ||
    state.phase !== "play" ||
    state.phaseBoundary !== "body" ||
    !window ||
    state.combat.attack ||
    state.resolutionStack.length
  )
    return [];
  return state.zones[`hand:${seat}`]!.orderedCardRefs.filter(
    (ref) => state.cards[ref]!.templateId === "special.sp03",
  ).map((cardRef) => ({
    offerId: `offer:special.sp03:${cardRef}`,
    cardRef,
    stateRevision: state.stateRevision,
  }));
}
export interface SheepCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  cardRef: string;
}
export type SheepResult =
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

export class SheepSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, SheepResult>();
  constructor(
    state: AuthoritativeGameState,
    private readonly ruleset: LoadedRuleset,
    private readonly nextDeadlineAt: () => number = Date.now,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(command: SheepCommand): SheepResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (reasonCode: string, refreshRequired: boolean) => {
      const result: SheepResult = {
        accepted: false,
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
    const actor = this.#state.players.find(
        (player) => player.userId === command.actorUserId,
      ),
      responseWindow = this.#state.pendingWindows.find(
        (window) => window.kind === "sheepPhaseOneDodgeRequest",
      );
    if (responseWindow) {
      if (!actor || actor.seat !== responseWindow.prioritySeat)
        return reject("NOT_YOUR_PRIORITY", false);
      if (responseWindow.promptId !== command.promptId)
        return reject("PROMPT_CLOSED", true);
      if (!responseWindow.legalOfferIds.includes(command.offerId))
        return reject("OFFER_EXPIRED", true);
      const raw = responseWindow.context as Record<string, JsonValue>,
        context: SheepContext = {
          cardRef: String(raw.cardRef),
          sourceSeat: Number(raw.sourceSeat) as Seat,
          order: raw.order as unknown as Seat[],
          index: Number(raw.index),
          responded: [...(raw.responded as unknown as Seat[])],
          armorAttempted: [...(raw.armorAttempted as unknown as Seat[])],
          resumeDeadlineAt: Number(raw.resumeDeadlineAt),
        },
        prefix = String(raw.offerPrefix),
        tx = new EngineTransaction(this.#state);
      tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
        (window) => window.promptId !== responseWindow.promptId,
      );
      if (command.offerId.includes(":armorJudgment:")) {
        const armorRef = String(raw.armorRef),
          colors =
            raw.armorColors as unknown as import("./judgment.js").PrintedColor[];
        context.armorAttempted.push(actor.seat);
        tx.emit("response.committed", {
          sourceRef: context.cardRef,
          seat: actor.seat,
          responseKind: "armorJudgment",
          familyId: "special.sp03",
          stage: 1,
        });
        handleMinerOffTurnActivePlay(tx, this.ruleset, {
          seat: actor.seat,
          respondsToAttackOrDamage: true,
          sourceSeat: context.sourceSeat,
          deadlineAt: responseWindow.deadlineAt,
          reason: "sheepArmorJudgmentResponse",
        });
        const paid = tx.commit();
        paid.state.history.domainEvents.push(...paid.events);
        validateAuthoritativeState(paid.state);
        const input = {
            controllerSeat: actor.seat,
            sourceRef: armorRef,
            purpose: "armorDodge",
            matchColors: colors,
            context: {
              specialSheepArmorJudgment: true,
              sheepContext: context as unknown as JsonValue,
            },
          },
          begun =
            openPreJudgmentWindow(
              paid.state,
              this.ruleset,
              input,
              responseWindow.deadlineAt,
            ) ??
            beginJudgment(
              paid.state,
              this.ruleset,
              input,
              responseWindow.deadlineAt,
            );
        this.#state = begun.state;
        const result: SheepResult = {
          accepted: true,
          commandId: command.commandId,
          previousRevision: paid.previousRevision,
          stateRevision: begun.state.stateRevision,
          events: [...paid.events, ...begun.events],
        };
        this.#results.set(command.commandId, result);
        return structuredClone(result);
      }
      if (command.offerId !== `${prefix}:pass`) {
        commitSpecialPlay(tx, this.ruleset, {
          seat: actor.seat,
          family: "dodge",
          offerId: command.offerId,
          prefix,
          sourceRef: context.cardRef,
          deadlineAt: responseWindow.deadlineAt,
        });
        context.responded.push(actor.seat);
      } else
        tx.emit("response.passed", {
          kind: "sheepPhaseOneDodgeRequest",
          sourceRef: context.cardRef,
          seat: actor.seat,
        });
      advance(tx, this.ruleset, context, this.nextDeadlineAt());
      return this.#commit(command.commandId, tx);
    }
    if (!actor) return reject("NOT_YOUR_PRIORITY", false);
    const window = playWindow(this.#state, actor.seat);
    if (!window || window.promptId !== command.promptId)
      return reject("PROMPT_CLOSED", true);
    const offer = buildSheepOffers(this.#state, this.ruleset, actor.seat).find(
      (candidate) =>
        candidate.offerId === command.offerId &&
        candidate.cardRef === command.cardRef,
    );
    if (!offer) return reject("OFFER_EXPIRED", true);
    const tx = new EngineTransaction(this.#state);
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (candidate) => candidate.promptId !== window.promptId,
    );
    moveCardInTransaction(tx, {
      cardRef: command.cardRef,
      toZoneRef: "resolving",
      moveKind: "use",
      faceUp: true,
    });
    tx.emit("card.played", {
      seat: actor.seat,
      cardRef: command.cardRef,
      familyId: "special.sp03",
    });
    const eligible = order(tx.draft, actor.seat),
      context: SheepContext = {
        cardRef: command.cardRef,
        sourceSeat: actor.seat,
        order: eligible,
        index: 0,
        responded: [],
        armorAttempted: [],
        resumeDeadlineAt: window.deadlineAt,
      };
    if (eligible.length)
      openResponse(tx, this.ruleset, context, this.nextDeadlineAt());
    else finish(tx, context);
    return this.#commit(command.commandId, tx);
  }
  handleTimeout(commandId: string) {
    const window = this.#state.pendingWindows.find(
      (candidate) => candidate.kind === "sheepPhaseOneDodgeRequest",
    );
    if (!window)
      return {
        accepted: false as const,
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
      offerId: window.legalOfferIds.find((id) => id.endsWith(":pass"))!,
      cardRef: String(window.context!.cardRef),
    });
  }
  #commit(
    commandId: string,
    tx: EngineTransaction<AuthoritativeGameState>,
  ): SheepResult {
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    this.#state = committed.state;
    const result: SheepResult = {
      accepted: true,
      commandId,
      previousRevision: committed.previousRevision,
      stateRevision: committed.state.stateRevision,
      events: committed.events,
    };
    this.#results.set(commandId, result);
    return structuredClone(result);
  }
}

export function continueSheepArmorJudgmentInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  rawContext: Record<string, JsonValue>,
  matched: boolean,
  deadlineAt: number,
): void {
  const value = rawContext.sheepContext as Record<string, JsonValue>,
    context: SheepContext = {
      cardRef: String(value.cardRef),
      sourceSeat: Number(value.sourceSeat) as Seat,
      order: value.order as unknown as Seat[],
      index: Number(value.index),
      responded: [...(value.responded as unknown as Seat[])],
      armorAttempted: [...(value.armorAttempted as unknown as Seat[])],
      resumeDeadlineAt: Number(value.resumeDeadlineAt),
    },
    seat = context.order[context.index]!;
  if (matched) {
    context.responded.push(seat);
    tx.emit("response.resolved", {
      sourceRef: context.cardRef,
      seat,
      responseKind: "armorJudgment",
      result: "specialDodge",
      familyId: "special.sp03",
      stage: 1,
    });
    advance(tx, ruleset, context, deadlineAt);
  } else {
    tx.emit("response.resolved", {
      sourceRef: context.cardRef,
      seat,
      responseKind: "armorJudgment",
      result: "continueResponse",
      familyId: "special.sp03",
      stage: 1,
    });
    openResponse(tx, ruleset, context, deadlineAt);
  }
}
export function continueSheepArmorJudgment(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  rawContext: Record<string, JsonValue>,
  matched: boolean,
  deadlineAt: number,
): TransactionCommit<AuthoritativeGameState> {
  const tx = new EngineTransaction(state);
  continueSheepArmorJudgmentInTransaction(
    tx,
    ruleset,
    rawContext,
    matched,
    deadlineAt,
  );
  const committed = tx.commit();
  committed.state.history.domainEvents.push(...committed.events);
  validateAuthoritativeState(committed.state);
  return committed;
}

export function applySheepPhaseOneTargetInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  input: {
    scheduledId: string;
    cardRef: string;
    sourceSeat: Seat;
    targetRef: string;
    amount: number;
  },
) {
  const seat = Number(input.targetRef.split(":")[1]) as Seat,
    player = tx.draft.players.find((candidate) => candidate.seat === seat)!;
  if (player.presence !== "inPlay" || player.lifeState === "eliminated") {
    tx.emit("effect.cancelled", {
      scheduledId: input.scheduledId,
      reason: "targetUnavailable",
      targetRef: input.targetRef,
    });
    return;
  }
  applyDirectDamageInTransaction(tx, {
    damageId: `damage:${input.scheduledId}`,
    sourceSeat: input.sourceSeat,
    targetRef: input.targetRef,
    amount: input.amount,
    damageType: "normal",
    element: "electric",
    isAdditional: false,
    ignoreArmor: false,
    ruleset,
  });
  addElectricMarkInTransaction(tx, seat, 1);
  player.markers.cannotDodgeUntilTurnEnd = true;
  const durationId = `duration:sheep-dodge-lock:${input.cardRef}:${seat}:${tx.draft.stateRevision + 1}`;
  tx.draft.durations.push({
    durationId,
    sourceRef: input.cardRef,
    ownerRef: input.targetRef,
    anchorEventId: null,
    activationPoint: "special.sp03.phase1.damage",
    expiryPoint: "currentTurn.end",
    remainingCount: null,
    countScope: "globalTurn",
    skipPolicy: "expireOnSkippedBoundary",
    sourceLeavePolicy: "continue",
    ownerEliminatedPolicy: "cancel",
    cleanupEffects: [],
  });
  tx.emit("restriction.applied", {
    restrictionId: "cannotDodge",
    targetRef: input.targetRef,
    appliesToAllDodgeMethods: true,
    durationId,
    expiryPoint: "currentTurn.end",
  });
  tx.emit("dying.check", {
    sourceId: input.scheduledId,
    targetRef: input.targetRef,
    hp: player.hp,
  });
  if (player.hp !== null && player.hp <= 0) {
    player.lifeState = "dying";
    tx.draft.combat.dyingStack.push(input.targetRef);
    tx.emit("dying.enter", {
      sourceId: input.scheduledId,
      targetRef: input.targetRef,
    });
  }
}

export function startSheepPhaseTwoInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  input: { cardRef: string; sourceSeat: Seat; resumeDeadlineAt: number },
  deadlineAt: number,
) {
  startNestedInternetAddictionInTransaction(
    tx,
    ruleset,
    { ...input, resolvedFamilyId: "special.sp03" },
    deadlineAt,
  );
}

export function expireSheepDodgeLocksAtTurnEnd(
  tx: EngineTransaction<AuthoritativeGameState>,
) {
  const durations = tx.draft.durations.filter(
    (duration) =>
      duration.expiryPoint === "currentTurn.end" &&
      duration.durationId.startsWith("duration:sheep-dodge-lock:"),
  );
  if (!durations.length) return;
  const ids = new Set(durations.map((duration) => duration.durationId));
  tx.draft.durations = tx.draft.durations.filter(
    (duration) => !ids.has(duration.durationId),
  );
  for (const player of tx.draft.players)
    if (player.markers.cannotDodgeUntilTurnEnd === true) {
      delete player.markers.cannotDodgeUntilTurnEnd;
      tx.emit("restriction.expired", {
        restrictionId: "cannotDodge",
        targetRef: `character:${player.seat}`,
        point: "currentTurn.end",
      });
    }
}
