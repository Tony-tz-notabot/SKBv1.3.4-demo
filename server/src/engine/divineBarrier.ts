import type { LoadedRuleset } from "../ruleset/types.js";
import type {
  AuthoritativeGameState,
  Seat,
  StatusInstanceState,
} from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent, JsonValue } from "./types.js";
import { moveCardInTransaction } from "./zoneMovement.js";

const ABILITY_ID = "skill.paladin.divine_barrier";
const STATUS_ID = "status.invincible";
const COOLDOWN_MARKER = "divineBarrierOwnerPreparesUntilReady";
const LEGAL_ZONE_TYPES = new Set([
  "hand",
  "weaponSlot",
  "thirdWeaponSlot",
  "armorSlot",
  "mountOffenseSlot",
  "mountDefenseSlot",
  "talentZone",
  "judgmentZone",
]);
interface CardFact {
  cardId: string;
  color: string;
}
function definition(ruleset: LoadedRuleset) {
  const document = ruleset.documents.get("character-rules.json") as {
      rules: Array<{
        ruleId: string;
        effects?: Array<{
          op?: string;
          params?: Record<string, unknown>;
          expiry?: Record<string, unknown>;
        }>;
      }>;
    },
    rule = document.rules.find(
      (candidate) => candidate.ruleId === "character.paladin.barrierModes",
    ),
    status = rule?.effects?.find((effect) => effect.op === "applyStatus"),
    prevention = rule?.effects?.find((effect) => effect.op === "if");
  if (
    status?.params?.statusId !== STATUS_ID ||
    status.expiry?.point !== "owner.nextPhase.prepare.before" ||
    prevention?.params?.condition !== "$window=damage.proposed"
  )
    throw new Error("DIVINE_BARRIER_RULE_INVALID");
  return { costCount: 2, cooldown: 1 } as const;
}
const playWindow = (state: AuthoritativeGameState, seat: Seat) =>
  state.pendingWindows.find(
    (window) =>
      window.kind === "playPhaseAction" && window.prioritySeat === seat,
  );
function blueCards(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  seat: Seat,
) {
  const facts = new Map(
    (ruleset.documents.get("cards.json") as { items: CardFact[] }).items.map(
      (item) => [item.cardId, item],
    ),
  );
  return Object.values(state.zones)
    .filter(
      (zone) => zone.ownerSeat === seat && LEGAL_ZONE_TYPES.has(zone.zoneType),
    )
    .flatMap((zone) => zone.orderedCardRefs)
    .filter((ref) => facts.get(state.cards[ref]!.templateId)?.color === "blue");
}
function eligibleOwner(state: AuthoritativeGameState, seat: Seat) {
  const player = state.players.find((candidate) => candidate.seat === seat);
  return Boolean(
    player?.characterId === "character.paladin" &&
    player.skillIds.includes(ABILITY_ID) &&
    player.lifeState === "alive" &&
    player.presence === "inPlay" &&
    Number(player.markers[COOLDOWN_MARKER] ?? 0) <= 0,
  );
}
function applyInvincible(
  tx: EngineTransaction<AuthoritativeGameState>,
  seat: Seat,
) {
  const player = tx.draft.players.find((candidate) => candidate.seat === seat)!,
    prior = player.statuses.find((status) => status.statusId === STATUS_ID);
  if (prior) {
    player.statuses = player.statuses.filter(
      (status) => status.statusRef !== prior.statusRef,
    );
    if (prior.durationId)
      tx.draft.durations = tx.draft.durations.filter(
        (duration) => duration.durationId !== prior.durationId,
      );
  }
  const statusRef = `status:${STATUS_ID}:${seat}:${tx.draft.stateRevision + 1}`,
    durationId = `duration:${statusRef}`,
    status: StatusInstanceState = {
      statusRef,
      statusId: STATUS_ID,
      ownerSeat: seat,
      sourceRef: `character:${seat}`,
      stackPolicy: "uniqueRefresh",
      stacks: 1,
      priority: 0,
      durationId,
      skipPhases: [],
      metadata: { abilityId: ABILITY_ID },
    };
  player.statuses.push(status);
  tx.draft.durations.push({
    durationId,
    sourceRef: `character:${seat}`,
    ownerRef: `character:${seat}`,
    anchorEventId: null,
    activationPoint: "ability.activation.committed",
    expiryPoint: "owner.nextPhase.prepare.before",
    remainingCount: null,
    countScope: "owner",
    skipPolicy: "expireOnSkippedBoundary",
    sourceLeavePolicy: "retain",
    ownerEliminatedPolicy: "cancel",
    cleanupEffects: [],
  });
  tx.emit(prior ? "status.refreshed" : "status.applied", {
    ownerSeat: seat,
    targetRef: `character:${seat}`,
    sourceSeat: seat,
    result: prior ? "refreshed" : "applied",
    statusId: STATUS_ID,
    statusRef,
    durationId,
  });
  tx.emit("duration.created", {
    durationId,
    ownerSeat: seat,
    expiryPoint: "owner.nextPhase.prepare.before",
    skipPolicy: "expireOnSkippedBoundary",
  });
}
function payAndActivate(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  seat: Seat,
  cardRefs: string[],
  mode: "active" | "damageResponse",
) {
  const values = definition(ruleset),
    player = tx.draft.players.find((candidate) => candidate.seat === seat)!;
  for (const cardRef of cardRefs)
    moveCardInTransaction(tx, {
      cardRef,
      toZoneRef: "discardPile",
      moveKind: "discard",
      faceUp: true,
    });
  player.markers[COOLDOWN_MARKER] = values.cooldown + 1;
  applyInvincible(tx, seat);
  tx.emit("cooldown.started", {
    seat,
    abilityId: ABILITY_ID,
    cooldown: values.cooldown,
    ownerPreparesUntilReady: values.cooldown + 1,
  });
  tx.emit("ability.activation.committed", {
    seat,
    abilityId: ABILITY_ID,
    mode,
    cardRefs,
  });
}

