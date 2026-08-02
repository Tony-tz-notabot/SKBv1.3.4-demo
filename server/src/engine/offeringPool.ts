import type { LoadedRuleset } from "../ruleset/types.js";
import { processCommittedEventTriggers } from "./triggerBridge.js";
import { chooseWithSource } from "./random.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent } from "./types.js";
import { moveCardInTransaction } from "./zoneMovement.js";

interface OfferingRule {
  familyId: string;
  usageKind: string;
  defaultWindow: string;
  legality?: { controllerHasEquippedWeapon?: boolean };
  costs?: Array<{
    kind?: string;
    count?: number;
    selector?: { category?: string; equipped?: boolean };
    uiConfirmWhenOnlyOneLegalWeapon?: boolean;
  }>;
  effects?: Array<{ op?: string; params?: Record<string, unknown> }>;
}

function definition(ruleset: LoadedRuleset) {
  const document = ruleset.documents.get("nonboss-rules.json") as {
      effectFamilies: OfferingRule[];
    },
    rule = document.effectFamilies.find(
      (family) => family.familyId === "special.sp10",
    ),
    cost = rule?.costs?.[0],
    random = rule?.effects?.find((effect) => effect.op === "randomChoice"),
    lines = ruleset.settings.special.sp10.flavorLines;
  if (
    rule?.usageKind !== "specialCard" ||
    rule.defaultWindow !== "owner.phase.play" ||
    rule.legality?.controllerHasEquippedWeapon !== true ||
    cost?.kind !== "discardEquippedCard" ||
    cost.count !== 1 ||
    cost.selector?.category !== "weapon" ||
    cost.selector.equipped !== true ||
    cost.uiConfirmWhenOnlyOneLegalWeapon !== true ||
    random?.params?.optionsConfigKey !== "special.sp10.flavorLines" ||
    random.params.resultHasNoRulesEffect !== true ||
    random.params.logResult !== true ||
    !Array.isArray(lines) ||
    !lines.length ||
    lines.some((line) => typeof line !== "string" || !line.length)
  )
    throw new Error("OFFERING_POOL_RULE_INVALID");
  return lines;
}

function equippedWeapons(state: AuthoritativeGameState, seat: Seat) {
  return [
    `weapon:${seat}:1`,
    `weapon:${seat}:2`,
    `weapon:${seat}:3`,
    `thirdWeapon:${seat}`,
  ]
    .flatMap((zoneRef) => state.zones[zoneRef]?.orderedCardRefs ?? [])
    .filter((ref) => state.cards[ref]?.templateId.startsWith("weapon."));
}

function playWindow(state: AuthoritativeGameState, seat: Seat) {
  return state.pendingWindows.find(
    (window) =>
      window.kind === "playPhaseAction" && window.prioritySeat === seat,
  );
}

export interface OfferingPoolOffer {
  offerId: string;
  cardRef: string;
  legalWeaponRefs: string[];
  requiresOnlyWeaponConfirmation: boolean;
  stateRevision: number;
}

export function buildOfferingPoolOffers(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  seat: Seat,
): OfferingPoolOffer[] {
  definition(ruleset);
  const player = state.players.find((candidate) => candidate.seat === seat),
    window = playWindow(state, seat),
    legalWeaponRefs = equippedWeapons(state, seat);
  if (
    !player ||
    player.lifeState !== "alive" ||
    player.presence !== "inPlay" ||
    state.activeSeat !== seat ||
    state.phase !== "play" ||
    state.phaseBoundary !== "body" ||
    !window ||
    state.combat.attack ||
    state.resolutionStack.length ||
    !legalWeaponRefs.length
  )
    return [];
  return state.zones[`hand:${seat}`]!.orderedCardRefs.filter(
    (ref) => state.cards[ref]!.templateId === "special.sp10",
  ).map((cardRef) => ({
    offerId: `offer:special.sp10:${cardRef}`,
    cardRef,
    legalWeaponRefs,
    requiresOnlyWeaponConfirmation: legalWeaponRefs.length === 1,
    stateRevision: state.stateRevision,
  }));
}

