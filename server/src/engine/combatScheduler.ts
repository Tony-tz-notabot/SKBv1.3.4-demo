import type { LoadedRuleset } from "../ruleset/types.js";
import { resolveCurrentAttackTarget } from "./damage.js";
import { openDyingRescue } from "./dying.js";
import { openAttackResponse } from "./response.js";
import { beginNextAttackJudgment } from "./attackJudgment.js";
import { applyPendingAttackJudgmentEffects } from "./attackJudgmentEffects.js";
import { applyAttackCriticalModifier } from "./critical.js";
import type { AuthoritativeGameState } from "./state.js";
import type { DomainEvent, JsonValue } from "./types.js";
import { processCriticalPenetrationHitEvents } from "./triggerAttackFollowup.js";
import { processStatusAppliedTriggerEvents } from "./statusTriggerBridge.js";
import { openPendingOwlWindow, processOwlTargetAfterEvents } from "./owl.js";
import { processElfAimTargetAfterEvents } from "./elfAim.js";
import {
  isPendingHellfireDamage,
  processDemonicNatureTargetAfterEvents,
  processDemonmancerHellfireEvents,
} from "./demonmancer.js";
import { executeNextImmediateDamageEffect } from "./directDamage.js";
import {
  openPendingWizardSpellStrike,
  processWizardSpellStrikeHitEvents,
} from "./wizard.js";
import { grantBombsAfterAttack } from "./trapMaster.js";
import { processVineAfter } from "./druid.js";
import { processQiBallShieldBreaker } from "./qiMaster.js";
import { beginPrecisionStrikeJudgment } from "./precisionStrike.js";
import { openWrenchChoiceAfterHit, openWrenchChoiceFromState } from "./wrenchWeapon.js";
import { openTemporaryCoinChoiceAfterHit } from "./coinGun.js";
import { beginAnubisCurseResolution, recordAnubisProjectileHit } from "./anubisWeapon.js";

export type CombatStopReason =
  | "responseWindow"
  | "dyingWindow"
  | "judgment"
  | "playWindow"
  | "combatComplete"
  | "safetyLimit";
