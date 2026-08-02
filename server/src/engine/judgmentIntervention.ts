import { finalizeJudgment } from "./judgment.js";
import type {
  AuthoritativeGameState,
  PendingWindowState,
  Seat,
} from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent } from "./types.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { continueGoldenMaskAfterJudgment } from "./goldenMask.js";
import { continueInternetArmorJudgment } from "./internetAddiction.js";
import { continueSheepArmorJudgment } from "./sheep.js";

export interface JudgmentInterventionCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
}
export type JudgmentInterventionResult =
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
const nextSeat = (seat: Seat) => (seat === 4 ? 1 : seat + 1) as Seat;
const activeWindow = (state: AuthoritativeGameState) =>
  state.pendingWindows.find((item) => item.kind === "judgmentIntervention");

function passPriority(
  state: AuthoritativeGameState,
  window: PendingWindowState,
): {
  state: AuthoritativeGameState;
  previousRevision: number;
  events: DomainEvent[];
  allPassed: boolean;
} {
  const tx = new EngineTransaction(state),
    draft = tx.draft,
    draftWindow = draft.pendingWindows.find(
      (item) => item.promptId === window.promptId,
    )!,
    passed = Array.isArray(draftWindow.context?.passedSeats)
      ? draftWindow.context.passedSeats.filter(
          (value): value is number => typeof value === "number",
        )
      : [],
    judgmentId = String(draftWindow.context?.judgmentId),
    seat = draftWindow.prioritySeat;
  passed.push(seat);
  tx.emit("response.passed", {
    kind: "judgmentIntervention",
    judgmentId,
    seat,
  });
  if (passed.length === 4) {
    draft.pendingWindows = draft.pendingWindows.filter(
      (item) => item.promptId !== window.promptId,
    );
    tx.emit("response.window.closed", {
      kind: "judgmentIntervention",
      judgmentId,
      reason: "allPassed",
    });
  } else {
    const prioritySeat = nextSeat(seat);
    draftWindow.prioritySeat = prioritySeat;
    draftWindow.context = {
      ...(draftWindow.context ?? {}),
      passedSeats: passed,
    };
    tx.emit("response.priority.granted", {
      kind: "judgmentIntervention",
      judgmentId,
      seat: prioritySeat,
    });
  }
  const committed = tx.commit();
  committed.state.history.domainEvents.push(...committed.events);
  validateAuthoritativeState(committed.state);
  return { ...committed, allPassed: passed.length === 4 };
}

export class JudgmentInterventionSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, JudgmentInterventionResult>();
  constructor(
    state: AuthoritativeGameState,
    private readonly ruleset?: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(command: JudgmentInterventionCommand): JudgmentInterventionResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (
      reasonCode: string,
      refreshRequired: boolean,
    ): JudgmentInterventionResult => {
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
    const window = activeWindow(this.#state);
    if (!window || window.promptId !== command.promptId)
      return reject("PROMPT_CLOSED", true);
    const player = this.#state.players.find(
      (item) => item.userId === command.actorUserId,
    );
    if (!player || player.seat !== window.prioritySeat)
      return reject("NOT_YOUR_PRIORITY", false);
    if (
      !window.legalOfferIds.includes(command.offerId) ||
      !command.offerId.includes(":pass:")
    )
      return reject("OFFER_EXPIRED", true);
    const passed = passPriority(this.#state, window),
      events = [...passed.events],
      previousRevision = passed.previousRevision;
    this.#state = passed.state;
    if (passed.allPassed) {
      const frame = this.#state.resolutionStack.at(-1),
        context = frame?.context,
        finalColor =
          typeof context?.finalColor === "string"
            ? context.finalColor
            : typeof context?.printedColor === "string"
              ? context.printedColor
              : null,
        finalized = finalizeJudgment(this.#state);
      this.#state = finalized.state;
      events.push(...finalized.events);
      if (context?.goldenMaskReplacement === true) {
        if (!this.ruleset) throw new Error("GOLDEN_MASK_RULESET_REQUIRED");
        const continued = continueGoldenMaskAfterJudgment(
          this.#state,
          this.ruleset,
          context,
          finalColor as import("./judgment.js").PrintedColor | null,
        );
        this.#state = continued.state;
        events.push(...continued.events);
      }
      if (context?.specialInternetArmorJudgment === true) {
        if (!this.ruleset)
          throw new Error("INTERNET_ADDICTION_RULESET_REQUIRED");
        const colors = Array.isArray(context.matchColors)
            ? context.matchColors
            : [],
          matched = finalColor !== null && colors.includes(finalColor),
          continued = continueInternetArmorJudgment(
            this.#state,
            this.ruleset,
            context,
            matched,
            Number(context.interventionDeadlineAt ?? 0),
          );
        this.#state = continued.state;
        events.push(...continued.events);
      }
      if (context?.specialSheepArmorJudgment === true) {
        if (!this.ruleset) throw new Error("SHEEP_RULESET_REQUIRED");
        const colors = Array.isArray(context.matchColors)
            ? context.matchColors
            : [],
          matched = finalColor !== null && colors.includes(finalColor),
          continued = continueSheepArmorJudgment(
            this.#state,
            this.ruleset,
            context,
            matched,
            Number(context.interventionDeadlineAt ?? 0),
          );
        this.#state = continued.state;
        events.push(...continued.events);
      }
    }
    const result = {
      accepted: true as const,
      commandId: command.commandId,
      previousRevision,
      stateRevision: this.#state.stateRevision,
      events,
    };
    this.#results.set(command.commandId, result);
    return structuredClone(result);
  }
  handleTimeout(commandId: string): JudgmentInterventionResult {
    const window = activeWindow(this.#state);
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
        (item) => item.seat === window.prioritySeat,
      )!.userId,
      promptId: window.promptId,
      offerId: window.legalOfferIds[0]!,
    });
  }
}
