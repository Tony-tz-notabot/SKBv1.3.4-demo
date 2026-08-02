import { EngineTransaction } from "./transaction.js";
import type {
  AuthoritativeGameState,
  Phase,
  PhaseMode,
  Seat,
} from "./state.js";
import type { TransactionCommit } from "./types.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import {
  expireStatusesAtPhaseAfter,
  expireStatusesAtPhaseBefore,
  statusPhaseDisposition,
} from "./status.js";
import { expireRoundShieldAtPrepareBefore } from "./killInvalidation.js";
import { expireGuaranteedCriticalAtTurnEnd } from "./guaranteedCritical.js";
import { activateGhostCrownAtPlayEnd } from "./armorRuntime.js";
import {
  eliminateIronPirateAtSecondEndStart,
  recordIronPiratePostDeathTurnStart,
} from "./deathReplacement.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import {
  onBossEndPhaseStart,
  onBossOwnerTurnStart,
  onBossTurnEnd,
} from "./bossLifecycle.js";
import { queuePurpleLordDemonBlade } from "./purpleLord.js";
import { openC6BombardmentAtPlayAfter } from "./c6h8o6.js";
import {
  onSpecialPlayOwnerTurnStart,
  resetSpecialPlayPrepareBefore,
} from "./specialCardPlay.js";
import {
  beginGoldenMaskReplacement,
  goldenMaskReplacementId,
  shouldReplaceWithGoldenMask,
} from "./goldenMask.js";
import { consumeDrawCountModifiersAtDrawBoundary } from "./drawCount.js";
import { beginGeneralDogSquadAtEndPhase } from "./general.js";
import { expireHornSquadAtPrepareBefore } from "./specialCards.js";
import { expireBloodAltarAtPrepareBefore } from "./bloodAltar.js";
import { expireSheepDodgeLocksAtTurnEnd } from "./sheep.js";
import { tickDivineBarrierAtPrepareBefore } from "./divineBarrier.js";
import { resetPriestAtPrepare } from "./priest.js";
import { queuePunchingBagInertiaAtSourceEnd } from "./punchingBag.js";
import {
  isTravelerOffField,
  recordTravelerOffFieldTurnStart,
  resolveDeadlyCurseReturnAtEnd,
} from "./traveler.js";
import {
  openMinerDigAtPlayEnd,
  openMinerNaturalExitAtPrepare,
} from "./miner.js";
import { tickDemonmancerPrepareDurations } from "./demonmancer.js";
import { tickNecromancerMarksAtPrepare } from "./necromancer.js";
import {
  expireAssassinCreedKillAtTurnEnd,
  onAssassinOwnerTurnStart,
  resetAssassinCreedKillAtPrepare,
} from "./assassin.js";
import { openBombDetonation, tickTrapCooldown } from "./trapMaster.js";
import { openEngineerMechAtPrepare } from "./engineer.js";
import { tickVineCooldown } from "./druid.js";
import { startScheduledWeaponAttackAtPrepare } from "./weaponScheduled.js";
const phases: Phase[] = [
  "prepare",
  "judgment",
  "draw",
  "play",
  "discard",
  "end",
];
const mode = (phase: Phase): PhaseMode =>
  phase === "play" || phase === "discard" ? "manual" : "automatic";
export type PhaseDisposition =
  | { kind: "normal" }
  | { kind: "skip"; reason: string }
  | { kind: "replace"; reason: string; replacementId: string };
