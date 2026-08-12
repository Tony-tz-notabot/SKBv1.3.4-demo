import type { LoadedRuleset } from "../ruleset/types.js";
import type {
  AuthoritativeGameState,
  Seat,
  ScheduledEffectState,
} from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import { moveCardInTransaction } from "./zoneMovement.js";
import type { DomainEvent, JsonValue } from "./types.js";
import { calculateEffectiveDistance } from "./distance.js";
import { commitSpecialPlay, specialPlayOffers } from "./specialCardPlay.js";
import { openValkyrieResponseInTransaction } from "./valkyrie.js";
type Family = "kill" | "dodge";
type Context = {
  cardRef: string;
  actorSeat: Seat;
  family: Family;
  queue: Seat[];
  passedSeats: Seat[];
  playedSeats: Seat[];
  resumeDeadlineAt: number;
  legalCardRefs?: string[];
};
const turnKey = (s: AuthoritativeGameState) => `${s.round}:${s.activeSeat}`;
const legalCards = (s: AuthoritativeGameState, seat: Seat, f: Family) =>
  s.zones[`hand:${seat}`]!.orderedCardRefs.filter((ref) =>
    s.cards[ref]!.templateId.startsWith(`basic.${f}.`),
  );
const responders = (s: AuthoritativeGameState, actor: Seat) =>
  s.players
    .filter(
      (p) =>
        p.seat !== actor &&
        p.lifeState !== "eliminated" &&
        p.presence === "inPlay",
    )
    .sort((a, b) => ((a.seat - actor + 4) % 4) - ((b.seat - actor + 4) % 4))
    .map((p) => p.seat);
