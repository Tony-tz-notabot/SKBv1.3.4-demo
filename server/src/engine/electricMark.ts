import type { LoadedRuleset } from "../ruleset/types.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import { applyDirectDamageInTransaction } from "./damage.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import type { DomainEvent, TransactionCommit } from "./types.js";

// 感电标记：带感电元素的攻击/效果命中后整一次叠加 1 层（除非特别说明），标记持续整场。
// 结算：整次攻击/效果结束后，先多人（≥2 名角色各 ≥2 层，全部 -2 并受 2 点真实伤害无来源）循环，
// 再单人（任意角色 ≥3 层，-3 并受 2 点真实伤害无来源）循环；每次结算后重新检查（多人优先）。
// 电盾：免疫获得标记；装备电盾时立即清除已有标记。
export const ELECTRIC_MARK = "electricMark";
const SETTLE_DAMAGE = 2;

const inPlay = (state: AuthoritativeGameState) =>
  state.players.filter(
    (p) => p.presence === "inPlay" && p.lifeState !== "eliminated",
  );
export function electricMarkCount(
  state: AuthoritativeGameState,
  seat: Seat,
): number {
  const p = state.players.find((x) => x.seat === seat);
  return p ? Math.max(0, Number(p.markers[ELECTRIC_MARK] ?? 0)) : 0;
}
export function hasElectricShield(
  state: AuthoritativeGameState,
  seat: Seat,
): boolean {
  const p = state.players.find((x) => x.seat === seat);
  if (!p) return false;
  if (p.initialTalentIds.includes("talent.electric_shield")) return true;
  if (
    p.markers.equipmentEffectsDisabled === true ||
    p.statuses.some((s) => s.statusId === "status.equipmentDisabled")
  )
    return false;
  return (state.zones[`talent:${seat}`]?.orderedCardRefs ?? []).some(
    (ref) => state.cards[ref]?.templateId === "talent.electric_shield",
  );
}
/** 叠感电标记；电盾免疫时返回 false 不叠加。返回是否实际叠加。 */
export function addElectricMarkInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  targetSeat: Seat,
  amount = 1,
): boolean {
  const p = tx.draft.players.find((x) => x.seat === targetSeat);
  if (
    !p ||
    p.lifeState === "eliminated" ||
    p.presence !== "inPlay" ||
    hasElectricShield(tx.draft, targetSeat)
  )
    return false;
  const before = Number(p.markers[ELECTRIC_MARK] ?? 0);
  p.markers[ELECTRIC_MARK] = before + amount;
  tx.emit("marker.changed", {
    seat: targetSeat,
    markerId: ELECTRIC_MARK,
    before,
    after: Number(p.markers[ELECTRIC_MARK]),
  });
  return true;
}
export function clearElectricMarkInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  targetSeat: Seat,
): void {
  const p = tx.draft.players.find((x) => x.seat === targetSeat);
  if (!p) return;
  const before = Number(p.markers[ELECTRIC_MARK] ?? 0);
  if (before === 0) return;
  p.markers[ELECTRIC_MARK] = 0;
  tx.emit("marker.changed", {
    seat: targetSeat,
    markerId: ELECTRIC_MARK,
    before,
    after: 0,
  });
}
const attackHasElectric = (state: AuthoritativeGameState): boolean => {
  const attack = state.combat.attack as
    | (Record<string, unknown> & { damageSegments?: unknown })
    | null;
  return (
    Array.isArray(attack?.damageSegments) &&
    (attack.damageSegments as Array<Record<string, unknown>>).some(
      (seg) => seg?.element === "electric",
    )
  );
};
/** 攻击命中桥：带感电元素的攻击命中后，整一次攻击给每个命中目标叠加 1 层（0 伤命中仍叠）。 */
export function applyElectricMarkOnAttackHit(
  commit: TransactionCommit<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
): TransactionCommit<AuthoritativeGameState> {
  const hitRefs = commit.events
    .filter((e) => e.eventType === "attack.hit")
    .map((e) =>
      e.payload && typeof e.payload === "object" && !Array.isArray(e.payload)
        ? String((e.payload as Record<string, unknown>).targetRef ?? "")
        : "",
    )
    .filter((ref) => ref.startsWith("character:"));
  if (!hitRefs.length || !attackHasElectric(commit.state)) return commit;
  const tx = new EngineTransaction(commit.state);
  for (const ref of hitRefs) {
    const seat = Number(ref.split(":")[1]) as Seat;
    addElectricMarkInTransaction(tx, seat, 1);
  }
  const out = tx.commit();
  out.state.history.domainEvents.push(...out.events);
  validateAuthoritativeState(out.state);
  return { ...out, events: [...commit.events, ...out.events] };
}
function settleRound(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  candidates: AuthoritativeGameState["players"],
  reduce: number,
  kind: "multi" | "single",
): TransactionCommit<AuthoritativeGameState> {
  const tx = new EngineTransaction(state),
    baseId = `damage:electric-mark:${kind}:${state.stateRevision + 1}`;
  for (const cand of candidates) {
    const p = tx.draft.players.find((x) => x.seat === cand.seat)!,
      seat = p.seat,
      before = Number(p.markers[ELECTRIC_MARK] ?? 0),
      after = Math.max(0, before - reduce);
    p.markers[ELECTRIC_MARK] = after;
    tx.emit("marker.changed", {
      seat,
      markerId: ELECTRIC_MARK,
      before,
      after,
    });
    if (p.hp !== null && p.shield !== null) {
      applyDirectDamageInTransaction(tx, {
        damageId: `${baseId}:${seat}`,
        sourceSeat: null,
        targetRef: `character:${seat}`,
        amount: SETTLE_DAMAGE,
        damageType: "true",
        element: "none",
        isAdditional: false,
        ruleset,
      });
      const hp = p.hp;
      tx.emit("dying.check", {
        sourceId: `${baseId}:${seat}`,
        targetRef: `character:${seat}`,
        hp,
      });
      if (hp !== null && hp <= 0) {
        p.lifeState = "dying";
        tx.draft.combat.dyingStack.push(`character:${seat}`);
        tx.emit("dying.enter", {
          sourceId: `${baseId}:${seat}`,
          targetRef: `character:${seat}`,
        });
      }
    } else {
      // 死亡未淘汰（无血盾条）角色：不能实际扣除伤害，仅消耗标记
      tx.emit("damage.prevented", {
        sourceId: `${baseId}:${seat}`,
        targetRef: `character:${seat}`,
        reason: "deadWithoutBars",
      });
    }
  }
  const out = tx.commit();
  out.state.history.domainEvents.push(...out.events);
  validateAuthoritativeState(out.state);
  return out;
}
/**
 * 感电标记结算（攻击/效果结束后调用）：先多人 ≥2 层循环，再单人 ≥3 层循环，
 * 每次结算后重新检查（多人优先）。期间产生的濒死进入 dyingStack 交由调度器处理。
 * 无任何结算返回 null。
 */
export function settleElectricMarks(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
): TransactionCommit<AuthoritativeGameState> | null {
  let current = state,
    first: TransactionCommit<AuthoritativeGameState> | null = null,
    last: TransactionCommit<AuthoritativeGameState> | null = null,
    allEvents: DomainEvent[] = [];
  for (let guard = 0; guard < 64; guard++) {
    const multi = inPlay(current).filter(
      (p) => electricMarkCount(current, p.seat) >= 2,
    );
    if (multi.length >= 2) {
      const out = settleRound(current, ruleset, multi, 2, "multi");
      allEvents.push(...out.events);
      first ??= out;
      last = out;
      current = out.state;
      continue;
    }
    const single = inPlay(current).filter(
      (p) => electricMarkCount(current, p.seat) >= 3,
    );
    if (single.length) {
      const out = settleRound(current, ruleset, single, 3, "single");
      allEvents.push(...out.events);
      first ??= out;
      last = out;
      current = out.state;
      continue;
    }
    return last
      ? {
          previousRevision: first!.previousRevision,
          state: last.state,
          events: allEvents,
        }
      : null;
  }
  return last
    ? {
        previousRevision: first!.previousRevision,
        state: last.state,
        events: allEvents,
      }
    : null;
}
