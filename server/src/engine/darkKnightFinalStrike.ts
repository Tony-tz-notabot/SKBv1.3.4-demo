import { eliminatePlayer } from "./deathReplacement.js";
import type {
  AuthoritativeGameState,
  PlayerRuntimeState,
  Seat,
} from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent, JsonValue, TransactionCommit } from "./types.js";

type AttackRecord = Record<string, JsonValue>;
const PENDING = "darkKnight.finalStrikePending",
  SWORDS = "darkKnight.blackSword",
  ROOT_SEAT = "darkKnight.finalStrikeRootAttackerSeat",
  RESUME_DEADLINE = "darkKnight.finalStrikeResumePlayDeadlineAt",
  CHOICE_DEADLINE = "darkKnight.finalStrikeChoiceDeadlineAt";
const boss = (state: AuthoritativeGameState, seat: Seat) => {
  const ref = state.zones[`boss:${seat}`]?.orderedCardRefs[0] ?? null,
    card = ref ? state.cards[ref] : null;
  return card?.templateId === "boss.dark_grand_knight" &&
    card.runtime.active === true
    ? { ref: ref!, card }
    : null;
};
const swordCount = (player: PlayerRuntimeState) =>
  typeof player.markers[SWORDS] === "number"
    ? Math.max(0, Math.floor(player.markers[SWORDS] as number))
    : 0;
const pendingPlayers = (state: AuthoritativeGameState) =>
  state.players.filter(
    (player) =>
      player.lifeState !== "eliminated" && player.markers[PENDING] === true,
  );
const legalTargets = (state: AuthoritativeGameState) =>
  state.players
    .filter(
      (player) =>
        player.lifeState !== "eliminated" && player.presence === "inPlay",
    )
    .map((player) => `character:${player.seat}`);

