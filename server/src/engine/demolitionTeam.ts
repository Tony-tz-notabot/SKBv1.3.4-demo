import type { LoadedRuleset } from "../ruleset/types.js";
import { weaponSlotRefs } from "./preselection.js";
import { chooseWithSource } from "./random.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent, JsonValue } from "./types.js";
import { moveCardInTransaction } from "./zoneMovement.js";

interface Family {
  familyId: string;
  usageKind: string;
  defaultWindow: string;
  effects?: JsonValue[];
}

function validateRule(ruleset: LoadedRuleset): void {
  const document = ruleset.documents.get("nonboss-rules.json") as {
      effectFamilies: Family[];
    },
    family = document.effectFamilies.find(
      (item) => item.familyId === "special.sp08",
    ),
    encoded = JSON.stringify(family?.effects ?? []);
  if (
    family?.usageKind !== "specialCard" ||
    family.defaultWindow !== "owner.phase.play" ||
    !encoded.includes(
      "notEliminatedPlayersFromCurrentTurnPlayerCounterclockwise",
    ) ||
    !encoded.includes('"min":0') ||
    !encoded.includes('"max":1') ||
    !encoded.includes('"includesThirdWeapon":true') ||
    !encoded.includes("simultaneousFromSnapshot") ||
    !encoded.includes('"preserveThirdWeaponClassification":true') ||
    !encoded.includes("playersWithWeaponSlotOverflow") ||
    !encoded.includes('"timeoutPolicy":"randomLegal"')
  )
    throw new Error("DEMOLITION_TEAM_RULE_INVALID");
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
function participantOrder(state: AuthoritativeGameState): Seat[] {
  const start = state.activeSeat!;
  return Array.from(
    { length: 4 },
    (_, offset) => (((start - 1 + offset) % 4) + 1) as Seat,
  ).filter(
    (seat) =>
      state.players.find((player) => player.seat === seat)!.lifeState !==
      "eliminated",
  );
}
function regularCapacity(state: AuthoritativeGameState, seat: Seat) {
  const player = state.players.find((item) => item.seat === seat)!,
    disabled =
      player.markers.equipmentEffectsDisabled === true ||
      player.statuses.some(
        (status) => status.statusId === "status.equipmentDisabled",
      ),
    initial = player.initialTalentIds.includes("talent.triple_wield"),
    equipped = state.zones[`talent:${seat}`]!.orderedCardRefs.some(
      (ref) => state.cards[ref]!.templateId === "talent.triple_wield",
    );
  return initial || (!disabled && equipped) ? 3 : 2;
}

export interface DemolitionTeamOffer {
  offerId: string;
  cardRef: string;
  stateRevision: number;
}

export function buildDemolitionTeamOffers(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  seat: Seat,
): DemolitionTeamOffer[] {
  validateRule(ruleset);
  const owner = state.players.find((player) => player.seat === seat);
  if (
    !owner ||
    owner.lifeState !== "alive" ||
    owner.presence !== "inPlay" ||
    state.activeSeat !== seat ||
    state.phase !== "play" ||
    state.phaseBoundary !== "body" ||
    !playWindow(state, seat) ||
    state.combat.attack ||
    state.resolutionStack.length
  )
    return [];
  return state.zones[`hand:${seat}`]!.orderedCardRefs.filter(
    (ref) => state.cards[ref]!.templateId === "special.sp08",
  ).map((cardRef) => ({
    offerId: `offer:special.sp08:${cardRef}`,
    cardRef,
    stateRevision: state.stateRevision,
  }));
}

function openOptionalDiscard(
  tx: EngineTransaction<AuthoritativeGameState>,
  order: Seat[],
  index: number,
  furnaceRef: string,
  resumeDeadlineAt: number,
): void {
  const seat = order[index]!,
    legalWeaponRefs = equippedWeapons(tx.draft, seat),
    promptId = `prompt:demolition-discard:${seat}:${tx.draft.stateRevision + 1}:${index}`;
  tx.draft.pendingWindows.push({
    promptId,
    kind: "demolitionOptionalDiscard",
    prioritySeat: seat,
    mandatory: false,
    deadlineAt: resumeDeadlineAt,
    timeoutPolicy: "pass",
    legalOfferIds: [
      "offer:demolition-discard:pass",
      ...legalWeaponRefs.map((ref) => `offer:demolition-discard:${ref}`),
    ],
    context: {
      participantOrder: order,
      participantIndex: index,
      furnaceRef,
      resumePlayDeadlineAt: resumeDeadlineAt,
      legalWeaponRefs,
    },
  });
  tx.emit("choice.requested", {
    promptId,
    kind: "demolitionOptionalDiscard",
    seat,
    legalWeaponRefs,
    optional: true,
  });
}

interface Overflow {
  seat: Seat;
  regular: string[];
  third: string[];
  count: number;
}
function overflows(state: AuthoritativeGameState, order: Seat[]): Overflow[] {
  return order
    .map((seat) => {
      const regular = [1, 2, 3].flatMap(
          (slot) => state.zones[`weapon:${slot}:${seat}`]!.orderedCardRefs,
        ),
        third = [...state.zones[`thirdWeapon:${seat}`]!.orderedCardRefs],
        count =
          Math.max(0, regular.length - regularCapacity(state, seat)) +
          Math.max(0, third.length - 1);
      return { seat, regular, third, count };
    })
    .filter((item) => item.count > 0);
}

function compactWeaponSlots(state: AuthoritativeGameState, seat: Seat): void {
  const refs = [1, 2, 3].flatMap(
    (slot) => state.zones[`weapon:${slot}:${seat}`]!.orderedCardRefs,
  );
  for (const slot of [1, 2, 3])
    state.zones[`weapon:${slot}:${seat}`]!.orderedCardRefs = [];
  refs.forEach((ref, index) => {
    const zoneRef = `weapon:${index + 1}:${seat}`;
    state.zones[zoneRef]!.orderedCardRefs.push(ref);
    state.cards[ref]!.zoneRef = zoneRef;
  });
}

function finish(
  tx: EngineTransaction<AuthoritativeGameState>,
  ownerSeat: Seat,
  cardRef: string,
  resumeDeadlineAt: number,
): void {
  moveCardInTransaction(tx, {
    cardRef,
    toZoneRef: "discardPile",
    moveKind: "systemMove",
    faceUp: true,
  });
  tx.emit("card.resolved", {
    seat: ownerSeat,
    cardRef,
    familyId: "special.sp08",
  });
  tx.draft.pendingWindows.push({
    promptId: `prompt:playPhaseAction:${tx.draft.round}:${ownerSeat}:${tx.draft.stateRevision + 1}`,
    kind: "playPhaseAction",
    prioritySeat: ownerSeat,
    mandatory: false,
    deadlineAt: resumeDeadlineAt,
    timeoutPolicy: "pass",
    legalOfferIds: ["offer:playPhaseAction:finish"],
    context: {},
  });
  tx.emit("choice.requested", {
    seat: ownerSeat,
    kind: "playPhaseAction",
    resumedAfterSpecialEffect: "special.sp08",
  });
}

function openOverflowOrFinish(
  tx: EngineTransaction<AuthoritativeGameState>,
  order: Seat[],
  ownerSeat: Seat,
  cardRef: string,
  resumeDeadlineAt: number,
): void {
  const overflow = overflows(tx.draft, order)[0];
  if (!overflow) {
    for (const seat of order) compactWeaponSlots(tx.draft, seat);
    finish(tx, ownerSeat, cardRef, resumeDeadlineAt);
    return;
  }
  const legalWeaponRefs = [...overflow.regular, ...overflow.third],
    promptId = `prompt:demolition-overflow:${overflow.seat}:${tx.draft.stateRevision + 1}`;
  tx.draft.pendingWindows.push({
    promptId,
    kind: "demolitionWeaponOverflow",
    prioritySeat: overflow.seat,
    mandatory: true,
    deadlineAt: resumeDeadlineAt,
    timeoutPolicy: "randomLegal",
    legalOfferIds: ["offer:demolition-overflow:submit"],
    context: {
      participantOrder: order,
      ownerSeat,
      cardRef,
      resumePlayDeadlineAt: resumeDeadlineAt,
      legalWeaponRefs,
      regularWeaponRefs: overflow.regular,
      thirdWeaponRefs: overflow.third,
      requiredCount: overflow.count,
      regularRequiredCount: Math.max(
        0,
        overflow.regular.length - regularCapacity(tx.draft, overflow.seat),
      ),
      thirdRequiredCount: Math.max(0, overflow.third.length - 1),
    },
  });
  tx.emit("choice.requested", {
    promptId,
    kind: "demolitionWeaponOverflow",
    seat: overflow.seat,
    legalWeaponRefs,
    requiredCount: overflow.count,
  });
}

function transferFromSnapshot(
  tx: EngineTransaction<AuthoritativeGameState>,
  order: Seat[],
  ownerSeat: Seat,
  cardRef: string,
  resumeDeadlineAt: number,
): void {
  const snapshots = order.map((seat) => ({
    seat,
    regular: [1, 2, 3].flatMap(
      (slot) => tx.draft.zones[`weapon:${slot}:${seat}`]!.orderedCardRefs,
    ),
    third: [...tx.draft.zones[`thirdWeapon:${seat}`]!.orderedCardRefs],
  }));
  tx.emit("snapshot.saved", {
    snapshotId: "remainingWeaponsByPlayer",
    items: snapshots,
  });
  for (const snapshot of snapshots)
    for (const ref of [...snapshot.regular, ...snapshot.third])
      moveCardInTransaction(tx, {
        cardRef: ref,
        toZoneRef: "resolving",
        moveKind: "give",
        faceUp: true,
      });
  for (const snapshot of snapshots) {
    const recipient = order[(order.indexOf(snapshot.seat) + 1) % order.length]!;
    for (const ref of snapshot.regular)
      moveCardInTransaction(tx, {
        cardRef: ref,
        toZoneRef: `weapon:1:${recipient}`,
        moveKind: "give",
        faceUp: true,
      });
    for (const ref of snapshot.third)
      moveCardInTransaction(tx, {
        cardRef: ref,
        toZoneRef: `thirdWeapon:${recipient}`,
        moveKind: "give",
        faceUp: true,
      });
  }
  tx.emit("cards.transferred", {
    familyId: "special.sp08",
    mode: "simultaneousFromSnapshot",
    snapshots,
  });
  openOverflowOrFinish(tx, order, ownerSeat, cardRef, resumeDeadlineAt);
}

export interface DemolitionUseCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  cardRef: string;
}
export interface DemolitionChoiceCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  selectedWeaponRefs: string[];
}
export type DemolitionResult =
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

