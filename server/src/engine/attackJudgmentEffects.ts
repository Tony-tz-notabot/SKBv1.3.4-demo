import type { LoadedRuleset } from "../ruleset/types.js";
import { applyStatusInTransaction } from "./status.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { JsonValue, TransactionCommit } from "./types.js";

type RecordValue = Record<string, JsonValue>;
const record = (value: JsonValue | undefined, code: string): RecordValue => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(code);
  return value as RecordValue;
};
const seatFromTarget = (targetRef: string): Seat => {
  const match = /^character:([1-4])$/.exec(targetRef);
  if (!match) throw new Error("JUDGMENT_EFFECT_TARGET_INVALID");
  return Number(match[1]) as Seat;
};

export function applyPendingAttackJudgmentEffects(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
): TransactionCommit<AuthoritativeGameState> | null {
  const rawAttack = state.combat.attack;
  if (!rawAttack || typeof rawAttack !== "object" || Array.isArray(rawAttack))
    return null;
  const attack = rawAttack as RecordValue,
    pending = Array.isArray(attack.pendingJudgmentEffects)
      ? attack.pendingJudgmentEffects
      : [];
  if (!pending.length) return null;
  const tx = new EngineTransaction(state),
    draftAttack = record(
      tx.draft.combat.attack ?? undefined,
      "ATTACK_CONTEXT_MISSING",
    ),
    segments = Array.isArray(draftAttack.damageSegments)
      ? draftAttack.damageSegments
      : [];
  for (const rawEntry of pending) {
    const entry = record(rawEntry, "JUDGMENT_EFFECT_ENTRY_INVALID"),
      effect = record(entry.effect, "JUDGMENT_EFFECT_INVALID"),
      op = String(effect.op),
      targetRef = String(entry.targetRef),
      params = record(effect.params, "JUDGMENT_EFFECT_PARAMS_INVALID");
    if (op === "createDamage") {
      if (
        params.requiresAttackHit === true &&
        draftAttack.currentTargetHit !== true
      )
        continue;
      const segment = record(params.segment, "JUDGMENT_DAMAGE_SEGMENT_INVALID");
      if (params.requiresAttackHit === false) segment.resolvesOnMiss = true;
      segments.push(structuredClone(segment));
      if (Array.isArray(draftAttack.pendingDamageOccurrences)) {
        const occurrences: JsonValue[] = [];
        const repeat = Number(segment.repeat);
        for (let repeatIndex = 0; repeatIndex < repeat; repeatIndex++)
          occurrences.push({ segment: structuredClone(segment), repeatIndex });
        if (entry.weaponJudgmentTiming === "damage.applied.after")
          draftAttack.pendingDamageOccurrences.unshift(...occurrences);
        else draftAttack.pendingDamageOccurrences.push(...occurrences);
      }
      tx.emit("damage.modified", {
        attackId: String(draftAttack.attackId),
        targetRef,
        reason: "judgmentAdditionalSegment",
        segmentId: String(segment.segmentId),
        judgmentRuleId: String(entry.judgmentRuleId),
      });
    } else if (op === "replaceDamageSegments") {
      if (!Array.isArray(params.segments)) throw new Error("JUDGMENT_REPLACEMENT_SEGMENTS_INVALID");
      segments.splice(0, segments.length, ...structuredClone(params.segments));
      tx.emit("damage.segments.replaced", { attackId: String(draftAttack.attackId), targetRef, judgmentRuleId: String(entry.judgmentRuleId), segmentCount: params.segments.length });
    } else if (op === "applyStatus") {
      applyStatusInTransaction(tx, ruleset, {
        ownerSeat: seatFromTarget(targetRef),
        statusId: String(params.statusId),
        sourceRef:
          typeof draftAttack.weaponRef === "string"
            ? draftAttack.weaponRef
            : null,
        metadata: {
          attackId: String(draftAttack.attackId),
          judgmentRuleId: String(entry.judgmentRuleId),
          finalColor: entry.finalColor ?? null,
        },
      });
    } else if (op === "applyCritical") {
      draftAttack.critical = true;
      draftAttack.precisionStrikeCriticalTargetRef = targetRef;
      tx.emit("critical.applied", {
        attackId: String(draftAttack.attackId),
        targetRef,
        sourceId: "talent.precision_strike",
      });
    } else if (
      op === "applyRestriction" &&
      params.restrictionId === "noHandDodgeForAttack"
    ) {
      draftAttack.cannotHandDodge = true;
      draftAttack.precisionStrikeNoHandDodgeTargetRef = targetRef;
      tx.emit("restriction.applied", {
        attackId: String(draftAttack.attackId),
        targetRef,
        restrictionId: "noHandDodgeForAttack",
      });
    } else throw new Error(`JUDGMENT_EFFECT_OP_UNSUPPORTED:${op}`);
  }
  draftAttack.damageSegments = segments;
  delete draftAttack.pendingJudgmentEffects;
  delete draftAttack.pendingWeaponJudgmentOccurrenceKey;
  const committed = tx.commit();
  committed.state.history.domainEvents.push(...committed.events);
  validateAuthoritativeState(committed.state);
  return committed;
}