function nextEligibleSeat(state: AuthoritativeGameState, from: Seat): Seat {
  for (let offset = 1; offset <= 4; offset++) {
    const seat = (((from - 1 + offset) % 4) + 1) as Seat;
    const player = state.players.find((item) => item.seat === seat)!;
    if (player.lifeState !== "eliminated") return seat;
  }
  throw new Error("NO_ELIGIBLE_TURN_OWNER");
}
function crossesSeat(from: Seat, to: Seat, anchor: Seat) {
  for (let offset = 1; offset <= 4; offset++) {
    const seat = (((from - 1 + offset) % 4) + 1) as Seat;
    if (seat === anchor) return true;
    if (seat === to) return false;
  }
  return false;
}
function enterPhase(
  transaction: EngineTransaction<AuthoritativeGameState>,
  phase: Phase,
  disposition: PhaseDisposition,
  ruleset?: LoadedRuleset,
  deadlineAt = 0,
) {
  const draft = transaction.draft,
    seat = draft.activeSeat!,
    owner = draft.players.find((item) => item.seat === seat)!;
  if (phase === "end" && ruleset)
    resolveDeadlyCurseReturnAtEnd(transaction, ruleset, seat);
  if (phase === "end" && ruleset)
    onBossEndPhaseStart(transaction, ruleset, seat);
  if (phase === "end" && ruleset)
    queuePunchingBagInertiaAtSourceEnd(transaction, ruleset, seat);
  if (
    phase === "end" &&
    owner.characterId === "character.interdimensional_traveler" &&
    owner.initialTalentIds.includes("talent.parallel_traversal") &&
    owner.markers.parallelTraversalDisabled !== true
  ) {
    const before =
        typeof owner.markers.healthFloor === "number"
          ? (owner.markers.healthFloor as number)
          : 3,
      after = Math.max(-1, before - 1);
    owner.markers.healthFloor = after;
    if (after !== before)
      transaction.emit("value.changed", {
        seat,
        path: "healthFloor",
        from: before,
        to: after,
        reason: "talent.parallel_traversal.ownerEndPhase",
      });
  }
  if (phase === "end") eliminateIronPirateAtSecondEndStart(transaction, seat);
  const eliminated = owner.lifeState === "eliminated";
  let effective: PhaseDisposition = eliminated
    ? { kind: "skip" as const, reason: "ownerEliminatedAtPhaseStart" }
    : disposition.kind === "normal"
      ? statusPhaseDisposition(draft, seat, phase)
      : disposition;
  if (isTravelerOffField(owner) && phase !== "end")
    effective = { kind: "skip", reason: "skill.deadlyCurse.leftPlay" };
  if (
    effective.kind === "normal" &&
    ruleset &&
    shouldReplaceWithGoldenMask(draft, ruleset, seat, phase)
  )
    effective = {
      kind: "replace",
      reason: "boss.golden_mask.active",
      replacementId: goldenMaskReplacementId,
    };
  draft.phase = phase;
  draft.phaseMode = mode(phase);
  draft.phaseBodyResolved = false;
  expireStatusesAtPhaseBefore(transaction,seat,phase);
  if (
    phase === "prepare" &&
    openMinerNaturalExitAtPrepare(transaction, deadlineAt)
  ) {
    // The mandatory field-damage target is chosen before normal prepare recovery.
  }
  if (phase === "prepare") {
    if (ruleset) startScheduledWeaponAttackAtPrepare(transaction, ruleset, seat);
    tickTrapCooldown(transaction, seat);
    openBombDetonation(transaction, seat, deadlineAt);
    openEngineerMechAtPrepare(transaction, seat, deadlineAt);
    tickVineCooldown(transaction, seat);
    tickDemonmancerPrepareDurations(transaction, seat);
    transaction.draft.players.find((player) => player.seat === seat)!.markers[
      "demonmancer.prepareDurationsTicked"
    ] = true;
    if (ruleset) tickNecromancerMarksAtPrepare(transaction, ruleset, seat);
    resetAssassinCreedKillAtPrepare(transaction, seat);
    tickDivineBarrierAtPrepareBefore(transaction, seat);
    expireBloodAltarAtPrepareBefore(transaction, seat);
    expireHornSquadAtPrepareBefore(transaction, seat);
    expireRoundShieldAtPrepareBefore(transaction, seat);
    resetSpecialPlayPrepareBefore(transaction, seat);
    resetPriestAtPrepare(transaction, seat);
  }
  transaction.emit("phase.before", { seat, phase });
  if (phase === "prepare" && ruleset)
    queuePurpleLordDemonBlade(transaction, seat);
  if (effective.kind === "skip") {
    draft.phaseBoundary = "after";
    draft.phaseBodyResolved = true;
    transaction.emit("phase.skip", { seat, phase, reason: effective.reason });
    if (phase === "draw")
      consumeDrawCountModifiersAtDrawBoundary(transaction, seat, "skipped");
    transaction.emit("phase.after", {
      seat,
      phase,
      skipped: true,
      replaced: false,
    });
    if (phase === "play" && ruleset)
      openC6BombardmentAtPlayAfter(transaction, ruleset, seat, deadlineAt);
    expireStatusesAtPhaseAfter(transaction, seat, phase, true);
    return;
  }
  if (effective.kind === "replace") {
    draft.phaseBoundary = "after";
    draft.phaseBodyResolved = true;
    transaction.emit("phase.replace", {
      seat,
      phase,
      reason: effective.reason,
      replacementId: effective.replacementId,
    });
    if (effective.replacementId === goldenMaskReplacementId && ruleset) {
      beginGoldenMaskReplacement(transaction, ruleset, seat, phase, deadlineAt);
      return;
    }
    transaction.emit("phase.after", {
      seat,
      phase,
      skipped: false,
      replaced: true,
    });
    if (phase === "play" && ruleset)
      openC6BombardmentAtPlayAfter(transaction, ruleset, seat, deadlineAt);
    expireStatusesAtPhaseAfter(transaction, seat, phase, false);
    return;
  }
  draft.phaseBoundary = "body";
  transaction.emit("phase.start", { seat, phase });
  transaction.emit("phase.body", { seat, phase, mode: draft.phaseMode });
  if (phase === "end" && ruleset)
    beginGeneralDogSquadAtEndPhase(transaction, ruleset, seat);
}
export function advanceTimeline(
  state: AuthoritativeGameState,
  nextDisposition: PhaseDisposition = { kind: "normal" },
  ruleset?: LoadedRuleset,
  deadlineAt = 0,
): TransactionCommit<AuthoritativeGameState> {
  if (
    state.lifecycle !== "inProgress" ||
    !state.activeSeat ||
    !state.phase ||
    !state.phaseBoundary
  )
    throw new Error("TIMELINE_NOT_ACTIVE");
  if (state.phaseBoundary === "body" && !state.phaseBodyResolved)
    throw new Error("PHASE_BODY_NOT_RESOLVED");
  if (
    state.pendingWindows.length ||
    state.resolutionStack.length ||
    state.combat.dyingStack.length
  )
    throw new Error("TIMELINE_NOT_STABLE");
  const transaction = new EngineTransaction(state),
    draft = transaction.draft,
    current = draft.phase!,
    seat = draft.activeSeat!;
  if (
    draft.phaseBoundary === "body" &&
    current === "play" &&
    ruleset &&
    openMinerDigAtPlayEnd(transaction, deadlineAt)
  ) {
    const committed = transaction.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    return committed;
  }
  if (draft.phaseBoundary === "body") {
    transaction.emit("phase.end.before", { seat, phase: current });
    transaction.emit("phase.end", { seat, phase: current });
    if (current === "play") activateGhostCrownAtPlayEnd(transaction, seat);
    transaction.emit("phase.after", {
      seat,
      phase: current,
      skipped: false,
      replaced: false,
    });
    if (current === "play" && ruleset)
      openC6BombardmentAtPlayAfter(transaction, ruleset, seat, deadlineAt);
    expireStatusesAtPhaseAfter(transaction, seat, current, false);
  }
  const index = phases.indexOf(current);
  if (index < phases.length - 1)
    enterPhase(
      transaction,
      phases[index + 1]!,
      nextDisposition,
      ruleset,
      deadlineAt,
    );
  else {
    transaction.emit("turn.end.before", { seat, round: draft.round });
    expireAssassinCreedKillAtTurnEnd(transaction, seat);
    transaction.emit("turn.end", { seat, round: draft.round });
    expireSheepDodgeLocksAtTurnEnd(transaction);
    if (ruleset) onBossTurnEnd(transaction, ruleset, seat);
    expireGuaranteedCriticalAtTurnEnd(transaction, seat);
    transaction.emit("turn.after", { seat, round: draft.round });
    const next = nextEligibleSeat(draft, seat);
    if (draft.setup && crossesSeat(seat, next, draft.setup.firstSeat))
      draft.round += 1;
    draft.activeSeat = next;
    onSpecialPlayOwnerTurnStart(transaction, next);
    onAssassinOwnerTurnStart(transaction, next);
    if (ruleset) onBossOwnerTurnStart(transaction, ruleset, next, deadlineAt);
    transaction.emit("turn.before", { seat: next, round: draft.round });
    transaction.emit("turn.start", { seat: next, round: draft.round });
    recordIronPiratePostDeathTurnStart(transaction, next);
    const returnNow = ruleset
      ? recordTravelerOffFieldTurnStart(transaction, ruleset, next)
      : false;
    enterPhase(
      transaction,
      returnNow ? "end" : "prepare",
      nextDisposition,
      ruleset,
      deadlineAt,
    );
  }
  const committed = transaction.commit();
  committed.state.history.domainEvents.push(...committed.events);
  validateAuthoritativeState(committed.state);
  return committed;
}