function assertBase(s: AuthoritativeGameState, seat: Seat, ref: string) {
  if (
    s.lifecycle !== "inProgress" ||
    s.activeSeat !== seat ||
    s.phase !== "play" ||
    s.phaseBoundary !== "body"
  )
    throw new Error("C6_USE_WRONG_WINDOW");
  if (
    s.pendingWindows.some((w) => w.kind !== "playPhaseAction") ||
    s.resolutionStack.length ||
    s.combat.attack
  )
    throw new Error("C6_USE_NOT_STABLE");
  if (
    s.cards[ref]?.templateId !== "boss.c6h8o6" ||
    s.cards[ref]?.zoneRef !== `hand:${seat}`
  )
    throw new Error("C6_CARD_NOT_IN_HAND");
  if (
    s.players.find((p) => p.seat === seat)!.markers[
      "boss.lastUsedGlobalTurn"
    ] === turnKey(s)
  )
    throw new Error("BOSS_USE_LIMIT_REACHED");
}
function openWindow(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  c: Context,
) {
  const seat = c.queue[0];
  if (!seat) return;
  const offers = specialPlayOffers(
      tx.draft,
      ruleset,
      seat,
      c.family,
      "offer:c6-sweep",
    ),
    promptId = `prompt:c6-sweep:${c.cardRef}:${seat}:${c.queue.length}`;
  tx.draft.pendingWindows.push({
    promptId,
    kind: "c6LaserSweepRequest",
    prioritySeat: seat,
    mandatory: false,
    deadlineAt: c.resumeDeadlineAt,
    timeoutPolicy: "pass",
    legalOfferIds: [
      `offer:c6-sweep:pass:${seat}`,
      ...offers.map((x) => x.offerId),
    ],
    context: { ...c, legalCardRefs: offers.flatMap((x) => x.cardRefs) },
  });
  tx.emit("response.specialRequest.opened", {
    promptId,
    sourceRef: c.cardRef,
    seat,
    requestedFamily: c.family,
    offers: offers as unknown as JsonValue,
  });
}
export function commitC6LaserSweep(
  s: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  input: {
    actorSeat: Seat;
    cardRef: string;
    family: Family;
    deadlineAt: number;
  },
) {
  assertBase(s, input.actorSeat, input.cardRef);
  if (input.family !== "kill" && input.family !== "dodge")
    throw new Error("C6_FAMILY_INVALID");
  const player = s.players.find((p) => p.seat === input.actorSeat)!,
    limitId = ruleset.settings.combat.attackCountLimitId,
    remaining = Number(player.limits[limitId] ?? 0);
  if (remaining < 1) throw new Error("C6_ATTACK_COUNT_UNAVAILABLE");
  const tx = new EngineTransaction(s),
    play = tx.draft.pendingWindows.find(
      (w) => w.kind === "playPhaseAction" && w.prioritySeat === input.actorSeat,
    ),
    resumeDeadlineAt = play?.deadlineAt ?? input.deadlineAt;
  tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
    (w) => w.kind !== "playPhaseAction",
  );
  tx.emit("boss.use.declared", {
    seat: input.actorSeat,
    cardRef: input.cardRef,
    bossId: "boss.c6h8o6",
    modeId: "laserSweep",
    requestedFamily: input.family,
  });
  moveCardInTransaction(tx, {
    cardRef: input.cardRef,
    toZoneRef: "resolving",
    moveKind: "use",
    faceUp: true,
  });
  const p = tx.draft.players.find((x) => x.seat === input.actorSeat)!;
  p.limits[limitId] = remaining - 1;
  p.markers["boss.lastUsedGlobalTurn"] = turnKey(tx.draft);
  const card = tx.draft.cards[input.cardRef]!;
  card.runtime.usedAtRound = tx.draft.round;
  card.runtime.usedAtActiveSeat = tx.draft.activeSeat;
  tx.emit("limit.consumed", {
    seat: input.actorSeat,
    limitId,
    amount: 1,
    reason: "boss.c6h8o6",
  });
  tx.emit("boss.use.committed", {
    seat: input.actorSeat,
    cardRef: input.cardRef,
    bossId: "boss.c6h8o6",
    modeId: "laserSweep",
    globalTurnKey: turnKey(tx.draft),
  });
  const sweepContext: Context = {
    cardRef: input.cardRef,
    actorSeat: input.actorSeat,
    family: input.family,
    queue: responders(tx.draft, input.actorSeat),
    passedSeats: [],
    playedSeats: [],
    resumeDeadlineAt,
  };
  const awaitingValkyrie = openValkyrieResponseInTransaction(tx, {
    originalBossRef: input.cardRef,
    originalControllerSeat: input.actorSeat,
    continuationKind: "c6LaserSweep",
    continuationData: sweepContext as unknown as Record<string, JsonValue>,
    deadlineAt: resumeDeadlineAt,
  });
  if (!awaitingValkyrie) openWindow(tx, ruleset, sweepContext);
  const out = tx.commit();
  out.state.history.domainEvents.push(...out.events);
  validateAuthoritativeState(out.state);
  return out;
}
export interface C6SweepCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  cardRef?: string;
}
export type C6SweepResult =
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
export class C6LaserSweepSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, C6SweepResult>();
  constructor(
    s: AuthoritativeGameState,
    private readonly ruleset: LoadedRuleset,
  ) {
    this.#state = s;
  }
  get state() {
    return this.#state;
  }
  handle(cmd: C6SweepCommand): C6SweepResult {
    const prior = this.#results.get(cmd.commandId);
    if (prior) return structuredClone(prior);
    const reject = (
      reasonCode: string,
      refreshRequired: boolean,
    ): C6SweepResult => {
      const r = {
        accepted: false as const,
        commandId: cmd.commandId,
        stateRevision: this.#state.stateRevision,
        reasonCode,
        refreshRequired,
      };
      this.#results.set(cmd.commandId, r);
      return structuredClone(r);
    };
    if (cmd.gameId !== this.#state.gameId)
      return reject("GAME_NOT_FOUND", false);
    if (cmd.expectedStateRevision !== this.#state.stateRevision)
      return reject("STALE_REVISION", true);
    const w = this.#state.pendingWindows.find(
      (x) => x.kind === "c6LaserSweepRequest",
    );
    if (!w || w.promptId !== cmd.promptId) return reject("PROMPT_CLOSED", true);
    const actor = this.#state.players.find((p) => p.userId === cmd.actorUserId);
    if (!actor || actor.seat !== w.prioritySeat)
      return reject("NOT_YOUR_PRIORITY", false);
    if (!w.legalOfferIds.includes(cmd.offerId))
      return reject("OFFER_EXPIRED", true);
    const c = w.context as unknown as Context,
      playing = !cmd.offerId.includes(":pass:");
    if (
      playing &&
      !specialPlayOffers(
        this.#state,
        this.ruleset,
        actor.seat,
        c.family,
        "offer:c6-sweep",
      ).some((offer) => offer.offerId === cmd.offerId)
    )
      return reject("CARD_NO_LONGER_LEGAL", true);
    if (!playing && cmd.cardRef) return reject("CARD_INVALID", false);
    const tx = new EngineTransaction(this.#state);
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (x) => x.promptId !== w.promptId,
    );
    const queue = c.queue.slice(1),
      playedSeats = [...c.playedSeats],
      passedSeats = [...c.passedSeats];
    if (playing) {
      commitSpecialPlay(tx, this.ruleset, {
        seat: actor.seat,
        family: c.family,
        offerId: cmd.offerId,
        prefix: "offer:c6-sweep",
        sourceRef: c.cardRef,
        deadlineAt: w.deadlineAt,
      });
      playedSeats.push(actor.seat);
    } else passedSeats.push(actor.seat);
    tx.emit("response.specialRequest.collected", {
      sourceRef: c.cardRef,
      seat: actor.seat,
      requestedFamily: c.family,
      result: playing ? "played" : "passed",
    });
    if (queue.length)
      openWindow(tx, this.ruleset, { ...c, queue, playedSeats, passedSeats });
    else {
      const missed = passedSeats.length,
        amount = missed === 3 ? 2 : missed === 2 ? 3 : missed === 1 ? 5 : 0;
      moveCardInTransaction(tx, {
        cardRef: c.cardRef,
        toZoneRef: "discardPile",
        moveKind: "systemMove",
        faceUp: true,
      });
      const ordered = responders(tx.draft, c.actorSeat).filter((seat) =>
        passedSeats.includes(seat),
      );
      for (const seat of ordered)
        tx.draft.scheduledEffects.push({
          scheduledId: `scheduled:c6-sweep:${c.cardRef}:${seat}`,
          sourceRef: c.cardRef,
          controllerSeat: c.actorSeat,
          executeAt: "immediate.damagePipeline",
          effect: {
            op: "createDamage",
            targetRef: `character:${seat}`,
            amount,
            damageType: "normal",
            element: "none",
            attackType: "laser",
            isAdditional: false,
          },
          cancelled: false,
        } as ScheduledEffectState);
      tx.draft.scheduledEffects.push({
        scheduledId: `scheduled:c6-sweep-resume:${c.cardRef}`,
        sourceRef: c.cardRef,
        controllerSeat: c.actorSeat,
        executeAt: "immediate.damagePipeline",
        effect: {
          op: "resumePlayWindow",
          seat: c.actorSeat,
          deadlineAt: c.resumeDeadlineAt,
        },
        cancelled: false,
      } as ScheduledEffectState);
      tx.emit("boss.effect.resolved", {
        sourceRef: c.cardRef,
        modeId: "laserSweep",
        missedSeats: ordered,
        damagePerMissed: amount,
      });
    }
    const out = tx.commit();
    out.state.history.domainEvents.push(...out.events);
    validateAuthoritativeState(out.state);
    this.#state = out.state;
    const result = {
      accepted: true as const,
      commandId: cmd.commandId,
      previousRevision: out.previousRevision,
      stateRevision: out.state.stateRevision,
      events: out.events,
    };
    this.#results.set(cmd.commandId, result);
    return structuredClone(result);
  }
  handleTimeout(commandId: string): C6SweepResult {
    const w = this.#state.pendingWindows.find(
      (x) => x.kind === "c6LaserSweepRequest",
    );
    if (!w)
      return {
        accepted: false,
        commandId,
        stateRevision: this.#state.stateRevision,
        reasonCode: "PROMPT_CLOSED",
        refreshRequired: true,
      };
    const p = this.#state.players.find((x) => x.seat === w.prioritySeat)!;
    return this.handle({
      commandId,
      gameId: this.#state.gameId,
      expectedStateRevision: this.#state.stateRevision,
      actorUserId: p.userId,
      promptId: w.promptId,
      offerId: w.legalOfferIds.find((id) => id.includes(":pass:"))!,
    });
  }
}

