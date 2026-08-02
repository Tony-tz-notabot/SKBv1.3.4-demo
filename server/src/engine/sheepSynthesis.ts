import type { LoadedRuleset } from "../ruleset/types.js";
import { copyTemporaryCardToHandInTransaction } from "./generatedCards.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent } from "./types.js";
import { moveCardInTransaction } from "./zoneMovement.js";

function validateRule(ruleset: LoadedRuleset) {
  const document = ruleset.documents.get("nonboss-rules.json") as {
      effectFamilies: Array<{
        familyId: string;
        synthesis?: {
          inputsFromHand?: string[];
          window?: string;
          inputMoveKind?: string;
          inputsDestination?: string;
          outputTo?: string;
          generatedInstanceExitZone?: string;
        };
      }>;
    },
    synthesis = document.effectFamilies.find(
      (family) => family.familyId === "special.sp03",
    )?.synthesis;
  if (
    JSON.stringify(synthesis?.inputsFromHand) !==
      JSON.stringify(["special.sp01", "special.sp02"]) ||
    synthesis?.window !== "owner.phase.play" ||
    synthesis?.inputMoveKind !== "synthesizeConsume" ||
    synthesis?.inputsDestination !== "discardPile" ||
    synthesis?.outputTo !== "hand" ||
    synthesis?.generatedInstanceExitZone !== "outsideDeck"
  )
    throw new Error("SHEEP_SYNTHESIS_RULE_INVALID");
}

function playWindow(state: AuthoritativeGameState, seat: Seat) {
  return state.pendingWindows.find(
    (window) =>
      window.kind === "playPhaseAction" && window.prioritySeat === seat,
  );
}

export interface SheepSynthesisOffer {
  offerId: string;
  boyRefs: string[];
  girlRefs: string[];
  stateRevision: number;
}

export function buildSheepSynthesisOffers(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  seat: Seat,
): SheepSynthesisOffer[] {
  validateRule(ruleset);
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
  const hand = state.zones[`hand:${seat}`]!.orderedCardRefs,
    boyRefs = hand.filter(
      (ref) => state.cards[ref]!.templateId === "special.sp01",
    ),
    girlRefs = hand.filter(
      (ref) => state.cards[ref]!.templateId === "special.sp02",
    );
  return boyRefs.length && girlRefs.length
    ? [
        {
          offerId: `offer:synthesize:special.sp03:${seat}`,
          boyRefs,
          girlRefs,
          stateRevision: state.stateRevision,
        },
      ]
    : [];
}

export interface SheepSynthesisCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  boyRef: string;
  girlRef: string;
}
export type SheepSynthesisResult =
  | {
      accepted: true;
      commandId: string;
      previousRevision: number;
      stateRevision: number;
      events: DomainEvent[];
      productRef: string;
    }
  | {
      accepted: false;
      commandId: string;
      stateRevision: number;
      reasonCode: string;
      refreshRequired: boolean;
    };

export class SheepSynthesisSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, SheepSynthesisResult>();
  constructor(
    state: AuthoritativeGameState,
    private readonly ruleset: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(command: SheepSynthesisCommand): SheepSynthesisResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (reasonCode: string, refreshRequired: boolean) => {
      const result: SheepSynthesisResult = {
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
    const offer = buildSheepSynthesisOffers(
      this.#state,
      this.ruleset,
      actor.seat,
    ).find((candidate) => candidate.offerId === command.offerId);
    if (!offer) return reject("OFFER_EXPIRED", true);
    if (
      !offer.boyRefs.includes(command.boyRef) ||
      !offer.girlRefs.includes(command.girlRef) ||
      command.boyRef === command.girlRef
    )
      return reject("MATERIAL_NO_LONGER_LEGAL", true);
    const tx = new EngineTransaction(this.#state);
    for (const cardRef of [command.boyRef, command.girlRef])
      moveCardInTransaction(tx, {
        cardRef,
        toZoneRef: "discardPile",
        moveKind: "synthesizeConsume",
        faceUp: true,
      });
    const productRef = copyTemporaryCardToHandInTransaction(tx, {
      templateId: "special.sp03",
      ownerSeat: actor.seat,
      sourceRef: command.boyRef,
      generatedBy: "synthesis.special.sp03",
      exitZoneRef: "outsideDeck",
    });
    tx.emit("card.synthesized", {
      seat: actor.seat,
      familyId: "special.sp03",
      materialRefs: [command.boyRef, command.girlRef],
      productRef,
    });
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    this.#state = committed.state;
    const result: SheepSynthesisResult = {
      accepted: true,
      commandId: command.commandId,
      previousRevision: committed.previousRevision,
      stateRevision: committed.state.stateRevision,
      events: committed.events,
      productRef,
    };
    this.#results.set(command.commandId, result);
    return structuredClone(result);
  }
}
