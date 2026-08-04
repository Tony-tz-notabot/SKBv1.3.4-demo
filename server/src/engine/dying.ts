import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent, JsonValue, TransactionCommit } from "./types.js";
import { finalizeCurrentAttack } from "./attackLifecycle.js";
import { replaceEliminationWithIronPirate } from "./deathReplacement.js";
import { replaceEliminationWithDarkKnightFinalStrike } from "./darkKnightFinalStrike.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import {
  compileTriggerRegistry,
  matchTriggeredEffects,
  type TriggerEventFact,
} from "./triggerRegistry.js";
import { executeMatchedTriggerInTransaction } from "./triggerEffects.js";
import { moveCardInTransaction } from "./zoneMovement.js";
import { chooseWithSource } from "./random.js";
import { handleMinerOffTurnActivePlay } from "./miner.js";
import { strongPotionBonus } from "./basicSupportCards.js";

type AttackRecord = Record<string, JsonValue>;
const asAttack = (state: AuthoritativeGameState): AttackRecord => {
  const value = state.combat.attack;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("ATTACK_CONTEXT_MISSING");
  return value as AttackRecord;
};
const seatFromRef = (ref: string): Seat => Number(ref.split(":")[1]) as Seat;
const extraGemPoint = (dyingRef: string) => `thisDyingFlow.result:${dyingRef}`;
function pendingExtraGem(state: AuthoritativeGameState, dyingRef: string) {
  return state.scheduledEffects.find(
    (item) =>
      !item.cancelled &&
      item.executeAt === extraGemPoint(dyingRef) &&
      item.effect &&
      typeof item.effect === "object" &&
      !Array.isArray(item.effect) &&
      (item.effect as Record<string, JsonValue>).familyId ===
        "talent.extra_gem",
  );
}
function triggerExtraGem(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset | undefined,
  dyingRef: string,
): void {
  if (!ruleset) return;
  const event: TriggerEventFact = {
      eventType: "dying.enter",
      payload: { dyingRef, targetRef: dyingRef },
    },
    definitions = compileTriggerRegistry(ruleset).filter(
      (item) => item.familyId === "talent.extra_gem",
    );
  for (const candidate of matchTriggeredEffects(tx.draft, definitions, event))
    executeMatchedTriggerInTransaction(tx, ruleset, candidate, event, {
      eventKey: `dying:${dyingRef}:${tx.draft.stateRevision}`,
    });
}
function removeExtraGemAfterResult(
  tx: EngineTransaction<AuthoritativeGameState>,
  scheduledId: string,
  result: "rescued" | "death",
): void {
  const scheduled = tx.draft.scheduledEffects.find(
    (item) => item.scheduledId === scheduledId,
  );
  if (!scheduled) return;
  tx.draft.scheduledEffects = tx.draft.scheduledEffects.filter(
    (item) => item.scheduledId !== scheduledId,
  );
  const sourceRef = scheduled.sourceRef;
  if (sourceRef && tx.draft.cards[sourceRef]) {
    const card = tx.draft.cards[sourceRef]!;
    if (card.zoneRef.startsWith("talent:"))
      moveCardInTransaction(tx, {
        cardRef: sourceRef,
        toZoneRef: "outsideDeck",
        moveKind: "remove",
      });
  }
  tx.emit("effect.executed", {
    scheduledId,
    sourceRef,
    result,
    kind: "extraGemDyingResult",
  });
}
const rescueOrder = (state: AuthoritativeGameState): Seat[] => {
  const start = state.activeSeat ?? 1;
  return Array.from(
    { length: 4 },
    (_, offset) => (((start - 1 + offset) % 4) + 1) as Seat,
  ).filter((seat) => {
    const player = state.players.find((item) => item.seat === seat)!;
    return player.lifeState !== "eliminated" && player.presence === "inPlay";
  });
};
function legalRescueCards(
  state: AuthoritativeGameState,
  responder: Seat,
  dyingSeat: Seat,
): string[] {
  return state.zones[`hand:${responder}`]!.orderedCardRefs.filter((ref) => {
    const id = state.cards[ref]!.templateId;
    return (
      id.startsWith("basic.potion.") ||
      (responder === dyingSeat && id.startsWith("basic.horn."))
    );
  });
}
function legalPrayerCards(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset | undefined,
  responder: Seat,
): string[] {
  if (!ruleset) return [];
  const player = state.players.find((item) => item.seat === responder)!;
  if (
    !player.skillIds.includes("skill.priest.pray") ||
    player.markers["priest.prayUsed"] === true
  )
    return [];
  const colors = new Map(
    (
      ruleset.documents.get("cards.json") as {
        items: Array<{ cardId: string; color: string }>;
      }
    ).items.map((item) => [item.cardId, item.color]),
  );
  return state.zones[`hand:${responder}`]!.orderedCardRefs.filter(
    (ref) => colors.get(state.cards[ref]!.templateId) === "red",
  );
}
function legalResurrectionCrosses(
  state: AuthoritativeGameState,
  responder: Seat,
  dyingSeat: Seat,
): string[] {
  if (responder !== dyingSeat) return [];
  const player = state.players.find((item) => item.seat === responder)!;
  if (
    player.markers.equipmentEffectsDisabled === true ||
    player.statuses.some((status) => status.statusId === "status.equipmentDisabled")
  ) return [];
  return [`weapon:1:${responder}`, `weapon:2:${responder}`, `weapon:3:${responder}`, `thirdWeapon:${responder}`]
    .flatMap((zoneRef) => state.zones[zoneRef]?.orderedCardRefs ?? [])
    .filter((ref) => state.cards[ref]?.templateId === "weapon.w43");
}
function pushWindow(
  draft: AuthoritativeGameState,
  tx: EngineTransaction<AuthoritativeGameState>,
  dyingRef: string,
  order: Seat[],
  passed: Seat[],
  prioritySeat: Seat,
  deadlineAt: number,
  ruleset?: LoadedRuleset,
): void {
  const cards = legalRescueCards(draft, prioritySeat, seatFromRef(dyingRef)),
    prayers = legalPrayerCards(draft, ruleset, prioritySeat),
    crosses = legalResurrectionCrosses(draft, prioritySeat, seatFromRef(dyingRef)),
    promptId = `prompt:dying:${dyingRef}:${draft.stateRevision + 1}:${prioritySeat}`;
  draft.pendingWindows.push({
    promptId,
    kind: "dyingRescue",
    prioritySeat,
    mandatory: false,
    deadlineAt,
    timeoutPolicy: "pass",
    legalOfferIds: [
      `offer:dying:pass:${dyingRef}`,
      ...(cards.length ? [`offer:dying:rescue:${dyingRef}`] : []),
      ...(prayers.length ? [`offer:dying:prayer:${dyingRef}`] : []),
      ...(crosses.length ? [`offer:dying:resurrectionCross:${dyingRef}`] : []),
    ],
    context: {
      dyingRef,
      eligibleSeats: order,
      passedSeats: passed,
      legalCardRefs: cards,
      legalPrayerCardRefs: prayers,
      legalResurrectionCrossRefs: crosses,
    },
  });
  tx.emit("dying.rescue.window.opened", { dyingRef, promptId, prioritySeat });
  tx.emit("response.priority.granted", {
    windowType: "dyingRescue",
    dyingRef,
    seat: prioritySeat,
  });
}
function cleanupAttack(
  tx: EngineTransaction<AuthoritativeGameState>,
  attack: AttackRecord,
): void {
  const draft = tx.draft,
    refs = Array.isArray(attack.killCardRefs)
      ? attack.killCardRefs.filter(
          (ref): ref is string => typeof ref === "string",
        )
      : [];
  for (const ref of refs) {
    const card = draft.cards[ref];
    if (!card || card.zoneRef !== "resolving") continue;
    draft.zones.resolving!.orderedCardRefs.splice(
      draft.zones.resolving!.orderedCardRefs.indexOf(ref),
      1,
    );
    draft.zones.discardPile!.orderedCardRefs.push(ref);
    card.zoneRef = "discardPile";
    card.ownerSeat = null;
    card.controllerSeat = null;
    card.faceUp = true;
    tx.emit("card.moved", {
      cardRef: ref,
      fromZoneRef: "resolving",
      toZoneRef: "discardPile",
      moveKind: "systemMove",
    });
  }
}
function restorePlayWindow(
  tx: EngineTransaction<AuthoritativeGameState>,
  attack: AttackRecord,
): void {
  const draft = tx.draft,
    deadline = attack.resumePlayDeadlineAt,
    seat = Number(attack.attackerSeat) as Seat;
  if (typeof deadline !== "number" || draft.lifecycle !== "inProgress") return;
  const kind = "playPhaseAction",
    promptId = `prompt:${kind}:${draft.round}:${seat}:${draft.stateRevision + 1}`;
  draft.pendingWindows.push({
    promptId,
    kind,
    prioritySeat: seat,
    mandatory: false,
    deadlineAt: deadline,
    timeoutPolicy: "pass",
    legalOfferIds: [`offer:${kind}:finish`],
    context: {},
  });
  tx.emit("choice.requested", { seat, kind, resumedAfterAttack: true });
}
function resumeOuterAttack(
  tx: EngineTransaction<AuthoritativeGameState>,
  deadlineSupplier?: () => number,
): void {
  const draft = tx.draft;
  if (!draft.combat.attack) {
    const owner = draft.players.find(
      (player) =>
        typeof player.markers["dying.resumePlayDeadlineAt"] === "number",
    );
    if (!owner) return;
    const deadline = Number(owner.markers["dying.resumePlayDeadlineAt"]);
    delete owner.markers["dying.resumePlayDeadlineAt"];
    if (
      owner.lifeState !== "alive" ||
      owner.presence !== "inPlay" ||
      draft.lifecycle !== "inProgress"
    )
      return;
    const kind = "playPhaseAction",
      promptId = `prompt:${kind}:${draft.round}:${owner.seat}:${draft.stateRevision + 1}`;
    draft.pendingWindows.push({
      promptId,
      kind,
      prioritySeat: owner.seat,
      mandatory: false,
      deadlineAt: deadlineSupplier ? deadlineSupplier() : deadline,
      timeoutPolicy: "pass",
      legalOfferIds: [`offer:${kind}:finish`],
      context: {},
    });
    tx.emit("choice.requested", {
      seat: owner.seat,
      kind,
      resumedAfterDying: true,
    });
    return;
  }
  const attack = asAttack(draft);
  if (attack.status === "awaitingSegmentDying") {
    const targetRef = draft.combat.currentTargetRef,
      target = targetRef
        ? draft.players.find((item) => item.seat === seatFromRef(targetRef))
        : undefined;
    if (target && target.lifeState !== "eliminated") {
      attack.status = "targetHit";
      tx.emit("attack.damageSegments.resumed", {
        attackId: String(attack.attackId),
        targetRef,
        remainingOccurrences: Array.isArray(attack.pendingDamageOccurrences)
          ? attack.pendingDamageOccurrences.length
          : 0,
      });
      return;
    }
    if (targetRef)
      draft.combat.targetQueue = draft.combat.targetQueue.filter(
        (ref) => ref !== targetRef,
      );
    delete attack.pendingDamageOccurrences;
    delete attack.currentTargetDamageResults;
    delete attack.currentTargetElementBudget;
  }
  if (draft.combat.targetQueue.length) {
    draft.combat.currentTargetRef = draft.combat.targetQueue[0]!;
    delete attack.currentTargetHit;
    delete attack.currentTargetResult;
    delete attack.currentTargetDamage;
    attack.status =
      attack.pendingOwlTrigger &&
      typeof attack.pendingOwlTrigger === "object" &&
      !Array.isArray(attack.pendingOwlTrigger)
        ? "awaitingOwlTrigger"
        : "committed";
  } else finalizeCurrentAttack(tx, attack, deadlineSupplier);
}
function commit(
  tx: EngineTransaction<AuthoritativeGameState>,
): TransactionCommit<AuthoritativeGameState> {
  const result = tx.commit();
  result.state.history.domainEvents.push(...result.events);
  validateAuthoritativeState(result.state);
  return result;
}
export function eliminatePlayer(
  tx: EngineTransaction<AuthoritativeGameState>,
  dyingRef: string,
): void {
  const draft = tx.draft,
    dyingSeat = seatFromRef(dyingRef),
    dying = draft.players.find((item) => item.seat === dyingSeat)!;
  dying.lifeState = "eliminated";
  dying.hp = null;
  dying.shield = null;
  tx.emit("elimination.occurred", { dyingRef });
  const losingTeam = dying.team,
    teamLost = draft.players
      .filter((item) => item.team === losingTeam)
      .every((item) => item.lifeState === "eliminated");
  tx.emit("game.victory.check", {
    team: losingTeam,
    allEliminated: teamLost,
  });
  if (teamLost) {
    draft.lifecycle = "ended";
    draft.winnerTeam = losingTeam === "A" ? "B" : "A";
    tx.emit("game.victory", { winnerTeam: draft.winnerTeam });
  }
}
function continueEliminationAfterDeath(
  tx: EngineTransaction<AuthoritativeGameState>,
  dyingRef: string,
  deadlineAt: number,
): void {
  const draft = tx.draft,
    dyingSeat = seatFromRef(dyingRef),
    dying = draft.players.find((item) => item.seat === dyingSeat)!;
  tx.emit("elimination.before", { dyingRef });
  const replaced =
    replaceEliminationWithDarkKnightFinalStrike(tx, dyingSeat, deadlineAt) ||
    replaceEliminationWithIronPirate(tx, dyingSeat);
  if (!replaced) {
    eliminatePlayer(tx, dyingRef);
  }
  draft.combat.dyingStack.pop();
  if (draft.lifecycle !== "ended") resumeOuterAttack(tx, () => deadlineAt);
}
function openExtraGemDeathTransfer(
  tx: EngineTransaction<AuthoritativeGameState>,
  dyingRef: string,
  deadlineAt: number,
): boolean {
  const scheduled = pendingExtraGem(tx.draft, dyingRef);
  if (!scheduled) return false;
  const seat = seatFromRef(dyingRef),
    targets = tx.draft.players
      .filter(
        (player) =>
          player.presence === "inPlay" && player.lifeState !== "eliminated",
      )
      .map((player) => `character:${player.seat}`),
    promptId = `prompt:extra-gem-death:${dyingRef}:${tx.draft.stateRevision + 1}`;
  if (!targets.length) throw new Error("EXTRA_GEM_TRANSFER_TARGET_MISSING");
  tx.draft.pendingWindows.push({
    promptId,
    kind: "extraGemDeathTransfer",
    prioritySeat: seat,
    mandatory: true,
    deadlineAt,
    timeoutPolicy: "randomLegal",
    legalOfferIds: targets.map((ref) => `offer:extra-gem-death:${ref}`),
    context: {
      dyingRef,
      scheduledId: scheduled.scheduledId,
      legalTargetRefs: targets,
    },
  });
  tx.emit("choice.requested", {
    kind: "extraGemDeathTransfer",
    promptId,
    seat,
    dyingRef,
    legalTargetRefs: targets,
  });
  return true;
}
export function openDyingRescue(
  state: AuthoritativeGameState,
  deadlineAt: number,
  ruleset?: LoadedRuleset,
): TransactionCommit<AuthoritativeGameState> {
  const dyingRef = state.combat.dyingStack.at(-1);
  if (!dyingRef || state.pendingWindows.length)
    throw new Error("DYING_RESCUE_NOT_OPENABLE");
  const player = state.players.find(
    (item) => item.seat === seatFromRef(dyingRef),
  )!;
  if (player.lifeState !== "dying") throw new Error("DYING_STATE_INVALID");
  const tx = new EngineTransaction(state),
    order = rescueOrder(tx.draft);
  triggerExtraGem(tx, ruleset, dyingRef);
  pushWindow(tx.draft, tx, dyingRef, order, [], order[0]!, deadlineAt, ruleset);
  return commit(tx);
}
export interface DyingCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  cardRef?: string;
}
export type DyingCommandResult =
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
export class DyingCommandSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, DyingCommandResult>();
  constructor(
    state: AuthoritativeGameState,
    private readonly nextDeadlineAt: () => number = Date.now,
    private readonly ruleset?: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(command: DyingCommand): DyingCommandResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (
      reasonCode: string,
      refreshRequired: boolean,
    ): DyingCommandResult => {
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
    const window = this.#state.pendingWindows.find(
      (item) => item.kind === "dyingRescue",
    );
    if (!window || window.promptId !== command.promptId)
      return reject("PROMPT_CLOSED", true);
    const responder = this.#state.players.find(
      (item) => item.userId === command.actorUserId,
    );
    if (!responder || responder.seat !== window.prioritySeat)
      return reject("NOT_YOUR_PRIORITY", false);
    if (!window.legalOfferIds.includes(command.offerId))
      return reject("OFFER_EXPIRED", true);
    const prayer = command.offerId.includes(":prayer:"),
      resurrectionCross = command.offerId.includes(":resurrectionCross:"),
      rescue = command.offerId.includes(":rescue:") || prayer || resurrectionCross,
      legal = resurrectionCross
        ? window.context?.legalResurrectionCrossRefs
        : prayer
        ? window.context?.legalPrayerCardRefs
        : window.context?.legalCardRefs;
    if (
      rescue &&
      (!command.cardRef ||
        !Array.isArray(legal) ||
        !legal.includes(command.cardRef) ||
        !(resurrectionCross
          ? String(this.#state.cards[command.cardRef]?.zoneRef).startsWith("weapon:") ||
            this.#state.cards[command.cardRef]?.zoneRef === `thirdWeapon:${responder.seat}`
          : this.#state.zones[`hand:${responder.seat}`]!.orderedCardRefs.includes(command.cardRef)))
    )
      return reject("RESCUE_CARD_INVALID", false);
    if (!rescue && command.cardRef) return reject("RESCUE_CARD_INVALID", false);
    const tx = new EngineTransaction(this.#state),
      draft = tx.draft,
      dyingRef = String(window.context!.dyingRef),
      dyingSeat = seatFromRef(dyingRef),
      dying = draft.players.find((item) => item.seat === dyingSeat)!,
      draftResponder = draft.players.find(
        (item) => item.seat === responder.seat,
      )!,
      order = (window.context!.eligibleSeats as number[]).map(Number) as Seat[],
      passed = (window.context!.passedSeats as number[]).map(Number) as Seat[];
    draft.pendingWindows = draft.pendingWindows.filter(
      (item) => item.promptId !== window.promptId,
    );
    if (rescue) {
      const cardRef = command.cardRef!,
        card = draft.cards[cardRef]!;
      if (resurrectionCross) {
        if (dying.hp === null || dying.maxHp === null) throw new Error("DYING_HP_MISSING");
        const before = dying.hp;
        dying.hp = dying.maxHp;
        dying.lifeState = "alive";
        draft.combat.dyingStack.pop();
        moveCardInTransaction(tx, { cardRef, toZoneRef: "discardPile", moveKind: "lose", faceUp: true });
        tx.emit("weapon.ability.activated", { weaponId: "weapon.w43", cardRef, seat: dyingSeat, abilityId: "weapon.w43.rescue" });
        tx.emit("health.recovered", { seat: dyingSeat, sourceSeat: dyingSeat, amount: dying.hp - before, hp: dying.hp });
        tx.emit("dying.rescued", { dyingRef, rescuerSeat: dyingSeat, hp: dying.hp, sourceRef: cardRef });
        const extraGem = pendingExtraGem(draft, dyingRef);
        if (extraGem) removeExtraGemAfterResult(tx, extraGem.scheduledId, "rescued");
        resumeOuterAttack(tx);
        const result = commit(tx);
        this.#state = result.state;
        const accepted = { accepted: true as const, commandId: command.commandId, previousRevision: command.expectedStateRevision, stateRevision: result.state.stateRevision, events: result.events };
        this.#results.set(command.commandId, accepted);
        return structuredClone(accepted);
      }
      const
        hand = draft.zones[`hand:${responder.seat}`]!,
        index = hand.orderedCardRefs.indexOf(cardRef),
        handCard = card;
      hand.orderedCardRefs.splice(index, 1);
      draft.zones.discardPile!.orderedCardRefs.push(cardRef);
      handCard.zoneRef = "discardPile";
      handCard.ownerSeat = null;
      handCard.controllerSeat = null;
      handCard.faceUp = true;
      const base = prayer
          ? 2
          : handCard.templateId.startsWith("basic.potion.")
            ? 2
            : 1,
        bonus =
          !prayer &&
          (responder.initialTalentIds.includes("talent.strong_potion") ||
            (responder.markers.equipmentEffectsDisabled !== true &&
              !responder.statuses.some(
                (status) => status.statusId === "status.equipmentDisabled",
              ) &&
              tx.draft.zones[`talent:${responder.seat}`]!.orderedCardRefs.some(
                (ref) =>
                  tx.draft.cards[ref]?.templateId === "talent.strong_potion",
              )))
            ? this.ruleset
              ? strongPotionBonus(this.ruleset)
              : 0
            : 0,
        amount = base + bonus;
      if (prayer) draftResponder.markers["priest.prayUsed"] = true;
      if (dying.hp === null) throw new Error("DYING_HP_MISSING");
      const before = dying.hp;
      dying.hp = Math.min(dying.maxHp!, dying.hp + amount);
      tx.emit("card.played", {
        cardRef,
        seat: responder.seat,
        purpose: prayer ? "skill.priest.pray" : "dyingRescue",
      });
      const currentAttack = draft.combat.attack;
      const attackerSeat =
        currentAttack &&
        typeof currentAttack === "object" &&
        !Array.isArray(currentAttack)
          ? Number((currentAttack as Record<string, JsonValue>).attackerSeat)
          : NaN;
      if (this.ruleset)
        handleMinerOffTurnActivePlay(tx, this.ruleset, {
          seat: responder.seat,
          respondsToAttackOrDamage: true,
          ...(attackerSeat >= 1 && attackerSeat <= 4
            ? { sourceSeat: attackerSeat as Seat }
            : {}),
          deadlineAt: window.deadlineAt,
          reason: "dyingRescue",
        });
      if (prayer)
        tx.emit("ability.activation.committed", {
          seat: responder.seat,
          abilityId: "skill.priest.pray",
          cardRef,
          mode: "dyingResponse",
        });
      tx.emit("health.recovered", {
        seat: dyingSeat,
        sourceSeat: responder.seat,
        amount: dying.hp - before,
        hp: dying.hp,
      });
      if (dying.hp >= 1) {
        dying.lifeState = "alive";
        draft.combat.dyingStack.pop();
        tx.emit("dying.rescued", {
          dyingRef,
          rescuerSeat: responder.seat,
          hp: dying.hp,
        });
        const extraGem = pendingExtraGem(draft, dyingRef);
        if (extraGem)
          removeExtraGemAfterResult(tx, extraGem.scheduledId, "rescued");
        resumeOuterAttack(tx, this.nextDeadlineAt);
      } else
        pushWindow(
          draft,
          tx,
          dyingRef,
          order,
          [],
          order[0]!,
          this.nextDeadlineAt(),
          this.ruleset,
        );
    } else {
      tx.emit("response.passed", {
        windowType: "dyingRescue",
        dyingRef,
        seat: responder.seat,
      });
      const nextPassed = [...passed, responder.seat],
        next = order.find((seat) => !nextPassed.includes(seat));
      if (next)
        pushWindow(
          draft,
          tx,
          dyingRef,
          order,
          nextPassed,
          next,
          this.nextDeadlineAt(),
          this.ruleset,
        );
      else {
        tx.emit("dying.unresolved", { dyingRef });
        tx.emit("death.before", { dyingRef });
        tx.emit("death.occurred", { dyingRef });
        if (!openExtraGemDeathTransfer(tx, dyingRef, this.nextDeadlineAt()))
          continueEliminationAfterDeath(tx, dyingRef, this.nextDeadlineAt());
      }
    }
    const committed = commit(tx);
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
  handleTimeout(commandId: string): DyingCommandResult {
    const window = this.#state.pendingWindows.find(
      (item) => item.kind === "dyingRescue",
    );
    if (!window)
      return {
        accepted: false,
        commandId,
        stateRevision: this.#state.stateRevision,
        reasonCode: "PROMPT_CLOSED",
        refreshRequired: true,
      };
    const player = this.#state.players.find(
      (item) => item.seat === window.prioritySeat,
    )!;
    return this.handle({
      commandId,
      gameId: this.#state.gameId,
      expectedStateRevision: this.#state.stateRevision,
      actorUserId: player.userId,
      promptId: window.promptId,
      offerId: window.legalOfferIds.find((id) => id.includes(":pass:"))!,
    });
  }
}

export interface ExtraGemDeathTransferCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  targetRef: string;
}
export class ExtraGemDeathTransferSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, DyingCommandResult>();
  constructor(
    state: AuthoritativeGameState,
    private readonly nextDeadlineAt: () => number = Date.now,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(command: ExtraGemDeathTransferCommand): DyingCommandResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (
      reasonCode: string,
      refreshRequired: boolean,
    ): DyingCommandResult => {
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
    const window = this.#state.pendingWindows.find(
      (item) => item.kind === "extraGemDeathTransfer",
    );
    if (!window || window.promptId !== command.promptId)
      return reject("PROMPT_CLOSED", true);
    const actor = this.#state.players.find(
      (item) => item.userId === command.actorUserId,
    );
    if (!actor || actor.seat !== window.prioritySeat)
      return reject("NOT_YOUR_PRIORITY", false);
    const legal = Array.isArray(window.context?.legalTargetRefs)
      ? window.context.legalTargetRefs
      : [];
    if (
      !window.legalOfferIds.includes(command.offerId) ||
      !legal.includes(command.targetRef) ||
      !command.offerId.endsWith(command.targetRef)
    )
      return reject("TARGET_INVALID", false);
    const targetSeat = seatFromRef(command.targetRef),
      target = this.#state.players.find((item) => item.seat === targetSeat);
    if (
      !target ||
      target.presence !== "inPlay" ||
      target.lifeState === "eliminated"
    )
      return reject("TARGET_NO_LONGER_LEGAL", true);
    const tx = new EngineTransaction(this.#state),
      draft = tx.draft,
      dyingRef = String(window.context!.dyingRef),
      dyingSeat = seatFromRef(dyingRef),
      scheduledId = String(window.context!.scheduledId);
    draft.pendingWindows = draft.pendingWindows.filter(
      (item) => item.promptId !== window.promptId,
    );
    const cards = [...draft.zones[`hand:${dyingSeat}`]!.orderedCardRefs];
    if (targetSeat !== dyingSeat)
      for (const cardRef of cards)
        moveCardInTransaction(tx, {
          cardRef,
          toZoneRef: `hand:${targetSeat}`,
          moveKind: "give",
          faceUp: false,
        });
    tx.emit("cards.given", {
      fromSeat: dyingSeat,
      toSeat: targetSeat,
      cardRefs: cards,
      reason: "talent.extra_gem.death",
    });
    removeExtraGemAfterResult(tx, scheduledId, "death");
    continueEliminationAfterDeath(tx, dyingRef, this.nextDeadlineAt());
    const committed = commit(tx);
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
  handleTimeout(commandId: string): DyingCommandResult {
    const window = this.#state.pendingWindows.find(
      (item) => item.kind === "extraGemDeathTransfer",
    );
    if (!window)
      return {
        accepted: false,
        commandId,
        stateRevision: this.#state.stateRevision,
        reasonCode: "PROMPT_CLOSED",
        refreshRequired: true,
      };
    const legal = Array.isArray(window.context?.legalTargetRefs)
      ? window.context.legalTargetRefs.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    const stillLegal = legal.filter((ref) => {
      const seat = seatFromRef(ref),
        player = this.#state.players.find((item) => item.seat === seat);
      return player?.presence === "inPlay" && player.lifeState !== "eliminated";
    });
    const chosen = chooseWithSource(stillLegal, this.#state.randomSource);
    this.#state.randomSource = chosen.source;
    this.#state.randomHistory.push({
      randomSeq: chosen.source.nextRandomSeq - 1,
      purpose: "extraGemDeathTransfer.timeout",
      candidateRefs: stillLegal,
      resultRefs: [chosen.value],
    });
    const actor = this.#state.players.find(
      (item) => item.seat === window.prioritySeat,
    )!;
    return this.handle({
      commandId,
      gameId: this.#state.gameId,
      expectedStateRevision: this.#state.stateRevision,
      actorUserId: actor.userId,
      promptId: window.promptId,
      offerId: `offer:extra-gem-death:${chosen.value}`,
      targetRef: chosen.value,
    });
  }
}