export function commitC6FocusedBombardment(
  s: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  input: { actorSeat: Seat; cardRef: string; family: Family; targetSeat: Seat },
) {
  assertBase(s, input.actorSeat, input.cardRef);
  if (input.family !== "kill" && input.family !== "dodge")
    throw new Error("C6_FAMILY_INVALID");
  const target = s.players.find((p) => p.seat === input.targetSeat);
  if (
    !target ||
    target.lifeState === "eliminated" ||
    target.presence !== "inPlay" ||
    calculateEffectiveDistance(s, input.actorSeat, input.targetSeat) > 1
  )
    throw new Error("C6_TARGET_INVALID");
  const occupant = s.zones[`boss:${input.actorSeat}`]!.orderedCardRefs[0],
    actor = s.players.find((p) => p.seat === input.actorSeat)!;
  if (
    occupant &&
    (s.cards[occupant]!.templateId !== "boss.iron_pirate_king" ||
      actor.lifeState === "deadNotEliminated")
  )
    throw new Error("BOSS_SLOT_OCCUPIED");
  const limitId = ruleset.settings.combat.attackCountLimitId,
    remaining = Number(actor.limits[limitId] ?? 0);
  if (remaining < 1) throw new Error("C6_ATTACK_COUNT_UNAVAILABLE");
  const tx = new EngineTransaction(s);
  tx.emit("boss.use.declared", {
    seat: input.actorSeat,
    cardRef: input.cardRef,
    bossId: "boss.c6h8o6",
    modeId: "focusedBombardment",
    targetSeat: input.targetSeat,
    requestedFamily: input.family,
  });
  if (occupant)
    moveCardInTransaction(tx, {
      cardRef: occupant,
      toZoneRef: "discardPile",
      moveKind: "replace",
    });
  moveCardInTransaction(tx, {
    cardRef: input.cardRef,
    toZoneRef: `boss:${input.actorSeat}`,
    moveKind: "use",
    faceUp: true,
  });
  const p = tx.draft.players.find((x) => x.seat === input.actorSeat)!,
    card = tx.draft.cards[input.cardRef]!;
  p.limits[limitId] = remaining - 1;
  p.markers["boss.lastUsedGlobalTurn"] = turnKey(tx.draft);
  Object.assign(card.runtime, {
    active: true,
    activationStatus: "active",
    modeId: "focusedBombardment",
    targetSeat: input.targetSeat,
    requestedFamily: input.family,
    triggered: false,
    usedAtRound: tx.draft.round,
    usedAtActiveSeat: tx.draft.activeSeat,
  });
  tx.emit("limit.consumed", {
    seat: input.actorSeat,
    limitId,
    amount: 1,
    reason: "boss.c6h8o6",
  });
  tx.emit("boss.use.committed", {
    seat: input.actorSeat,
    cardRef: input.cardRef,
    bossId: "boss.c6h8o6",
    modeId: "focusedBombardment",
    targetSeat: input.targetSeat,
    globalTurnKey: turnKey(tx.draft),
  });
  openValkyrieResponseInTransaction(tx, {
    originalBossRef: input.cardRef,
    originalControllerSeat: input.actorSeat,
    continuationKind: "c6FocusedBombardment",
    continuationData: {
      actorSeat: input.actorSeat,
      resumeDeadlineAt:
        tx.draft.pendingWindows.find(
          (window) =>
            window.kind === "playPhaseAction" &&
            window.prioritySeat === input.actorSeat,
        )?.deadlineAt ?? 0,
    },
    deadlineAt: 0,
  });
  const out = tx.commit();
  out.state.history.domainEvents.push(...out.events);
  validateAuthoritativeState(out.state);
  return out;
}