export class DemolitionTeamSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, DemolitionResult>();
  constructor(
    state: AuthoritativeGameState,
    private readonly ruleset: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  private reject(
    commandId: string,
    reasonCode: string,
    refreshRequired: boolean,
  ): DemolitionResult {
    const result: DemolitionResult = {
      accepted: false,
      commandId,
      stateRevision: this.#state.stateRevision,
      reasonCode,
      refreshRequired,
    };
    this.#results.set(commandId, result);
    return structuredClone(result);
  }
  private accept(
    commandId: string,
    tx: EngineTransaction<AuthoritativeGameState>,
  ): DemolitionResult {
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    this.#state = committed.state;
    const result: DemolitionResult = {
      accepted: true,
      commandId,
      previousRevision: committed.previousRevision,
      stateRevision: committed.state.stateRevision,
      events: committed.events,
    };
    this.#results.set(commandId, result);
    return structuredClone(result);
  }
  handleUse(command: DemolitionUseCommand): DemolitionResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    if (command.gameId !== this.#state.gameId)
      return this.reject(command.commandId, "GAME_NOT_FOUND", false);
    if (command.expectedStateRevision !== this.#state.stateRevision)
      return this.reject(command.commandId, "STALE_REVISION", true);
    const actor = this.#state.players.find(
        (player) => player.userId === command.actorUserId,
      ),
      window = actor ? playWindow(this.#state, actor.seat) : undefined;
    if (!actor || !window)
      return this.reject(command.commandId, "NOT_YOUR_PRIORITY", false);
    if (window.promptId !== command.promptId)
      return this.reject(command.commandId, "PROMPT_CLOSED", true);
    const offer = buildDemolitionTeamOffers(
      this.#state,
      this.ruleset,
      actor.seat,
    ).find(
      (item) =>
        item.offerId === command.offerId && item.cardRef === command.cardRef,
    );
    if (!offer) return this.reject(command.commandId, "OFFER_EXPIRED", true);
    const tx = new EngineTransaction(this.#state),
      order = participantOrder(tx.draft);
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (candidate) => candidate.promptId !== window.promptId,
    );
    moveCardInTransaction(tx, {
      cardRef: command.cardRef,
      toZoneRef: "resolving",
      moveKind: "use",
      faceUp: true,
    });
    tx.emit("card.played", {
      seat: actor.seat,
      cardRef: command.cardRef,
      familyId: "special.sp08",
    });
    openOptionalDiscard(tx, order, 0, command.cardRef, window.deadlineAt);
    return this.accept(command.commandId, tx);
  }
  handleChoice(command: DemolitionChoiceCommand): DemolitionResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    if (command.gameId !== this.#state.gameId)
      return this.reject(command.commandId, "GAME_NOT_FOUND", false);
    if (command.expectedStateRevision !== this.#state.stateRevision)
      return this.reject(command.commandId, "STALE_REVISION", true);
    const window = this.#state.pendingWindows[0],
      actor = this.#state.players.find(
        (player) => player.userId === command.actorUserId,
      );
    if (!window || window.promptId !== command.promptId)
      return this.reject(command.commandId, "PROMPT_CLOSED", true);
    if (!actor || actor.seat !== window.prioritySeat)
      return this.reject(command.commandId, "NOT_YOUR_PRIORITY", false);
    if (!window.legalOfferIds.includes(command.offerId))
      return this.reject(command.commandId, "OFFER_EXPIRED", true);
    const legal = Array.isArray(window.context?.legalWeaponRefs)
        ? window.context.legalWeaponRefs.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
      selected = command.selectedWeaponRefs;
    if (new Set(selected).size !== selected.length)
      return this.reject(command.commandId, "SELECTION_INVALID", false);
    const tx = new EngineTransaction(this.#state);
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (candidate) => candidate.promptId !== window.promptId,
    );
    if (window.kind === "demolitionOptionalDiscard") {
      const pass = command.offerId === "offer:demolition-discard:pass";
      if (
        (pass && selected.length) ||
        (!pass &&
          (selected.length !== 1 ||
            command.offerId !== `offer:demolition-discard:${selected[0]}` ||
            !legal.includes(selected[0]!)))
      )
        return this.reject(command.commandId, "SELECTION_INVALID", false);
      if (!pass)
        moveCardInTransaction(tx, {
          cardRef: selected[0]!,
          toZoneRef: "discardPile",
          moveKind: "discard",
          faceUp: true,
        });
      const order = window.context!.participantOrder as unknown as Seat[],
        index = Number(window.context!.participantIndex),
        cardRef = String(window.context!.furnaceRef),
        deadline = Number(window.context!.resumePlayDeadlineAt);
      if (index + 1 < order.length)
        openOptionalDiscard(tx, order, index + 1, cardRef, deadline);
      else
        transferFromSnapshot(
          tx,
          order,
          this.#state.activeSeat!,
          cardRef,
          deadline,
        );
    } else if (window.kind === "demolitionWeaponOverflow") {
      const required = Number(window.context?.requiredCount),
        regularRequired = Number(window.context?.regularRequiredCount),
        thirdRequired = Number(window.context?.thirdRequiredCount),
        regular = new Set(window.context?.regularWeaponRefs as string[]),
        third = new Set(window.context?.thirdWeaponRefs as string[]);
      if (
        selected.length !== required ||
        selected.some(
          (ref) =>
            !legal.includes(ref) ||
            !equippedWeapons(this.#state, actor.seat).includes(ref),
        ) ||
        selected.filter((ref) => regular.has(ref)).length !== regularRequired ||
        selected.filter((ref) => third.has(ref)).length !== thirdRequired
      )
        return this.reject(command.commandId, "SELECTION_INVALID", false);
      for (const ref of selected)
        moveCardInTransaction(tx, {
          cardRef: ref,
          toZoneRef: "discardPile",
          moveKind: "discard",
          faceUp: true,
        });
      compactWeaponSlots(tx.draft, actor.seat);
      openOverflowOrFinish(
        tx,
        window.context!.participantOrder as unknown as Seat[],
        Number(window.context!.ownerSeat) as Seat,
        String(window.context!.cardRef),
        Number(window.context!.resumePlayDeadlineAt),
      );
    } else return this.reject(command.commandId, "PROMPT_CLOSED", true);
    return this.accept(command.commandId, tx);
  }
  handleTimeout(commandId: string): DemolitionResult {
    const window = this.#state.pendingWindows[0];
    if (!window) return this.reject(commandId, "PROMPT_CLOSED", true);
    const actor = this.#state.players.find(
      (player) => player.seat === window.prioritySeat,
    )!;
    if (window.kind === "demolitionOptionalDiscard")
      return this.handleChoice({
        commandId,
        gameId: this.#state.gameId,
        expectedStateRevision: this.#state.stateRevision,
        actorUserId: actor.userId,
        promptId: window.promptId,
        offerId: "offer:demolition-discard:pass",
        selectedWeaponRefs: [],
      });
    if (window.kind !== "demolitionWeaponOverflow")
      return this.reject(commandId, "PROMPT_CLOSED", true);
    const regular = [...(window.context!.regularWeaponRefs as string[])],
      third = [...(window.context!.thirdWeaponRefs as string[])],
      regularCount = Number(window.context!.regularRequiredCount),
      thirdCount = Number(window.context!.thirdRequiredCount),
      chosen: string[] = [];
    for (const [items, count, purpose] of [
      [regular, regularCount, "regular"],
      [third, thirdCount, "third"],
    ] as const) {
      const remaining = [...items];
      for (let index = 0; index < count; index += 1) {
        const result = chooseWithSource(remaining, this.#state.randomSource);
        this.#state.randomSource = result.source;
        remaining.splice(remaining.indexOf(result.value), 1);
        chosen.push(result.value);
        this.#state.randomHistory.push({
          randomSeq: result.source.nextRandomSeq - 1,
          purpose: `special.sp08.overflow.timeout.${purpose}`,
          candidateRefs: [...remaining, result.value],
          resultRefs: [result.value],
        });
      }
    }
    return this.handleChoice({
      commandId,
      gameId: this.#state.gameId,
      expectedStateRevision: this.#state.stateRevision,
      actorUserId: actor.userId,
      promptId: window.promptId,
      offerId: "offer:demolition-overflow:submit",
      selectedWeaponRefs: chosen,
    });
  }
}
