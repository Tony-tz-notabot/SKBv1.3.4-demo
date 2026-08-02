import type { LoadedRuleset } from "../ruleset/types.js";
import type {
  AuthoritativeGameState,
  PendingWindowState,
  Seat,
} from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent, JsonValue, TransactionCommit } from "./types.js";
import { beginJudgment, type PrintedColor } from "./judgment.js";
import { openPreJudgmentWindow } from "./preJudgment.js";
import { ghostCrownInvalidates } from "./armorRuntime.js";
import { processCriticalPenetrationHitEvents } from "./triggerAttackFollowup.js";
import { processWizardSpellStrikeHitEvents } from "./wizard.js";
import { processMeleeCounterResponseEvents } from "./triggerMeleeCounter.js";
import { commitSpecialPlay, specialPlayOffers } from "./specialCardPlay.js";
import {
  exitUnderground,
  handleMinerOffTurnActivePlay,
  isUnderground,
  openMinerSourceDismantle,
} from "./miner.js";

type AttackRecord = Record<string, JsonValue>;
const attackRecord = (state: AuthoritativeGameState): AttackRecord => {
  const attack = state.combat.attack;
  if (!attack || typeof attack !== "object" || Array.isArray(attack))
    throw new Error("ATTACK_CONTEXT_MISSING");
  return attack as AttackRecord;
};
const seatFromTarget = (targetRef: string): Seat => {
  const match = /^character:([1-4])$/.exec(targetRef);
  if (!match) throw new Error("ATTACK_TARGET_REF_INVALID");
  return Number(match[1]) as Seat;
};
const dodgeCards = (state: AuthoritativeGameState, seat: Seat) =>
  state.zones[`hand:${seat}`]!.orderedCardRefs.filter((ref) =>
    state.cards[ref]!.templateId.startsWith("basic.dodge."),
  );
function meleeBlockCards(
  state: AuthoritativeGameState,
  seat: Seat,
  ruleset: LoadedRuleset,
  attackTypes: JsonValue[],
): string[] {
  const player = state.players.find((item) => item.seat === seat)!;
  if (
    !attackTypes.includes("ranged") ||
    attackTypes.includes("laser") ||
    attackTypes.includes("field") ||
    player.markers.equipmentEffectsDisabled === true ||
    player.statuses.some(
      (status) => status.statusId === "status.equipmentDisabled",
    )
  )
    return [];
  const document = ruleset.documents.get("weapon-rules.json") as {
      templates: Array<{ weaponId: string; weaponTypes: string[] }>;
    },
    types = new Map(
      document.templates.map((item) => [item.weaponId, item.weaponTypes]),
    );
  return [
    `weapon:1:${seat}`,
    `weapon:2:${seat}`,
    `weapon:3:${seat}`,
    `thirdWeapon:${seat}`,
  ]
    .flatMap((ref) => state.zones[ref]?.orderedCardRefs ?? [])
    .filter((ref) =>
      types.get(state.cards[ref]!.templateId)?.includes("melee"),
    );
}
const equipmentEnabled = (state: AuthoritativeGameState, seat: Seat) => {
  const player = state.players.find((item) => item.seat === seat)!;
  return (
    player.markers.equipmentEffectsDisabled !== true &&
    !player.statuses.some(
      (status) => status.statusId === "status.equipmentDisabled",
    )
  );
};
function armorJudgment(
  state: AuthoritativeGameState,
  seat: Seat,
  attack: AttackRecord,
  types: JsonValue[],
): { armorRef: string; matchColors: PrintedColor[] } | null {
  if (
    types.includes("field") ||
    attack.ignoreArmor === true ||
    !equipmentEnabled(state, seat)
  )
    return null;
  const armorRef = state.zones[`armor:${seat}`]?.orderedCardRefs[0];
  if (!armorRef) return null;
  const id = state.cards[armorRef]!.templateId,
    matchColors =
      id === "armor.a01"
        ? ["orange" as const]
        : id === "armor.a03"
          ? ["blue" as const, "orange" as const]
          : null;
  if (!matchColors) return null;
  const targetRef = state.combat.currentTargetRef,
    attempts = Array.isArray(attack.armorResponseAttempts)
      ? attack.armorResponseAttempts
      : [];
  return attempts.includes(`${targetRef}:${armorRef}`)
    ? null
    : { armorRef, matchColors };
}
function armorKillBlockCards(
  state: AuthoritativeGameState,
  seat: Seat,
  attack: AttackRecord,
  types: JsonValue[],
): string[] {
  if (
    !types.includes("ranged") ||
    types.includes("laser") ||
    types.includes("field") ||
    attack.cannotMeleeBlock === true ||
    attack.ignoreArmor === true ||
    !equipmentEnabled(state, seat)
  )
    return [];
  const armorRef = state.zones[`armor:${seat}`]?.orderedCardRefs[0];
  if (!armorRef || state.cards[armorRef]!.templateId !== "armor.a07") return [];
  return state.zones[`hand:${seat}`]!.orderedCardRefs.filter((ref) =>
    state.cards[ref]!.templateId.startsWith("basic.kill."),
  );
}
function finalizeHit(
  tx: EngineTransaction<AuthoritativeGameState>,
  hit: boolean,
  reason: string,
): void {
  const draft = tx.draft,
    attack = attackRecord(draft),
    attackId = String(attack.attackId),
    targetRef = draft.combat.currentTargetRef!;
  attack.currentTargetHit = hit;
  attack.currentTargetResult = hit ? "hit" : "miss";
  if (hit) delete attack.currentTargetMissReason;
  else attack.currentTargetMissReason = reason;
  attack.status = hit ? "targetHit" : "targetMiss";
  tx.emit(hit ? "attack.hit" : "attack.miss", { attackId, targetRef, reason });
}