export function continueC6AfterValkyrieInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  continuationKind: string,
  data: Record<string, JsonValue>,
): void {
  if (continuationKind === "c6LaserSweep") {
    openWindow(tx, ruleset, data as unknown as Context);
    return;
  }
  if (continuationKind === "c6FocusedBombardment") {
    const seat = Number(data.actorSeat) as Seat;
    tx.draft.pendingWindows.push({
      promptId: `prompt:playPhaseAction:${tx.draft.round}:${seat}:${tx.draft.stateRevision + 1}`,
      kind: "playPhaseAction",
      prioritySeat: seat,
      mandatory: false,
      deadlineAt: Number(data.resumeDeadlineAt ?? 0),
      timeoutPolicy: "pass",
      legalOfferIds: ["offer:playPhaseAction:finish"],
      context: {},
    });
    tx.emit("choice.requested", {
      seat,
      kind: "playPhaseAction",
      resumedAfterValkyrie: true,
    });
    return;
  }
  throw new Error("C6_VALKYRIE_CONTINUATION_INVALID");
}
function openBombardWindow(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  ref: string,
  targetSeat: Seat,
  family: Family,
  index: number,
  successes: number,
  deadlineAt: number,
) {
  const offers = specialPlayOffers(
      tx.draft,
      ruleset,
      targetSeat,
      family,
      "offer:c6-bombard",
    ),
    promptId = `prompt:c6-bombard:${ref}:${index}`;
  tx.draft.pendingWindows.push({
    promptId,
    kind: "c6FocusedBombardmentRequest",
    prioritySeat: targetSeat,
    mandatory: false,
    deadlineAt,
    timeoutPolicy: "pass",
    legalOfferIds: [
      `offer:c6-bombard:pass:${index}`,
      ...offers.map((offer) => offer.offerId),
    ],
    context: {
      cardRef: ref,
      targetSeat,
      family,
      requestIndex: index,
      successes,
      legalCardRefs: offers.flatMap((offer) => offer.cardRefs),
    },
  });
  tx.emit("response.specialRequest.opened", {
    promptId,
    sourceRef: ref,
    seat: targetSeat,
    requestedFamily: family,
    requestIndex: index,
    offers: offers as unknown as JsonValue,
  });
}
export function openC6BombardmentAtPlayAfter(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  targetSeat: Seat,
  deadlineAt: number,
) {
  for (const seat of [1, 2, 3, 4] as const) {
    const ref = tx.draft.zones[`boss:${seat}`]?.orderedCardRefs[0],
      card = ref ? tx.draft.cards[ref] : undefined;
    if (
      !card ||
      card.templateId !== "boss.c6h8o6" ||
      card.runtime.modeId !== "focusedBombardment" ||
      card.runtime.triggered === true ||
      Number(card.runtime.targetSeat) !== targetSeat
    )
      continue;
    const target = tx.draft.players.find((p) => p.seat === targetSeat)!;
    card.runtime.triggered = true;
    if (target.lifeState === "eliminated" || target.presence !== "inPlay") {
      moveCardInTransaction(tx, {
        cardRef: ref!,
        toZoneRef: "discardPile",
        moveKind: "systemMove",
      });
      tx.emit("boss.effect.cancelled", {
        sourceRef: ref!,
        modeId: "focusedBombardment",
        reason: "targetUnavailable",
      });
      continue;
    }
    openBombardWindow(
      tx,
      ruleset,
      ref!,
      targetSeat,
      String(card.runtime.requestedFamily) as Family,
      1,
      0,
      deadlineAt,
    );
  }
}
export class C6FocusedBombardmentSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, C6SweepResult>();
  constructor(
    s: AuthoritativeGameState,
    private readonly ruleset: LoadedRuleset,
  ) {
    this.#state = s;
  }
  get state() {
    return this.#state;
  }
  handle(cmd: C6SweepCommand): C6SweepResult {
    const prior = this.#results.get(cmd.commandId);
    if (prior) return structuredClone(prior);
    const reject = (
      reasonCode: string,
      refreshRequired: boolean,
    ): C6SweepResult => ({
      accepted: false,
      commandId: cmd.commandId,
      stateRevision: this.#state.stateRevision,
      reasonCode,
      refreshRequired,
    });
    if (cmd.gameId !== this.#state.gameId)
      return reject("GAME_NOT_FOUND", false);
    if (cmd.expectedStateRevision !== this.#state.stateRevision)
      return reject("STALE_REVISION", true);
    const w = this.#state.pendingWindows.find(
      (x) => x.kind === "c6FocusedBombardmentRequest",
    );
    if (!w || w.promptId !== cmd.promptId) return reject("PROMPT_CLOSED", true);
    const actor = this.#state.players.find((p) => p.userId === cmd.actorUserId);
    if (!actor || actor.seat !== w.prioritySeat)
      return reject("NOT_YOUR_PRIORITY", false);
    if (!w.legalOfferIds.includes(cmd.offerId))
      return reject("OFFER_EXPIRED", true);
    const c = w.context as unknown as {
        cardRef: string;
        targetSeat: Seat;
        family: Family;
        requestIndex: number;
        successes: number;
        legalCardRefs: string[];
      },
      playing = !cmd.offerId.includes(":pass:");
    if (
      playing &&
      !specialPlayOffers(
        this.#state,
        this.ruleset,
        actor.seat,
        c.family,
        "offer:c6-bombard",
      ).some((offer) => offer.offerId === cmd.offerId)
    )
      return reject("CARD_NO_LONGER_LEGAL", true);
    const tx = new EngineTransaction(this.#state);
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (x) => x.promptId !== w.promptId,
    );
    const successes = c.successes + (playing ? 1 : 0);
    if (playing) {
      commitSpecialPlay(tx, this.ruleset, {
        seat: actor.seat,
        family: c.family,
        offerId: cmd.offerId,
        prefix: "offer:c6-bombard",
        sourceRef: c.cardRef,
        deadlineAt: w.deadlineAt,
      });
    }
    tx.emit("response.specialRequest.collected", {
      sourceRef: c.cardRef,
      seat: actor.seat,
      requestedFamily: c.family,
      requestIndex: c.requestIndex,
      result: playing ? "played" : "passed",
    });
    if (c.requestIndex === 1)
      openBombardWindow(
        tx,
        this.ruleset,
        c.cardRef,
        c.targetSeat,
        c.family,
        2,
        successes,
        w.deadlineAt,
      );
    else {
      const amount = successes === 0 ? 5 : successes === 1 ? 2 : 0;
      moveCardInTransaction(tx, {
        cardRef: c.cardRef,
        toZoneRef: "discardPile",
        moveKind: "systemMove",
        faceUp: true,
      });
      if (amount > 0)
        tx.draft.scheduledEffects.push({
          scheduledId: `scheduled:c6-bombard:${c.cardRef}`,
          sourceRef: c.cardRef,
          controllerSeat: tx.draft.cards[c.cardRef]!.controllerSeat,
          executeAt: "immediate.damagePipeline",
          effect: {
            op: "createDamage",
            targetRef: `character:${c.targetSeat}`,
            amount,
            damageType: "normal",
            element: "none",
            attackType: "field",
            isAdditional: false,
          },
          cancelled: false,
        } as ScheduledEffectState);
      tx.emit("boss.effect.resolved", {
        sourceRef: c.cardRef,
        modeId: "focusedBombardment",
        targetSeat: c.targetSeat,
        playedCount: successes,
        damage: amount,
      });
    }
    const out = tx.commit();
    out.state.history.domainEvents.push(...out.events);
    validateAuthoritativeState(out.state);
    this.#state = out.state;
    const result = {
      accepted: true as const,
      commandId: cmd.commandId,
      previousRevision: out.previousRevision,
      stateRevision: out.state.stateRevision,
      events: out.events,
    };
    this.#results.set(cmd.commandId, result);
    return structuredClone(result);
  }
  handleTimeout(commandId: string) {
    const w = this.#state.pendingWindows.find(
      (x) => x.kind === "c6FocusedBombardmentRequest",
    );
    if (!w)
      return {
        accepted: false as const,
        commandId,
        stateRevision: this.#state.stateRevision,
        reasonCode: "PROMPT_CLOSED",
        refreshRequired: true,
      };
    const p = this.#state.players.find((x) => x.seat === w.prioritySeat)!;
    return this.handle({
      commandId,
      gameId: this.#state.gameId,
      expectedStateRevision: this.#state.stateRevision,
      actorUserId: p.userId,
      promptId: w.promptId,
      offerId: w.legalOfferIds.find((id) => id.includes(":pass:"))!,
    });
  }
}


