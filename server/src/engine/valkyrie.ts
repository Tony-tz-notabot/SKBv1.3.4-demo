import type { LoadedRuleset } from "../ruleset/types.js";
import { activateImmediateBossIfNeeded } from "./bossLifecycle.js";
import { copyTemporaryCardToHandInTransaction } from "./generatedCards.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent, JsonValue } from "./types.js";
import { moveCardInTransaction } from "./zoneMovement.js";

type StackEntry = { seat: Seat; valkyrieRef: string };
type Context = {
  originalBossRef: string;
  originalTemplateId: string;
  originalControllerSeat: Seat;
  queue: Seat[];
  stack: StackEntry[];
  resumePlayDeadlineAt: number;
  continuationKind:
    "standardPersistent" | "c6LaserSweep" | "c6FocusedBombardment";
  continuationData?: Record<string, JsonValue>;
};
const turnKey = (state: AuthoritativeGameState) =>
  `${state.round}:${state.activeSeat}`;
const marker = "boss.lastUsedGlobalTurn";
const valkyries = (state: AuthoritativeGameState, seat: Seat) =>
  state.zones[`hand:${seat}`]!.orderedCardRefs.filter(
    (ref) => state.cards[ref]!.templateId === "boss.valkyrie",
  );
const eligible = (state: AuthoritativeGameState, originalSeat: Seat): Seat[] =>
  state.players
    .filter(
      (player) =>
        player.seat !== originalSeat &&
        player.presence === "inPlay" &&
        player.lifeState !== "eliminated" &&
        player.markers[marker] !== turnKey(state) &&
        valkyries(state, player.seat).length > 0,
    )
    .sort(
      (left, right) =>
        ((left.seat - originalSeat + 4) % 4) -
        ((right.seat - originalSeat + 4) % 4),
    )
    .map((player) => player.seat);

function openWindow(
  tx: EngineTransaction<AuthoritativeGameState>,
  context: Context,
): void {
  const seat = context.queue[0];
  if (!seat) return;
  const cards = valkyries(tx.draft, seat),
    promptId = `prompt:valkyrie:${context.originalBossRef}:${seat}:${context.queue.length}`;
  tx.draft.pendingWindows.push({
    promptId,
    kind: "valkyrieBossResponse",
    prioritySeat: seat,
    mandatory: false,
    deadlineAt: context.resumePlayDeadlineAt,
    timeoutPolicy: "pass",
    legalOfferIds: [
      `offer:valkyrie:pass:${seat}`,
      ...cards.map((ref) => `offer:valkyrie:use:${ref}`),
    ],
    context: { ...context, legalCardRefs: cards },
  });
  tx.emit("response.window.opened", {
    kind: "valkyrieBossResponse",
    promptId,
    prioritySeat: seat,
    originalBossRef: context.originalBossRef,
  });
}

export function openValkyrieResponseInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  input: {
    originalBossRef: string;
    originalControllerSeat: Seat;
    continuationKind: Context["continuationKind"];
    continuationData?: Record<string, JsonValue>;
    deadlineAt: number;
  },
): boolean {
  const card = tx.draft.cards[input.originalBossRef];
  if (!card || card.templateId === "boss.valkyrie") return false;
  const queue = eligible(tx.draft, input.originalControllerSeat);
  if (!queue.length) return false;
  const play = tx.draft.pendingWindows.find(
    (window) =>
      window.kind === "playPhaseAction" &&
      window.prioritySeat === input.originalControllerSeat,
  );
  tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
    (window) => window.promptId !== play?.promptId,
  );
  card.runtime.pendingValkyrieResponses = true;
  openWindow(tx, {
    originalBossRef: input.originalBossRef,
    originalTemplateId: card.templateId,
    originalControllerSeat: input.originalControllerSeat,
    queue,
    stack: [],
    resumePlayDeadlineAt: play?.deadlineAt ?? input.deadlineAt,
    continuationKind: input.continuationKind,
    ...(input.continuationData
      ? { continuationData: structuredClone(input.continuationData) }
      : {}),
  });
  return true;
}

