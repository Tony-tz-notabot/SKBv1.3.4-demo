import type { AuthoritativeGameState, Seat } from "./state.js";
import { calculateEffectiveDistance } from "./distance.js";
import { EngineTransaction } from "./transaction.js";
import { createScriptedAttackInTransaction } from "./scriptedAttack.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import type { TransactionCommit } from "./types.js";
const weapon = (s: AuthoritativeGameState, n: Seat) =>
  Object.values(s.zones)
    .filter(
      (z) =>
        z.ownerSeat === n &&
        ["weaponSlot", "thirdWeaponSlot"].includes(z.zoneType),
    )
    .flatMap((z) => z.orderedCardRefs)
    .find((ref) => s.cards[ref]?.templateId === "weapon.w64");
function payKill(
  tx: EngineTransaction<AuthoritativeGameState>,
  seat: Seat,
  ref: string,
) {
  const h = tx.draft.zones[`hand:${seat}`]!,
    i = h.orderedCardRefs.indexOf(ref);
  if (i < 0 || !tx.draft.cards[ref]!.templateId.startsWith("basic.kill."))
    throw Error("ATTACK_KILL_COST_INVALID");
  h.orderedCardRefs.splice(i, 1);
  tx.draft.zones.discardPile!.orderedCardRefs.push(ref);
  Object.assign(tx.draft.cards[ref]!, {
    zoneRef: "discardPile",
    ownerSeat: null,
    controllerSeat: null,
    faceUp: true,
  });
}
export function aimLaserFish(
  state: AuthoritativeGameState,
  seat: Seat,
  targetSeat: Seat,
  killRef: string,
): TransactionCommit<AuthoritativeGameState> {
  const ref = weapon(state, seat),
    p = state.players.find((x) => x.seat === seat);
  if (
    !ref ||
    !p ||
    state.cards[ref]!.runtime.aimTarget ||
    state.activeSeat !== seat ||
    state.phase !== "play" ||
    calculateEffectiveDistance(state, seat, targetSeat) > 3 ||
    Number(p.limits.attackCountRemaining ?? 0) < 1
  )
    throw Error("WEAPON_W64_AIM_INVALID");
  const tx = new EngineTransaction(state);
  payKill(tx, seat, killRef);
  tx.draft.players.find((x) => x.seat === seat)!.limits.attackCountRemaining =
    Number(p.limits.attackCountRemaining) - 1;
  tx.draft.cards[ref]!.runtime.aimTarget = `character:${targetSeat}`;
  tx.emit("weapon.aim.changed", {
    weaponRef: ref,
    before: null,
    after: `character:${targetSeat}`,
  });
  const out = tx.commit();
  out.state.history.domainEvents.push(...out.events);
  validateAuthoritativeState(out.state);
  return out;
}
export function cancelLaserFishAim(
  state: AuthoritativeGameState,
  seat: Seat,
  killRef: string,
) {
  const ref = weapon(state, seat);
  if (!ref || typeof state.cards[ref]!.runtime.aimTarget !== "string")
    throw Error("WEAPON_W64_AIM_ABSENT");
  const tx = new EngineTransaction(state);
  payKill(tx, seat, killRef);
  const before = tx.draft.cards[ref]!.runtime.aimTarget ?? null;
  tx.draft.cards[ref]!.runtime.aimTarget = null;
  tx.emit("weapon.aim.changed", { weaponRef: ref, before, after: null });
  const out = tx.commit();
  out.state.history.domainEvents.push(...out.events);
  return out;
}
export function consumeLaserFishAttackCount(
  state: AuthoritativeGameState,
  seat: Seat,
): TransactionCommit<AuthoritativeGameState> | null {
  const ref = weapon(state, seat),
    p = state.players.find((x) => x.seat === seat),
    target = ref ? state.cards[ref]!.runtime.aimTarget : null;
  if (
    !ref ||
    !p ||
    typeof target !== "string" ||
    state.activeSeat !== seat ||
    state.phase !== "play" ||
    state.combat.attack ||
    state.pendingWindows.some((w) => w.kind !== "playPhaseAction") ||
    Number(p.limits.attackCountRemaining ?? 0) < 1
  )
    return null;
  const amount = Number(p.limits.attackCountRemaining),
    tx = new EngineTransaction(state);
  tx.draft.players.find((x) => x.seat === seat)!.limits.attackCountRemaining =
    amount - 1;
  const ts = Number(target.split(":")[1]) as Seat,
    legal =
      tx.draft.players.some(
        (x) =>
          x.seat === ts &&
          x.presence === "inPlay" &&
          x.lifeState !== "eliminated",
      ) && calculateEffectiveDistance(tx.draft, seat, ts) <= 3;
  if (legal) {
    const play = tx.draft.pendingWindows.find(
      (w) => w.kind === "playPhaseAction" && w.prioritySeat === seat,
    );
    if (play)
      tx.draft.pendingWindows = tx.draft.pendingWindows.filter(
        (w) => w.promptId !== play.promptId,
      );
    createScriptedAttackInTransaction(tx, {
      attackId: `attack:w64:${tx.draft.stateRevision + 1}:${amount}`,
      attackerSeat: seat,
      targetRef: target,
      sourceRef: ref,
      weaponId: "weapon.w64",
      modeId: "locked_attack",
      range: 3,
      attackTypes: ["laser"],
      damageSegments: [
        {
          segmentId: "base",
          deliveryType: "laser",
          attackType: "laser",
          damageType: "normal",
          element: "none",
          amount: 2,
          repeat: 1,
          isAdditional: false,
          overflowPolicy: "default",
        },
      ],
      tags: ["laserFish.locked"],
      ...(play ? { resumePlayDeadlineAt: play.deadlineAt } : {}),
    });
  } else
    tx.emit("weapon.w64.attackCount.consumedWithoutAttack", {
      weaponRef: ref,
      targetRef: target,
    });
  const out = tx.commit();
  out.state.history.domainEvents.push(...out.events);
  return out;
}
export function clearInvalidLaserFishAim(
  state: AuthoritativeGameState,
  seat: Seat,
) {
  const ref = weapon(state, seat);
  if (!ref) return null;
  const target = state.cards[ref]!.runtime.aimTarget;
  if (typeof target !== "string") return null;
  const ts = Number(target.split(":")[1]) as Seat,
    p = state.players.find((x) => x.seat === ts);
  if (p && p.presence === "inPlay" && p.lifeState !== "eliminated") return null;
  const tx = new EngineTransaction(state);
  tx.draft.cards[ref]!.runtime.aimTarget = null;
  tx.emit("weapon.aim.changed", {
    weaponRef: ref,
    before: target,
    after: null,
    reason: "targetUnavailable",
  });
  const out = tx.commit();
  out.state.history.domainEvents.push(...out.events);
  validateAuthoritativeState(out.state);
  return out;
}
