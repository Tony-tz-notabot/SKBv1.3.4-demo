import type { LoadedRuleset } from "../ruleset/types.js";
import { moveCardInTransaction } from "./zoneMovement.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent } from "./types.js";

interface EffectFamily {
  familyId: string;
  usageKind: string;
  defaultWindow: string;
  targetRule?: {
    selector?: string;
    min?: number;
    max?: number;
    range?: string;
  };
  effects?: Array<{ op: string; params?: Record<string, unknown> }>;
}
interface NonbossDocument {
  effectFamilies: EffectFamily[];
}
function family(ruleset: LoadedRuleset, id: string): EffectFamily {
  const document = ruleset.documents.get(
      "nonboss-rules.json",
    ) as NonbossDocument,
    value = document.effectFamilies.find((item) => item.familyId === id);
  if (!value) throw new Error("SPECIAL_RULE_MISSING");
  return value;
}
function validateDeathNoteRule(ruleset: LoadedRuleset): void {
  const rule = family(ruleset, "special.sp04"),
    effect = rule.effects?.[0],
    params = effect?.params;
  if (
    rule.usageKind !== "specialCard" ||
    rule.defaultWindow !== "owner.phase.play" ||
    rule.targetRule?.selector !== "inPlayCharacter" ||
    rule.targetRule.range !== "unlimited" ||
    effect?.op !== "if" ||
    !params
  )
    throw new Error("DEATH_NOTE_RULE_INVALID");
  const encoded = JSON.stringify(params);
  if (
    !encoded.includes('"$target.shield"') ||
    !encoded.includes('"$target.hp"') ||
    !encoded.includes('"modifyNotDamage"')
  )
    throw new Error("DEATH_NOTE_RULE_INVALID");
}
function playWindow(state: AuthoritativeGameState, seat: Seat) {
  return state.pendingWindows.find(
    (item) => item.kind === "playPhaseAction" && item.prioritySeat === seat,
  );
}
function legalTargets(state: AuthoritativeGameState): string[] {
  return state.players
    .filter(
      (item) => item.presence === "inPlay" && item.lifeState !== "eliminated",
    )
    .map((item) => `character:${item.seat}`);
}
export function applyDeathNoteInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  targetRef: string,
  sourceRef: string,
): void {
  const targetSeat = Number(targetRef.split(":")[1]) as Seat,
    target = tx.draft.players.find((item) => item.seat === targetSeat);
  if (!target) throw new Error("DEATH_NOTE_TARGET_INVALID");
  if (target.shield !== null && target.shield > 0) {
    const before = target.shield;
    target.shield = 0;
    tx.emit("value.changed", {
      seat: targetSeat,
      path: "shield",
      from: before,
      to: 0,
      semantic: "modifyNotDamage",
      sourceRef,
    });
  } else if (target.hp !== null) {
    const before = target.hp;
    target.hp = 1;
    tx.emit("value.changed", {
      seat: targetSeat,
      path: "hp",
      from: before,
      to: 1,
      semantic: "modifyNotDamage",
      sourceRef,
    });
  } else
    tx.emit("effect.noop", {
      seat: targetSeat,
      reason: "targetHasNoHealthShieldBars",
      sourceRef,
    });
}
export interface DeathNoteOffer {
  offerId: string;
  cardRef: string;
  legalTargetRefs: string[];
  stateRevision: number;
}
export function buildDeathNoteOffers(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  seat: Seat,
): DeathNoteOffer[] {
  validateDeathNoteRule(ruleset);
  const owner = state.players.find((item) => item.seat === seat),
    window = playWindow(state, seat);
  if (
    !owner ||
    owner.lifeState !== "alive" ||
    owner.presence !== "inPlay" ||
    state.activeSeat !== seat ||
    state.phase !== "play" ||
    state.phaseBoundary !== "body" ||
    !window ||
    state.combat.attack
  )
    return [];
  const targets = legalTargets(state);
  return state.zones[`hand:${seat}`]!.orderedCardRefs.filter(
    (ref) => state.cards[ref]!.templateId === "special.sp04",
  ).map((cardRef) => ({
    offerId: `offer:special.sp04:${cardRef}`,
    cardRef,
    legalTargetRefs: targets,
    stateRevision: state.stateRevision,
  }));
}
export interface DeathNoteCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  cardRef: string;
  targetRef: string;
}
export type DeathNoteResult =
  | {
      accepted: true;
      commandId: string;
      previousRevision: number;
      stateRevision: number;
      events: DomainEvent[];
      offers: DeathNoteOffer[];
    }
  | {
      accepted: false;
      commandId: string;
      stateRevision: number;
      reasonCode: string;
      refreshRequired: boolean;
    };
