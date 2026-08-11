import type { LoadedRuleset } from "../ruleset/types.js";
import { beginJudgment } from "./judgment.js";
import { openPreJudgmentWindow } from "./preJudgment.js";
import { specialPlayOffers, commitSpecialPlay } from "./specialCardPlay.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent, JsonValue, TransactionCommit } from "./types.js";
import { moveCardInTransaction } from "./zoneMovement.js";
import { handleMinerOffTurnActivePlay } from "./miner.js";

type FamilyId = "special.sp01" | "special.sp02";
type ResolvedFamilyId = FamilyId | "special.sp03";
interface Rule {
  familyId: string;
  usageKind: string;
  defaultWindow: string;
  effects?: Array<{ op?: string; params?: Record<string, unknown> }>;
}

function definition(ruleset: LoadedRuleset, familyId: FamilyId) {
  const rules = (
      ruleset.documents.get("nonboss-rules.json") as { effectFamilies: Rule[] }
    ).effectFamilies,
    rule = rules.find((candidate) => candidate.familyId === familyId),
    request = rule?.effects?.find(
      (effect) => effect.op === "requestSpecialPlay",
    ),
    encoded = JSON.stringify(rule?.effects ?? []);
  if (
    rule?.usageKind !== "specialCard" ||
    rule.defaultWindow !== "owner.phase.play" ||
    request?.params?.requestId !== "specialRequest.dodge" ||
    request.params.collectAllBeforeConsequences !== true ||
    request.params.isAttack !== false ||
    JSON.stringify(request.params.responseMayComeFrom) !==
      JSON.stringify(["handCard", "ability", "armor"]) ||
    !encoded.includes('"element":"electric"') ||
    !encoded.includes('"amount":"$x"')
  )
    throw new Error("INTERNET_ADDICTION_RULE_INVALID");
  return rule;
}

const nextSeat = (seat: Seat) => (seat === 4 ? 1 : seat + 1) as Seat;
function eligibleOrder(state: AuthoritativeGameState, sourceSeat: Seat) {
  const order: Seat[] = [],
    alive = new Set(
      state.players
        .filter(
          (player) =>
            player.presence === "inPlay" && player.lifeState !== "eliminated",
        )
        .map((player) => player.seat),
    );
  let seat = nextSeat(sourceSeat);
  for (let count = 0; count < 3; count += 1, seat = nextSeat(seat))
    if (alive.has(seat)) order.push(seat);
  return order;
}
function playWindow(state: AuthoritativeGameState, seat: Seat) {
  return state.pendingWindows.find(
    (window) =>
      window.kind === "playPhaseAction" && window.prioritySeat === seat,
  );
}
function equipmentEnabled(state: AuthoritativeGameState, seat: Seat) {
  const player = state.players.find((candidate) => candidate.seat === seat)!;
  return (
    player.markers.equipmentEffectsDisabled !== true &&
    !player.statuses.some(
      (status) => status.statusId === "status.equipmentDisabled",
    )
  );
}
function judgmentArmor(
  state: AuthoritativeGameState,
  seat: Seat,
  attempted: Seat[],
) {
  if (attempted.includes(seat) || !equipmentEnabled(state, seat)) return null;
  const ref = state.zones[`armor:${seat}`]?.orderedCardRefs[0],
    id = ref ? state.cards[ref]!.templateId : null;
  if (id === "armor.a01") return { ref: ref!, colors: ["orange"] as const };
  if (id === "armor.a03")
    return { ref: ref!, colors: ["blue", "orange"] as const };
  return null;
}

export interface InternetAddictionOffer {
  offerId: string;
  cardRef: string;
  familyId: FamilyId;
  stateRevision: number;
}
export function buildInternetAddictionOffers(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  seat: Seat,
): InternetAddictionOffer[] {
  for (const id of ["special.sp01", "special.sp02"] as const)
    definition(ruleset, id);
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
  return state.zones[`hand:${seat}`]!.orderedCardRefs.flatMap((cardRef) => {
    const familyId = state.cards[cardRef]!.templateId;
    return familyId === "special.sp01" || familyId === "special.sp02"
      ? [
          {
            offerId: `offer:${familyId}:${cardRef}`,
            cardRef,
            familyId,
            stateRevision: state.stateRevision,
          },
        ]
      : [];
  });
}

