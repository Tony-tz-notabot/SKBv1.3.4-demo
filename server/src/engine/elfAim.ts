import type { LoadedRuleset } from "../ruleset/types.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { DomainEvent, JsonValue, TransactionCommit } from "./types.js";

const AIM_MARKER = "elf.aimTargetRef";
function definition(ruleset: LoadedRuleset) {
  const document = ruleset.documents.get("character-rules.json") as {
      rules: Array<{
        ruleId: string;
        effects?: Array<{ op?: string; params?: Record<string, unknown> }>;
      }>;
    },
    sourceRule = document.rules.find(
      (rule) => rule.ruleId === "character.elf.focusSource",
    ),
    attackRule = document.rules.find(
      (rule) => rule.ruleId === "character.elf.aimAttack",
    ),
    sourceParams = sourceRule?.effects?.[0]?.params,
    attackParams = attackRule?.effects?.[0]?.params;
  if (
    sourceRule?.effects?.[0]?.op !== "addMarker" ||
    sourceParams?.markerId !== "elf.aim" ||
    sourceParams.when !== "$actualHpLoss>0" ||
    attackRule?.effects?.[0]?.op !== "modifyEvent" ||
    attackParams?.killStillRequired !== true ||
    attackParams.preselectedWeaponStillRequired !== true ||
    attackParams.attackCountCost !== 0
  )
    throw new Error("ELF_AIM_RULE_INVALID");
}
export function elfAimTargetRef(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  seat: Seat,
) {
  definition(ruleset);
  const player = state.players.find((candidate) => candidate.seat === seat);
  return player?.characterId === "character.elf" &&
    player.skillIds.includes("skill.elf.focused_shot") &&
    typeof player.markers[AIM_MARKER] === "string"
    ? String(player.markers[AIM_MARKER])
    : null;
}
const payload = (event: DomainEvent) =>
  event.payload &&
  typeof event.payload === "object" &&
  !Array.isArray(event.payload)
    ? (event.payload as Record<string, JsonValue>)
    : {};
export function processElfAimTargetAfterEvents(
  committed: TransactionCommit<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
): TransactionCommit<AuthoritativeGameState> {
  definition(ruleset);
  let state = committed.state;
  const extra: DomainEvent[] = [];
  for (const event of committed.events) {
    if (event.eventType !== "attack.target.after") continue;
    const data = payload(event),
      actualHpLoss = Number(data.actualHpLoss ?? 0);
    if (actualHpLoss <= 0) continue;
    const targetRef = String(data.targetRef),
      targetSeat = Number(targetRef.split(":")[1]) as Seat,
      attackerSeat = Number(data.attackerSeat) as Seat,
      tx = new EngineTransaction(state),
      target = tx.draft.players.find((player) => player.seat === targetSeat)!,
      attacker = tx.draft.players.find(
        (player) => player.seat === attackerSeat,
      )!;
    let changed = false;
    if (
      target.characterId === "character.elf" &&
      target.skillIds.includes("skill.elf.focused_shot") &&
      attackerSeat !== targetSeat
    ) {
      const before = target.markers[AIM_MARKER] ?? null,
        after = `character:${attackerSeat}`;
      target.markers[AIM_MARKER] = after;
      tx.emit("marker.changed", {
        seat: targetSeat,
        markerId: AIM_MARKER,
        from: before,
        to: after,
        reason: "skill.elf.focused_shot.actualHpLossReceived",
        attackId: String(data.attackId),
      });
      changed = true;
    }
    if (
      attacker.characterId === "character.elf" &&
      attacker.skillIds.includes("skill.elf.focused_shot") &&
      attacker.markers[AIM_MARKER] === targetRef
    ) {
      delete attacker.markers[AIM_MARKER];
      tx.emit("marker.removed", {
        seat: attackerSeat,
        markerId: AIM_MARKER,
        priorTargetRef: targetRef,
        reason: "skill.elf.focused_shot.actualHpLossDealtToAim",
        attackId: String(data.attackId),
      });
      changed = true;
    }
    if (!changed) continue;
    const next = tx.commit();
    next.state.history.domainEvents.push(...next.events);
    validateAuthoritativeState(next.state);
    state = next.state;
    extra.push(...next.events);
  }
  return {
    previousRevision: committed.previousRevision,
    state,
    events: [...committed.events, ...extra],
  };
}

export const elfAimMarkerId = AIM_MARKER;
