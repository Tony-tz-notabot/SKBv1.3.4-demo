import type { LoadedRuleset } from "../ruleset/types.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent, JsonValue, TransactionCommit } from "./types.js";
import { moveCardInTransaction } from "./zoneMovement.js";
import { activateImmediateBossIfNeeded } from "./bossLifecycle.js";
import { openValkyrieResponseInTransaction } from "./valkyrie.js";

type RecordValue = Record<string, JsonValue>;
interface BossFamily {
  familyId: string;
  bossType: string;
  modes?: Array<{ modeId: string; occupiesBossSlot: boolean }>;
}
interface BossDocument {
  effectFamilies: BossFamily[];
}
const record = (value: unknown): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
const turnKey = (state: AuthoritativeGameState) =>
  `${state.round}:${state.activeSeat}`;
const useMarker = "boss.lastUsedGlobalTurn";
function family(ruleset: LoadedRuleset, templateId: string): BossFamily {
  const document = ruleset.documents.get("boss-rules.json") as
      BossDocument | undefined,
    item = document?.effectFamilies.find(
      (entry) => entry.familyId === templateId,
    );
  if (!item) throw new Error("BOSS_DEFINITION_MISSING");
  return item;
}
function occupiesSlot(definition: BossFamily, modeId: string | null): boolean {
  if (definition.bossType === "persistent") return true;
  if (definition.bossType === "instant") return false;
  if (definition.bossType === "hybrid") {
    const mode = definition.modes?.find((item) => item.modeId === modeId);
    if (!mode) throw new Error("BOSS_MODE_REQUIRED");
    return mode.occupiesBossSlot;
  }
  throw new Error("BOSS_TYPE_UNSUPPORTED");
}
function assertBase(
  state: AuthoritativeGameState,
  actorSeat: Seat,
  cardRef: string,
): void {
  if (
    state.lifecycle !== "inProgress" ||
    state.phase !== "play" ||
    state.phaseBoundary !== "body" ||
    state.activeSeat !== actorSeat
  )
    throw new Error("BOSS_USE_WRONG_WINDOW");
  if (
    state.pendingWindows.some((window) => window.kind !== "playPhaseAction") ||
    state.resolutionStack.length ||
    state.combat.attack
  )
    throw new Error("BOSS_USE_NOT_STABLE");
  const player = state.players.find((item) => item.seat === actorSeat),
    card = state.cards[cardRef];
  if (
    !player ||
    player.lifeState === "eliminated" ||
    player.presence !== "inPlay"
  )
    throw new Error("BOSS_USE_ACTOR_INVALID");
  if (
    !card ||
    card.zoneRef !== `hand:${actorSeat}` ||
    !card.templateId.startsWith("boss.")
  )
    throw new Error("BOSS_CARD_NOT_IN_HAND");
  if (player.markers[useMarker] === turnKey(state))
    throw new Error("BOSS_USE_LIMIT_REACHED");
}
function replaceableOccupant(
  state: AuthoritativeGameState,
  actorSeat: Seat,
): string | null {
  const ref = state.zones[`boss:${actorSeat}`]!.orderedCardRefs[0];
  if (!ref) return null;
  const card = state.cards[ref]!,
    player = state.players.find((item) => item.seat === actorSeat)!;
  if (
    card.templateId !== "boss.iron_pirate_king" ||
    player.lifeState === "deadNotEliminated"
  )
    throw new Error("BOSS_SLOT_OCCUPIED");
  return ref;
}
export interface BossUseInput {
  actorSeat: Seat;
  cardRef: string;
  modeId?: string | null;
}
export function commitStandardPersistentBossUse(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  input: BossUseInput,
): TransactionCommit<AuthoritativeGameState> {
  assertBase(state, input.actorSeat, input.cardRef);
  const card = state.cards[input.cardRef]!,
    definition = family(ruleset, card.templateId),
    modeId = input.modeId ?? null;
  if (!occupiesSlot(definition, modeId) || definition.bossType === "hybrid")
    throw new Error("BOSS_REQUIRES_SPECIALIZED_USE_FLOW");
  const oldRef = replaceableOccupant(state, input.actorSeat),
    tx = new EngineTransaction(state),
    key = turnKey(state),
    playDeadlineAt =
      state.pendingWindows.find(
        (window) =>
          window.kind === "playPhaseAction" &&
          window.prioritySeat === input.actorSeat,
      )?.deadlineAt ?? 0;
  tx.emit("boss.use.declared", {
    seat: input.actorSeat,
    cardRef: input.cardRef,
    bossId: card.templateId,
    modeId,
  });
  if (oldRef)
    moveCardInTransaction(tx, {
      cardRef: oldRef,
      toZoneRef: "discardPile",
      moveKind: "replace",
    });
  moveCardInTransaction(tx, {
    cardRef: input.cardRef,
    toZoneRef: `boss:${input.actorSeat}`,
    moveKind: "use",
    faceUp: true,
  });
  const draftCard = tx.draft.cards[input.cardRef]!,
    player = tx.draft.players.find((item) => item.seat === input.actorSeat)!;
  player.markers[useMarker] = key;
  draftCard.runtime.usedAtRound = tx.draft.round;
  draftCard.runtime.usedAtActiveSeat = tx.draft.activeSeat;
  draftCard.runtime.ownerTurnOrdinal = 0;
  draftCard.runtime.activationStatus = "pending";
  draftCard.runtime.active = false;
  tx.emit("boss.use.committed", {
    seat: input.actorSeat,
    cardRef: input.cardRef,
    bossId: card.templateId,
    replacedCardRef: oldRef,
    globalTurnKey: key,
  });
  const awaitingValkyrie = openValkyrieResponseInTransaction(tx, {
    originalBossRef: input.cardRef,
    originalControllerSeat: input.actorSeat,
    continuationKind: "standardPersistent",
    deadlineAt: playDeadlineAt,
  });
  if (!awaitingValkyrie)
    activateImmediateBossIfNeeded(tx, ruleset, input.cardRef);
  const committed = tx.commit();
  committed.state.history.domainEvents.push(...committed.events);
  validateAuthoritativeState(committed.state);
  return committed;
}
export function legalStandardPersistentBossCards(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  actorSeat: Seat,
): string[] {
  try {
    if (
      state.players.find((item) => item.seat === actorSeat)?.markers[
        useMarker
      ] === turnKey(state)
    )
      return [];
    return state.zones[`hand:${actorSeat}`]!.orderedCardRefs.filter((ref) => {
      try {
        const definition = family(ruleset, state.cards[ref]!.templateId);
        return (
          definition.bossType === "persistent" &&
          (state.zones[`boss:${actorSeat}`]!.orderedCardRefs.length === 0 ||
            (state.cards[state.zones[`boss:${actorSeat}`]!.orderedCardRefs[0]!]!
              .templateId === "boss.iron_pirate_king" &&
              state.players.find((item) => item.seat === actorSeat)!
                .lifeState !== "deadNotEliminated"))
        );
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}
export interface BossUseCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  cardRef: string;
}
export type BossUseCommandResult =
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
export class BossUseCommandSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, BossUseCommandResult>();
  constructor(
    state: AuthoritativeGameState,
    private readonly ruleset: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(command: BossUseCommand): BossUseCommandResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (
      reasonCode: string,
      refreshRequired: boolean,
    ): BossUseCommandResult => {
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
      window = this.#state.pendingWindows.find(
        (item) =>
          item.kind === "playPhaseAction" && item.prioritySeat === actor?.seat,
      );
    if (!actor) return reject("NOT_YOUR_PRIORITY", false);
    if (!window || window.promptId !== command.promptId)
      return reject("PROMPT_CLOSED", true);
    if (
      !legalStandardPersistentBossCards(
        this.#state,
        this.ruleset,
        actor.seat,
      ).includes(command.cardRef)
    )
      return reject("BOSS_USE_ILLEGAL", true);
    let committed;
    try {
      committed = commitStandardPersistentBossUse(this.#state, this.ruleset, {
        actorSeat: actor.seat,
        cardRef: command.cardRef,
      });
    } catch (error) {
      return reject(
        error instanceof Error ? error.message : "BOSS_USE_FAILED",
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
