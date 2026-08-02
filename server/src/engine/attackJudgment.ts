import type { LoadedRuleset } from "../ruleset/types.js";
import { beginDesignatedJudgmentChoice, beginJudgment, type PrintedColor } from "./judgment.js";
import { openPreJudgmentWindow } from "./preJudgment.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import type { JsonValue, TransactionCommit } from "./types.js";

interface JudgmentRule {
  judgmentId: string;
  timing: string;
  purpose: string;
  runOnHit?: boolean;
  runOnMiss?: boolean;
  effectsRequireAttackHit?: boolean;
  outcomes: Record<string, { matched: boolean; effects?: JsonValue[]; replacementSegments?: JsonValue[] }>;
}
interface WeaponTemplate { weaponId: string; judgments?: JudgmentRule[] }
type AttackRecord = Record<string, JsonValue>;

export function beginNextAttackJudgment(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  deadlineAt = 0,
): TransactionCommit<AuthoritativeGameState> | null {
  const raw = state.combat.attack;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const attack = raw as AttackRecord;
  const targetRef = state.combat.currentTargetRef;
  if (!targetRef) return null;
  const weaponId = typeof attack.weaponId === "string" ? attack.weaponId : null;
  const document = ruleset.documents.get("weapon-rules.json") as { templates: WeaponTemplate[] };
  const weapon = weaponId ? document.templates.find((item) => item.weaponId === weaponId) : undefined;
  const custom = Array.isArray(attack.customJudgments) ? attack.customJudgments as unknown as JudgmentRule[] : [];
  const rules = custom.length ? custom : weapon?.judgments ?? [];
  const status = String(attack.status);
  const occurrenceKey = typeof attack.pendingWeaponJudgmentOccurrenceKey === "string"
    ? attack.pendingWeaponJudgmentOccurrenceKey
    : null;
  const processed = new Set(
    (Array.isArray(attack.judgmentResults) ? attack.judgmentResults : [])
      .filter((item) => typeof item === "object" && item !== null && !Array.isArray(item))
      .map((item) => {
        const result = item as Record<string, JsonValue>;
        return `${String(result.judgmentRuleId)}:${String(result.targetRef)}:${String(result.occurrenceKey ?? "")}`;
      }),
  );
  const rule = rules.find((item) => {
    if (processed.has(`${item.judgmentId}:${targetRef}:${occurrenceKey ?? ""}`)) return false;
    if (status === "weaponJudgmentPerSegment") return item.timing === "damage.applied.after";
    if (status === "weaponJudgmentAfterBase") return item.timing === "attack.baseDamageSegments.after";
    if (status === "committed") return item.timing.includes("targeted.beforeResponse");
    if (status === "targetHit" && item.runOnMiss && !item.runOnHit) return false;
    if (status === "targetMiss" && !item.runOnMiss) return false;
    if (status === "targetMiss" && item.timing === "attack.miss") return true;
    return (status === "targetHit" || status === "targetMiss") &&
      (item.timing.includes("beforeDamage") || item.timing.includes("hitDetermined"));
  });
  if (!rule) return null;
  const colors = Object.entries(rule.outcomes)
    .filter(([color, outcome]) => color !== "default" && outcome.matched)
    .map(([color]) => color as PrintedColor);
  const effectsByColor = Object.fromEntries(Object.entries(rule.outcomes).map(([color, outcome]) => [
    color,
    [...(outcome.replacementSegments ? [{ op: "replaceDamageSegments", params: { segments: outcome.replacementSegments } } as unknown as JsonValue] : []), ...(outcome.effects ?? [])].map((effect) => {
      if (rule.effectsRequireAttackHit !== false || !effect || typeof effect !== "object" || Array.isArray(effect)) return effect;
      const copy = structuredClone(effect) as Record<string, JsonValue>;
      if (copy.op === "createDamage" && copy.params && typeof copy.params === "object" && !Array.isArray(copy.params))
        (copy.params as Record<string, JsonValue>).requiresAttackHit = false;
      return copy;
    }),
  ]));
  const input = {
    controllerSeat: Number(attack.attackerSeat) as Seat,
    sourceRef: typeof attack.weaponRef === "string" ? attack.weaponRef : null,
    purpose: rule.purpose,
    matchColors: colors,
    context: {
      attackId: String(attack.attackId),
      judgmentRuleId: rule.judgmentId,
      targetRef,
      resumeAttackStatus: status.startsWith("weaponJudgment") ? "targetHit" : status,
      effectsByColor,
      occurrenceKey: occurrenceKey ?? "",
      weaponJudgmentTiming: rule.timing,
    },
  };
  if (attack.guaranteedCritical === true && rule.purpose.toLowerCase().includes("critical"))
    return beginDesignatedJudgmentChoice(state, input, deadlineAt);
  return openPreJudgmentWindow(state, ruleset, input, deadlineAt) ?? beginJudgment(state, ruleset, input, deadlineAt);
}
