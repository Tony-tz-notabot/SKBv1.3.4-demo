import type { LoadedRuleset } from "../ruleset/types.js";
import type { AuthoritativeGameState } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import type { JsonValue } from "./types.js";

type Effect = { op: string; params?: Record<string, JsonValue> };
interface WeaponTemplate {
  weaponId: string;
  onAttackCommit?: Effect[];
}

export function applyWeaponCommitEffects(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  weaponRef: string | null,
  weaponId: string | null,
  modeId: string,
  targetRefs: readonly string[] = [],
  attackerSeat?: number,
): void {
  if (!weaponRef || !weaponId) return;
  const card = tx.draft.cards[weaponRef];
  if (!card) return;
  const document = ruleset.documents.get("weapon-rules.json") as { templates: WeaponTemplate[] };
  const weapon = document.templates.find((item) => item.weaponId === weaponId);
  for (const effect of weapon?.onAttackCommit ?? []) {
    const params = effect.params ?? {};
    if (effect.op === "transformCard") {
      if (typeof params.triggerOnlyForModeId === "string" && params.triggerOnlyForModeId !== modeId) continue;
      const toTemplateId = params.toTemplateId;
      if (typeof toTemplateId !== "string" || params.sameInstance !== true)
        throw new Error("WEAPON_COMMIT_TRANSFORM_INVALID");
      card.runtime.transformedBaseTemplateId = weaponId;
      card.runtime.restoreBaseTemplateOnLeaveEquipment = true;
      card.templateId = toTemplateId;
      tx.emit("card.transformed", { cardRef: weaponRef, fromTemplateId: weaponId, toTemplateId, reason: "weapon.onAttackCommit" });
      continue;
    }
    if (effect.op === "setValue") {
      const modes = Array.isArray(params.whenModeIn) ? params.whenModeIn : [];
      if (!modes.includes(modeId)) continue;
      const path = params.path;
      const toggle = params.toggle;
      if (typeof path !== "string" || !path.startsWith("state.") || !toggle || typeof toggle !== "object" || Array.isArray(toggle))
        throw new Error("WEAPON_COMMIT_SET_VALUE_INVALID");
      const stateId = path.slice("state.".length), before = card.runtime[stateId];
      if (typeof before !== "string") throw new Error("WEAPON_INSTANCE_STATE_INVALID");
      const after = (toggle as Record<string, JsonValue>)[before];
      if (typeof after !== "string") throw new Error("WEAPON_INSTANCE_STATE_INVALID");
      card.runtime[stateId] = after;
      tx.emit("weapon.instanceState.changed", { cardRef: weaponRef, weaponId, stateId, before, after, reason: "weapon.onAttackCommit" });
      continue;
    }
    if (effect.op === "if") {
      const condition = params.condition as Record<string, JsonValue> | undefined;
      const equals = condition?.eq;
      if (!Array.isArray(equals) || equals[0] !== "$attack.modeId" || equals[1] !== modeId) continue;
      const then = (effect as unknown as { then?: Effect[] }).then ?? [];
      for (const nested of then) {
        if (nested.op !== "scheduleEffect") throw new Error(`WEAPON_COMMIT_NESTED_EFFECT_UNSUPPORTED:${nested.op}`);
        const schedule = nested.params ?? {}, targetRef = targetRefs[0];
        if (!targetRef || typeof attackerSeat !== "number") throw new Error("WEAPON_SCHEDULE_CONTEXT_INVALID");
        tx.draft.scheduledEffects.push({
          scheduledId: `scheduled:weapon:${String(schedule.scheduleId)}:${tx.draft.stateRevision + 1}:${weaponRef}`,
          sourceRef: weaponRef,
          controllerSeat: attackerSeat as 1 | 2 | 3 | 4,
          executeAt: `weapon.ownerNextPrepareStart:${attackerSeat}`,
          effect: { op: "createScheduledWeaponAttack", weaponId, weaponRef, modeId, targetRef, attackerSeat, suppressScheduleIds: [String(schedule.scheduleId)] },
          cancelled: false,
        });
        tx.emit("effect.scheduled", { sourceRef: weaponRef, weaponId, scheduleId: String(schedule.scheduleId), executeAt: `weapon.ownerNextPrepareStart:${attackerSeat}`, targetRef });
      }
      continue;
    }
    throw new Error(`WEAPON_COMMIT_EFFECT_UNSUPPORTED:${effect.op}`);
  }
}