function openResponse(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  context: {
    cardRef: string;
    familyId: FamilyId;
    sourceSeat: Seat;
    order: Seat[];
    index: number;
    responded: Seat[];
    armorAttempted: Seat[];
    resumeDeadlineAt: number;
    resolvedFamilyId?: ResolvedFamilyId;
  },
  deadlineAt: number,
) {
  const seat = context.order[context.index]!,
    prefix = `offer:internet-addiction:${context.cardRef}:${seat}`,
    plays = specialPlayOffers(tx.draft, ruleset, seat, "dodge", prefix),
    armor = judgmentArmor(tx.draft, seat, context.armorAttempted),
    promptId = `prompt:internet-addiction:${context.cardRef}:${seat}:${tx.draft.stateRevision + 1}`;
  tx.draft.pendingWindows.push({
    promptId,
    kind: "internetAddictionDodgeRequest",
    prioritySeat: seat,
    mandatory: false,
    deadlineAt,
    timeoutPolicy: "pass",
    legalOfferIds: [
      `${prefix}:pass`,
      ...plays.map((offer) => offer.offerId),
      ...(armor ? [`${prefix}:armorJudgment:${armor.ref}`] : []),
    ],
    context: {
      ...context,
      offerPrefix: prefix,
      ...(armor ? { armorRef: armor.ref, armorColors: [...armor.colors] } : {}),
    },
  });
  tx.emit("response.specialRequest.opened", {
    requestId: "specialRequest.dodge",
    sourceRef: context.cardRef,
    familyId: context.familyId,
    seat,
    promptId,
    isAttack: false,
    allowsArmor: true,
  });
}

function finishResponses(
  tx: EngineTransaction<AuthoritativeGameState>,
  context: {
    cardRef: string;
    familyId: FamilyId;
    sourceSeat: Seat;
    order: Seat[];
    responded: Seat[];
    resumeDeadlineAt: number;
    resolvedFamilyId?: ResolvedFamilyId;
  },
) {
  const nonResponders = context.order.filter(
      (seat) => !context.responded.includes(seat),
    ),
    amount = nonResponders.length;
  if (amount > 0)
    for (const [index, seat] of nonResponders.entries()) {
      tx.draft.scheduledEffects.push({
        scheduledId: `scheduled:internet-addiction:${context.cardRef}:${seat}:${index}`,
        sourceRef: context.cardRef,
        controllerSeat: context.sourceSeat,
        executeAt: "immediate.damagePipeline",
        effect: {
          op: "createDamage",
          targetRef: `character:${seat}`,
          amount,
          damageType: "normal",
          element: "electric",
          ignoreArmor: false,
          sourceFamilyId: context.familyId,
        },
        cancelled: false,
      });
      tx.draft.scheduledEffects.push({
        scheduledId: `scheduled:internet-addiction:${context.cardRef}:${seat}:mark:${index}`,
        sourceRef: context.cardRef,
        controllerSeat: context.sourceSeat,
        executeAt: "immediate.damagePipeline",
        effect: {
          op: "addElectricMark",
          targetRef: `character:${seat}`,
          amount: 1,
        },
        cancelled: false,
      });
    }
  tx.draft.scheduledEffects.push({
    scheduledId: `scheduled:internet-addiction:cleanup:${context.cardRef}`,
    sourceRef: context.cardRef,
    controllerSeat: context.sourceSeat,
    executeAt: "immediate.damagePipeline",
    effect: {
      op: "cleanupInternetAddiction",
      cardRef: context.cardRef,
      familyId: context.resolvedFamilyId ?? context.familyId,
      sourceSeat: context.sourceSeat,
      resumeDeadlineAt: context.resumeDeadlineAt,
    },
    cancelled: false,
  });
  tx.emit("response.specialRequest.collected", {
    sourceRef: context.cardRef,
    familyId: context.familyId,
    eligibleSeats: context.order,
    respondedSeats: context.responded,
    nonResponderSeats: nonResponders,
    damageAmount: amount,
  });
}