export interface C6BombardmentUseCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  cardRef: string;
  targetRef: string;
  mode: Family;
}
export type C6BombardmentUseCommandResult =
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
const c6UseMarker = "boss.lastUsedGlobalTurn";
export function legalC6BombardmentUses(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  actorSeat: Seat,
): Array<{ cardRef: string; legalTargetRefs: string[] }> {
  try {
    if (
      state.players.find((item) => item.seat === actorSeat)?.markers[
        c6UseMarker
      ] === turnKey(state)
    )
      return [];
    const occupant = state.zones[`boss:${actorSeat}`]!.orderedCardRefs[0],
      actor = state.players.find((item) => item.seat === actorSeat)!;
    if (
      occupant &&
      (state.cards[occupant]!.templateId !== "boss.iron_pirate_king" ||
        actor.lifeState === "deadNotEliminated")
    )
      return [];
    const limitId = ruleset.settings.combat.attackCountLimitId;
    if (Number(actor.limits[limitId] ?? 0) < 1) return [];
    const targets = state.players
      .filter(
        (p) =>
          p.lifeState !== "eliminated" &&
          p.presence === "inPlay" &&
          calculateEffectiveDistance(state, actorSeat, p.seat) <= 1,
      )
      .map((p) => `character:${p.seat}`);
    if (!targets.length) return [];
    return state.zones[`hand:${actorSeat}`]!
      .orderedCardRefs.filter(
        (ref) => state.cards[ref]!.templateId === "boss.c6h8o6",
      )
      .map((cardRef) => ({ cardRef, legalTargetRefs: targets }));
  } catch {
    return [];
  }
}