export function openAttackResponse(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  deadlineAt: number,
): TransactionCommit<AuthoritativeGameState> {
  const attack = attackRecord(state),
    targetRef = state.combat.currentTargetRef;
  if (!targetRef || state.pendingWindows.length)
    throw new Error("ATTACK_RESPONSE_NOT_OPENABLE");
  const attackId = String(attack.attackId),
    targetSeat = seatFromTarget(targetRef),
    types = Array.isArray(attack.attackTypes) ? attack.attackTypes : [],
    cannotHandDodge =
      types.includes("field") ||
      attack.cannotDodge === true ||
      attack.cannotHandDodge === true ||
      state.players.find((player) => player.seat === targetSeat)!.markers
        .cannotDodgeUntilTurnEnd === true;
  const tx = new EngineTransaction(state),
    draft = tx.draft;
  tx.emit("attack.response.before", { attackId, targetRef });
  const crownRef = ghostCrownInvalidates(
    draft,
    targetSeat,
    types,
    attack.ignoreArmor === true || types.includes("field"),
  );
  if (isUnderground(draft, targetSeat) && types.includes("ranged")) {
    tx.emit("attack.invalidated", {
      attackId,
      targetRef,
      sourceKind: "status",
      sourceRef: "status.underground",
      result: "miss",
    });
    finalizeHit(tx, false, "status.underground");
  } else if (crownRef) {
    tx.emit("attack.invalidated", {
      attackId,
      targetRef,
      sourceKind: "armor",
      sourceRef: crownRef,
      result: "miss",
    });
    finalizeHit(tx, false, "armor.a05.ghostCrown");
  } else {
    const specialPrefix = `offer:attack-response:${attackId}`,
      dodges = cannotHandDodge ? [] : dodgeCards(draft, targetSeat),
      specialDodges = cannotHandDodge
        ? []
        : specialPlayOffers(
            draft,
            ruleset,
            targetSeat,
            "dodge",
            specialPrefix,
          ).filter((offer) => offer.kind === "rangerRoll"),
      blocks =
        attack.cannotMeleeBlock === true
          ? []
          : meleeBlockCards(draft, targetSeat, ruleset, types),
      armorJudge =
        attack.cannotArmorResponse === true ||
        draft.players.find((player) => player.seat === targetSeat)!.markers
          .cannotDodgeUntilTurnEnd === true
          ? null
          : armorJudgment(draft, targetSeat, attack, types),
      armorBlocks =
        attack.cannotArmorResponse === true
          ? []
          : armorKillBlockCards(draft, targetSeat, attack, types);
    if (
      cannotHandDodge &&
      specialDodges.length === 0 &&
      blocks.length === 0 &&
      armorBlocks.length === 0 &&
      !armorJudge
    ) {
      tx.emit("response.window.closed", {
        attackId,
        targetRef,
        reason: "noLegalOrdinaryResponse",
      });
      finalizeHit(tx, true, "unanswered");
    } else {
      const promptId = `prompt:attack-response:${attackId}:${targetSeat}`,
        legalOfferIds = [
          `offer:attack-response:pass:${attackId}`,
          ...(dodges.length ? [`offer:attack-response:dodge:${attackId}`] : []),
          ...specialDodges.map((offer) => offer.offerId),
          ...(blocks.length
            ? [`offer:attack-response:meleeBlock:${attackId}`]
            : []),
          ...(armorJudge
            ? [`offer:attack-response:armorJudgment:${attackId}`]
            : []),
          ...(armorBlocks.length
            ? [`offer:attack-response:armorKillBlock:${attackId}`]
            : []),
        ];
      draft.pendingWindows.push({
        promptId,
        kind: "attackResponse",
        prioritySeat: targetSeat,
        mandatory: false,
        deadlineAt,
        timeoutPolicy: "pass",
        legalOfferIds,
        context: {
          attackId,
          targetRef,
          legalDodgeCardRefs: dodges,
          legalSpecialDodgeOfferIds: specialDodges.map(
            (offer) => offer.offerId,
          ),
          legalMeleeBlockRefs: blocks,
          legalArmorKillBlockRefs: armorBlocks,
          ...(armorJudge
            ? {
                armorJudgmentRef: armorJudge.armorRef,
                armorJudgmentMatchColors: armorJudge.matchColors,
              }
            : {}),
        },
      });
      tx.emit("response.window.opened", {
        attackId,
        targetRef,
        promptId,
        prioritySeat: targetSeat,
      });
      tx.emit("response.priority.granted", {
        attackId,
        targetRef,
        seat: targetSeat,
      });
    }
  }
  const committed = tx.commit();
  committed.state.history.domainEvents.push(...committed.events);
  validateAuthoritativeState(committed.state);
  void ruleset;
  return committed;
}

