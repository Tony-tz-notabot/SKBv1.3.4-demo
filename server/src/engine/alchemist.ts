import type { LoadedRuleset } from "../ruleset/types.js";
import { calculateEffectiveDistance } from "./distance.js";
import { createScriptedAttackInTransaction } from "./scriptedAttack.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent, JsonValue } from "./types.js";
import { moveCardInTransaction } from "./zoneMovement.js";

interface CardFact {
  cardId: string;
  color: string;
}
function definition(ruleset: LoadedRuleset) {
  const document = ruleset.documents.get("character-rules.json") as {
      rules: Array<{
        ruleId: string;
        effects?: Array<{ op?: string; params?: Record<string, unknown> }>;
      }>;
    },
    rule = document.rules.find(
      (candidate) => candidate.ruleId === "character.alchemist.toxicBottle",
    ),
    params = rule?.effects?.find(
      (effect) => effect.op === "createAttack",
    )?.params,
    damage = Array.isArray(params?.damage)
      ? (params.damage[0] as Record<string, unknown>)
      : null;
  if (
    params?.range !== 2 ||
    JSON.stringify(params.types) !== JSON.stringify(["field"]) ||
    params.targetCount !== 1 ||
    damage?.type !== "poison" ||
    damage.amount !== 1 ||
    damage.repeat !== 2 ||
    params.ignoreTalentModifiers !== true
  )
    throw new Error("ALCHEMIST_TOXIC_BOTTLE_RULE_INVALID");
  return { range: 2, amount: 1, repeat: 2 } as const;
}
const playWindow = (state: AuthoritativeGameState, seat: Seat) =>
  state.pendingWindows.find(
    (window) =>
      window.kind === "playPhaseAction" && window.prioritySeat === seat,
  );
function turnKey(state: AuthoritativeGameState) {
  const latest =
    [...state.history.domainEvents]
      .reverse()
      .find((event) => event.eventType === "turn.start")?.eventSeq ?? 0;
  return `${state.round}:${state.activeSeat}:${latest}`;
}
function greenCards(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  seat: Seat,
) {
  const facts = new Map(
    (ruleset.documents.get("cards.json") as { items: CardFact[] }).items.map(
      (fact) => [fact.cardId, fact],
    ),
  );
  return state.zones[`hand:${seat}`]!.orderedCardRefs.filter(
    (ref) => facts.get(state.cards[ref]!.templateId)?.color === "green",
  );
}
function targets(state: AuthoritativeGameState, seat: Seat, range: number) {
  return state.players
    .filter(
      (player) =>
        player.seat !== seat &&
        player.presence === "inPlay" &&
        player.lifeState !== "eliminated" &&
        calculateEffectiveDistance(state, seat, player.seat) <= range,
    )
    .map((player) => `character:${player.seat}`);
}

export interface ToxicReagentOffer {
  offerId: string;
  legalCardRefs: string[];
  legalTargetRefs: string[];
  stateRevision: number;
}
export function buildToxicReagentOffers(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  seat: Seat,
): ToxicReagentOffer[] {
  const values = definition(ruleset),
    player = state.players.find((candidate) => candidate.seat === seat),
    window = playWindow(state, seat),
    legalCardRefs = greenCards(state, ruleset, seat),
    legalTargetRefs = targets(state, seat, values.range);
  return player?.characterId === "character.alchemist" &&
    player.skillIds.includes("skill.alchemist.toxic_reagent") &&
    player.lifeState === "alive" &&
    player.presence === "inPlay" &&
    state.activeSeat === seat &&
    state.phase === "play" &&
    state.phaseBoundary === "body" &&
    window &&
    !state.combat.attack &&
    !state.resolutionStack.length &&
    player.markers.toxicReagentUsedTurnKey !== turnKey(state) &&
    legalCardRefs.length &&
    legalTargetRefs.length
    ? [
        {
          offerId: "offer:skill.alchemist.toxic_reagent",
          legalCardRefs,
          legalTargetRefs,
          stateRevision: state.stateRevision,
        },
      ]
    : [];
}
export interface ToxicReagentCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  cardRef: string;
  targetRef: string;
}
export type ToxicReagentResult =
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
export class ToxicReagentSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, ToxicReagentResult>();
  constructor(
    state: AuthoritativeGameState,
    private readonly ruleset: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(command: ToxicReagentCommand): ToxicReagentResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (reasonCode: string, refreshRequired: boolean) => {
      const result: ToxicReagentResult = {
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
    const offer = buildToxicReagentOffers(
      this.#state,
      this.ruleset,
      actor.seat,
    ).find((candidate) => candidate.offerId === command.offerId);
    if (!offer) return reject("OFFER_EXPIRED", true);
    if (!offer.legalCardRefs.includes(command.cardRef))
      return reject("COST_CARD_NO_LONGER_LEGAL", true);
    if (!offer.legalTargetRefs.includes(command.targetRef))
      return reject("TARGET_NO_LONGER_LEGAL", true);
    const values = definition(this.ruleset),
      tx = new EngineTransaction(this.#state),
      draftActor = tx.draft.players.find(
        (player) => player.seat === actor.seat,
      )!;
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (candidate) => candidate.promptId !== window.promptId,
    );
    moveCardInTransaction(tx, {
      cardRef: command.cardRef,
      toZoneRef: "resolving",
      moveKind: "use",
      faceUp: true,
    });
    draftActor.markers.toxicReagentUsedTurnKey = turnKey(tx.draft);
    const segment = {
      segmentId: "skill.alchemist.toxic_reagent.poison",
      deliveryType: "attack",
      attackType: "field",
      damageType: "normal",
      element: "poison",
      amount: values.amount,
      repeat: values.repeat,
      isAdditional: false,
      overflowPolicy: "normal",
      ignoreTalentModifiers: true,
    };
    createScriptedAttackInTransaction(tx, {
      attackId: `attack:toxic-reagent:${actor.seat}:${tx.draft.stateRevision + 1}`,
      attackerSeat: actor.seat,
      targetRef: command.targetRef,
      sourceRef: command.cardRef,
      weaponId: "skill.alchemist.toxic_reagent",
      modeId: "toxicBottle",
      range: values.range,
      attackTypes: ["field"],
      damageSegments: [segment as unknown as JsonValue],
      cannotMeleeBlock: true,
      ignoreArmor: true,
      ignoreTalentModifiers: true,
      costCardRefs: [command.cardRef],
      resumePlayDeadlineAt: window.deadlineAt,
      tags: ["characterAbilityAttack", "toxicBottle"],
    });
    tx.emit("ability.activation.committed", {
      seat: actor.seat,
      abilityId: "skill.alchemist.toxic_reagent",
      cardRef: command.cardRef,
      targetRef: command.targetRef,
      limitScope: "ownerPlayPhase",
    });
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    this.#state = committed.state;
    const result: ToxicReagentResult = {
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
