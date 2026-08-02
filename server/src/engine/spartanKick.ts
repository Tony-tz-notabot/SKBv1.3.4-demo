import type { LoadedRuleset } from "../ruleset/types.js";
import { applyDirectDamageInTransaction } from "./damage.js";
import { addDrawCountModifierInTransaction } from "./drawCount.js";
import {
  handCards,
  handZoneRef,
  type AuthoritativeGameState,
  type Seat,
} from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent } from "./types.js";

interface CharacterRule {
  ruleId: string;
  effects: Array<{ op: string; params?: Record<string, unknown> }>;
}
interface CharacterDocument {
  rules: CharacterRule[];
}
function drawDelta(ruleset: LoadedRuleset): number {
  const document = ruleset.documents.get(
      "character-rules.json",
    ) as CharacterDocument,
    rule = document.rules.find(
      (item) => item.ruleId === "character.headtaker.kick",
    ),
    branch = rule?.effects.find((effect) => effect.op === "applyRestriction")
      ?.params?.branch;
  if (branch !== "shieldBroken?selfDrawMinus1:targetDrawMinus1")
    throw new Error("SPARTAN_KICK_RULE_INVALID");
  return -1;
}

export function canUseSpartanKick(
  state: AuthoritativeGameState,
  seat: Seat,
): boolean {
  const player = state.players.find((item) => item.seat === seat);
  return Boolean(
    player?.characterId === "character.headtaker" &&
    player.skillIds.includes("skill.headtaker.spartan_kick") &&
    player.lifeState !== "eliminated" &&
    player.presence === "inPlay" &&
    state.activeSeat === seat &&
    state.phase === "discard" &&
    state.phaseBoundary === "body" &&
    handCards(state, seat).length > 0,
  );
}

function resolveInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  input: { actorSeat: Seat; targetSeat: Seat; cardRefs: string[] },
): void {
  if (!canUseSpartanKick(tx.draft, input.actorSeat))
    throw new Error("SPARTAN_KICK_UNAVAILABLE");
  const allHand = handCards(tx.draft, input.actorSeat),
    target = tx.draft.players.find((item) => item.seat === input.targetSeat);
  if (
    input.cardRefs.length !== allHand.length ||
    new Set(input.cardRefs).size !== allHand.length ||
    input.cardRefs.some((ref) => !allHand.includes(ref))
  )
    throw new Error("INVALID_SELECTION");
  if (
    !target ||
    target.lifeState === "eliminated" ||
    target.presence !== "inPlay"
  )
    throw new Error("TARGET_NO_LONGER_LEGAL");
  const amount = allHand.length,
    shieldBefore = target.shield;
  for (const cardRef of input.cardRefs) {
    const hand = tx.draft.zones[handZoneRef(input.actorSeat)]!,
      card = tx.draft.cards[cardRef]!;
    hand.orderedCardRefs.splice(hand.orderedCardRefs.indexOf(cardRef), 1);
    tx.draft.zones.discardPile!.orderedCardRefs.push(cardRef);
    card.zoneRef = "discardPile";
    card.ownerSeat = null;
    card.controllerSeat = null;
    card.faceUp = true;
    tx.emit("cost.paid", {
      seat: input.actorSeat,
      costId: "skill.headtaker.spartan_kick.allHand",
      kind: "cards",
      cardRef,
      moveKind: "discard",
    });
  }
  const result = applyDirectDamageInTransaction(tx, {
      damageId: `damage:spartan-kick:${tx.draft.stateRevision + 1}:${input.actorSeat}`,
      sourceSeat: input.actorSeat,
      targetRef: `character:${input.targetSeat}`,
      amount,
      damageType: "shield",
      element: "none",
      isAdditional: false,
      ruleset,
    }),
    brokeShield =
      shieldBefore !== null && shieldBefore > 0 && target.shield === 0,
    affectedSeat = brokeShield ? input.actorSeat : input.targetSeat;
  addDrawCountModifierInTransaction(tx, {
    seat: affectedSeat,
    modifierId: `spartanKick:${tx.draft.stateRevision + 1}:${input.actorSeat}:${input.targetSeat}`,
    sourceRef: `character:${input.actorSeat}`,
    delta: drawDelta(ruleset),
    remainingAffectedDraws: 1,
  });
  tx.emit("ability.resolved", {
    abilityId: "skill.headtaker.spartan_kick",
    actorSeat: input.actorSeat,
    targetSeat: input.targetSeat,
    discardedCount: amount,
    actualShieldLoss: result.actualShieldLoss,
    brokeShield,
    drawPenaltySeat: affectedSeat,
  });
}

export interface SpartanKickCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  cardRefs: string[];
  targetRef: string;
}
export type SpartanKickResult =
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
export class SpartanKickSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, SpartanKickResult>();
  constructor(
    state: AuthoritativeGameState,
    private readonly ruleset: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(command: SpartanKickCommand): SpartanKickResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (reasonCode: string, refreshRequired: boolean) => {
      const result: SpartanKickResult = {
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
      window = this.#state.pendingWindows.find(
        (item) => item.kind === "discardPhaseAction",
      );
    if (!actor || !window || actor.seat !== window.prioritySeat)
      return reject("NOT_YOUR_PRIORITY", false);
    if (window.promptId !== command.promptId)
      return reject("PROMPT_CLOSED", true);
    if (
      command.offerId !== "offer:skill.headtaker.spartan_kick" ||
      !window.legalOfferIds.includes(command.offerId)
    )
      return reject("OFFER_EXPIRED", true);
    const match = /^character:([1-4])$/.exec(command.targetRef);
    if (!match) return reject("TARGET_NO_LONGER_LEGAL", false);
    const tx = new EngineTransaction(this.#state);
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (item) => item.promptId !== window.promptId,
    );
    try {
      resolveInTransaction(tx, this.ruleset, {
        actorSeat: actor.seat,
        targetSeat: Number(match[1]) as Seat,
        cardRefs: command.cardRefs,
      });
    } catch (error) {
      if (error instanceof Error)
        return reject(
          error.message,
          error.message === "TARGET_NO_LONGER_LEGAL",
        );
      throw error;
    }
    tx.draft.phaseBodyResolved = true;
    tx.emit("choice.resolved", {
      seat: actor.seat,
      kind: "discardPhaseAction",
      result: "spartanKick",
    });
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    this.#state = committed.state;
    const result: SpartanKickResult = {
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