export interface AttackResponseCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  cardRef?: string;
}
export type AttackResponseResult =
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
export class AttackResponseSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, AttackResponseResult>();
  constructor(
    state: AuthoritativeGameState,
    private readonly ruleset?: LoadedRuleset,
  ) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(command: AttackResponseCommand): AttackResponseResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (
      reasonCode: string,
      refreshRequired: boolean,
    ): AttackResponseResult => {
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
      (item) => item.kind === "attackResponse",
    );
    if (!window || window.promptId !== command.promptId)
      return reject("PROMPT_CLOSED", true);
    const player = this.#state.players.find(
      (item) => item.userId === command.actorUserId,
    );
    if (!player || player.seat !== window.prioritySeat)
      return reject("NOT_YOUR_PRIORITY", false);
    if (!window.legalOfferIds.includes(command.offerId))
      return reject("OFFER_EXPIRED", true);
    const dodge = command.offerId.includes(":dodge:"),
      specialDodge = Array.isArray(window.context?.legalSpecialDodgeOfferIds)
        ? window.context.legalSpecialDodgeOfferIds.includes(command.offerId)
        : false,
      block = command.offerId.includes(":meleeBlock:"),
      armorJudge = command.offerId.includes(":armorJudgment:"),
      armorKillBlock = command.offerId.includes(":armorKillBlock:"),
      legal = window.context?.legalDodgeCardRefs,
      blockLegal = window.context?.legalMeleeBlockRefs,
      armorBlockLegal = window.context?.legalArmorKillBlockRefs;
    if (
      dodge &&
      (!command.cardRef ||
        !Array.isArray(legal) ||
        !legal.includes(command.cardRef) ||
        !this.#state.zones[`hand:${player.seat}`]!.orderedCardRefs.includes(
          command.cardRef,
        ))
    )
      return reject("RESPONSE_CARD_INVALID", false);
    if (
      block &&
      (!command.cardRef ||
        !Array.isArray(blockLegal) ||
        !blockLegal.includes(command.cardRef))
    )
      return reject("RESPONSE_CARD_INVALID", false);
    if (
      armorKillBlock &&
      (!command.cardRef ||
        !Array.isArray(armorBlockLegal) ||
        !armorBlockLegal.includes(command.cardRef) ||
        !this.#state.zones[`hand:${player.seat}`]!.orderedCardRefs.includes(
          command.cardRef,
        ))
    )
      return reject("RESPONSE_CARD_INVALID", false);
    if (!dodge && !specialDodge && !block && !armorKillBlock && command.cardRef)
      return reject("RESPONSE_CARD_INVALID", false);
    if (specialDodge) {
      if (!this.ruleset) return reject("RULESET_REQUIRED", false);
      const prefix = `offer:attack-response:${String(window.context?.attackId)}`,
        offer = specialPlayOffers(
          this.#state,
          this.ruleset,
          player.seat,
          "dodge",
          prefix,
        ).find((candidate) => candidate.offerId === command.offerId);
      if (
        !offer ||
        offer.kind !== "rangerRoll" ||
        offer.cardRefs.length !== 1 ||
        command.cardRef !== offer.cardRefs[0]
      )
        return reject("RESPONSE_CARD_INVALID", false);
    }
    if (armorJudge) {
      if (!this.ruleset) return reject("RULESET_REQUIRED", false);
      const armorRef =
          typeof window.context?.armorJudgmentRef === "string"
            ? window.context.armorJudgmentRef
            : null,
        colors = Array.isArray(window.context?.armorJudgmentMatchColors)
          ? (window.context.armorJudgmentMatchColors as PrintedColor[])
          : [];
      if (!armorRef || !colors.length)
        return reject("ARMOR_RESPONSE_INVALID", false);
      const tx = new EngineTransaction(this.#state),
        draft = tx.draft,
        attack = attackRecord(draft),
        attackId = String(attack.attackId),
        targetRef = draft.combat.currentTargetRef!,
        attempts = Array.isArray(attack.armorResponseAttempts)
          ? attack.armorResponseAttempts
          : [];
      draft.pendingWindows = draft.pendingWindows.filter(
        (item) => item.promptId !== window.promptId,
      );
      attempts.push(`${targetRef}:${armorRef}`);
      attack.armorResponseAttempts = attempts;
      attack.status = "awaitingResponseJudgment";
      tx.emit("response.committed", {
        attackId,
        targetRef,
        seat: player.seat,
        responseKind: "armorJudgment",
        armorRef,
      });
      tx.emit("response.window.closed", {
        attackId,
        targetRef,
        reason: "nestedJudgment",
      });
      handleMinerOffTurnActivePlay(tx, this.ruleset, {
        seat: player.seat,
        respondsToAttackOrDamage: true,
        sourceSeat: Number(attack.attackerSeat) as Seat,
        deadlineAt: window.deadlineAt,
        reason: "activeArmorJudgmentResponse",
      });
      const paid = tx.commit();
      paid.state.history.domainEvents.push(...paid.events);
      validateAuthoritativeState(paid.state);
      const input = {
          controllerSeat: player.seat,
          sourceRef: armorRef,
          purpose: "armorDodge",
          matchColors: colors,
          context: {
            attackId,
            targetRef,
            responseJudgment: true,
            armorRef,
            resumeAttackStatus: "committed",
          },
        },
        begun =
          openPreJudgmentWindow(
            paid.state,
            this.ruleset,
            input,
            window.deadlineAt,
          ) ??
          beginJudgment(paid.state, this.ruleset, input, window.deadlineAt);
      this.#state = begun.state;
      const events = [...paid.events, ...begun.events],
        result = {
          accepted: true as const,
          commandId: command.commandId,
          previousRevision: paid.previousRevision,
          stateRevision: begun.state.stateRevision,
          events,
        };
      this.#results.set(command.commandId, result);
      return structuredClone(result);
    }
    const tx = new EngineTransaction(this.#state),
      draft = tx.draft,
      attack = attackRecord(draft),
      attackId = String(attack.attackId),
      targetRef = draft.combat.currentTargetRef!;
    draft.pendingWindows = draft.pendingWindows.filter(
      (item) => item.promptId !== window.promptId,
    );
    if (
      (dodge || specialDodge || block || armorKillBlock) &&
      isUnderground(draft, player.seat)
    ) {
      exitUnderground(tx, player.seat, "activeAttackResponse");
      if (this.ruleset)
        openMinerSourceDismantle(
          tx,
          this.ruleset,
          player.seat,
          Number(attack.attackerSeat) as Seat,
          window.deadlineAt,
          "activeAttackResponse",
        );
    }
    if (dodge || specialDodge || armorKillBlock) {
      const responseCardRef = command.cardRef!,
        responseKind = dodge || specialDodge ? "dodge" : "armorKillBlock";
      if (specialDodge)
        commitSpecialPlay(tx, this.ruleset!, {
          seat: player.seat,
          family: "dodge",
          offerId: command.offerId,
          prefix: `offer:attack-response:${attackId}`,
          sourceRef:
            typeof attack.weaponRef === "string"
              ? attack.weaponRef
              : `character:${Number(attack.attackerSeat)}`,
          deadlineAt: window.deadlineAt,
        });
      else {
        const hand = draft.zones[`hand:${player.seat}`]!,
          index = hand.orderedCardRefs.indexOf(responseCardRef);
        hand.orderedCardRefs.splice(index, 1);
        draft.zones.discardPile!.orderedCardRefs.push(responseCardRef);
        const card = draft.cards[responseCardRef]!;
        card.zoneRef = "discardPile";
        card.ownerSeat = null;
        card.controllerSeat = null;
        card.faceUp = true;
        tx.emit("card.responded", {
          cardRef: responseCardRef,
          seat: player.seat,
          responseKind,
        });
      }
      tx.emit("response.committed", {
        attackId,
        targetRef,
        seat: player.seat,
        responseKind,
      });
      tx.emit("response.resolved", {
        attackId,
        targetRef,
        responderSeat: player.seat,
        tags: [responseKind],
        result: "attackMiss",
      });
      tx.emit("response.window.closed", {
        attackId,
        targetRef,
        reason: "responseResolved",
      });
      finalizeHit(tx, false, responseKind);
    } else if (block) {
      tx.emit("response.committed", {
        attackId,
        targetRef,
        seat: player.seat,
        responseKind: "meleeBlock",
        weaponRef: command.cardRef!,
      });
      tx.emit("response.resolved", {
        attackId,
        targetRef,
        responderSeat: player.seat,
        tags: ["meleeBlock"],
        result: "attackMiss",
      });
      tx.emit("response.window.closed", {
        attackId,
        targetRef,
        reason: "responseResolved",
      });
      finalizeHit(tx, false, "meleeBlock");
    } else {
      tx.emit("response.passed", { attackId, targetRef, seat: player.seat });
      tx.emit("response.window.closed", {
        attackId,
        targetRef,
        reason: "allPassed",
      });
      finalizeHit(tx, true, "allPassed");
    }
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    let bridged = this.ruleset
      ? processCriticalPenetrationHitEvents(
          committed,
          this.ruleset,
          window.deadlineAt,
        )
      : committed;
    if (this.ruleset)
      bridged = processWizardSpellStrikeHitEvents(
        bridged,
        this.ruleset,
        window.deadlineAt,
      );
    if (
      this.ruleset &&
      bridged.events.some((event) => event.eventType === "response.resolved")
    )
      bridged = processMeleeCounterResponseEvents(bridged, this.ruleset);
    this.#state = bridged.state;
    const result = {
      accepted: true as const,
      commandId: command.commandId,
      previousRevision: committed.previousRevision,
      stateRevision: bridged.state.stateRevision,
      events: bridged.events,
    };
    this.#results.set(command.commandId, result);
    return structuredClone(result);
  }
  handleTimeout(commandId: string): AttackResponseResult {
    const window = this.#state.pendingWindows.find(
      (item) => item.kind === "attackResponse",
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
