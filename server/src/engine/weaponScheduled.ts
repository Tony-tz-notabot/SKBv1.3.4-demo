import type { LoadedRuleset } from "../ruleset/types.js";
import { calculateEffectiveDistance } from "./distance.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import type { JsonValue } from "./types.js";

export function startScheduledWeaponAttackAtPrepare(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  seat: Seat,
): boolean {
  if (tx.draft.combat.attack) return false;
  const executeAt = `weapon.ownerNextPrepareStart:${seat}`;
  const scheduled = tx.draft.scheduledEffects.find((item) => !item.cancelled && item.executeAt === executeAt);
  if (!scheduled) return false;
  tx.draft.scheduledEffects = tx.draft.scheduledEffects.filter((item) => item.scheduledId !== scheduled.scheduledId);
  const effect = scheduled.effect as Record<string, JsonValue>, targetRef = String(effect.targetRef), targetSeat = Number(targetRef.split(":")[1]) as Seat;
  const target = tx.draft.players.find((item) => item.seat === targetSeat);
  const document = ruleset.documents.get("weapon-rules.json") as { templates: Array<{ weaponId: string; attackModes: Array<Record<string, JsonValue>> }> };
  const weapon = document.templates.find((item) => item.weaponId === effect.weaponId);
  const mode = weapon?.attackModes.find((item) => item.modeId === effect.modeId);
  const range = mode?.range;
  if (!target || target.lifeState !== "alive" || target.presence !== "inPlay" || !mode || (typeof range === "number" && calculateEffectiveDistance(tx.draft, seat, targetSeat) > range)) {
    tx.emit("effect.cancelled", { scheduledId: scheduled.scheduledId, reason: "scheduledWeaponTargetInvalid", targetRef });
    return false;
  }
  const attackId = `attack:scheduled-weapon:${scheduled.scheduledId}`;
  tx.draft.combat.attack = {
    attackId, attackerSeat: seat, weaponRef: typeof effect.weaponRef === "string" ? effect.weaponRef : null,
    weaponId: String(effect.weaponId), modeId: String(effect.modeId), targetRefs: [targetRef], killCardRefs: [],
    range: range ?? "unlimited", attackTypes: structuredClone(mode.attackTypes ?? []), responsePolicy: String(mode.responsePolicy),
    damageSegments: structuredClone(mode.damageSegments ?? []), status: "committed", tags: ["scheduledWeaponAttack", "suppressSchedule:heavenly_fist_repeat"], resumePlayDeadlineAt: null,
  };
  tx.draft.combat.targetQueue = [targetRef]; tx.draft.combat.currentTargetRef = targetRef;
  tx.emit("attack.scheduled.started", { attackId, scheduledId: scheduled.scheduledId, weaponId: String(effect.weaponId), targetRef });
  return true;
}