export interface CombatSchedulerResult {
  state: AuthoritativeGameState;
  events: DomainEvent[];
  steps: number;
  stoppedReason: CombatStopReason;
}
const attackStatus = (state: AuthoritativeGameState): string | null => {
  const attack = state.combat.attack;
  return attack && typeof attack === "object" && !Array.isArray(attack)
    ? String((attack as Record<string, JsonValue>).status)
    : null;
};
export function runCombatUntilBlocked(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  deadlineAt: () => number = Date.now,
): CombatSchedulerResult {
  let current = state,
    steps = 0;
  const events: DomainEvent[] = [],
    max = ruleset.settings.engine.autoAdvanceMaxSteps;
  while (steps < max) {
    const window = current.pendingWindows[0];
    if (window)
      return {
        state: current,
        events,
        steps,
        stoppedReason:
          window.kind === "attackResponse"
            ? "responseWindow"
            : window.kind === "dyingRescue"
              ? "dyingWindow"
              : window.kind === "judgmentIntervention" ||
                  window.kind === "judgmentDesignation" ||
                  window.kind === "preJudgment"
                ? "judgment"
                : "playWindow",
      };
    if (current.resolutionStack.length)
      return { state: current, events, steps, stoppedReason: "judgment" };
    if (isPendingHellfireDamage(current) && !current.combat.attack) {
      const applied = executeNextImmediateDamageEffect(current, ruleset);
      current = applied.state;
      events.push(...applied.events);
      steps++;
      continue;
    }
    if (current.combat.dyingStack.length) {
      const committed = openDyingRescue(current, deadlineAt(), ruleset);
      current = committed.state;
      events.push(...committed.events);
      steps++;
      continue;
    }
    if (!current.combat.attack)
      return { state: current, events, steps, stoppedReason: "combatComplete" };
    const status = attackStatus(current);
    const pendingJudgmentEffects = applyPendingAttackJudgmentEffects(
      current,
      ruleset,
    );
    if (pendingJudgmentEffects) {
      const afterStatus = pendingJudgmentEffects.events.some(
        (event) =>
          event.eventType === "status.applied" ||
          event.eventType === "status.refreshed",
      )
        ? processStatusAppliedTriggerEvents(
            pendingJudgmentEffects,
            ruleset,
            deadlineAt(),
          )
        : pendingJudgmentEffects;
      current = afterStatus.state;
      events.push(...afterStatus.events);
      steps++;
      continue;
    }
    const targetedJudgment = status === "committed"
      ? beginNextAttackJudgment(current, ruleset, deadlineAt())
      : null;
    if (targetedJudgment) {
      current = targetedJudgment.state;
      events.push(...targetedJudgment.events);
      steps++;
      continue;
    }
    const precision = beginPrecisionStrikeJudgment(
      current,
      ruleset,
      deadlineAt(),
    );
    if (precision) {
      current = precision.state;
      events.push(...precision.events);
      steps++;
      continue;
    }
    const pendingWizard = openPendingWizardSpellStrike(
      current,
      ruleset,
      deadlineAt(),
    );
    if (pendingWizard) {
      current = pendingWizard.state;
      events.push(...pendingWizard.events);
      steps++;
      continue;
    }
    if (status === "awaitingOwlTrigger") {
      const opened = openPendingOwlWindow(current, ruleset, deadlineAt());
      if (!opened) throw new Error("OWL_TRIGGER_NOT_OPENABLE");
      current = opened.state;
      events.push(...opened.events);
      steps++;
      continue;
    }
    if(status==="targetHit"){const special=openWrenchChoiceFromState(current,deadlineAt());if(special){current=special.state;events.push(...special.events.filter(e=>e.eventSeq!==0));steps++;continue;}}
    let committed =
      status === "committed"
        ? openAttackResponse(current, ruleset, deadlineAt())
        : null;
    if (!committed && (status === "targetHit" || status === "targetMiss" || status === "weaponJudgmentPerSegment" || status === "weaponJudgmentAfterBase"))
      committed =
        beginNextAttackJudgment(current, ruleset, deadlineAt()) ??
        (status === "targetHit" || status === "targetMiss"
          ? applyAttackCriticalModifier(current, ruleset) ??
            resolveCurrentAttackTarget(current, ruleset, deadlineAt(), true)
          : null);
    if (!committed) throw new Error(`COMBAT_STATUS_UNSUPPORTED:${status}`);
    if(committed.events.some(event=>event.eventType==="attack.hit"))committed=recordAnubisProjectileHit(committed);
    if(committed.events.some(event=>event.eventType==="attack.hit"))committed=openWrenchChoiceAfterHit(committed,deadlineAt());
    if(committed.events.some(event=>event.eventType==="attack.hit"))committed=openTemporaryCoinChoiceAfterHit(committed,deadlineAt());
    if(committed.events.some(event=>event.eventType==="attack.resolved"))committed=beginAnubisCurseResolution(committed,ruleset,deadlineAt());
    let bridged = committed.events.some(
      (event) => event.eventType === "attack.hit",
    )
      ? processCriticalPenetrationHitEvents(committed, ruleset, deadlineAt())
      : committed;
    if (bridged.events.some((event) => event.eventType === "attack.hit"))
      bridged = processWizardSpellStrikeHitEvents(
        bridged,
        ruleset,
        deadlineAt(),
      );
    if (
      bridged.events.some(
        (event) =>
          event.eventType === "status.applied" ||
          event.eventType === "status.refreshed",
      )
    )
      bridged = processStatusAppliedTriggerEvents(
        bridged,
        ruleset,
        deadlineAt(),
      );
    if (
      bridged.events.some((event) => event.eventType === "attack.target.after")
    ) {
      bridged = processDemonicNatureTargetAfterEvents(bridged);
      bridged = grantBombsAfterAttack(bridged);
      bridged = processVineAfter(bridged);
      bridged = processQiBallShieldBreaker(bridged, ruleset, deadlineAt());
      bridged = processDemonmancerHellfireEvents(
        bridged,
        ruleset,
        deadlineAt(),
      );
      bridged = processElfAimTargetAfterEvents(bridged, ruleset);
      bridged = processOwlTargetAfterEvents(bridged, ruleset, deadlineAt());
    }
    current = bridged.state;
    events.push(...bridged.events);
    steps++;
  }
  return { state: current, events, steps, stoppedReason: "safetyLimit" };
}
