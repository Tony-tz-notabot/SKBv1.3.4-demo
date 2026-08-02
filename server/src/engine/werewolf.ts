import type { LoadedRuleset } from "../ruleset/types.js";
import { applyDeathNoteInTransaction } from "./specialCards.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent } from "./types.js";
import { moveCardInTransaction } from "./zoneMovement.js";

const COLORS = ["white", "green", "blue", "orange", "red"] as const;
interface CardFact {
  cardId: string;
  color: string;
}
function definition(ruleset: LoadedRuleset) {
  const document = ruleset.documents.get("character-rules.json") as {
      rules: Array<{
        ruleId: string;
        effects?: Array<{
          op?: string;
          target?: string;
          value?: number;
          params?: Record<string, unknown>;
        }>;
      }>;
    },
    rule = document.rules.find(
      (item) => item.ruleId === "character.werewolf.notebook",
    ),
    maxHp = rule?.effects?.find((effect) => effect.op === "changeMaxHp"),
    branch = rule?.effects?.find((effect) => effect.op === "switch")?.params;
  if (
    maxHp?.target !== "$source" ||
    maxHp.value !== 1 ||
    branch?.on !== "$target.shield>0"
  )
    throw new Error("WEREWOLF_NOTEBOOK_RULE_INVALID");
  return { maxUses: 2, maxHpGain: 1, heal: 1 } as const;
}
const playWindow = (state: AuthoritativeGameState, seat: Seat) =>
  state.pendingWindows.find(
    (window) =>
      window.kind === "playPhaseAction" && window.prioritySeat === seat,
  );
function facts(ruleset: LoadedRuleset) {
  return new Map(
    (ruleset.documents.get("cards.json") as { items: CardFact[] }).items.map(
      (item) => [item.cardId, item],
    ),
  );
}
function costs(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  seat: Seat,
) {
  const byColor: Record<string, string[]> = Object.fromEntries(
    COLORS.map((color) => [color, []]),
  );
  const cardFacts = facts(ruleset);
  for (const ref of state.zones[`hand:${seat}`]!.orderedCardRefs) {
    const color = cardFacts.get(state.cards[ref]!.templateId)?.color;
    if (color && byColor[color]) byColor[color]!.push(ref);
  }
  return byColor;
}
function targets(state: AuthoritativeGameState) {
  return state.players
    .filter(
      (player) =>
        player.presence === "inPlay" && player.lifeState !== "eliminated",
    )
    .map((player) => `character:${player.seat}`);
}
export interface WerewolfNotebookOffer {
  offerId: string;
  legalCardRefsByColor: Record<string, string[]>;
  legalTargetRefs: string[];
  stateRevision: number;
}
export function buildWerewolfNotebookOffers(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  seat: Seat,
): WerewolfNotebookOffer[] {
  const values = definition(ruleset),
    player = state.players.find((item) => item.seat === seat),
    window = playWindow(state, seat),
    legalCardRefsByColor = costs(state, ruleset, seat),
    legalTargetRefs = targets(state);
  return player?.characterId === "character.werewolf" &&
    player.skillIds.includes("skill.werewolf.notebook") &&
    player.lifeState === "alive" &&
    player.presence === "inPlay" &&
    state.activeSeat === seat &&
    state.phase === "play" &&
    state.phaseBoundary === "body" &&
    window &&
    !state.combat.attack &&
    !state.resolutionStack.length &&
    Number(player.markers.werewolfNotebookUses ?? 0) < values.maxUses &&
    COLORS.every((color) => legalCardRefsByColor[color]!.length) &&
    legalTargetRefs.length
    ? [
        {
          offerId: "offer:skill.werewolf.notebook",
          legalCardRefsByColor,
          legalTargetRefs,
          stateRevision: state.stateRevision,
        },
      ]
    : [];
}
export interface WerewolfNotebookCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  cardRefs: string[];
  targetRef: string;
}
export type WerewolfNotebookResult =
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
export class WerewolfNotebookSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, WerewolfNotebookResult>();
  constructor(
    state: AuthoritativeGameState,
    private readonly ruleset: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(command: WerewolfNotebookCommand): WerewolfNotebookResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (reasonCode: string, refreshRequired: boolean) => {
      const result: WerewolfNotebookResult = {
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
    const offer = buildWerewolfNotebookOffers(
      this.#state,
      this.ruleset,
      actor.seat,
    ).find((item) => item.offerId === command.offerId);
    if (!offer) return reject("OFFER_EXPIRED", true);
    if (!offer.legalTargetRefs.includes(command.targetRef))
      return reject("TARGET_NO_LONGER_LEGAL", true);
    if (
      command.cardRefs.length !== COLORS.length ||
      new Set(command.cardRefs).size !== COLORS.length
    )
      return reject("COST_SELECTION_INVALID", false);
    const selectedColors = command.cardRefs.map((ref) =>
      COLORS.find((color) => offer.legalCardRefsByColor[color]!.includes(ref)),
    );
    if (
      selectedColors.some((color) => !color) ||
      new Set(selectedColors).size !== COLORS.length
    )
      return reject("COST_CARD_NO_LONGER_LEGAL", true);
    const values = definition(this.ruleset),
      tx = new EngineTransaction(this.#state),
      draftActor = tx.draft.players.find(
        (player) => player.seat === actor.seat,
      )!;
    for (const cardRef of command.cardRefs)
      moveCardInTransaction(tx, {
        cardRef,
        toZoneRef: "discardPile",
        moveKind: "discard",
        faceUp: true,
      });
    const hpBefore = draftActor.hp!,
      maxBefore = draftActor.maxHp!;
    draftActor.maxHp = maxBefore + values.maxHpGain;
    draftActor.hp = Math.min(draftActor.maxHp, hpBefore + values.heal);
    draftActor.markers.werewolfNotebookUses =
      Number(draftActor.markers.werewolfNotebookUses ?? 0) + 1;
    tx.emit("stat.max.changed", {
      seat: actor.seat,
      stat: "maxHp",
      from: maxBefore,
      to: draftActor.maxHp,
      sourceRef: "skill.werewolf.notebook",
    });
    tx.emit("health.recovered", {
      seat: actor.seat,
      amount: draftActor.hp - hpBefore,
      hp: draftActor.hp,
      sourceRef: "skill.werewolf.notebook",
    });
    applyDeathNoteInTransaction(
      tx,
      command.targetRef,
      "skill.werewolf.notebook",
    );
    tx.emit("ability.activation.committed", {
      seat: actor.seat,
      abilityId: "skill.werewolf.notebook",
      cardRefs: command.cardRefs,
      targetRef: command.targetRef,
      useCount: draftActor.markers.werewolfNotebookUses,
      limitScope: "perGame",
    });
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    this.#state = committed.state;
    const result: WerewolfNotebookResult = {
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
