import type { LoadedRuleset } from "../ruleset/types.js";
import {
  drawCardsInTransaction,
  takeTopCardsToResolvingInTransaction,
} from "./deck.js";
import { weaponSlotRefs } from "./preselection.js";
import { chooseWithSource } from "./random.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import { processCommittedEventTriggers } from "./triggerBridge.js";
import type { DomainEvent } from "./types.js";
import { moveCardInTransaction } from "./zoneMovement.js";

type Color = "white" | "green" | "blue" | "orange" | "red";
interface CardFact {
  cardId: string;
  category: string;
  color: Color;
}
interface OriginFurnaceRule {
  familyId: string;
  usageKind: string;
  defaultWindow: string;
  costs?: Array<{
    kind?: string;
    count?: number;
    selector?: { category?: string; equipped?: boolean };
  }>;
  effects?: Array<{
    op?: string;
    params?: {
      count?: {
        switch?: {
          expression?: string;
          cases?: Partial<Record<Color, number>>;
        };
      };
    };
  }>;
}

function originDefinition(ruleset: LoadedRuleset) {
  const document = ruleset.documents.get("nonboss-rules.json") as {
      effectFamilies: OriginFurnaceRule[];
    },
    rule = document.effectFamilies.find(
      (family) => family.familyId === "special.sp06",
    ),
    cost = rule?.costs?.[0],
    draw = rule?.effects?.find((effect) => effect.op === "drawCards"),
    switchRule = draw?.params?.count?.switch,
    counts = switchRule?.cases;
  if (
    rule?.usageKind !== "specialCard" ||
    rule.defaultWindow !== "owner.phase.play" ||
    cost?.kind !== "discardEquippedCard" ||
    cost.count !== 1 ||
    cost.selector?.category !== "weapon" ||
    cost.selector.equipped !== true ||
    switchRule?.expression !== "$discardedWeapon.printedColor" ||
    !counts ||
    !(["white", "green", "blue", "orange", "red"] as Color[]).every(
      (color) => Number.isInteger(counts[color]) && Number(counts[color]) >= 0,
    )
  )
    throw new Error("ORIGIN_FURNACE_RULE_INVALID");
  return counts as Record<Color, number>;
}

function cardFacts(ruleset: LoadedRuleset) {
  return new Map(
    (ruleset.documents.get("cards.json") as { items: CardFact[] }).items.map(
      (item) => [item.cardId, item],
    ),
  );
}

function playWindow(state: AuthoritativeGameState, seat: Seat) {
  return state.pendingWindows.find(
    (window) =>
      window.kind === "playPhaseAction" && window.prioritySeat === seat,
  );
}

function equippedWeapons(state: AuthoritativeGameState, seat: Seat) {
  return weaponSlotRefs(seat).flatMap(
    (zoneRef) => state.zones[zoneRef]?.orderedCardRefs ?? [],
  );
}

export interface OriginFurnaceOffer {
  offerId: string;
  cardRef: string;
  legalWeaponRefs: string[];
  drawCountByWeaponRef: Record<string, number>;
  stateRevision: number;
}

export function buildOriginFurnaceOffers(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  seat: Seat,
): OriginFurnaceOffer[] {
  const counts = originDefinition(ruleset),
    facts = cardFacts(ruleset),
    owner = state.players.find((player) => player.seat === seat),
    window = playWindow(state, seat);
  if (
    !owner ||
    owner.lifeState !== "alive" ||
    owner.presence !== "inPlay" ||
    state.activeSeat !== seat ||
    state.phase !== "play" ||
    state.phaseBoundary !== "body" ||
    !window ||
    state.combat.attack ||
    state.resolutionStack.length
  )
    return [];
  const legalWeaponRefs = equippedWeapons(state, seat).filter(
      (ref) => facts.get(state.cards[ref]!.templateId)?.category === "weapon",
    ),
    drawCountByWeaponRef = Object.fromEntries(
      legalWeaponRefs.map((ref) => {
        const color = facts.get(state.cards[ref]!.templateId)!.color;
        return [ref, counts[color]];
      }),
    );
  if (!legalWeaponRefs.length) return [];
  return state.zones[`hand:${seat}`]!.orderedCardRefs.filter(
    (ref) => state.cards[ref]!.templateId === "special.sp06",
  ).map((cardRef) => ({
    offerId: `offer:special.sp06:${cardRef}`,
    cardRef,
    legalWeaponRefs,
    drawCountByWeaponRef,
    stateRevision: state.stateRevision,
  }));
}

