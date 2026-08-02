import type { LoadedRuleset } from "../ruleset/types.js";
import { applyDirectDamageInTransaction } from "./damage.js";
import { commitSpecialPlay, specialPlayOffers } from "./specialCardPlay.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent, JsonValue } from "./types.js";
import { moveCardInTransaction } from "./zoneMovement.js";

interface RuleValues {
  hp: number;
  fire: number;
  poison: number;
}
function definition(ruleset: LoadedRuleset): RuleValues {
  const document = ruleset.documents.get("nonboss-rules.json") as {
      effectFamilies: Array<{
        familyId: string;
        usageKind: string;
        defaultWindow: string;
        effects?: JsonValue[];
        delayedTrigger?: JsonValue;
      }>;
    },
    rule = document.effectFamilies.find(
      (family) => family.familyId === "special.sp09",
    ),
    encoded = JSON.stringify(rule?.delayedTrigger ?? {}),
    damages: Array<{ damageType?: string; element?: string; amount?: number }> =
      [];
  const walk = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    const record = value as Record<string, unknown>;
    if (record.op === "createDamage" && record.params)
      damages.push(record.params as (typeof damages)[number]);
    Object.values(record).forEach(walk);
  };
  walk(rule?.delayedTrigger);
  const hp = damages.find((item) => item.damageType === "hp")?.amount,
    fire = damages.find((item) => item.element === "fire")?.amount,
    poison = damages.find((item) => item.element === "poison")?.amount;
  if (
    rule?.usageKind !== "specialCard" ||
    rule.defaultWindow !== "owner.phase.play" ||
    !encoded.includes('"collectAllBeforeConsequences":true') ||
    !encoded.includes('"responseMayComeFrom":["handCard","ability"]') ||
    !encoded.includes('"onlyWhileInJudgmentZone":true') ||
    !Number.isInteger(hp) ||
    !Number.isInteger(fire) ||
    !Number.isInteger(poison)
  )
    throw new Error("SUPER_BABY_RULE_INVALID");
  return { hp: Number(hp), fire: Number(fire), poison: Number(poison) };
}
function playWindow(state: AuthoritativeGameState, seat: Seat) {
  return state.pendingWindows.find(
    (window) =>
      window.kind === "playPhaseAction" && window.prioritySeat === seat,
  );
}
const inPlayOrder = (state: AuthoritativeGameState, sourceSeat: Seat) =>
  Array.from(
    { length: 4 },
    (_, offset) => (((sourceSeat - 1 + offset) % 4) + 1) as Seat,
  ).filter((seat) => {
    const player = state.players.find((item) => item.seat === seat)!;
    return player.presence === "inPlay" && player.lifeState !== "eliminated";
  });

export interface SuperBabyOffer {
  offerId: string;
  cardRef: string;
  stateRevision: number;
}
export function buildSuperBabyOffers(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  seat: Seat,
): SuperBabyOffer[] {
  definition(ruleset);
  const owner = state.players.find((player) => player.seat === seat);
  if (
    !owner ||
    owner.lifeState !== "alive" ||
    owner.presence !== "inPlay" ||
    state.activeSeat !== seat ||
    state.phase !== "play" ||
    state.phaseBoundary !== "body" ||
    !playWindow(state, seat) ||
    state.combat.attack ||
    state.resolutionStack.length
  )
    return [];
  return state.zones[`hand:${seat}`]!.orderedCardRefs.filter(
    (ref) => state.cards[ref]!.templateId === "special.sp09",
  ).map((cardRef) => ({
    offerId: `offer:special.sp09:${cardRef}`,
    cardRef,
    stateRevision: state.stateRevision,
  }));
}

export interface SuperBabyUseCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  cardRef: string;
}
export type SuperBabyResult =
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

