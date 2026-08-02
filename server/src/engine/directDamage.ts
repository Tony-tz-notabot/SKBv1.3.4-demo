import { applyDirectDamageInTransaction } from "./damage.js";
import { openDivineBarrierDirectDamageWindow } from "./divineBarrier.js";
import {
  beginParallelTraversalJudgment,
  parallelTraversalController,
} from "./traveler.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { JsonValue, TransactionCommit } from "./types.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { completeGoldenMaskReplacement } from "./goldenMask.js";
import { continueC6AfterValkyrieInTransaction } from "./c6h8o6.js";
import {
  continuePaidAttackAfterBloodCurseInTransaction,
  type PaidAttackContinuation,
} from "./attack.js";
import {
  applySuperBabyElementPairInTransaction,
  cleanupSuperBabyInTransaction,
  startSuperBabyElementalStageInTransaction,
} from "./superBaby.js";
import { cleanupInternetAddictionInTransaction } from "./internetAddiction.js";
import {
  applySheepPhaseOneTargetInTransaction,
  startSheepPhaseTwoInTransaction,
} from "./sheep.js";
import { applyStatusInTransaction } from "./status.js";
import { beginJudgmentInTransaction } from "./judgment.js";

type EffectRecord = Record<string, JsonValue>;
const effectRecord = (value: JsonValue): EffectRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("SCHEDULED_EFFECT_INVALID");
  return value as EffectRecord;
};
const seatFromTarget = (targetRef: string): Seat => {
  const match = /^character:([1-4])$/.exec(targetRef);
  if (!match) throw new Error("DIRECT_DAMAGE_TARGET_INVALID");
  return Number(match[1]) as Seat;
};

export function hasImmediateDamageEffect(
  state: AuthoritativeGameState,
): boolean {
  return state.scheduledEffects.some(
    (item) => !item.cancelled && item.executeAt === "immediate.damagePipeline",
  );
}