function advance(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  context: {
    cardRef: string;
    familyId: FamilyId;
    sourceSeat: Seat;
    order: Seat[];
    index: number;
    responded: Seat[];
    armorAttempted: Seat[];
    resumeDeadlineAt: number;
    resolvedFamilyId?: ResolvedFamilyId;
  },
  deadlineAt: number,
) {
  if (context.index + 1 < context.order.length)
    openResponse(
      tx,
      ruleset,
      { ...context, index: context.index + 1 },
      deadlineAt,
    );
  else finishResponses(tx, context);
}

export interface InternetAddictionCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  cardRef: string;
}
export type InternetAddictionResult =
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

export class InternetAddictionSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, InternetAddictionResult>();
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
  handle(command: InternetAddictionCommand): InternetAddictionResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (reasonCode: string, refreshRequired: boolean) => {
      const result: InternetAddictionResult = {
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
        (window) => window.kind === "internetAddictionDodgeRequest",
      );
    if (responseWindow) {
      if (!actor || actor.seat !== responseWindow.prioritySeat)
        return reject("NOT_YOUR_PRIORITY", false);
      if (responseWindow.promptId !== command.promptId)
        return reject("PROMPT_CLOSED", true);
      if (!responseWindow.legalOfferIds.includes(command.offerId))
        return reject("OFFER_EXPIRED", true);
      const raw = responseWindow.context as Record<string, JsonValue>,
        context = {
          cardRef: String(raw.cardRef),
          familyId: String(raw.familyId) as FamilyId,
          sourceSeat: Number(raw.sourceSeat) as Seat,
          order: raw.order as unknown as Seat[],
          index: Number(raw.index),
          responded: [...(raw.responded as unknown as Seat[])],
          armorAttempted: [...(raw.armorAttempted as unknown as Seat[])],
          resumeDeadlineAt: Number(raw.resumeDeadlineAt),
          ...(typeof raw.resolvedFamilyId === "string"
            ? { resolvedFamilyId: raw.resolvedFamilyId as ResolvedFamilyId }
            : {}),
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
          armorRef,
          isAttack: false,
        });
        handleMinerOffTurnActivePlay(tx, this.ruleset, {
          seat: actor.seat,
          respondsToAttackOrDamage: true,
          sourceSeat: context.sourceSeat,
          deadlineAt: responseWindow.deadlineAt,
          reason: "internetAddictionArmorJudgmentResponse",
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
              specialInternetArmorJudgment: true,
              internetContext: context as unknown as JsonValue,
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
        const result: InternetAddictionResult = {
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
          kind: "internetAddictionDodgeRequest",
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
    const offer = buildInternetAddictionOffers(
      this.#state,
      this.ruleset,
      actor.seat,
    ).find(
      (candidate) =>
        candidate.offerId === command.offerId &&
        candidate.cardRef === command.cardRef,
    );
    if (!offer) return reject("OFFER_EXPIRED", true);
    definition(this.ruleset, offer.familyId);
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
      familyId: offer.familyId,
    });
    const order = eligibleOrder(tx.draft, actor.seat),
      context = {
        cardRef: command.cardRef,
        familyId: offer.familyId,
        sourceSeat: actor.seat,
        order,
        index: 0,
        responded: [] as Seat[],
        armorAttempted: [] as Seat[],
        resumeDeadlineAt: window.deadlineAt,
      };
    if (order.length)
      openResponse(tx, this.ruleset, context, this.nextDeadlineAt());
    else finishResponses(tx, context);
    return this.#commit(command.commandId, tx);
  }
  handleTimeout(commandId: string) {
    const window = this.#state.pendingWindows.find(
      (candidate) => candidate.kind === "internetAddictionDodgeRequest",
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
  ): InternetAddictionResult {
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    this.#state = committed.state;
    const result: InternetAddictionResult = {
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

export function continueInternetArmorJudgmentInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  rawContext: Record<string, JsonValue>,
  matched: boolean,
  deadlineAt: number,
): void {
  const value = rawContext.internetContext as Record<string, JsonValue>,
    context = {
      cardRef: String(value.cardRef),
      familyId: String(value.familyId) as FamilyId,
      sourceSeat: Number(value.sourceSeat) as Seat,
      order: value.order as unknown as Seat[],
      index: Number(value.index),
      responded: [...(value.responded as unknown as Seat[])],
      armorAttempted: [...(value.armorAttempted as unknown as Seat[])],
      resumeDeadlineAt: Number(value.resumeDeadlineAt),
      ...(typeof value.resolvedFamilyId === "string"
        ? { resolvedFamilyId: value.resolvedFamilyId as ResolvedFamilyId }
        : {}),
    },
    seat = context.order[context.index]!;
  if (matched) {
    context.responded.push(seat);
    tx.emit("response.resolved", {
      sourceRef: context.cardRef,
      seat,
      responseKind: "armorJudgment",
      result: "specialDodge",
    });
    advance(tx, ruleset, context, deadlineAt);
  } else {
    tx.emit("response.resolved", {
      sourceRef: context.cardRef,
      seat,
      responseKind: "armorJudgment",
      result: "continueResponse",
    });
    openResponse(tx, ruleset, context, deadlineAt);
  }
}
export function continueInternetArmorJudgment(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  rawContext: Record<string, JsonValue>,
  matched: boolean,
  deadlineAt: number,
): TransactionCommit<AuthoritativeGameState> {
  const tx = new EngineTransaction(state);
  continueInternetArmorJudgmentInTransaction(
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

export function cleanupInternetAddictionInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  input: {
    cardRef: string;
    familyId: ResolvedFamilyId;
    sourceSeat: Seat;
    resumeDeadlineAt: number;
  },
) {
  if (tx.draft.cards[input.cardRef]?.zoneRef === "resolving")
    moveCardInTransaction(tx, {
      cardRef: input.cardRef,
      toZoneRef: "discardPile",
      moveKind: "systemMove",
      faceUp: true,
    });
  tx.draft.pendingWindows.push({
    promptId: `prompt:playPhaseAction:${tx.draft.round}:${input.sourceSeat}:${tx.draft.stateRevision + 1}`,
    kind: "playPhaseAction",
    prioritySeat: input.sourceSeat,
    mandatory: false,
    deadlineAt: input.resumeDeadlineAt,
    timeoutPolicy: "pass",
    legalOfferIds: ["offer:playPhaseAction:finish"],
    context: {},
  });
  tx.emit("card.resolved", {
    seat: input.sourceSeat,
    cardRef: input.cardRef,
    familyId: input.familyId,
  });
}

export function startNestedInternetAddictionInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  input: {
    cardRef: string;
    sourceSeat: Seat;
    resumeDeadlineAt: number;
    resolvedFamilyId: "special.sp03";
  },
  deadlineAt: number,
): void {
  definition(ruleset, "special.sp01");
  const order = eligibleOrder(tx.draft, input.sourceSeat),
    context = {
      cardRef: input.cardRef,
      familyId: "special.sp01" as const,
      sourceSeat: input.sourceSeat,
      order,
      index: 0,
      responded: [] as Seat[],
      armorAttempted: [] as Seat[],
      resumeDeadlineAt: input.resumeDeadlineAt,
      resolvedFamilyId: input.resolvedFamilyId,
    };
  tx.emit("effect.stage.started", {
    familyId: "special.sp03",
    stage: "nestedInternetAddiction",
    invokedFamilyId: "special.sp01",
    sourceRef: input.cardRef,
  });
  if (order.length) openResponse(tx, ruleset, context, deadlineAt);
  else finishResponses(tx, context);
}