function restorePlay(
  tx: EngineTransaction<AuthoritativeGameState>,
  owner: PlayerRuntimeState,
): void {
  const draft = tx.draft,
    deadline = owner.markers[RESUME_DEADLINE],
    seat = Number(owner.markers[ROOT_SEAT]) as Seat;
  if (
    typeof deadline !== "number" ||
    ![1, 2, 3, 4].includes(seat) ||
    draft.lifecycle !== "inProgress" ||
    draft.pendingWindows.length
  )
    return;
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
function clearRuntime(player: PlayerRuntimeState): void {
  delete player.markers[PENDING];
  delete player.markers[ROOT_SEAT];
  delete player.markers[RESUME_DEADLINE];
  delete player.markers[CHOICE_DEADLINE];
}
function openWindow(
  tx: EngineTransaction<AuthoritativeGameState>,
  owner: PlayerRuntimeState,
): void {
  const draft = tx.draft,
    targets = legalTargets(draft),
    deadline = owner.markers[CHOICE_DEADLINE],
    promptId = `prompt:dark-knight-final-strike:${owner.seat}:${draft.stateRevision + 1}`;
  draft.pendingWindows.push({
    promptId,
    kind: "darkKnightFinalStrike",
    prioritySeat: owner.seat,
    mandatory: false,
    deadlineAt: typeof deadline === "number" ? deadline : 0,
    timeoutPolicy: "abortRemaining",
    legalOfferIds: [
      `offer:dark-knight-final-strike:pass:${owner.seat}`,
      ...(targets.length
        ? [`offer:dark-knight-final-strike:attack:${owner.seat}`]
        : []),
    ],
    context: { ownerSeat: owner.seat, legalTargetRefs: targets },
  });
  tx.emit("choice.requested", {
    seat: owner.seat,
    kind: "darkKnightFinalStrike",
    promptId,
    remainingBlackSwords: swordCount(owner),
  });
}
function preferredPending(
  state: AuthoritativeGameState,
  completedAttack?: AttackRecord,
): PlayerRuntimeState | undefined {
  const pending = pendingPlayers(state);
  if (!completedAttack) return pending.at(-1);
  const targetRef = Array.isArray(completedAttack.targetRefs)
      ? completedAttack.targetRefs[0]
      : null,
    targetSeat =
      typeof targetRef === "string" ? Number(targetRef.split(":")[1]) : NaN;
  return pending.find((player) => player.seat === targetSeat) ?? pending.at(-1);
}

export function replaceEliminationWithDarkKnightFinalStrike(
  tx: EngineTransaction<AuthoritativeGameState>,
  seat: Seat,
  choiceDeadlineAt: number,
): boolean {
  const draft = tx.draft,
    owner = draft.players.find((player) => player.seat === seat)!,
    source = boss(draft, seat);
  if (!source || swordCount(owner) <= 0) return false;
  const attack = draft.combat.attack as AttackRecord | null;
  owner.lifeState = "deadNotEliminated";
  owner.hp = null;
  owner.shield = null;
  owner.markers[PENDING] = true;
  owner.markers[ROOT_SEAT] = Number(
    attack?.rootAttackerSeat ?? attack?.attackerSeat ?? seat,
  );
  owner.markers[RESUME_DEADLINE] =
    typeof attack?.resumePlayDeadlineAt === "number"
      ? attack.resumePlayDeadlineAt
      : null;
  owner.markers[CHOICE_DEADLINE] = choiceDeadlineAt;
  tx.emit("elimination.replaced", {
    seat,
    replacementId: "boss.dark_grand_knight.finalStrike",
    bossRef: source.ref,
    remainingBlackSwords: swordCount(owner),
  });
  return true;
}

export function continuePendingDarkKnightFinalStrike(
  tx: EngineTransaction<AuthoritativeGameState>,
  completedAttack?: AttackRecord,
): boolean {
  const draft = tx.draft,
    owner = preferredPending(draft, completedAttack);
  if (!owner) return false;
  const source = boss(draft, owner.seat);
  if (!source || swordCount(owner) <= 0) {
    const resumeOwner = structuredClone(owner);
    owner.markers[SWORDS] = 0;
    clearRuntime(owner);
    eliminatePlayer(
      tx,
      owner.seat,
      source
        ? "darkKnightFinalStrikeComplete"
        : "darkKnightBossLeftDuringFinalStrike",
    );
    if (
      draft.lifecycle !== "ended" &&
      !continuePendingDarkKnightFinalStrike(tx, completedAttack)
    )
      restorePlay(tx, resumeOwner);
    return true;
  }
  openWindow(tx, owner);
  return true;
}

export function handleDarkKnightBossLeave(
  tx: EngineTransaction<AuthoritativeGameState>,
  seat: Seat,
): void {
  const draft = tx.draft,
    owner = draft.players.find((player) => player.seat === seat)!;
  owner.markers[SWORDS] = 0;
  if (owner.markers[PENDING] !== true) return;
  draft.pendingWindows = draft.pendingWindows.filter(
    (window) =>
      window.kind !== "darkKnightFinalStrike" || window.prioritySeat !== seat,
  );
  const attack = draft.combat.attack as AttackRecord | null,
    launched = attack && attack.darkKnightFinalStrikeOwnerSeat === seat;
  if (launched) {
    tx.emit("darkKnight.finalStrike.remaining.cancelled", {
      seat,
      reason: "bossLeft",
      launchedAttackContinues: true,
    });
    return;
  }
  const resumeOwner = structuredClone(owner);
  clearRuntime(owner);
  eliminatePlayer(tx, seat, "darkKnightBossLeftDuringFinalStrike");
  if (draft.lifecycle !== "ended" && !continuePendingDarkKnightFinalStrike(tx))
    restorePlay(tx, resumeOwner);
}

function commit(
  tx: EngineTransaction<AuthoritativeGameState>,
): TransactionCommit<AuthoritativeGameState> {
  const result = tx.commit();
  result.state.history.domainEvents.push(...result.events);
  validateAuthoritativeState(result.state);
  return result;
}
export interface DarkKnightFinalStrikeCommand {
  commandId: string;
  gameId: string;
  expectedStateRevision: number;
  actorUserId: string;
  promptId: string;
  offerId: string;
  targetRef?: string;
}
export type DarkKnightFinalStrikeResult =
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
export class DarkKnightFinalStrikeSession {
  #state: AuthoritativeGameState;
  readonly #results = new Map<string, DarkKnightFinalStrikeResult>();
  constructor(state: AuthoritativeGameState) {
    this.#state = state;
  }
  get state() {
    return this.#state;
  }
  handle(command: DarkKnightFinalStrikeCommand): DarkKnightFinalStrikeResult {
    const prior = this.#results.get(command.commandId);
    if (prior) return structuredClone(prior);
    const reject = (
      reasonCode: string,
      refreshRequired: boolean,
    ): DarkKnightFinalStrikeResult => {
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
      (item) => item.kind === "darkKnightFinalStrike",
    );
    if (!window || window.promptId !== command.promptId)
      return reject("PROMPT_CLOSED", true);
    const owner = this.#state.players.find(
      (player) => player.userId === command.actorUserId,
    );
    if (!owner || owner.seat !== window.prioritySeat)
      return reject("NOT_YOUR_PRIORITY", false);
    if (!window.legalOfferIds.includes(command.offerId))
      return reject("OFFER_EXPIRED", true);
    const attacks = command.offerId.includes(":attack:"),
      legal = window.context?.legalTargetRefs;
    if (
      attacks &&
      (!command.targetRef ||
        !Array.isArray(legal) ||
        !legal.includes(command.targetRef))
    )
      return reject("TARGET_INVALID", false);
    if (!attacks && command.targetRef) return reject("TARGET_INVALID", false);
    const tx = new EngineTransaction(this.#state),
      draft = tx.draft,
      draftOwner = draft.players.find((player) => player.seat === owner.seat)!;
    draft.pendingWindows = draft.pendingWindows.filter(
      (item) => item.promptId !== window.promptId,
    );
    if (!attacks) {
      const resumeOwner = structuredClone(draftOwner);
      draftOwner.markers[SWORDS] = 0;
      clearRuntime(draftOwner);
      eliminatePlayer(tx, draftOwner.seat, "darkKnightFinalStrikeDeclined");
      if (
        draft.lifecycle !== "ended" &&
        !continuePendingDarkKnightFinalStrike(tx)
      )
        restorePlay(tx, resumeOwner);
    } else {
      const before = swordCount(draftOwner);
      if (before <= 0 || !boss(draft, draftOwner.seat))
        return reject("FINAL_STRIKE_NO_LONGER_AVAILABLE", true);
      draftOwner.markers[SWORDS] = before - 1;
      const attackId = `attack:dark-knight-final-strike:${draft.stateRevision + 1}:${draftOwner.seat}`,
        targetRef = command.targetRef!;
      draft.combat.attack = {
        attackId,
        attackerSeat: draftOwner.seat,
        weaponRef: null,
        weaponId: "boss.dark_grand_knight",
        modeId: "finalStrike",
        targetRefs: [targetRef],
        killCardRefs: [],
        range: "unlimited",
        attackTypes: ["melee"],
        responsePolicy: "standardAttack",
        damageSegments: [
          {
            segmentId: "finalStrike",
            deliveryType: "attack",
            attackType: "melee",
            damageType: "normal",
            element: "none",
            amount: 3,
            repeat: 1,
            isAdditional: false,
            overflowPolicy: "normal",
          },
        ],
        ignoreArmor: true,
        cannotMeleeBlock: true,
        darkKnightFinalStrikeOwnerSeat: draftOwner.seat,
        rootAttackerSeat: draftOwner.markers[ROOT_SEAT] ?? null,
        resumePlayDeadlineAt: draftOwner.markers[RESUME_DEADLINE] ?? null,
        status: "committed",
      };
      draft.combat.targetQueue = [targetRef];
      draft.combat.currentTargetRef = targetRef;
      tx.emit("counter.changed", {
        seat: draftOwner.seat,
        counterId: SWORDS,
        from: before,
        to: before - 1,
        reason: "darkKnightFinalStrikeCommitted",
      });
      tx.emit("attack.declare", {
        attackId,
        attackerSeat: draftOwner.seat,
        sourceRef: `boss:${draftOwner.seat}`,
        modeId: "finalStrike",
      });
      tx.emit("attack.targets.chosen", { attackId, targetRefs: [targetRef] });
      tx.emit("attack.costs.paid", {
        attackId,
        blackSword: 1,
        killCardRefs: [],
        attackCount: 0,
      });
      tx.emit("attack.commit", {
        attackId,
        attackerSeat: draftOwner.seat,
        modeId: "finalStrike",
      });
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
  handleTimeout(commandId: string): DarkKnightFinalStrikeResult {
    const window = this.#state.pendingWindows.find(
      (item) => item.kind === "darkKnightFinalStrike",
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