export function executeNextImmediateDamageEffect(
  state: AuthoritativeGameState,
  ruleset?: LoadedRuleset,
  deadlineAt = Date.now(),
): TransactionCommit<AuthoritativeGameState> {
  if (
    state.pendingWindows.length ||
    state.resolutionStack.length ||
    state.combat.attack ||
    state.combat.dyingStack.length
  )
    throw new Error("DIRECT_DAMAGE_NOT_STABLE");
  const scheduled = state.scheduledEffects.find(
    (item) => !item.cancelled && item.executeAt === "immediate.damagePipeline",
  );
  if (!scheduled) throw new Error("DIRECT_DAMAGE_EFFECT_MISSING");
  const effect = effectRecord(scheduled.effect);
  if (effect.op === "applyAnubisCurse" || effect.op === "beginAnubisJudgment") {
    if (!ruleset) throw new Error("RULESET_REQUIRED");
    const tx = new EngineTransaction(state);
    tx.draft.scheduledEffects = tx.draft.scheduledEffects.filter(
      (x) => x.scheduledId !== scheduled.scheduledId,
    );
    if (effect.op === "applyAnubisCurse")
      applyStatusInTransaction(tx, ruleset, {
        ownerSeat: seatFromTarget(String(effect.targetRef)),
        statusId: "status.anubisCurse",
        sourceRef: String(effect.sourceRef),
      });
    else
      beginJudgmentInTransaction(
        tx,
        ruleset,
        {
          controllerSeat: seatFromTarget(String(effect.targetRef)),
          sourceRef: String(effect.sourceRef),
          purpose: "weapon.w56.anubisCurse",
          matchColors: (Array.isArray(effect.colors)
            ? effect.colors
            : []
          ).filter(
            (x): x is "white" | "green" | "blue" | "orange" | "red" =>
              ["white", "green", "blue", "orange", "red"].includes(String(x)),
          ),
          context: {
            anubisCurse: true,
            anubisTargetRef: String(effect.targetRef),
            anubisSourceRef: String(effect.sourceRef),
            anubisRemaining: effect.remaining ?? [],
          },
        },
        Number(effect.deadlineAt ?? deadlineAt),
      );
    const out = tx.commit();
    out.state.history.domainEvents.push(...out.events);
    validateAuthoritativeState(out.state);
    return out;
  }
  if (effect.op === "resumePlayWindow") {
    const tx = new EngineTransaction(state),
      draftScheduled = tx.draft.scheduledEffects.find(
        (item) => item.scheduledId === scheduled.scheduledId,
      )!;
    tx.draft.scheduledEffects = tx.draft.scheduledEffects.filter(
      (item) => item.scheduledId !== draftScheduled.scheduledId,
    );
    const seat = Number(effect.seat) as Seat,
      deadlineAt = Number(effect.deadlineAt);
    tx.draft.pendingWindows.push({
      promptId: `prompt:playPhaseAction:${tx.draft.round}:${seat}:${tx.draft.stateRevision + 1}`,
      kind: "playPhaseAction",
      prioritySeat: seat,
      mandatory: false,
      deadlineAt,
      timeoutPolicy: "pass",
      legalOfferIds: ["offer:playPhaseAction:finish"],
      context: {},
    });
    tx.emit("choice.requested", {
      seat,
      kind: "playPhaseAction",
      resumedAfterSpecialEffect: true,
    });
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    return committed;
  }
  if (effect.op === "cleanupInternetAddiction") {
    const tx = new EngineTransaction(state),
      draftScheduled = tx.draft.scheduledEffects.find(
        (item) => item.scheduledId === scheduled.scheduledId,
      )!;
    tx.draft.scheduledEffects = tx.draft.scheduledEffects.filter(
      (item) => item.scheduledId !== draftScheduled.scheduledId,
    );
    cleanupInternetAddictionInTransaction(tx, {
      cardRef: String(effect.cardRef),
      familyId: String(effect.familyId) as
        "special.sp01" | "special.sp02" | "special.sp03",
      sourceSeat: Number(effect.sourceSeat) as Seat,
      resumeDeadlineAt: Number(effect.resumeDeadlineAt),
    });
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    return committed;
  }
  if (
    effect.op === "applySheepPhaseOneTarget" ||
    effect.op === "startSheepPhaseTwo"
  ) {
    if (!ruleset) throw new Error("SHEEP_RULESET_REQUIRED");
    const tx = new EngineTransaction(state),
      draftScheduled = tx.draft.scheduledEffects.find(
        (item) => item.scheduledId === scheduled.scheduledId,
      )!;
    tx.draft.scheduledEffects = tx.draft.scheduledEffects.filter(
      (item) => item.scheduledId !== draftScheduled.scheduledId,
    );
    if (effect.op === "applySheepPhaseOneTarget")
      applySheepPhaseOneTargetInTransaction(tx, ruleset, {
        scheduledId: scheduled.scheduledId,
        cardRef: String(effect.cardRef),
        sourceSeat: Number(effect.sourceSeat) as Seat,
        targetRef: String(effect.targetRef),
        amount: Number(effect.amount),
      });
    else
      startSheepPhaseTwoInTransaction(
        tx,
        ruleset,
        {
          cardRef: String(effect.cardRef),
          sourceSeat: Number(effect.sourceSeat) as Seat,
          resumeDeadlineAt: Number(effect.resumeDeadlineAt),
        },
        Number(effect.resumeDeadlineAt),
      );
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    return committed;
  }
  if (effect.op === "completeGoldenMaskReplacement") {
    if (!ruleset) throw new Error("GOLDEN_MASK_RULESET_REQUIRED");
    const tx = new EngineTransaction(state),
      draftScheduled = tx.draft.scheduledEffects.find(
        (item) => item.scheduledId === scheduled.scheduledId,
      )!;
    tx.draft.scheduledEffects = tx.draft.scheduledEffects.filter(
      (item) => item.scheduledId !== draftScheduled.scheduledId,
    );
    completeGoldenMaskReplacement(
      tx,
      ruleset,
      Number(effect.seat) as Seat,
      String(effect.phase) as import("./state.js").Phase,
      Number(effect.deadlineAt ?? 0),
    );
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    return committed;
  }
  if (effect.op === "continueBossAfterValkyrie") {
    if (!ruleset) throw new Error("VALKYRIE_RULESET_REQUIRED");
    const tx = new EngineTransaction(state),
      draftScheduled = tx.draft.scheduledEffects.find(
        (item) => item.scheduledId === scheduled.scheduledId,
      )!;
    tx.draft.scheduledEffects = tx.draft.scheduledEffects.filter(
      (item) => item.scheduledId !== draftScheduled.scheduledId,
    );
    const data =
      effect.continuationData &&
      typeof effect.continuationData === "object" &&
      !Array.isArray(effect.continuationData)
        ? (effect.continuationData as Record<string, JsonValue>)
        : {};
    continueC6AfterValkyrieInTransaction(
      tx,
      ruleset,
      String(effect.continuationKind),
      data,
    );
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    return committed;
  }
  if (effect.op === "continuePaidAttackAfterBloodCurse") {
    if (!ruleset) throw new Error("BLOOD_CURSE_RULESET_REQUIRED");
    if (
      !effect.continuation ||
      typeof effect.continuation !== "object" ||
      Array.isArray(effect.continuation)
    )
      throw new Error("BLOOD_CURSE_CONTINUATION_INVALID");
    const tx = new EngineTransaction(state),
      draftScheduled = tx.draft.scheduledEffects.find(
        (item) => item.scheduledId === scheduled.scheduledId,
      )!;
    tx.draft.scheduledEffects = tx.draft.scheduledEffects.filter(
      (item) => item.scheduledId !== draftScheduled.scheduledId,
    );
    continuePaidAttackAfterBloodCurseInTransaction(
      tx,
      ruleset,
      effect.continuation as unknown as PaidAttackContinuation,
    );
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    return committed;
  }
  if (
    effect.op === "startSuperBabyElementalStage" ||
    effect.op === "applySuperBabyElementPair" ||
    effect.op === "cleanupSuperBaby"
  ) {
    if (!ruleset) throw new Error("SUPER_BABY_RULESET_REQUIRED");
    const tx = new EngineTransaction(state),
      draftScheduled = tx.draft.scheduledEffects.find(
        (item) => item.scheduledId === scheduled.scheduledId,
      )!;
    tx.draft.scheduledEffects = tx.draft.scheduledEffects.filter(
      (item) => item.scheduledId !== draftScheduled.scheduledId,
    );
    if (effect.op === "startSuperBabyElementalStage")
      startSuperBabyElementalStageInTransaction(
        tx,
        ruleset,
        String(effect.cardRef),
        Number(effect.sourceSeat) as Seat,
      );
    else if (effect.op === "applySuperBabyElementPair")
      applySuperBabyElementPairInTransaction(tx, ruleset, {
        scheduledId: scheduled.scheduledId,
        sourceSeat: Number(effect.sourceSeat) as Seat,
        targetRef: String(effect.targetRef),
        fireAmount: Number(effect.fireAmount),
        poisonAmount: Number(effect.poisonAmount),
      });
    else
      cleanupSuperBabyInTransaction(
        tx,
        String(effect.cardRef),
        Number(effect.sourceSeat) as Seat,
      );
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    return committed;
  }
  if (effect.op !== "createDamage")
    throw new Error("DIRECT_DAMAGE_OPERATION_UNSUPPORTED");
  const targetRef = String(effect.targetRef),
    targetSeat = seatFromTarget(targetRef),
    amount = Number(effect.amount),
    damageType = String(effect.damageType ?? "normal"),
    element = String(effect.element ?? "none");
  if (!Number.isFinite(amount) || amount < 0)
    throw new Error("DIRECT_DAMAGE_AMOUNT_INVALID");
  const parallelController = parallelTraversalController(
    state,
    scheduled.controllerSeat,
    targetSeat,
  );
  if (
    ruleset &&
    amount > 0 &&
    parallelController &&
    effect.parallelTraversalJudged !== true
  )
    return beginParallelTraversalJudgment(state, ruleset, {
      controllerSeat: parallelController,
      occurrenceKey: `direct:${scheduled.scheduledId}`,
      scheduledId: scheduled.scheduledId,
      targetRef,
      deadlineAt,
    });
  if (ruleset && effect.divineBarrierPassed !== true) {
    const opened = openDivineBarrierDirectDamageWindow(state, ruleset, {
      scheduledId: scheduled.scheduledId,
      targetSeat,
      targetRef,
      deadlineAt,
    });
    if (opened) return opened;
  }
  const tx = new EngineTransaction(state),
    draft = tx.draft,
    draftScheduled = draft.scheduledEffects.find(
      (item) => item.scheduledId === scheduled.scheduledId,
    )!;
  if (effect.parallelTraversalPrevented === true) {
    draft.scheduledEffects = draft.scheduledEffects.filter(
      (item) => item.scheduledId !== scheduled.scheduledId,
    );
    tx.emit("damage.prevented", {
      scheduledId: scheduled.scheduledId,
      targetRef,
      reason: "talent.parallel_traversal",
    });
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    return committed;
  }
  if (
    draftScheduled.effect &&
    typeof draftScheduled.effect === "object" &&
    !Array.isArray(draftScheduled.effect)
  )
    delete (draftScheduled.effect as Record<string, JsonValue>)
      .divineBarrierPassed;
  draft.scheduledEffects = draft.scheduledEffects.filter(
    (item) => item.scheduledId !== scheduled.scheduledId,
  );
  const player = draft.players.find((item) => item.seat === targetSeat)!;
  tx.emit("effect.execution.before", {
    scheduledId: scheduled.scheduledId,
    op: "createDamage",
    targetRef,
  });
  if (player.lifeState === "eliminated" || player.presence !== "inPlay")
    tx.emit("effect.cancelled", {
      scheduledId: scheduled.scheduledId,
      reason: "targetUnavailable",
      targetRef,
    });
  else {
    const result = applyDirectDamageInTransaction(tx, {
      damageId: `damage:${scheduled.scheduledId}`,
      sourceSeat: draftScheduled.controllerSeat,
      targetRef,
      amount: Math.floor(amount),
      damageType,
      element,
      isAdditional: effect.isAdditional === true,
      ignoreArmor: effect.ignoreArmor === true,
      ...(typeof effect.attackType === "string"
        ? { attackType: effect.attackType }
        : {}),
      ...(ruleset ? { ruleset } : {}),
    });
    tx.emit("effect.executed", {
      scheduledId: scheduled.scheduledId,
      op: "createDamage",
      targetRef,
      actualDamage: result.actualDamage,
      actualHpLoss: result.actualHpLoss,
      actualShieldLoss: result.actualShieldLoss,
    });
    tx.emit("dying.check", {
      sourceId: scheduled.scheduledId,
      targetRef,
      hp: player.hp,
    });
    if (player.hp !== null && player.hp <= 0) {
      player.lifeState = "dying";
      draft.combat.dyingStack.push(targetRef);
      tx.emit("dying.enter", { sourceId: scheduled.scheduledId, targetRef });
    }
  }
  const committed = tx.commit();
  committed.state.history.domainEvents.push(...committed.events);
  validateAuthoritativeState(committed.state);
  return committed;
}