export interface DivineBarrierOffer {
  offerId: string;
  legalCardRefs: string[];
  requiredCount: number;
  stateRevision: number;
}
export function buildDivineBarrierActiveOffers(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  seat: Seat,
): DivineBarrierOffer[] {
  const values = definition(ruleset),
    cards = blueCards(state, ruleset, seat);
  return eligibleOwner(state, seat) &&
    state.activeSeat === seat &&
    state.phase === "play" &&
    state.phaseBoundary === "body" &&
    playWindow(state, seat) &&
    !state.combat.attack &&
    !state.resolutionStack.length &&
    cards.length >= values.costCount
    ? [
        {
          offerId: "offer:skill.paladin.divine_barrier:active",
          legalCardRefs: cards,
          requiredCount: values.costCount,
          stateRevision: state.stateRevision,
        },
      ]
    : [];
}
export interface DivineBarrierCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  cardRefs: string[];
}
export type DivineBarrierResult =
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
export class DivineBarrierActiveSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, DivineBarrierResult>();
  constructor(
    state: AuthoritativeGameState,
    private readonly ruleset: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(command: DivineBarrierCommand): DivineBarrierResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (reasonCode: string, refreshRequired: boolean) => {
      const result: DivineBarrierResult = {
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
    const offer = buildDivineBarrierActiveOffers(
      this.#state,
      this.ruleset,
      actor.seat,
    ).find((candidate) => candidate.offerId === command.offerId);
    if (!offer) return reject("OFFER_EXPIRED", true);
    if (
      command.cardRefs.length !== offer.requiredCount ||
      new Set(command.cardRefs).size !== offer.requiredCount
    )
      return reject("COST_SELECTION_INVALID", false);
    if (!command.cardRefs.every((ref) => offer.legalCardRefs.includes(ref)))
      return reject("COST_CARD_NO_LONGER_LEGAL", true);
    const tx = new EngineTransaction(this.#state);
    payAndActivate(tx, this.ruleset, actor.seat, command.cardRefs, "active");
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    this.#state = committed.state;
    const result: DivineBarrierResult = {
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

export function tickDivineBarrierAtPrepareBefore(
  tx: EngineTransaction<AuthoritativeGameState>,
  seat: Seat,
) {
  const player = tx.draft.players.find((candidate) => candidate.seat === seat)!;
  const status = player.statuses.find(
    (candidate) => candidate.statusId === STATUS_ID,
  );
  if (status) {
    player.statuses = player.statuses.filter(
      (candidate) => candidate.statusRef !== status.statusRef,
    );
    if (status.durationId)
      tx.draft.durations = tx.draft.durations.filter(
        (duration) => duration.durationId !== status.durationId,
      );
    tx.emit("status.expired", {
      ownerSeat: seat,
      statusId: STATUS_ID,
      statusRef: status.statusRef,
      point: "owner.nextPhase.prepare.before",
      skipped: false,
    });
  }
  const remaining = Number(player.markers[COOLDOWN_MARKER] ?? 0);
  if (remaining > 0) {
    player.markers[COOLDOWN_MARKER] = remaining - 1;
    tx.emit("cooldown.ticked", {
      seat,
      abilityId: ABILITY_ID,
      remainingOwnerPrepares: remaining - 1,
    });
  }
}

export const divineBarrierInternals = {
  blueCards,
  eligibleOwner,
  payAndActivate,
  abilityId: ABILITY_ID,
  statusId: STATUS_ID,
} as const;

export function openDivineBarrierDamageWindowInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  input: {
    targetSeat: Seat;
    attackId: string;
    targetRef: string;
    segmentId: string;
    repeatIndex: number;
    occurrenceKey: string;
    deadlineAt: number;
  },
) {
  const player = tx.draft.players.find(
      (candidate) => candidate.seat === input.targetSeat,
    )!,
    cards = blueCards(tx.draft, ruleset, input.targetSeat),
    values = definition(ruleset);
  if (
    !eligibleOwner(tx.draft, input.targetSeat) ||
    player.statuses.some((status) => status.statusId === STATUS_ID) ||
    cards.length < values.costCount
  )
    return false;
  const promptId = `prompt:divine-barrier:${input.attackId}:${input.segmentId}:${input.repeatIndex}:${tx.draft.stateRevision + 1}`;
  tx.draft.pendingWindows.push({
    promptId,
    kind: "divineBarrierDamage",
    prioritySeat: input.targetSeat,
    mandatory: false,
    deadlineAt: input.deadlineAt,
    timeoutPolicy: "pass",
    legalOfferIds: [
      `offer:divine-barrier:pass:${input.occurrenceKey}`,
      `offer:divine-barrier:activate:${input.occurrenceKey}`,
    ],
    context: {
      ...input,
      sourceKind: "attack",
      legalCardRefs: cards,
      requiredCount: values.costCount,
    },
  });
  const attack = tx.draft.combat.attack as Record<string, JsonValue>;
  attack.status = "awaitingDivineBarrier";
  tx.emit("choice.requested", {
    kind: "divineBarrierDamage",
    promptId,
    seat: input.targetSeat,
    attackId: input.attackId,
    targetRef: input.targetRef,
    segmentId: input.segmentId,
    repeatIndex: input.repeatIndex,
    legalCardRefs: cards,
    requiredCount: values.costCount,
  });
  return true;
}

export class DivineBarrierDamageSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, DivineBarrierResult>();
  constructor(
    state: AuthoritativeGameState,
    private readonly ruleset: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(command: DivineBarrierCommand): DivineBarrierResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (reasonCode: string, refreshRequired: boolean) => {
      const result: DivineBarrierResult = {
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
        (candidate) => candidate.kind === "divineBarrierDamage",
      ),
      actor = this.#state.players.find(
        (player) => player.userId === command.actorUserId,
      );
    if (!window || window.promptId !== command.promptId)
      return reject("PROMPT_CLOSED", true);
    if (!actor || actor.seat !== window.prioritySeat)
      return reject("NOT_YOUR_PRIORITY", false);
    if (!window.legalOfferIds.includes(command.offerId))
      return reject("OFFER_EXPIRED", true);
    const context = window.context as Record<string, JsonValue>,
      sourceKind = String(context.sourceKind ?? "attack"),
      attack = this.#state.combat.attack as Record<string, JsonValue> | null,
      scheduled = this.#state.scheduledEffects.find(
        (candidate) => candidate.scheduledId === context.scheduledId,
      );
    if (
      (sourceKind === "attack" &&
        (!attack ||
          attack.status !== "awaitingDivineBarrier" ||
          attack.attackId !== context.attackId)) ||
      (sourceKind === "direct" && !scheduled)
    )
      return reject("DAMAGE_CONTEXT_CHANGED", true);
    const activate = command.offerId.startsWith(
      "offer:divine-barrier:activate:",
    );
    if (!activate && command.cardRefs.length)
      return reject("COST_SELECTION_INVALID", false);
    const legal = Array.isArray(context.legalCardRefs)
        ? context.legalCardRefs.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
      required = Number(context.requiredCount);
    if (
      activate &&
      (command.cardRefs.length !== required ||
        new Set(command.cardRefs).size !== required)
    )
      return reject("COST_SELECTION_INVALID", false);
    if (activate && !command.cardRefs.every((ref) => legal.includes(ref)))
      return reject("COST_CARD_NO_LONGER_LEGAL", true);
    if (activate && !eligibleOwner(this.#state, actor.seat))
      return reject("ABILITY_NO_LONGER_LEGAL", true);
    const tx = new EngineTransaction(this.#state),
      draftAttack = tx.draft.combat.attack as Record<string, JsonValue> | null;
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (candidate) => candidate.promptId !== window.promptId,
    );
    if (activate)
      payAndActivate(
        tx,
        this.ruleset,
        actor.seat,
        command.cardRefs,
        "damageResponse",
      );
    else {
      if (sourceKind === "attack")
        draftAttack!.divineBarrierPassedOccurrenceKey = String(
          context.occurrenceKey,
        );
      else {
        const draftScheduled = tx.draft.scheduledEffects.find(
            (candidate) => candidate.scheduledId === context.scheduledId,
          )!,
          effect = draftScheduled.effect as Record<string, JsonValue>;
        effect.divineBarrierPassed = true;
      }
      tx.emit("ability.passed", {
        seat: actor.seat,
        abilityId: ABILITY_ID,
        mode: "damageResponse",
        occurrenceKey: String(context.occurrenceKey),
      });
    }
    if (sourceKind === "attack") draftAttack!.status = "targetHit";
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    this.#state = committed.state;
    const result: DivineBarrierResult = {
      accepted: true,
      commandId: command.commandId,
      previousRevision: committed.previousRevision,
      stateRevision: committed.state.stateRevision,
      events: committed.events,
    };
    this.#results.set(command.commandId, result);
    return structuredClone(result);
  }
  handleTimeout(commandId: string) {
    const window = this.#state.pendingWindows.find(
      (candidate) => candidate.kind === "divineBarrierDamage",
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
      offerId: window.legalOfferIds.find((offer) =>
        offer.startsWith("offer:divine-barrier:pass:"),
      )!,
      cardRefs: [],
    });
  }
}

export function openDivineBarrierDirectDamageWindow(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  input: {
    scheduledId: string;
    targetSeat: Seat;
    targetRef: string;
    deadlineAt: number;
  },
) {
  const player = state.players.find(
      (candidate) => candidate.seat === input.targetSeat,
    )!,
    cards = blueCards(state, ruleset, input.targetSeat),
    values = definition(ruleset);
  if (
    !eligibleOwner(state, input.targetSeat) ||
    player.statuses.some((status) => status.statusId === STATUS_ID) ||
    cards.length < values.costCount
  )
    return null;
  const tx = new EngineTransaction(state),
    promptId = `prompt:divine-barrier:${input.scheduledId}:${state.stateRevision + 1}`,
    occurrenceKey = `direct:${input.scheduledId}`;
  tx.draft.pendingWindows.push({
    promptId,
    kind: "divineBarrierDamage",
    prioritySeat: input.targetSeat,
    mandatory: false,
    deadlineAt: input.deadlineAt,
    timeoutPolicy: "pass",
    legalOfferIds: [
      `offer:divine-barrier:pass:${occurrenceKey}`,
      `offer:divine-barrier:activate:${occurrenceKey}`,
    ],
    context: {
      sourceKind: "direct",
      scheduledId: input.scheduledId,
      targetRef: input.targetRef,
      occurrenceKey,
      legalCardRefs: cards,
      requiredCount: values.costCount,
    },
  });
  tx.emit("choice.requested", {
    kind: "divineBarrierDamage",
    promptId,
    seat: input.targetSeat,
    scheduledId: input.scheduledId,
    targetRef: input.targetRef,
    legalCardRefs: cards,
    requiredCount: values.costCount,
  });
  const committed = tx.commit();
  committed.state.history.domainEvents.push(...committed.events);
  validateAuthoritativeState(committed.state);
  return committed;
}