export class DeathNoteSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, DeathNoteResult>();
  constructor(
    state: AuthoritativeGameState,
    private readonly ruleset: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  offersFor(userId: string) {
    const seat = this.#state.players.find(
      (item) => item.userId === userId,
    )?.seat;
    return seat ? buildDeathNoteOffers(this.#state, this.ruleset, seat) : [];
  }
  handle(command: DeathNoteCommand): DeathNoteResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (
      reasonCode: string,
      refreshRequired: boolean,
    ): DeathNoteResult => {
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
    const actor = this.#state.players.find(
        (item) => item.userId === command.actorUserId,
      ),
      window = actor ? playWindow(this.#state, actor.seat) : undefined;
    if (!actor || !window) return reject("NOT_YOUR_PRIORITY", false);
    if (window.promptId !== command.promptId)
      return reject("PROMPT_CLOSED", true);
    const offer = buildDeathNoteOffers(
      this.#state,
      this.ruleset,
      actor.seat,
    ).find(
      (item) =>
        item.offerId === command.offerId && item.cardRef === command.cardRef,
    );
    if (!offer) return reject("OFFER_EXPIRED", true);
    if (!offer.legalTargetRefs.includes(command.targetRef))
      return reject("TARGET_NO_LONGER_LEGAL", true);
    const targetSeat = Number(command.targetRef.split(":")[1]) as Seat,
      tx = new EngineTransaction(this.#state),
      target = tx.draft.players.find((item) => item.seat === targetSeat)!;
    moveCardInTransaction(tx, {
      cardRef: command.cardRef,
      toZoneRef: "resolving",
      moveKind: "use",
      faceUp: true,
    });
    tx.emit("card.played", {
      seat: actor.seat,
      cardRef: command.cardRef,
      familyId: "special.sp04",
      targetRef: command.targetRef,
    });
    applyDeathNoteInTransaction(tx, command.targetRef, command.cardRef);
    moveCardInTransaction(tx, {
      cardRef: command.cardRef,
      toZoneRef: "discardPile",
      moveKind: "systemMove",
      faceUp: true,
    });
    tx.emit("card.resolved", {
      seat: actor.seat,
      cardRef: command.cardRef,
      familyId: "special.sp04",
    });
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
      offers: this.offersFor(command.actorUserId),
    };
    this.#results.set(command.commandId, result);
    return structuredClone(result);
  }
}

function validateHornSquadRule(ruleset: LoadedRuleset) {
  const rule = family(ruleset, "special.sp07"),
    duration = rule.effects?.find((effect) => effect.op === "createDuration"),
    params = duration?.params as
      { modifier?: { filter?: Record<string, unknown> } } | undefined,
    filter = params?.modifier?.filter;
  if (
    rule.usageKind !== "specialCard" ||
    rule.defaultWindow !== "owner.phase.play" ||
    filter?.actualKillCardPaid !== true ||
    filter.generalWeaponAttackFlow !== true ||
    filter.excludesExplicitAttackCountAbilityOrMode !== true
  )
    throw new Error("HORN_SQUAD_RULE_INVALID");
  return duration!;
}

export interface HornSquadOffer {
  offerId: string;
  cardRef: string;
  stateRevision: number;
}

export function buildHornSquadOffers(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  seat: Seat,
): HornSquadOffer[] {
  validateHornSquadRule(ruleset);
  const owner = state.players.find((item) => item.seat === seat),
    window = playWindow(state, seat);
  if (
    !owner ||
    owner.lifeState !== "alive" ||
    owner.presence !== "inPlay" ||
    state.activeSeat !== seat ||
    state.phase !== "play" ||
    state.phaseBoundary !== "body" ||
    !window ||
    state.combat.attack
  )
    return [];
  return state.zones[`hand:${seat}`]!.orderedCardRefs.filter(
    (ref) => state.cards[ref]!.templateId === "special.sp07",
  ).map((cardRef) => ({
    offerId: `offer:special.sp07:${cardRef}`,
    cardRef,
    stateRevision: state.stateRevision,
  }));
}

