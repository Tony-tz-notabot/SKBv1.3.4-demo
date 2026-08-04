import { continueGoldenMaskAfterJudgmentInTransaction } from "./goldenMask.js";
import { continueInternetArmorJudgmentInTransaction } from "./internetAddiction.js";
import { continueSheepArmorJudgmentInTransaction } from "./sheep.js";
import { finalizeJudgmentInTransaction, replaceJudgmentCardInTransaction } from "./judgment.js";
import type {
  AuthoritativeGameState,
  PendingWindowState,
  Seat,
} from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent } from "./types.js";
import type { LoadedRuleset } from "../ruleset/types.js";

export interface JudgmentInterventionCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  cardRefs?: string[];
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
const activeWindow = (state: AuthoritativeGameState) =>
  state.pendingWindows.find((item) => item.kind === "judgmentIntervention");

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
    if (!window.legalOfferIds.includes(command.offerId))
      return reject("OFFER_EXPIRED", true);
    if (command.offerId.includes(":replace:")) {
      if (!this.ruleset) throw new Error("JUDGMENT_INTERVENTION_RULESET_REQUIRED");
      if (window.context?.replaced === true)
        return reject("OFFER_EXPIRED", true);
      if (command.cardRefs?.length !== 2)
        return reject("JUDGMENT_REPLACE_COST_INVALID", false);
      const tx = new EngineTransaction(this.#state),
        draft = tx.draft,
        draftWindow = draft.pendingWindows.find(
          (item) => item.promptId === window.promptId,
        )!;
      draft.pendingWindows = draft.pendingWindows.filter(
        (item) => item.promptId !== window.promptId,
      );
      tx.emit("response.window.closed", {
        kind: "judgmentIntervention",
        judgmentId: String(draftWindow.context?.judgmentId),
        reason: "replace",
      });
      replaceJudgmentCardInTransaction(
        tx,
        this.ruleset,
        command.cardRefs,
        window.deadlineAt,
      );
      const committed = tx.commit();
      committed.state.history.domainEvents.push(...committed.events);
      validateAuthoritativeState(committed.state);
      this.#state = committed.state;
      const replaced = {
        accepted: true as const,
        commandId: command.commandId,
        previousRevision: committed.previousRevision,
        stateRevision: committed.state.stateRevision,
        events: committed.events,
      };
      this.#results.set(command.commandId, replaced);
      return structuredClone(replaced);
    }
    if (!command.offerId.includes(":pass:"))
      return reject("OFFER_EXPIRED", true);
    if (command.cardRefs?.length) return reject("JUDGMENT_REPLACE_COST_INVALID", false);
    const tx = new EngineTransaction(this.#state),
      draft = tx.draft,
      draftWindow = draft.pendingWindows.find(
        (item) => item.promptId === window.promptId,
      )!,
      judgmentId = String(draftWindow.context?.judgmentId),
      seat = draftWindow.prioritySeat;
    draft.pendingWindows = draft.pendingWindows.filter(
      (item) => item.promptId !== window.promptId,
    );
    tx.emit("response.passed", {
      kind: "judgmentIntervention",
      judgmentId,
      seat,
    });
    tx.emit("response.window.closed", {
      kind: "judgmentIntervention",
      judgmentId,
      reason: "pass",
    });
    const frame = draft.resolutionStack.at(-1);
    if (!frame || frame.frameType !== "judgment")
      throw new Error("JUDGMENT_FRAME_MISSING");
    const context = frame.context;
    finalizeJudgmentInTransaction(tx, context);
    const finalColor =
      typeof context.finalColor === "string"
        ? context.finalColor
        : typeof context.printedColor === "string"
          ? context.printedColor
          : null;
    if (context?.goldenMaskReplacement === true) {
      if (!this.ruleset) throw new Error("GOLDEN_MASK_RULESET_REQUIRED");
      continueGoldenMaskAfterJudgmentInTransaction(
        tx,
        this.ruleset,
        context,
        finalColor as import("./judgment.js").PrintedColor | null,
      );
    }
    if (context?.specialInternetArmorJudgment === true) {
      if (!this.ruleset) throw new Error("INTERNET_ADDICTION_RULESET_REQUIRED");
      const colors = Array.isArray(context.matchColors)
          ? context.matchColors
          : [],
        matched = finalColor !== null && colors.includes(finalColor);
      continueInternetArmorJudgmentInTransaction(
        tx,
        this.ruleset,
        context,
        matched,
        Number(context.interventionDeadlineAt ?? 0),
      );
    }
    if (context?.specialSheepArmorJudgment === true) {
      if (!this.ruleset) throw new Error("SHEEP_RULESET_REQUIRED");
      const colors = Array.isArray(context.matchColors)
          ? context.matchColors
          : [],
        matched = finalColor !== null && colors.includes(finalColor);
      continueSheepArmorJudgmentInTransaction(
        tx,
        this.ruleset,
        context,
        matched,
        Number(context.interventionDeadlineAt ?? 0),
      );
    }
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
