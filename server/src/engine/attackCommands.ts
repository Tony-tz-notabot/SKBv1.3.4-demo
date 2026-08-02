import { buildAttackOffer, commitAttack, type AttackOffer } from "./attack.js";
import {
  runCombatUntilBlocked,
  type CombatStopReason,
} from "./combatScheduler.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import type { DomainEvent } from "./types.js";

export interface AttackCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  targetRefs: string[];
  killCardRefs: string[];
  resourceCardRefs?: string[];
}
export type AttackCommandResult =
  | {
      accepted: true;
      commandId: string;
      previousRevision: number;
      stateRevision: number;
      firstEventSeq: number | null;
      events: DomainEvent[];
      stoppedReason: CombatStopReason;
    }
  | {
      accepted: false;
      commandId: string;
      stateRevision: number;
      reasonCode: string;
      refreshRequired: boolean;
    };
const seatForUser = (
  state: AuthoritativeGameState,
  userId: string,
): Seat | null =>
  state.players.find((player) => player.userId === userId)?.seat ?? null;
export class AttackCommandSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, AttackCommandResult>();
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
  offerFor(userId: string): AttackOffer | null {
    const seat = seatForUser(this.#state, userId),
      window = this.#state.pendingWindows.find(
        (item) => item.kind === "playPhaseAction" && item.prioritySeat === seat,
      );
    if (!seat || !window) return null;
    try {
      return buildAttackOffer(
        this.#state,
        seat,
        this.ruleset,
        `offer:attack:${window.promptId}`,
      );
    } catch {
      return null;
    }
  }
  handle(command: AttackCommand): AttackCommandResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (
      reasonCode: string,
      refreshRequired: boolean,
    ): AttackCommandResult => {
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
    const seat = seatForUser(this.#state, command.actorUserId),
      window = this.#state.pendingWindows.find(
        (item) => item.kind === "playPhaseAction" && item.prioritySeat === seat,
      );
    if (!seat) return reject("NOT_YOUR_PRIORITY", false);
    if (!window || window.promptId !== command.promptId)
      return reject("PROMPT_CLOSED", true);
    const offer = this.offerFor(command.actorUserId);
    if (!offer || offer.offerId !== command.offerId)
      return reject("OFFER_EXPIRED", true);
    let committed;
    try {
      committed = commitAttack(this.#state, this.ruleset, {
        attackerSeat: seat,
        targetRefs: command.targetRefs,
        killCardRefs: command.killCardRefs,
        ...(command.resourceCardRefs ? { resourceCardRefs: command.resourceCardRefs } : {}),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        [
          "SELECTION_COUNT_INVALID",
          "TARGET_NO_LONGER_LEGAL",
          "ATTACK_KILL_COST_INVALID",
          "ATTACK_RESOURCE_COST_INVALID",
          "ATTACK_COUNT_UNPAYABLE",
        ].includes(error.message)
      )
        return reject(error.message, false);
      throw error;
    }
    const scheduled = runCombatUntilBlocked(
      committed.state,
      this.ruleset,
      this.nextDeadlineAt,
    );
    this.#state = scheduled.state;
    const events = [...committed.events, ...scheduled.events],
      result = {
        accepted: true as const,
        commandId: command.commandId,
        previousRevision: committed.previousRevision,
        stateRevision: this.#state.stateRevision,
        firstEventSeq: events[0]?.eventSeq ?? null,
        events,
        stoppedReason: scheduled.stoppedReason,
      };
    this.#results.set(command.commandId, result);
    return structuredClone(result);
  }
}