export interface OfferingPoolCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  cardRef: string;
  weaponRef: string;
  confirmOnlyWeapon?: boolean;
}

export type OfferingPoolResult =
  | {
      accepted: true;
      commandId: string;
      previousRevision: number;
      stateRevision: number;
      events: DomainEvent[];
      flavorLine: string;
      offers: OfferingPoolOffer[];
    }
  | {
      accepted: false;
      commandId: string;
      stateRevision: number;
      reasonCode: string;
      refreshRequired: boolean;
    };

export class OfferingPoolSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, OfferingPoolResult>();
  constructor(
    state: AuthoritativeGameState,
    private readonly ruleset: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  offersFor(userId: string) {
    const seat = this.#state.players.find(
      (player) => player.userId === userId,
    )?.seat;
    return seat ? buildOfferingPoolOffers(this.#state, this.ruleset, seat) : [];
  }
  handle(command: OfferingPoolCommand): OfferingPoolResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (reasonCode: string, refreshRequired: boolean) => {
      const result: OfferingPoolResult = {
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
    const offer = buildOfferingPoolOffers(
      this.#state,
      this.ruleset,
      actor.seat,
    ).find(
      (candidate) =>
        candidate.offerId === command.offerId &&
        candidate.cardRef === command.cardRef,
    );
    if (!offer) return reject("OFFER_EXPIRED", true);
    if (!offer.legalWeaponRefs.includes(command.weaponRef))
      return reject("WEAPON_NO_LONGER_LEGAL", true);
    if (
      offer.requiresOnlyWeaponConfirmation &&
      command.confirmOnlyWeapon !== true
    )
      return reject("ONLY_WEAPON_CONFIRMATION_REQUIRED", false);

    const lines = definition(this.ruleset),
      tx = new EngineTransaction(this.#state),
      chosen = chooseWithSource(lines, tx.draft.randomSource);
    tx.draft.randomSource = chosen.source;
    tx.draft.randomHistory.push({
      randomSeq: chosen.source.nextRandomSeq - 1,
      purpose: "special.sp10.flavorLine",
      candidateRefs: lines,
      resultRefs: [chosen.value],
    });
    moveCardInTransaction(tx, {
      cardRef: command.cardRef,
      toZoneRef: "resolving",
      moveKind: "use",
      faceUp: true,
    });
    tx.emit("card.played", {
      seat: actor.seat,
      cardRef: command.cardRef,
      familyId: "special.sp10",
      weaponRef: command.weaponRef,
    });
    moveCardInTransaction(tx, {
      cardRef: command.weaponRef,
      toZoneRef: "discardPile",
      moveKind: "discard",
      faceUp: true,
    });
    tx.emit("random.choice.resolved", {
      familyId: "special.sp10",
      cardRef: command.cardRef,
      flavorLine: chosen.value,
      resultHasNoRulesEffect: true,
    });
    moveCardInTransaction(tx, {
      cardRef: command.cardRef,
      toZoneRef: "discardPile",
      moveKind: "systemMove",
      faceUp: true,
    });
    tx.emit("card.resolved", {
      seat: actor.seat,
      cardRef: command.cardRef,
      familyId: "special.sp10",
    });
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    const processed = processCommittedEventTriggers(
      committed,
      this.ruleset,
      window.deadlineAt,
    );
    this.#state = processed.state;
    const result: OfferingPoolResult = {
      accepted: true,
      commandId: command.commandId,
      previousRevision: processed.previousRevision,
      stateRevision: processed.state.stateRevision,
      events: processed.events,
      flavorLine: chosen.value,
      offers: this.offersFor(command.actorUserId),
    };
    this.#results.set(command.commandId, result);
    return structuredClone(result);
  }
}