export interface OriginFurnaceCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  cardRef: string;
  weaponRef: string;
}

export type OriginFurnaceResult =
  | {
      accepted: true;
      commandId: string;
      previousRevision: number;
      stateRevision: number;
      events: DomainEvent[];
      offers: OriginFurnaceOffer[];
    }
  | {
      accepted: false;
      commandId: string;
      stateRevision: number;
      reasonCode: string;
      refreshRequired: boolean;
    };

export class OriginFurnaceSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, OriginFurnaceResult>();

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
    return seat
      ? buildOriginFurnaceOffers(this.#state, this.ruleset, seat)
      : [];
  }

  handle(command: OriginFurnaceCommand): OriginFurnaceResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (
      reasonCode: string,
      refreshRequired: boolean,
    ): OriginFurnaceResult => {
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
        (player) => player.userId === command.actorUserId,
      ),
      window = actor ? playWindow(this.#state, actor.seat) : undefined;
    if (!actor || !window) return reject("NOT_YOUR_PRIORITY", false);
    if (window.promptId !== command.promptId)
      return reject("PROMPT_CLOSED", true);
    const offer = buildOriginFurnaceOffers(
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
    const configuredDrawCount = offer.drawCountByWeaponRef[command.weaponRef];
    if (
      typeof configuredDrawCount !== "number" ||
      !Number.isInteger(configuredDrawCount)
    )
      return reject("WEAPON_COLOR_INVALID", false);
    const drawCount = configuredDrawCount;

    const tx = new EngineTransaction(this.#state);
    moveCardInTransaction(tx, {
      cardRef: command.cardRef,
      toZoneRef: "resolving",
      moveKind: "use",
      faceUp: true,
    });
    tx.emit("card.played", {
      seat: actor.seat,
      cardRef: command.cardRef,
      familyId: "special.sp06",
      weaponRef: command.weaponRef,
    });
    moveCardInTransaction(tx, {
      cardRef: command.weaponRef,
      toZoneRef: "discardPile",
      moveKind: "discard",
      faceUp: true,
    });
    drawCardsInTransaction(
      tx,
      actor.seat,
      drawCount,
      "special.sp06.originFurnace",
    );
    moveCardInTransaction(tx, {
      cardRef: command.cardRef,
      toZoneRef: "discardPile",
      moveKind: "systemMove",
      faceUp: true,
    });
    tx.emit("card.resolved", {
      seat: actor.seat,
      cardRef: command.cardRef,
      familyId: "special.sp06",
      weaponRef: command.weaponRef,
      drawCount,
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
    const result: OriginFurnaceResult = {
      accepted: true,
      commandId: command.commandId,
      previousRevision: processed.previousRevision,
      stateRevision: processed.state.stateRevision,
      events: processed.events,
      offers: this.offersFor(command.actorUserId),
    };
    this.#results.set(command.commandId, result);
    return structuredClone(result);
  }
}

interface ReforgeFurnaceRule {
  familyId: string;
  usageKind: string;
  defaultWindow: string;
  costs?: OriginFurnaceRule["costs"];
  effects?: Array<{
    op?: string;
    maxIterations?: number;
    params?: Record<string, unknown>;
  }>;
}

function reforgeDefinition(ruleset: LoadedRuleset) {
  const document = ruleset.documents.get("nonboss-rules.json") as {
      effectFamilies: ReforgeFurnaceRule[];
    },
    rule = document.effectFamilies.find(
      (family) => family.familyId === "special.sp05",
    ),
    cost = rule?.costs?.[0],
    repeat = rule?.effects?.find((effect) => effect.op === "repeat"),
    selection = rule?.effects?.find((effect) => effect.op === "selectCards"),
    selectionParams = selection?.params;
  if (
    rule?.usageKind !== "specialCard" ||
    rule.defaultWindow !== "owner.phase.play" ||
    cost?.kind !== "discardEquippedCard" ||
    cost.count !== 1 ||
    cost.selector?.category !== "weapon" ||
    cost.selector.equipped !== true ||
    repeat?.maxIterations !== 8 ||
    repeat.params?.reshuffleImmediatelyIfExhausted !== true ||
    repeat.params.currentlyResolvingCardsExcludedFromReshuffle !== true ||
    selectionParams?.max !== 1 ||
    selectionParams.timeoutPolicy !== "randomLegal"
  )
    throw new Error("REFORGE_FURNACE_RULE_INVALID");
  const ranks = ruleset.settings.cardColorRank,
    values = (Object.keys(ranks) as Color[]).map((color) => ranks[color]);
  if (
    values.length !== 5 ||
    values.some((rank) => !Number.isInteger(rank)) ||
    new Set(values).size !== 5
  )
    throw new Error("CARD_COLOR_RANK_INVALID");
  return { maxReveal: repeat.maxIterations, ranks };
}

export interface ReforgeFurnaceOffer {
  offerId: string;
  cardRef: string;
  legalWeaponRefs: string[];
  stateRevision: number;
}

export function buildReforgeFurnaceOffers(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  seat: Seat,
): ReforgeFurnaceOffer[] {
  reforgeDefinition(ruleset);
  const facts = cardFacts(ruleset),
    owner = state.players.find((player) => player.seat === seat),
    window = playWindow(state, seat);
  if (
    !owner ||
    owner.lifeState !== "alive" ||
    owner.presence !== "inPlay" ||
    state.activeSeat !== seat ||
    state.phase !== "play" ||
    state.phaseBoundary !== "body" ||
    !window ||
    state.combat.attack ||
    state.resolutionStack.length
  )
    return [];
  const legalWeaponRefs = equippedWeapons(state, seat).filter(
    (ref) => facts.get(state.cards[ref]!.templateId)?.category === "weapon",
  );
  if (!legalWeaponRefs.length) return [];
  return state.zones[`hand:${seat}`]!.orderedCardRefs.filter(
    (ref) => state.cards[ref]!.templateId === "special.sp05",
  ).map((cardRef) => ({
    offerId: `offer:special.sp05:${cardRef}`,
    cardRef,
    legalWeaponRefs,
    stateRevision: state.stateRevision,
  }));
}

export interface ReforgeFurnaceCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  cardRef: string;
  weaponRef: string;
}

type FurnaceRejected = {
  accepted: false;
  commandId: string;
  stateRevision: number;
  reasonCode: string;
  refreshRequired: boolean;
};
export type ReforgeFurnaceResult =
  | {
      accepted: true;
      commandId: string;
      previousRevision: number;
      stateRevision: number;
      events: DomainEvent[];
      selectionRequired: boolean;
      revealedCardRefs: string[];
      legalWeaponRefs: string[];
    }
  | FurnaceRejected;

function finishReforgeInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  seat: Seat,
  furnaceRef: string,
  revealedRefs: string[],
  selectedRef: string | null,
  resumeDeadlineAt: number | null,
): void {
  if (selectedRef)
    moveCardInTransaction(tx, {
      cardRef: selectedRef,
      toZoneRef: `hand:${seat}`,
      moveKind: "gain",
      faceUp: false,
    });
  for (const ref of revealedRefs) {
    if (ref === selectedRef) continue;
    moveCardInTransaction(tx, {
      cardRef: ref,
      toZoneRef: "discardPile",
      moveKind: "discard",
      faceUp: true,
    });
  }
  moveCardInTransaction(tx, {
    cardRef: furnaceRef,
    toZoneRef: "discardPile",
    moveKind: "systemMove",
    faceUp: true,
  });
  tx.emit("card.resolved", {
    seat,
    cardRef: furnaceRef,
    familyId: "special.sp05",
    selectedRef,
    revealedCardRefs: revealedRefs,
  });
  if (resumeDeadlineAt !== null) {
    tx.draft.pendingWindows.push({
      promptId: `prompt:playPhaseAction:${tx.draft.round}:${seat}:${tx.draft.stateRevision + 1}`,
      kind: "playPhaseAction",
      prioritySeat: seat,
      mandatory: false,
      deadlineAt: resumeDeadlineAt,
      timeoutPolicy: "pass",
      legalOfferIds: ["offer:playPhaseAction:finish"],
      context: {},
    });
    tx.emit("choice.requested", {
      seat,
      kind: "playPhaseAction",
      resumedAfterSpecialEffect: "special.sp05",
    });
  }
}

export class ReforgeFurnaceSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, ReforgeFurnaceResult>();
  constructor(
    state: AuthoritativeGameState,
    private readonly ruleset: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(command: ReforgeFurnaceCommand): ReforgeFurnaceResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (
      reasonCode: string,
      refreshRequired: boolean,
    ): FurnaceRejected => {
      const result: FurnaceRejected = {
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
    const offer = buildReforgeFurnaceOffers(
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
    const definition = reforgeDefinition(this.ruleset),
      facts = cardFacts(this.ruleset),
      paidFact = facts.get(this.#state.cards[command.weaponRef]!.templateId);
    if (!paidFact || paidFact.category !== "weapon")
      return reject("WEAPON_RULE_INVALID", false);
    const tx = new EngineTransaction(this.#state);
    moveCardInTransaction(tx, {
      cardRef: command.cardRef,
      toZoneRef: "resolving",
      moveKind: "use",
      faceUp: true,
    });
    tx.emit("card.played", {
      seat: actor.seat,
      cardRef: command.cardRef,
      familyId: "special.sp05",
      weaponRef: command.weaponRef,
    });
    moveCardInTransaction(tx, {
      cardRef: command.weaponRef,
      toZoneRef: "discardPile",
      moveKind: "discard",
      faceUp: true,
    });
    const revealedRefs: string[] = [];
    for (let index = 0; index < definition.maxReveal; index += 1) {
      const shown = takeTopCardsToResolvingInTransaction(
        tx,
        1,
        "special.sp05.reveal",
      );
      if (!shown.cardRefs.length) break;
      const ref = shown.cardRefs[0]!,
        card = tx.draft.cards[ref]!,
        fact = facts.get(card.templateId);
      card.faceUp = true;
      revealedRefs.push(ref);
      tx.emit("card.revealed", {
        seat: actor.seat,
        cardRef: ref,
        familyId: "special.sp05",
        revealIndex: index,
      });
      if (
        fact?.category === "weapon" &&
        definition.ranks[fact.color] >= definition.ranks[paidFact.color]
      )
        break;
    }
    const legalWeaponRefs = revealedRefs.filter(
      (ref) =>
        facts.get(tx.draft.cards[ref]!.templateId)?.category === "weapon",
    );
    let selectionRequired = false;
    if (legalWeaponRefs.length) {
      selectionRequired = true;
      tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
        (candidate) => candidate.promptId !== window.promptId,
      );
      const promptId = `prompt:reforge-furnace:${actor.seat}:${tx.draft.stateRevision + 1}`;
      tx.draft.pendingWindows.push({
        promptId,
        kind: "reforgeFurnaceSelection",
        prioritySeat: actor.seat,
        mandatory: true,
        deadlineAt: window.deadlineAt,
        timeoutPolicy: "randomLegal",
        legalOfferIds: legalWeaponRefs.map(
          (ref) => `offer:reforge-furnace:${ref}`,
        ),
        context: {
          furnaceRef: command.cardRef,
          paidWeaponRef: command.weaponRef,
          revealedCardRefs: revealedRefs,
          legalWeaponRefs,
          resumePlayDeadlineAt: window.deadlineAt,
        },
      });
      tx.emit("choice.requested", {
        promptId,
        kind: "reforgeFurnaceSelection",
        seat: actor.seat,
        revealedCardRefs: revealedRefs,
        legalWeaponRefs,
      });
    } else
      finishReforgeInTransaction(
        tx,
        actor.seat,
        command.cardRef,
        revealedRefs,
        null,
        null,
      );
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    this.#state = committed.state;
    const result: ReforgeFurnaceResult = {
      accepted: true,
      commandId: command.commandId,
      previousRevision: committed.previousRevision,
      stateRevision: committed.state.stateRevision,
      events: committed.events,
      selectionRequired,
      revealedCardRefs: revealedRefs,
      legalWeaponRefs,
    };
    this.#results.set(command.commandId, result);
    return structuredClone(result);
  }
}

export interface ReforgeFurnaceSelectionCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  selectedWeaponRef: string;
}

export type ReforgeFurnaceSelectionResult =
  | {
      accepted: true;
      commandId: string;
      previousRevision: number;
      stateRevision: number;
      events: DomainEvent[];
    }
  | FurnaceRejected;

export class ReforgeFurnaceSelectionSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, ReforgeFurnaceSelectionResult>();
  constructor(state: AuthoritativeGameState) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(
    command: ReforgeFurnaceSelectionCommand,
  ): ReforgeFurnaceSelectionResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (
      reasonCode: string,
      refreshRequired: boolean,
    ): FurnaceRejected => {
      const result: FurnaceRejected = {
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
    const window = this.#state.pendingWindows.find(
      (candidate) => candidate.kind === "reforgeFurnaceSelection",
    );
    if (!window || window.promptId !== command.promptId)
      return reject("PROMPT_CLOSED", true);
    const actor = this.#state.players.find(
      (player) => player.userId === command.actorUserId,
    );
    if (!actor || actor.seat !== window.prioritySeat)
      return reject("NOT_YOUR_PRIORITY", false);
    const legal = Array.isArray(window.context?.legalWeaponRefs)
      ? window.context.legalWeaponRefs.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    if (
      !legal.includes(command.selectedWeaponRef) ||
      command.offerId !==
        `offer:reforge-furnace:${command.selectedWeaponRef}` ||
      this.#state.cards[command.selectedWeaponRef]?.zoneRef !== "resolving"
    )
      return reject("SELECTION_NO_LONGER_LEGAL", true);
    const revealed = Array.isArray(window.context?.revealedCardRefs)
        ? window.context.revealedCardRefs.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
      furnaceRef = String(window.context?.furnaceRef),
      resumeDeadlineAt = Number(window.context?.resumePlayDeadlineAt),
      tx = new EngineTransaction(this.#state);
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (candidate) => candidate.promptId !== window.promptId,
    );
    finishReforgeInTransaction(
      tx,
      actor.seat,
      furnaceRef,
      revealed,
      command.selectedWeaponRef,
      resumeDeadlineAt,
    );
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    this.#state = committed.state;
    const result: ReforgeFurnaceSelectionResult = {
      accepted: true,
      commandId: command.commandId,
      previousRevision: committed.previousRevision,
      stateRevision: committed.state.stateRevision,
      events: committed.events,
    };
    this.#results.set(command.commandId, result);
    return structuredClone(result);
  }
  handleTimeout(commandId: string): ReforgeFurnaceSelectionResult {
    const window = this.#state.pendingWindows.find(
      (candidate) => candidate.kind === "reforgeFurnaceSelection",
    );
    if (!window)
      return {
        accepted: false,
        commandId,
        stateRevision: this.#state.stateRevision,
        reasonCode: "PROMPT_CLOSED",
        refreshRequired: true,
      };
    const legal = Array.isArray(window.context?.legalWeaponRefs)
      ? window.context.legalWeaponRefs.filter(
          (value): value is string =>
            typeof value === "string" &&
            this.#state.cards[value]?.zoneRef === "resolving",
        )
      : [];
    const chosen = chooseWithSource(legal, this.#state.randomSource);
    this.#state.randomSource = chosen.source;
    this.#state.randomHistory.push({
      randomSeq: chosen.source.nextRandomSeq - 1,
      purpose: "special.sp05.selection.timeout",
      candidateRefs: legal,
      resultRefs: [chosen.value],
    });
    const actor = this.#state.players.find(
      (player) => player.seat === window.prioritySeat,
    )!;
    return this.handle({
      commandId,
      gameId: this.#state.gameId,
      expectedStateRevision: this.#state.stateRevision,
      actorUserId: actor.userId,
      promptId: window.promptId,
      offerId: `offer:reforge-furnace:${chosen.value}`,
      selectedWeaponRef: chosen.value,
    });
  }
}