export class SuperBabyUseSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, SuperBabyResult>();
  constructor(
    state: AuthoritativeGameState,
    private readonly ruleset: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(command: SuperBabyUseCommand): SuperBabyResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (reasonCode: string, refreshRequired: boolean) => {
      const result: SuperBabyResult = {
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
      window = actor ? playWindow(this.#state, actor.seat) : undefined;
    if (!actor || !window) return reject("NOT_YOUR_PRIORITY", false);
    if (window.promptId !== command.promptId)
      return reject("PROMPT_CLOSED", true);
    const offer = buildSuperBabyOffers(
      this.#state,
      this.ruleset,
      actor.seat,
    ).find(
      (candidate) =>
        candidate.offerId === command.offerId &&
        candidate.cardRef === command.cardRef,
    );
    if (!offer) return reject("OFFER_EXPIRED", true);
    const tx = new EngineTransaction(this.#state),
      card = tx.draft.cards[command.cardRef]!;
    moveCardInTransaction(tx, {
      cardRef: command.cardRef,
      toZoneRef: `judgment:${actor.seat}`,
      moveKind: "use",
      faceUp: true,
    });
    card.runtime.persistentSourceSeat = actor.seat;
    tx.emit("card.played", {
      seat: actor.seat,
      cardRef: command.cardRef,
      familyId: "special.sp09",
      delayed: true,
    });
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    this.#state = committed.state;
    const result: SuperBabyResult = {
      accepted: true,
      commandId: command.commandId,
      previousRevision: committed.previousRevision,
      stateRevision: committed.state.stateRevision,
      events: committed.events,
    };
    this.#results.set(command.commandId, result);
    return structuredClone(result);
  }
}

function openResponse(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  cardRef: string,
  sourceSeat: Seat,
  order: Seat[],
  index: number,
  respondedSeats: Seat[],
  deadlineAt: number,
): void {
  const seat = order[index]!,
    prefix = `offer:super-baby:${cardRef}:${seat}`,
    plays = specialPlayOffers(tx.draft, ruleset, seat, "dodge", prefix),
    promptId = `prompt:super-baby:${cardRef}:${seat}:${tx.draft.stateRevision + 1}`;
  tx.draft.pendingWindows.push({
    promptId,
    kind: "superBabyDodgeRequest",
    prioritySeat: seat,
    mandatory: false,
    deadlineAt,
    timeoutPolicy: "pass",
    legalOfferIds: [`${prefix}:pass`, ...plays.map((offer) => offer.offerId)],
    context: {
      cardRef,
      sourceSeat,
      eligibleSeats: order,
      responseIndex: index,
      respondedSeats,
      offerPrefix: prefix,
    },
  });
  tx.emit("response.specialRequest.opened", {
    requestId: "specialRequest.dodge",
    sourceRef: cardRef,
    seat,
    promptId,
    breakArmor: true,
    isAttack: false,
  });
}

export function openSuperBabyAtJudgment(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  seat: Seat,
  deadlineAt: number,
): boolean {
  definition(ruleset);
  const cardRef = tx.draft.zones[`judgment:${seat}`]!.orderedCardRefs[0],
    card = cardRef ? tx.draft.cards[cardRef] : undefined;
  if (!card || card.templateId !== "special.sp09") return false;
  const resolvedCardRef = cardRef!,
    sourceSeat = Number(card.runtime.persistentSourceSeat) as Seat,
    order = inPlayOrder(tx.draft, sourceSeat);
  if (!order.length) throw new Error("SUPER_BABY_ELIGIBLE_PLAYERS_MISSING");
  openResponse(
    tx,
    ruleset,
    resolvedCardRef,
    sourceSeat,
    order,
    0,
    [],
    deadlineAt,
  );
  tx.emit("effect.execution.before", {
    familyId: "special.sp09",
    cardRef: resolvedCardRef,
    sourceSeat,
    phase: "judgment",
  });
  return true;
}

function scheduleHpStage(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  cardRef: string,
  sourceSeat: Seat,
  order: Seat[],
  responded: Seat[],
): void {
  const values = definition(ruleset),
    nonResponders = order.filter((seat) => !responded.includes(seat));
  nonResponders.forEach((seat, index) =>
    tx.draft.scheduledEffects.push({
      scheduledId: `scheduled:super-baby:hp:${cardRef}:${seat}:${index}`,
      sourceRef: cardRef,
      controllerSeat: sourceSeat,
      executeAt: "immediate.damagePipeline",
      effect: {
        op: "createDamage",
        targetRef: `character:${seat}`,
        amount: values.hp,
        damageType: "hp",
        element: "none",
        ignoreArmor: true,
        sourceFamilyId: "special.sp09",
      },
      cancelled: false,
    }),
  );
  tx.draft.scheduledEffects.push({
    scheduledId: `scheduled:super-baby:element-start:${cardRef}`,
    sourceRef: cardRef,
    controllerSeat: sourceSeat,
    executeAt: "immediate.damagePipeline",
    effect: {
      op: "startSuperBabyElementalStage",
      cardRef,
      sourceSeat,
    },
    cancelled: false,
  });
  tx.emit("response.specialRequest.collected", {
    sourceRef: cardRef,
    eligibleSeats: order,
    respondedSeats: responded,
    nonResponderSeats: nonResponders,
  });
}

export interface SuperBabyResponseCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
}
export class SuperBabyResponseSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, SuperBabyResult>();
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
  handle(command: SuperBabyResponseCommand): SuperBabyResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (reasonCode: string, refreshRequired: boolean) => {
      const result: SuperBabyResult = {
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
    const window = this.#state.pendingWindows.find(
      (item) => item.kind === "superBabyDodgeRequest",
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
    const tx = new EngineTransaction(this.#state),
      cardRef = String(window.context!.cardRef),
      sourceSeat = Number(window.context!.sourceSeat) as Seat,
      order = window.context!.eligibleSeats as unknown as Seat[],
      index = Number(window.context!.responseIndex),
      responded = [...(window.context!.respondedSeats as unknown as Seat[])],
      prefix = String(window.context!.offerPrefix),
      passed = command.offerId === `${prefix}:pass`;
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (item) => item.promptId !== window.promptId,
    );
    if (!passed) {
      commitSpecialPlay(tx, this.ruleset, {
        seat: actor.seat,
        family: "dodge",
        offerId: command.offerId,
        prefix,
        sourceRef: cardRef,
        deadlineAt: window.deadlineAt,
      });
      responded.push(actor.seat);
    } else
      tx.emit("response.passed", {
        kind: "superBabyDodgeRequest",
        sourceRef: cardRef,
        seat: actor.seat,
      });
    if (index + 1 < order.length)
      openResponse(
        tx,
        this.ruleset,
        cardRef,
        sourceSeat,
        order,
        index + 1,
        responded,
        this.nextDeadlineAt(),
      );
    else
      scheduleHpStage(tx, this.ruleset, cardRef, sourceSeat, order, responded);
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    this.#state = committed.state;
    const result: SuperBabyResult = {
      accepted: true,
      commandId: command.commandId,
      previousRevision: committed.previousRevision,
      stateRevision: committed.state.stateRevision,
      events: committed.events,
    };
    this.#results.set(command.commandId, result);
    return structuredClone(result);
  }
  handleTimeout(commandId: string): SuperBabyResult {
    const window = this.#state.pendingWindows.find(
      (item) => item.kind === "superBabyDodgeRequest",
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
      offerId: `${String(window.context!.offerPrefix)}:pass`,
    });
  }
}

export function startSuperBabyElementalStageInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  cardRef: string,
  sourceSeat: Seat,
): void {
  const values = definition(ruleset),
    targets = inPlayOrder(tx.draft, sourceSeat).filter(
      (seat) => seat !== sourceSeat,
    );
  targets.forEach((seat, index) =>
    tx.draft.scheduledEffects.push({
      scheduledId: `scheduled:super-baby:element-pair:${cardRef}:${seat}:${index}`,
      sourceRef: cardRef,
      controllerSeat: sourceSeat,
      executeAt: "immediate.damagePipeline",
      effect: {
        op: "applySuperBabyElementPair",
        cardRef,
        sourceSeat,
        targetRef: `character:${seat}`,
        fireAmount: values.fire,
        poisonAmount: values.poison,
      },
      cancelled: false,
    }),
  );
  tx.draft.scheduledEffects.push({
    scheduledId: `scheduled:super-baby:cleanup:${cardRef}`,
    sourceRef: cardRef,
    controllerSeat: sourceSeat,
    executeAt: "immediate.damagePipeline",
    effect: { op: "cleanupSuperBaby", cardRef, sourceSeat },
    cancelled: false,
  });
  tx.emit("effect.stage.started", {
    familyId: "special.sp09",
    stage: "firePoison",
    cardRef,
    targetRefs: targets.map((seat) => `character:${seat}`),
  });
}

export function applySuperBabyElementPairInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  input: {
    scheduledId: string;
    sourceSeat: Seat;
    targetRef: string;
    fireAmount: number;
    poisonAmount: number;
  },
): void {
  const targetSeat = Number(input.targetRef.split(":")[1]) as Seat,
    target = tx.draft.players.find((player) => player.seat === targetSeat)!;
  if (target.presence !== "inPlay" || target.lifeState === "eliminated") {
    tx.emit("effect.cancelled", {
      scheduledId: input.scheduledId,
      reason: "targetUnavailable",
      targetRef: input.targetRef,
    });
    return;
  }
  for (const [element, amount] of [
    ["fire", input.fireAmount],
    ["poison", input.poisonAmount],
  ] as const)
    applyDirectDamageInTransaction(tx, {
      damageId: `damage:${input.scheduledId}:${element}`,
      sourceSeat: input.sourceSeat,
      targetRef: input.targetRef,
      amount,
      damageType: "normal",
      element,
      isAdditional: false,
      ignoreArmor: true,
      ruleset,
    });
  tx.emit("dying.check", {
    sourceId: input.scheduledId,
    targetRef: input.targetRef,
    hp: target.hp,
  });
  if (target.hp !== null && target.hp <= 0) {
    target.lifeState = "dying";
    tx.draft.combat.dyingStack.push(input.targetRef);
    tx.emit("dying.enter", {
      sourceId: input.scheduledId,
      targetRef: input.targetRef,
    });
  }
}

export function cleanupSuperBabyInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  cardRef: string,
  sourceSeat: Seat,
): void {
  const card = tx.draft.cards[cardRef];
  if (card?.zoneRef.startsWith("judgment:"))
    moveCardInTransaction(tx, {
      cardRef,
      toZoneRef: "discardPile",
      moveKind: "systemMove",
      faceUp: true,
    });
  tx.draft.phaseBodyResolved =
    tx.draft.zones[`judgment:${tx.draft.activeSeat}`]!.orderedCardRefs
      .length === 0;
  tx.emit("card.resolved", {
    seat: sourceSeat,
    cardRef,
    familyId: "special.sp09",
  });
}
