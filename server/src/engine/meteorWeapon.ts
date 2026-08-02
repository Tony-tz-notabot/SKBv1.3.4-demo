import type { AuthoritativeGameState, Seat } from "./state.js";
import { EngineTransaction } from "./transaction.js";
import { createCompositeScriptedAttackInTransaction } from "./scriptedAttack.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import type { TransactionCommit } from "./types.js";

const equipped = (s: AuthoritativeGameState, n: Seat) =>
  Object.values(s.zones)
    .filter(
      (z) =>
        z.ownerSeat === n &&
        ["weaponSlot", "thirdWeaponSlot"].includes(z.zoneType),
    )
    .flatMap((z) => z.orderedCardRefs)
    .find((ref) => s.cards[ref]?.templateId === "weapon.w58");
export function activateMeteorWeapon(
  state: AuthoritativeGameState,
  seat: Seat,
  killCardRef: string,
): TransactionCommit<AuthoritativeGameState> {
  const ref = equipped(state, seat),
    p = state.players.find((x) => x.seat === seat),
    card = ref ? state.cards[ref] : undefined;
  if (
    !ref ||
    !p ||
    state.activeSeat !== seat ||
    state.phase !== "play" ||
    state.phaseBoundary !== "body" ||
    state.combat.attack
  )
    throw Error("WEAPON_W58_NOT_ACTIVATABLE");
  if (
    p.markers.equipmentEffectsDisabled === true ||
    p.statuses.some((x) => x.statusId === "status.equipmentDisabled")
  )
    throw Error("WEAPON_INEFFECTIVE");
  if (Number(card!.runtime.cooldownOwnPreparesUntilReady ?? 0) > 0)
    throw Error("WEAPON_COOLDOWN_ACTIVE");
  if (Number(p.limits.attackCountRemaining ?? 0) < 1)
    throw Error("ATTACK_COUNT_UNPAYABLE");
  if (
    !state.zones[`hand:${seat}`]!.orderedCardRefs.includes(killCardRef) ||
    !state.cards[killCardRef]!.templateId.startsWith("basic.kill.")
  )
    throw Error("ATTACK_KILL_COST_INVALID");
  const tx = new EngineTransaction(state),
    d = tx.draft,
    hand = d.zones[`hand:${seat}`]!,
    i = hand.orderedCardRefs.indexOf(killCardRef);
  hand.orderedCardRefs.splice(i, 1);
  d.zones.resolving!.orderedCardRefs.push(killCardRef);
  Object.assign(d.cards[killCardRef]!, {
    zoneRef: "resolving",
    ownerSeat: seat,
    controllerSeat: seat,
    faceUp: true,
  });
  d.players.find((x) => x.seat === seat)!.limits.attackCountRemaining =
    Number(p.limits.attackCountRemaining) - 1;
  d.cards[ref]!.runtime.cooldownRemaining = 2;
  d.cards[ref]!.runtime.cooldownOwnPreparesUntilReady = 3;
  d.cards[ref]!.runtime.cooldownReadyRound = d.round + 3;
  const play = d.pendingWindows.find(
    (w) => w.kind === "playPhaseAction" && w.prioritySeat === seat,
  );
  if (play)
    d.pendingWindows = d.pendingWindows.filter(
      (w) => w.promptId !== play.promptId,
    );
  const targets = d.players
    .filter((x) => x.presence === "inPlay" && x.lifeState !== "eliminated")
    .sort((a, b) => ((a.seat - seat + 4) % 4) - ((b.seat - seat + 4) % 4));
  createCompositeScriptedAttackInTransaction(tx, {
    attackId: `attack:w58:${d.stateRevision + 1}:${seat}`,
    attackerSeat: seat,
    sourceRef: ref,
    weaponId: "weapon.w58",
    modeId: "meteor",
    range: "unlimited",
    targetGroups: targets.map((x) => ({
      targetRef: `character:${x.seat}`,
      attackTypes: ["field"],
      damageSegments: [
        {
          segmentId: "meteor",
          deliveryType: "field",
          attackType: "field",
          damageType: "normal",
          element: "none",
          amount: 3,
          repeat: 1,
          isAdditional: false,
          overflowPolicy: "default",
        },
      ],
    })),
    preserveTargetOrder: true,
    costCardRefs: [killCardRef],
    ...(play ? { resumePlayDeadlineAt: play.deadlineAt } : {}),
  });
  tx.emit("weapon.cooldown.started", {
    weaponRef: ref,
    cooldownId: "weapon.w58.cooldown",
    remaining: 2,
    readyRound: d.round + 3,
  });
  const out = tx.commit();
  out.state.history.domainEvents.push(...out.events);
  validateAuthoritativeState(out.state);
  return out;
}

export function tickMeteorCooldownAtPrepare(
  state: AuthoritativeGameState,
  seat: Seat,
): TransactionCommit<AuthoritativeGameState> | null {
  const ref = equipped(state, seat);
  if (!ref) return null;
  const remaining = Number(state.cards[ref]!.runtime.cooldownRemaining ?? 0);
  if (remaining <= 0) return null;
  const tx = new EngineTransaction(state),
    card = tx.draft.cards[ref]!,
    after = Math.max(0, remaining - 1);
  card.runtime.cooldownRemaining = after;
  tx.emit("weapon.cooldown.changed", {
    weaponRef: ref,
    before: remaining,
    after,
  });
  const out = tx.commit();
  out.state.history.domainEvents.push(...out.events);
  return out;
}

export function tickMeteorCooldownAtPrepareInTransaction(tx:EngineTransaction<AuthoritativeGameState>,seat:Seat):void{const ref=equipped(tx.draft,seat);if(!ref)return;const card=tx.draft.cards[ref]!,before=Number(card.runtime.cooldownOwnPreparesUntilReady??0);if(before<=0)return;const after=before-1;card.runtime.cooldownOwnPreparesUntilReady=after;card.runtime.cooldownRemaining=Math.max(0,after-1);tx.emit("weapon.cooldown.changed",{weaponRef:ref,before,after,printedRemaining:card.runtime.cooldownRemaining});}
