import type { LoadedRuleset } from "../ruleset/types.js";
import type { AuthoritativeGameState, Seat } from "./state.js";
import { calculateEffectiveDistance } from "./distance.js";
import { EngineTransaction } from "./transaction.js";
import { createScriptedAttackInTransaction } from "./scriptedAttack.js";
import { beginJudgmentInTransaction } from "./judgment.js";
import { applyStatusInTransaction } from "./status.js";
import type { JsonValue, TransactionCommit } from "./types.js";
type A = Record<string, JsonValue>;
const weapon = (s: AuthoritativeGameState, n: Seat) =>
  Object.values(s.zones)
    .filter(
      (z) =>
        z.ownerSeat === n &&
        ["weaponSlot", "thirdWeaponSlot"].includes(z.zoneType),
    )
    .flatMap((z) => z.orderedCardRefs)
    .find((ref) => s.cards[ref]?.templateId === "weapon.w56");
const attack = (
  id: string,
  seat: Seat,
  ref: string,
  target: string,
  last: boolean,
): A => ({
  attackId: id,
  attackerSeat: seat,
  weaponRef: ref,
  weaponId: "weapon.w56",
  modeId: "projectile",
  targetRefs: [target],
  killCardRefs: [],
  costCardRefs: [],
  range: 4,
  attackTypes: ["ranged"],
  responsePolicy: "standardAttack",
  damageSegments: [
    {
      segmentId: "projectile",
      deliveryType: "ranged",
      attackType: "ranged",
      damageType: "normal",
      element: "none",
      amount: 0,
      repeat: 1,
      isAdditional: false,
      overflowPolicy: "default",
    },
  ],
  status: "committed",
  tags: ["anubis.projectile"],
  anubisProjectile: true,
  anubisFinal: last,
});
export function activateAnubisProjectiles(
  state: AuthoritativeGameState,
  r: LoadedRuleset,
  seat: Seat,
  targets: string[],
  killRef: string,
): TransactionCommit<AuthoritativeGameState> {
  const ref = weapon(state, seat),
    p = state.players.find((x) => x.seat === seat),
    scatter = p?.initialTalentIds.includes("talent.scatter_up") ? 1 : 0,
    count = 2 + scatter;
  if (
    !ref ||
    !p ||
    targets.length !== count ||
    Number(p.limits.attackCountRemaining ?? 0) < 1 ||
    state.activeSeat !== seat ||
    state.phase !== "play"
  )
    throw Error("WEAPON_W56_ACTIVATION_INVALID");
  for (const t of targets) {
    const ts = Number(t.split(":")[1]) as Seat;
    if (
      !state.players.some(
        (x) =>
          x.seat === ts &&
          x.presence === "inPlay" &&
          x.lifeState !== "eliminated",
      ) ||
      calculateEffectiveDistance(state, seat, ts) > 4
    )
      throw Error("TARGET_NO_LONGER_LEGAL");
  }
  const tx = new EngineTransaction(state),
    h = tx.draft.zones[`hand:${seat}`]!,
    i = h.orderedCardRefs.indexOf(killRef);
  if (i < 0 || !tx.draft.cards[killRef]!.templateId.startsWith("basic.kill."))
    throw Error("ATTACK_KILL_COST_INVALID");
  h.orderedCardRefs.splice(i, 1);
  tx.draft.zones.resolving!.orderedCardRefs.push(killRef);
  Object.assign(tx.draft.cards[killRef]!, {
    zoneRef: "resolving",
    ownerSeat: seat,
    controllerSeat: seat,
    faceUp: true,
  });
  tx.draft.players.find((x) => x.seat === seat)!.limits.attackCountRemaining =
    Number(p.limits.attackCountRemaining) - 1;
  const ids = targets.map(
      (_, x) => `attack:w56:${tx.draft.stateRevision + 1}:${x + 1}`,
    ),
    first = attack(ids[0]!, seat, ref, targets[0]!, count === 1),
    rest = targets
      .slice(1)
      .map((t, x) => attack(ids[x + 1]!, seat, ref, t, x + 2 === count));
  first.costCardRefs = [killRef];
  first.afterAttackQueue = rest as unknown as JsonValue;
  const play = tx.draft.pendingWindows.find(
    (w) => w.kind === "playPhaseAction" && w.prioritySeat === seat,
  );
  if (play)
    tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
      (w) => w.promptId !== play.promptId,
    );
  first.resumePlayDeadlineAt = play?.deadlineAt ?? null;
  tx.draft.cards[ref]!.runtime.anubisBatch = {
    finalAttackId: ids.at(-1)!,
    hits: {},
  };
  createScriptedAttackInTransaction(tx, {
    attackId: String(first.attackId),
    attackerSeat: seat,
    targetRef: targets[0]!,
    sourceRef: ref,
    weaponId: "weapon.w56",
    modeId: "projectile",
    range: 4,
    attackTypes: ["ranged"],
    damageSegments: first.damageSegments as JsonValue[],
    costCardRefs: [killRef],
    tags: ["anubis.projectile"],
    ...(play ? { resumePlayDeadlineAt: play.deadlineAt } : {}),
  });
  const active = tx.draft.combat.attack as A;
  active.afterAttackQueue = rest as unknown as JsonValue;
  active.anubisProjectile = true;
  active.anubisFinal = count === 1;
  tx.emit("weapon.w56.batch.started", {
    weaponRef: ref,
    projectileCount: count,
    targetRefs: targets,
  });
  const out = tx.commit();
  out.state.history.domainEvents.push(...out.events);
  return out;
}
export function recordAnubisProjectileHit(
  commit: TransactionCommit<AuthoritativeGameState>,
) {
  const a = commit.state.combat.attack as A | null;
  if (!a || a.weaponId !== "weapon.w56" || a.anubisProjectile !== true)
    return commit;
  const target = commit.state.combat.currentTargetRef,
    ref = String(a.weaponRef),
    batch = commit.state.cards[ref]?.runtime.anubisBatch as A | undefined;
  if (!target || !batch) return commit;
  const tx = new EngineTransaction(commit.state),
    b = tx.draft.cards[ref]!.runtime.anubisBatch as A,
    h = (
      b.hits && typeof b.hits === "object" && !Array.isArray(b.hits)
        ? b.hits
        : {}
    ) as A;
  h[target] = Number(h[target] ?? 0) + 1;
  b.hits = h;
  const out = tx.commit();
  out.state.history.domainEvents.push(...out.events);
  return { ...out, events: [...commit.events, ...out.events] };
}
export function beginAnubisCurseResolution(
  commit: TransactionCommit<AuthoritativeGameState>,
  r: LoadedRuleset,
  deadlineAt: number,
) {
  const resolved = commit.events
    .filter((e) => e.eventType === "attack.resolved")
    .map((e) => String((e.payload as A).attackId));
  const card = Object.values(commit.state.cards).find(
    (c) =>
      c.templateId === "weapon.w56" &&
      c.runtime.anubisBatch &&
      resolved.includes(String((c.runtime.anubisBatch as A).finalAttackId)),
  );
  if (!card) return commit;
  const batch = card.runtime.anubisBatch as A,
    hits = (batch.hits ?? {}) as A,
    tx = new EngineTransaction(commit.state),
    entries = Object.entries(hits).map(([targetRef, n]) => ({
      targetRef,
      count: Number(n),
    }));
  tx.draft.cards[card.cardRef]!.runtime.anubisBatch = null;
  const pending = [] as Array<{
    targetRef: string;
    colors: Array<"white" | "green" | "blue" | "orange" | "red">;
  }>;
  for (const e of entries)
    if (e.count >= 3)
      applyStatusInTransaction(tx, r, {
        ownerSeat: Number(e.targetRef.split(":")[1]) as Seat,
        statusId: "status.anubisCurse",
        sourceRef: card.cardRef,
      });
    else if (e.count === 2)
      pending.push({
        targetRef: e.targetRef,
        colors: ["white", "green", "orange", "red"],
      });
    else if (e.count === 1)
      pending.push({ targetRef: e.targetRef, colors: ["orange", "red"] });
  if (pending.length) {
    const [first, ...remaining] = pending;
    beginJudgmentInTransaction(
      tx,
      r,
      {
        controllerSeat: Number(first!.targetRef.split(":")[1]) as Seat,
        sourceRef: card.cardRef,
        purpose: "weapon.w56.anubisCurse",
        matchColors: first!.colors,
        context: {
          anubisCurse: true,
          anubisTargetRef: first!.targetRef,
          anubisSourceRef: card.cardRef,
          anubisRemaining: remaining as unknown as JsonValue,
        },
      },
      deadlineAt,
    );
  }
  const out = tx.commit();
  out.state.history.domainEvents.push(...out.events);
  return { ...out, events: [...commit.events, ...out.events] };
}