export function legalC6LaserSweepUses(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  actorSeat: Seat,
): string[] {
  try {
    if (
      state.players.find((item) => item.seat === actorSeat)?.markers[
        c6UseMarker
      ] === turnKey(state)
    )
      return [];
    const actor = state.players.find((item) => item.seat === actorSeat)!;
    if (
      actor.lifeState === "eliminated" ||
      actor.presence !== "inPlay"
    )
      return [];
    const limitId = ruleset.settings.combat.attackCountLimitId;
    if (Number(actor.limits[limitId] ?? 0) < 1) return [];
    return state.zones[`hand:${actorSeat}`]!.orderedCardRefs.filter(
      (ref) => state.cards[ref]!.templateId === "boss.c6h8o6",
    );
  } catch {
    return [];
  }
}
export class C6LaserSweepUseCommandSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, C6BombardmentUseCommandResult>();
  constructor(
    state: AuthoritativeGameState,
    private readonly ruleset: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(command: C6BombardmentUseCommand): C6BombardmentUseCommandResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (
      reasonCode: string,
      refreshRequired: boolean,
    ): C6BombardmentUseCommandResult => ({
      accepted: false,
      commandId: command.commandId,
      stateRevision: this.#state.stateRevision,
      reasonCode,
      refreshRequired,
    });
    if (command.gameId !== this.#state.gameId)
      return reject("GAME_NOT_FOUND", false);
    if (command.expectedStateRevision !== this.#state.stateRevision)
      return reject("STALE_REVISION", true);
    const actor = this.#state.players.find(
        (item) => item.userId === command.actorUserId,
      ),
      window = this.#state.pendingWindows.find(
        (item) =>
          item.kind === "playPhaseAction" && item.prioritySeat === actor?.seat,
      );
    if (!actor) return reject("NOT_YOUR_PRIORITY", false);
    if (!window || window.promptId !== command.promptId)
      return reject("PROMPT_CLOSED", true);
    if (command.mode !== "kill" && command.mode !== "dodge")
      return reject("C6_FAMILY_INVALID", true);
    if (
      this.#state.players.find((item) => item.seat === actor.seat)?.markers[
        c6UseMarker
      ] === turnKey(this.#state)
    )
      return reject("BOSS_USE_ILLEGAL", true);
    if (
      !legalC6LaserSweepUses(this.#state, this.ruleset, actor.seat).includes(
        command.cardRef,
      )
    )
      return reject("C6_USE_ILLEGAL", true);
    let committed;
    try {
      committed = commitC6LaserSweep(this.#state, this.ruleset, {
        actorSeat: actor.seat,
        cardRef: command.cardRef,
        family: command.mode,
        deadlineAt: 0,
      });
    } catch (error) {
      return reject(
        error instanceof Error ? error.message : "C6_USE_FAILED",
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
}
export class C6BombardmentUseCommandSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, C6BombardmentUseCommandResult>();
  constructor(
    state: AuthoritativeGameState,
    private readonly ruleset: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(command: C6BombardmentUseCommand): C6BombardmentUseCommandResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (
      reasonCode: string,
      refreshRequired: boolean,
    ): C6BombardmentUseCommandResult => ({
      accepted: false,
      commandId: command.commandId,
      stateRevision: this.#state.stateRevision,
      reasonCode,
      refreshRequired,
    });
    if (command.gameId !== this.#state.gameId)
      return reject("GAME_NOT_FOUND", false);
    if (command.expectedStateRevision !== this.#state.stateRevision)
      return reject("STALE_REVISION", true);
    const actor = this.#state.players.find(
        (item) => item.userId === command.actorUserId,
      ),
      window = this.#state.pendingWindows.find(
        (item) =>
          item.kind === "playPhaseAction" && item.prioritySeat === actor?.seat,
      );
    if (!actor) return reject("NOT_YOUR_PRIORITY", false);
    if (!window || window.promptId !== command.promptId)
      return reject("PROMPT_CLOSED", true);
    const seatMatch = /^character:([1-4])$/.exec(command.targetRef ?? "");
    if (!seatMatch) return reject("C6_TARGET_INVALID", true);
    const targetSeat = Number(seatMatch[1]) as Seat;
    if (command.mode !== "kill" && command.mode !== "dodge")
      return reject("C6_FAMILY_INVALID", true);
    if (
      this.#state.players.find((item) => item.seat === actor.seat)?.markers[
        c6UseMarker
      ] === turnKey(this.#state)
    )
      return reject("BOSS_USE_ILLEGAL", true);
    if (
      !legalC6BombardmentUses(this.#state, this.ruleset, actor.seat).some(
        (item) =>
          item.cardRef === command.cardRef &&
          item.legalTargetRefs.includes(command.targetRef),
      )
    )
      return reject("C6_USE_ILLEGAL", true);
    let committed;
    try {
      committed = commitC6FocusedBombardment(this.#state, this.ruleset, {
        actorSeat: actor.seat,
        cardRef: command.cardRef,
        family: command.mode,
        targetSeat,
      });
    } catch (error) {
      return reject(
        error instanceof Error ? error.message : "C6_USE_FAILED",
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
}