export function expireHornSquadAtPrepareBefore(
  tx: EngineTransaction<AuthoritativeGameState>,
  seat: Seat,
): void {
  const player = tx.draft.players.find((item) => item.seat === seat)!,
    marker = player.markers.hornSquadActive;
  if (!marker || typeof marker !== "object" || Array.isArray(marker)) return;
  const durationId =
    typeof marker.durationId === "string" ? marker.durationId : null;
  if (!durationId) return;
  delete player.markers.hornSquadActive;
  tx.draft.durations = tx.draft.durations.filter(
    (duration) => duration.durationId !== durationId,
  );
  tx.emit("duration.expired", {
    durationId,
    point: "owner.nextPhase.prepare.before",
    skipped: false,
  });
}

export interface HornSquadCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  cardRef: string;
}
export type HornSquadResult =
  | {
      accepted: true;
      commandId: string;
      previousRevision: number;
      stateRevision: number;
      events: DomainEvent[];
      offers: HornSquadOffer[];
    }
  | {
      accepted: false;
      commandId: string;
      stateRevision: number;
      reasonCode: string;
      refreshRequired: boolean;
    };

export class HornSquadSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, HornSquadResult>();
  constructor(
    state: AuthoritativeGameState,
    private readonly ruleset: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  offersFor(userId: string) {
    const seat = this.#state.players.find(
      (item) => item.userId === userId,
    )?.seat;
    return seat ? buildHornSquadOffers(this.#state, this.ruleset, seat) : [];
  }
  handle(command: HornSquadCommand): HornSquadResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (reasonCode: string, refreshRequired: boolean) => {
      const result: HornSquadResult = {
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
        (item) => item.userId === command.actorUserId,
      ),
      window = actor ? playWindow(this.#state, actor.seat) : undefined;
    if (!actor || !window) return reject("NOT_YOUR_PRIORITY", false);
    if (window.promptId !== command.promptId)
      return reject("PROMPT_CLOSED", true);
    const offer = buildHornSquadOffers(
      this.#state,
      this.ruleset,
      actor.seat,
    ).find(
      (item) =>
        item.offerId === command.offerId && item.cardRef === command.cardRef,
    );
    if (!offer) return reject("OFFER_EXPIRED", true);
    const tx = new EngineTransaction(this.#state),
      player = tx.draft.players.find((item) => item.seat === actor.seat)!,
      priorMarker = player.markers.hornSquadActive;
    if (
      priorMarker &&
      typeof priorMarker === "object" &&
      !Array.isArray(priorMarker)
    ) {
      const priorDurationId =
        typeof priorMarker.durationId === "string"
          ? priorMarker.durationId
          : null;
      if (priorDurationId)
        tx.draft.durations = tx.draft.durations.filter(
          (duration) => duration.durationId !== priorDurationId,
        );
    }
    moveCardInTransaction(tx, {
      cardRef: command.cardRef,
      toZoneRef: "resolving",
      moveKind: "use",
      faceUp: true,
    });
    const durationId = `duration:horn-squad:${actor.seat}:${tx.draft.stateRevision + 1}`;
    player.markers.hornSquadActive = {
      durationId,
      sourceRef: command.cardRef,
    };
    tx.draft.durations.push({
      durationId,
      sourceRef: command.cardRef,
      ownerRef: `character:${actor.seat}`,
      anchorEventId: null,
      activationPoint: "special.sp07.resolved",
      expiryPoint: "owner.nextPhase.prepare.before",
      remainingCount: null,
      countScope: "owner",
      skipPolicy: "expireOnSkippedBoundary",
      sourceLeavePolicy: "continue",
      ownerEliminatedPolicy: "cancel",
      cleanupEffects: [],
    });
    tx.emit("card.played", {
      seat: actor.seat,
      cardRef: command.cardRef,
      familyId: "special.sp07",
    });
    tx.emit("duration.created", {
      durationId,
      seat: actor.seat,
      sourceRef: command.cardRef,
      expiryPoint: "owner.nextPhase.prepare.before",
      kind: "hornSquadAttackCountWaiver",
    });
    moveCardInTransaction(tx, {
      cardRef: command.cardRef,
      toZoneRef: "discardPile",
      moveKind: "systemMove",
      faceUp: true,
    });
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    this.#state = committed.state;
    const result: HornSquadResult = {
      accepted: true,
      commandId: command.commandId,
      previousRevision: committed.previousRevision,
      stateRevision: committed.state.stateRevision,
      events: committed.events,
      offers: this.offersFor(command.actorUserId),
    };
    this.#results.set(command.commandId, result);
    return structuredClone(result);
  }
}