function finish(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  context: Context,
): void {
  for (const entry of [...context.stack].reverse()) {
    const copyRef = copyTemporaryCardToHandInTransaction(tx, {
      templateId: context.originalTemplateId,
      ownerSeat: entry.seat,
      sourceRef: context.originalBossRef,
      generatedBy: "boss.valkyrie",
    });
    moveCardInTransaction(tx, {
      cardRef: entry.valkyrieRef,
      toZoneRef: "discardPile",
      moveKind: "use",
      faceUp: true,
    });
    tx.emit("boss.valkyrie.resolved", {
      seat: entry.seat,
      valkyrieRef: entry.valkyrieRef,
      originalBossRef: context.originalBossRef,
      copiedTemplateId: context.originalTemplateId,
      copyRef,
    });
  }
  const original = tx.draft.cards[context.originalBossRef];
  if (original) delete original.runtime.pendingValkyrieResponses;
  if (context.continuationKind === "standardPersistent" && original)
    activateImmediateBossIfNeeded(tx, ruleset, context.originalBossRef);
  if (
    context.continuationKind !== "standardPersistent" &&
    tx.draft.lifecycle === "inProgress"
  ) {
    tx.draft.scheduledEffects.push({
      scheduledId: `scheduled:boss-after-valkyrie:${context.originalBossRef}`,
      sourceRef: context.originalBossRef,
      controllerSeat: context.originalControllerSeat,
      executeAt: "immediate.damagePipeline",
      effect: {
        op: "continueBossAfterValkyrie",
        continuationKind: context.continuationKind,
        continuationData: context.continuationData ?? {},
      },
      cancelled: false,
    });
    return;
  }
  if (tx.draft.lifecycle === "inProgress") {
    const seat = context.originalControllerSeat;
    tx.draft.pendingWindows.push({
      promptId: `prompt:playPhaseAction:${tx.draft.round}:${seat}:${tx.draft.stateRevision + 1}`,
      kind: "playPhaseAction",
      prioritySeat: seat,
      mandatory: false,
      deadlineAt: context.resumePlayDeadlineAt,
      timeoutPolicy: "pass",
      legalOfferIds: ["offer:playPhaseAction:finish"],
      context: {},
    });
    tx.emit("choice.requested", {
      seat,
      kind: "playPhaseAction",
      resumedAfterValkyrie: true,
    });
  }
}

export interface ValkyrieCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  cardRef?: string;
}
export type ValkyrieResult =
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

export class ValkyrieResponseSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, ValkyrieResult>();
  constructor(
    state: AuthoritativeGameState,
    private readonly ruleset: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(command: ValkyrieCommand): ValkyrieResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (
      reasonCode: string,
      refreshRequired: boolean,
    ): ValkyrieResult => {
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
      (item) => item.kind === "valkyrieBossResponse",
    );
    if (!window || window.promptId !== command.promptId)
      return reject("PROMPT_CLOSED", true);
    const actor = this.#state.players.find(
      (item) => item.userId === command.actorUserId,
    );
    if (!actor || actor.seat !== window.prioritySeat)
      return reject("NOT_YOUR_PRIORITY", false);
    if (!window.legalOfferIds.includes(command.offerId))
      return reject("OFFER_EXPIRED", true);
    const context = window.context as unknown as Context,
      use = command.offerId.includes(":use:");
    if (
      use &&
      (!command.cardRef ||
        !valkyries(this.#state, actor.seat).includes(command.cardRef) ||
        !command.offerId.endsWith(command.cardRef) ||
        actor.markers[marker] === turnKey(this.#state))
    )
      return reject("VALKYRIE_NO_LONGER_LEGAL", true);
    if (!use && command.cardRef) return reject("CARD_INVALID", false);
    const tx = new EngineTransaction(this.#state);
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (item) => item.promptId !== window.promptId,
    );
    const stack = [...context.stack];
    if (use) {
      moveCardInTransaction(tx, {
        cardRef: command.cardRef!,
        toZoneRef: "resolving",
        moveKind: "use",
        faceUp: true,
      });
      tx.draft.players.find((item) => item.seat === actor.seat)!.markers[
        marker
      ] = turnKey(tx.draft);
      stack.push({ seat: actor.seat, valkyrieRef: command.cardRef! });
      tx.emit("boss.valkyrie.committed", {
        seat: actor.seat,
        cardRef: command.cardRef!,
        originalBossRef: context.originalBossRef,
      });
    } else
      tx.emit("response.passed", {
        kind: "valkyrieBossResponse",
        seat: actor.seat,
        originalBossRef: context.originalBossRef,
      });
    const queue = context.queue.slice(1),
      next = { ...context, queue, stack };
    if (queue.length) openWindow(tx, next);
    else finish(tx, this.ruleset, next);
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
  handleTimeout(commandId: string) {
    const window = this.#state.pendingWindows.find(
      (item) => item.kind === "valkyrieBossResponse",
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
      (item) => item.seat === window.prioritySeat,
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
