import type { LoadedRuleset } from "../ruleset/types.js";
import { resolvePhaseBody } from "./phaseBody.js";
import type { AuthoritativeGameState } from "./state.js";
import { advanceTimeline } from "./timeline.js";
import type { DomainEvent } from "./types.js";
import {
  executeNextImmediateDamageEffect,
  hasImmediateDamageEffect,
} from "./directDamage.js";
import { openDyingRescue } from "./dying.js";
import { runCombatUntilBlocked } from "./combatScheduler.js";
import { settleElectricMarks } from "./electricMark.js";
import { beginStatueResolution } from "./statueEffects.js";
import { consumeLaserFishAttackCount } from "./laserFishWeapon.js";

export type SchedulerStopReason =
  "manualWindow" | "resolutionStack" | "gameNotRunning" | "safetyLimit";
export interface AutomaticSchedulerResult {
  state: AuthoritativeGameState;
  events: DomainEvent[];
  steps: number;
  stoppedReason: SchedulerStopReason;
}

export function runAutomaticScheduler(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  deadlineAt: () => number = Date.now,
  turnDeadlineAt: () => number = deadlineAt,
): AutomaticSchedulerResult {
  let current = state,
    steps = 0;
  const events: DomainEvent[] = [];
  const maxSteps = ruleset.settings.engine.autoAdvanceMaxSteps;
  if (!Number.isInteger(maxSteps) || maxSteps < 1)
    throw new Error("AUTO_ADVANCE_MAX_STEPS_INVALID");
  while (steps < maxSteps) {
    if (current.lifecycle !== "inProgress")
      return { state: current, events, steps, stoppedReason: "gameNotRunning" };
    if (current.resolutionStack.length || current.combat.responseStack.length)
      return {
        state: current,
        events,
        steps,
        stoppedReason: "resolutionStack",
      };
    if(current.activeSeat){const locked=consumeLaserFishAttackCount(current,current.activeSeat);if(locked){current=locked.state;events.push(...locked.events);steps++;continue;}}
    if (current.pendingWindows.length)
      return { state: current, events, steps, stoppedReason: "manualWindow" };
    // 双触判定后无需选择的雕像（法师/狂战士/牧师/刺客）自动结算
    const autoStatue=Object.values(current.cards).find(c=>c.zoneRef==="resolving"&&c.runtime.autoResolveStatueAfterJudgment===true);
    if (autoStatue) {
      delete autoStatue.runtime.autoResolveStatueAfterJudgment;
      const committed = beginStatueResolution(current, ruleset, autoStatue.cardRef, { deadlineAt: deadlineAt() });
      current = committed.state;
      events.push(...committed.events);
      steps += 1;
      continue;
    }
    if (current.combat.attack) {
      const combat = runCombatUntilBlocked(current, ruleset, deadlineAt);
      current = combat.state;
      events.push(...combat.events);
      steps += Math.max(1, combat.steps);
      if (
        combat.stoppedReason === "responseWindow" ||
        combat.stoppedReason === "dyingWindow" ||
        combat.stoppedReason === "playWindow"
      )
        return { state: current, events, steps, stoppedReason: "manualWindow" };
      if (combat.stoppedReason === "judgment")
        return {
          state: current,
          events,
          steps,
          stoppedReason: "resolutionStack",
        };
      continue;
    }
    if (current.combat.dyingStack.length) {
      const committed = openDyingRescue(current, deadlineAt(), ruleset);
      current = committed.state;
      events.push(...committed.events);
      steps += 1;
      continue;
    }
    if (hasImmediateDamageEffect(current)) {
      const committed = executeNextImmediateDamageEffect(
        current,
        ruleset,
        deadlineAt(),
      );
      current = committed.state;
      events.push(...committed.events);
      steps += 1;
      continue;
    }
    if (current.phaseBoundary === "body" && !current.phaseBodyResolved) {
      const committed = resolvePhaseBody(
        current,
        ruleset,
        deadlineAt(),
        turnDeadlineAt,
      );
      current = committed.state;
      events.push(...committed.events);
      steps += 1;
      continue;
    }
    // 攻击/效果结束后感电标记结算（先多人后单人，循环）
    const settled = settleElectricMarks(current, ruleset);
    if (settled) {
      current = settled.state;
      events.push(...settled.events);
      steps += 1;
      continue;
    }
    const committed = advanceTimeline(
      current,
      { kind: "normal" },
      ruleset,
      deadlineAt(),
    );
    current = committed.state;
    events.push(...committed.events);
    steps += 1;
  }
  if (current.pendingWindows.length)
    return { state: current, events, steps, stoppedReason: "manualWindow" };
  if (current.resolutionStack.length || current.combat.responseStack.length)
    return { state: current, events, steps, stoppedReason: "resolutionStack" };
  return { state: current, events, steps, stoppedReason: "safetyLimit" };
}
