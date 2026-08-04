import type { AuthoritativeGameState, Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { JsonValue, TransactionCommit } from "./types.js";
import { finalizeCurrentAttack } from "./attackLifecycle.js";
import type { LoadedRuleset } from "../ruleset/types.js";
import { applyAttackTargetHpLossBenefits } from "./attackDamageBenefits.js";
import { expireBossInTransaction } from "./bossLifecycle.js";
import { applyStatusInTransaction } from "./status.js";
import { openDivineBarrierDamageWindowInTransaction } from "./divineBarrier.js";
import { recordPunchingBagInertia } from "./punchingBag.js";
import {
  beginParallelTraversalJudgment,
  parallelTraversalController,
} from "./traveler.js";
import { exitUnderground, isUnderground } from "./miner.js";
import {
  necromancerMarkExtraPotential,
  recordNecromancerAppliedDamage,
} from "./necromancer.js";
import { exitMech } from "./engineer.js";

type AttackRecord = Record<string, JsonValue>;
type SegmentRecord = Record<string, JsonValue>;
export interface AppliedDamageSegment {
  segmentId: string;
  repeatIndex: number;
  element: string;
  proposedDamage: number;
  finalDamage: number;
  actualDamage: number;
  actualSpecialLayerLoss: number;
  actualHpLoss: number;
  actualShieldLoss: number;
  receivedEvent: boolean;
  prevented: boolean;
  interruptedByDying?: boolean;
}
const record = (
  value: JsonValue | null,
  code: string,
): Record<string, JsonValue> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(code);
  return value as Record<string, JsonValue>;
};
const targetSeat = (ref: string): Seat => {
  const match = /^character:([1-4])$/.exec(ref);
  if (!match) throw new Error("ATTACK_TARGET_REF_INVALID");
  return Number(match[1]) as Seat;
};
const hasStatus = (
  state: AuthoritativeGameState,
  seat: Seat,
  statusId: string,
) =>
  state.players
    .find((item) => item.seat === seat)!
    .statuses.some((status) => status.statusId === statusId);
const equipmentEnabled = (state: AuthoritativeGameState, seat: Seat) => {
  const player = state.players.find((item) => item.seat === seat)!;
  return (
    player.markers.equipmentEffectsDisabled !== true &&
    !player.statuses.some(
      (status) => status.statusId === "status.equipmentDisabled",
    )
  );
};
const activeArmor = (state: AuthoritativeGameState, seat: Seat) => {
  const ref = state.zones[`armor:${seat}`]?.orderedCardRefs[0] ?? null;
  return ref ? { ref, card: state.cards[ref]! } : null;
};
const hasEffectiveTalent = (
  state: AuthoritativeGameState,
  seat: Seat,
  talentId: string,
) => {
  const player = state.players.find((item) => item.seat === seat)!;
  return (
    player.initialTalentIds.includes(talentId) ||
    (equipmentEnabled(state, seat) &&
      (state.zones[`talent:${seat}`]?.orderedCardRefs ?? []).some(
        (ref) => state.cards[ref]?.templateId === talentId,
      ))
  );
};
const ignoresArmor = (attack: AttackRecord) =>
  attack.ignoreArmor === true ||
  (Array.isArray(attack.attackTypes) && attack.attackTypes.includes("field"));
function offensiveElementSegments(
  tx: EngineTransaction<AuthoritativeGameState>,
  attack: AttackRecord,
  rawSegments: JsonValue[],
  targetRef: string,
): SegmentRecord[] {
  const attackerSeat = Number(attack.attackerSeat) as Seat,
    attacker = tx.draft.players.find((player) => player.seat === attackerSeat),
    segments = rawSegments.map((value) =>
      structuredClone(record(value, "DAMAGE_SEGMENT_INVALID")),
    );
  if (!attacker || attack.ignoreTalentModifiers === true) return segments;
  const eligible = (segment: SegmentRecord) =>
    segment.ignoreTalentModifiers !== true &&
    segment.ignoresTalent !== true &&
    !(Array.isArray(segment.tags) && segment.tags.includes("ignoresTalent"));
  for (const [element, talentId] of [
    ["fire", "talent.fire_shield"],
    ["poison", "talent.poison_shield"],
  ] as const) {
    if (!hasEffectiveTalent(tx.draft, attackerSeat, talentId)) continue;
    const segment = segments.find(
      (item) =>
        eligible(item) && item.element === element && Number(item.repeat) > 0,
    );
    if (!segment) continue;
    const before = Number(segment.repeat);
    segment.repeat = before + 1;
    tx.emit("attack.elementRepeat.modified", {
      attackId: String(attack.attackId),
      targetRef,
      attackerSeat,
      element,
      from: before,
      to: before + 1,
      sourceId: talentId,
    });
  }
  const totalBonuses: Record<string, number> = {};
  if (hasEffectiveTalent(tx.draft, attackerSeat, "talent.electric_shield"))
    totalBonuses.electric = (totalBonuses.electric ?? 0) + 1;
  if (hasEffectiveTalent(tx.draft, attackerSeat, "talent.elemental_burst"))
    for (const element of ["fire", "poison", "electric"])
      totalBonuses[element] = (totalBonuses[element] ?? 0) + 1;
  for (const [element, bonus] of Object.entries(totalBonuses)) {
    const segment = segments.find(
      (item) =>
        eligible(item) &&
        item.element === element &&
        Number(item.repeat) > 0 &&
        Number(item.amount) > 0,
    );
    if (!segment) continue;
    segment.firstRepeatElementBonus =
      Number(segment.firstRepeatElementBonus ?? 0) + bonus;
    tx.emit("attack.elementDamageTotal.modified", {
      attackId: String(attack.attackId),
      targetRef,
      attackerSeat,
      element,
      add: bonus,
      placement: "firstPositiveElementSegment",
    });
  }
  return segments;
}
function removeDepletedArmor(
  tx: EngineTransaction<AuthoritativeGameState>,
  seat: Seat,
  armorRef: string,
  to: "discardPile" | "outsideDeck" = "discardPile",
): void {
  const draft = tx.draft,
    zone = draft.zones[`armor:${seat}`]!,
    index = zone.orderedCardRefs.indexOf(armorRef);
  if (index < 0) return;
  zone.orderedCardRefs.splice(index, 1);
  draft.zones[to]!.orderedCardRefs.push(armorRef);
  const card = draft.cards[armorRef]!;
  card.zoneRef = to;
  card.ownerSeat = null;
  card.controllerSeat = null;
  card.faceUp = true;
  tx.emit("card.lost", {
    cardRef: armorRef,
    lostFamilyId: card.templateId,
    ownerSeat: seat,
    seat,
    fromZoneRef: `armor:${seat}`,
    fromZoneType: "armorSlot",
    reason: "durabilityDepleted",
    toZoneRef: to,
    moveKind: "remove",
  });
}
function armRefinedStaff(
  tx: EngineTransaction<AuthoritativeGameState>,
  attack: AttackRecord,
  targetRef: string,
  seat: Seat,
): void {
  const draft = tx.draft,
    player = draft.players.find((item) => item.seat === seat)!,
    armor = activeArmor(draft, seat),
    types = Array.isArray(attack.attackTypes) ? attack.attackTypes : [];
  if (
    ignoresArmor(attack) ||
    !equipmentEnabled(draft, seat) ||
    !armor ||
    armor.card.templateId !== "armor.a06" ||
    !types.includes("ranged") ||
    types.includes("laser") ||
    player.markers.refinedStaffUsed === true
  )
    return;
  player.markers.refinedStaffUsed = true;
  attack.refinedStaffPendingTarget = targetRef;
  tx.emit("limit.consumed", {
    seat,
    limitId: "armor.a06.firstHitRangedAttackPerOwnerRound",
    attackId: String(attack.attackId),
    targetRef,
  });
}
function queueMissReflection(
  tx: EngineTransaction<AuthoritativeGameState>,
  attack: AttackRecord,
  targetRef: string,
): void {
  if (attack.currentTargetHit !== false) return;
  const draft = tx.draft,
    seat = targetSeat(targetRef),
    player = draft.players.find((item) => item.seat === seat)!,
    types = Array.isArray(attack.attackTypes) ? attack.attackTypes : [],
    reason = String(attack.currentTargetMissReason ?? "unknown"),
    depth = Number(attack.chainDepth ?? 0);
  if (!types.includes("ranged") || reason.includes("ghostCrown") || depth >= 10)
    return;
  const taoist = player.skillIds.includes("skill.taoist.attack_reflection");
  if (!taoist) return;
  const sourceSeat = Number(attack.attackerSeat) as Seat,
    reflected = structuredClone(attack);
  for (const key of [
    "currentTargetHit",
    "currentTargetResult",
    "currentTargetMissReason",
    "currentTargetDamage",
    "pendingJudgmentEffects",
    "judgmentResults",
    "afterAttackQueue",
    "continuationQueue",
    "resumePlayDeadlineAt",
  ])
    delete reflected[key];
  reflected.attackId = `attack:reflection:${String(attack.attackId)}:${depth + 1}`;
  reflected.targetRefs = [`character:${sourceSeat}`];
  reflected.killCardRefs = [];
  reflected.status = "committed";
  reflected.chainDepth = depth + 1;
  reflected.generatedByAttackId = String(attack.attackId);
  reflected.reflectedBySeat = seat;
  const queue = Array.isArray(attack.afterAttackQueue)
    ? attack.afterAttackQueue
    : [];
  attack.afterAttackQueue = [...queue, reflected] as unknown as JsonValue;
  tx.emit("attack.queued", {
    attackId: String(reflected.attackId),
    parentAttackId: String(attack.attackId),
    kind: "taoistReflection",
    reflectorSeat: seat,
    chainDepth: depth + 1,
  });
}
function queueCrystalCrabCounter(
  tx: EngineTransaction<AuthoritativeGameState>,
  attack: AttackRecord,
  targetRef: string,
  actualDamage: number,
): void {
  if (actualDamage <= 0) return;
  const draft = tx.draft,
    seat = targetSeat(targetRef),
    bossRef = draft.zones[`boss:${seat}`]?.orderedCardRefs[0],
    boss = bossRef ? draft.cards[bossRef] : null,
    sourceSeat = Number(attack.attackerSeat) as Seat;
  if (
    !bossRef ||
    !boss ||
    boss.templateId !== "boss.crystal_crab" ||
    boss.runtime.active !== true ||
    draft.activeSeat === seat ||
    attack.crystalCrabCounterQueued === true
  )
    return;
  const counterId = `attack:crystal-crab:${String(attack.attackId)}:${seat}`,
    freezeEffect = { op: "applyStatus", params: { statusId: "status.frozen" } },
    counter: AttackRecord = {
      attackId: counterId,
      attackerSeat: seat,
      weaponRef: null,
      weaponId: "boss.crystal_crab.pincer",
      modeId: "pincer",
      targetRefs: [`character:${sourceSeat}`],
      killCardRefs: [],
      range: "unlimited",
      attackTypes: ["melee"],
      responsePolicy: "standardAttack",
      damageSegments: [
        {
          segmentId: "pincer",
          deliveryType: "attack",
          attackType: "melee",
          damageType: "normal",
          element: "none",
          amount: 1,
          repeat: 1,
          isAdditional: false,
          overflowPolicy: "normal",
        },
      ],
      customJudgments: [
        {
          judgmentId: "crystalCrabPincer",
          timing: "hitDetermined.beforeDamage",
          purpose: "criticalAndStatus",
          runOnHit: true,
          outcomes: {
            white: { matched: true, effects: [freezeEffect] },
            blue: { matched: true, effects: [freezeEffect] },
            default: { matched: false, effects: [] },
          },
        },
      ],
      status: "committed",
      generatedByAttackId: String(attack.attackId),
      launchCounterMarkerSeat: seat,
      launchCounterMarkerId: "crystalCrab.passivePincerLaunchedInWindow",
    };
  const queue = Array.isArray(attack.afterAttackQueue)
    ? attack.afterAttackQueue
    : [];
  attack.afterAttackQueue = [...queue, counter] as unknown as JsonValue;
  attack.crystalCrabCounterQueued = true;
  tx.emit("attack.queued", {
    attackId: counterId,
    parentAttackId: String(attack.attackId),
    kind: "crystalCrabPassivePincer",
    attackerSeat: seat,
    targetSeat: sourceSeat,
    bossRef,
  });
}
function applyOne(
  tx: EngineTransaction<AuthoritativeGameState>,
  attack: AttackRecord,
  segment: SegmentRecord,
  repeatIndex: number,
  elementBudget: Record<string, number>,
  explicitTargetRef?: string,
  ruleset?: LoadedRuleset,
): AppliedDamageSegment {
  const draft = tx.draft,
    targetRef = explicitTargetRef ?? draft.combat.currentTargetRef!,
    seat = targetSeat(targetRef),
    player = draft.players.find((item) => item.seat === seat)!,
    attackId = String(attack.attackId),
    segmentId = String(segment.segmentId),
    element = String(segment.element ?? "none"),
    raw = Number(segment.amount),
    offensiveBonus =
      repeatIndex === 0 ? Number(segment.firstRepeatElementBonus ?? 0) : 0;
  if (!Number.isFinite(raw) || raw < 0)
    throw new Error("DAMAGE_AMOUNT_INVALID");
  let proposedDamage = Math.floor(raw) + offensiveBonus;
  const damageType = String(segment.damageType),
    isTrue = damageType === "true",
    deadWithoutBars =
      player.lifeState === "deadNotEliminated" &&
      player.hp === null &&
      player.shield === null;
  tx.emit("damage.proposed", {
    attackId,
    targetRef,
    segmentId,
    repeatIndex,
    amount: proposedDamage,
  });
  if (offensiveBonus > 0)
    tx.emit("damage.modified", {
      attackId,
      targetRef,
      segmentId,
      repeatIndex,
      from: Math.floor(raw),
      to: proposedDamage,
      reason: "offensiveElementTotalBonus",
      element,
      add: offensiveBonus,
    });
  tx.emit("damage.immunity.check", {
    attackId,
    targetRef,
    segmentId,
    repeatIndex,
  });
  tx.emit("damage.replacement.before", {
    attackId,
    targetRef,
    segmentId,
    repeatIndex,
  });
  if (proposedDamage > 0 && attack.refinedStaffPendingTarget === targetRef) {
    const before = proposedDamage;
    proposedDamage = Math.max(0, proposedDamage - 2);
    delete attack.refinedStaffPendingTarget;
    tx.emit("damage.modified", {
      attackId,
      targetRef,
      segmentId,
      repeatIndex,
      from: before,
      to: proposedDamage,
      reason: "armor.a06.refinedStaff",
    });
  }
  if (proposedDamage > 0 && (elementBudget[element] ?? 0) > 0) {
    const before = proposedDamage,
      used = Math.min(proposedDamage, elementBudget[element]!);
    proposedDamage -= used;
    elementBudget[element] = (elementBudget[element] ?? 0) - used;
    tx.emit("damage.modified", {
      attackId,
      targetRef,
      segmentId,
      repeatIndex,
      from: before,
      to: proposedDamage,
      reason: "talent.adaptive_evolution",
      element,
      consumedReduction: used,
    });
  }
  const armor = activeArmor(draft, seat),
    currentDurability =
      armor && typeof armor.card.runtime.durability === "number"
        ? armor.card.runtime.durability
        : 3,
    boxKind =
      armor?.card.templateId === "armor.a02" ||
      armor?.card.templateId === "armor.a09",
    boxActive =
      proposedDamage > 0 &&
      !ignoresArmor(attack) &&
      equipmentEnabled(draft, seat) &&
      boxKind &&
      currentDurability > 0,
    invincible = hasStatus(draft, seat, "status.invincible"),
    elementImmune =
      (element === "fire" &&
        (hasEffectiveTalent(draft, seat, "talent.fire_shield") ||
          hasEffectiveTalent(draft, seat, "talent.element_origin"))) ||
      (element === "poison" &&
        hasEffectiveTalent(draft, seat, "talent.poison_shield")),
    immune = invincible || elementImmune;
  let boxDepleted = false;
  if (boxActive && armor) {
    const current = currentDurability,
      remaining = Math.max(0, current - 1);
    armor.card.runtime.durability = remaining;
    boxDepleted = remaining === 0;
    tx.emit("armor.durability.changed", {
      seat,
      armorRef: armor.ref,
      from: current,
      to: remaining,
      attackId,
      segmentId,
      repeatIndex,
    });
    if (armor.card.templateId === "armor.a09") {
      const sourceSeat = Number(attack.attackerSeat) as Seat,
        counterId = `attack:trap:${attackId}:${segmentId}:${repeatIndex}`,
        counter: AttackRecord = {
          attackId: counterId,
          attackerSeat: seat,
          weaponRef: null,
          weaponId: "armor.a09",
          modeId: "trapCounter",
          targetRefs: [`character:${sourceSeat}`],
          killCardRefs: [],
          range: "unlimited",
          attackTypes: ["ranged"],
          responsePolicy: "standardAttack",
          damageSegments: [
            {
              segmentId: "trapCounter",
              deliveryType: "attack",
              attackType: "ranged",
              damageType: "normal",
              element: "none",
              amount: 2,
              repeat: 1,
              isAdditional: false,
              overflowPolicy: "normal",
            },
          ],
          status: "committed",
          generatedByAttackId: attackId,
          ...(boxDepleted ? { removeArmorAfterAttackRef: armor.ref } : {}),
        };
      const queue = Array.isArray(attack.afterAttackQueue)
        ? attack.afterAttackQueue
        : [];
      attack.afterAttackQueue = [...queue, counter] as unknown as JsonValue;
      tx.emit("attack.queued", {
        attackId: counterId,
        parentAttackId: attackId,
        sourceRef: armor.ref,
        attackerSeat: seat,
        targetSeat: sourceSeat,
      });
    }
  }
  let finalDamage =
    immune || boxActive
      ? 0
      : isTrue
        ? proposedDamage
        : Math.max(0, proposedDamage - player.ironShield);
  if (immune)
    tx.emit("damage.prevented", {
      attackId,
      targetRef,
      segmentId,
      repeatIndex,
      reason: invincible ? "invincible" : "elementImmunity",
      element,
    });
  else if (boxActive)
    tx.emit("damage.prevented", {
      attackId,
      targetRef,
      segmentId,
      repeatIndex,
      reason:
        armor!.card.templateId === "armor.a09"
          ? "armor.a09.trapBox"
          : "armor.a02.box",
      armorRef: armor!.ref,
    });
  else if (finalDamage !== proposedDamage)
    tx.emit("damage.modified", {
      attackId,
      targetRef,
      segmentId,
      repeatIndex,
      from: proposedDamage,
      to: finalDamage,
      reason: "ironShield",
    });
  const bombs = Number(player.markers["trap.bombs"] ?? 0);
  if (
    player.characterId === "character.trap_master" &&
    finalDamage > 0 &&
    bombs > 0
  ) {
    const spent = Math.min(bombs, finalDamage),
      before = finalDamage;
    finalDamage -= spent;
    if (spent === bombs) delete player.markers["trap.bombs"];
    else player.markers["trap.bombs"] = bombs - spent;
    tx.emit("damage.modified", {
      attackId,
      targetRef,
      segmentId,
      repeatIndex,
      from: before,
      to: finalDamage,
      reason: "skill.trap_master.bomb_defense",
      bombsSpent: spent,
    });
  }
  const redLordRef = draft.zones[`boss:${seat}`]?.orderedCardRefs.find(
      (ref) =>
        draft.cards[ref]?.templateId === "boss.red_lord" &&
        draft.cards[ref]?.runtime.active === true,
    ),
    redLord = redLordRef ? draft.cards[redLordRef] : undefined;
  if (redLord && finalDamage > 0) {
    const before = finalDamage;
    finalDamage = 1;
    if (before !== finalDamage)
      tx.emit("damage.modified", {
        attackId,
        targetRef,
        segmentId,
        repeatIndex,
        from: before,
        to: finalDamage,
        reason: "boss.red_lord.positiveDamageReplacement",
        sourceRef: redLordRef!,
      });
  }
  const markExtraPotential = ruleset
    ? necromancerMarkExtraPotential(
        draft,
        ruleset,
        seat,
        proposedDamage,
        finalDamage,
        immune || boxActive || isTrue,
      )
    : 0;
  let actualSpecialLayerLoss = 0,
    actualHpLoss = 0,
    actualShieldLoss = 0,
    receivedEvent = false,
    interruptedByDying = false,
    depletedSlimeRef: string | null = null;
  if (deadWithoutBars) {
    receivedEvent = true;
  } else if (finalDamage > 0) {
    if (player.hp === null || player.shield === null)
      throw new Error("DAMAGE_TARGET_BARS_MISSING");
    const mechBefore = Number(player.markers["engineer.mechShield"] ?? 0);
    if (player.markers["engineer.mechActive"] === true && mechBefore > 0) {
      const loss = Math.min(mechBefore, finalDamage);
      player.markers["engineer.mechShield"] = mechBefore - loss;
      actualSpecialLayerLoss += loss;
      finalDamage = 0;
      tx.emit("specialLayer.lost", {
        seat,
        layerId: "engineer.mechShield",
        amount: loss,
        remaining: mechBefore - loss,
        attackId,
        segmentId,
      });
      if (loss === mechBefore) exitMech(tx, seat, "shieldDepleted");
    }
    const shieldBefore = player.shield,
      slimeRef = draft.zones[`boss:${seat}`]?.orderedCardRefs.find((ref) => {
        const card = draft.cards[ref];
        return (
          card?.templateId === "boss.giant_slime" &&
          card.runtime.active === true &&
          card.runtime.specialLayerId === "giantSlime.temporaryHp" &&
          Number(card.runtime.specialLayerRemaining ?? 0) > 0
        );
      }),
      slime = slimeRef ? draft.cards[slimeRef] : undefined,
      slimeBefore = slime
        ? Number(slime.runtime.specialLayerRemaining ?? 0)
        : 0,
      extraBefore =
        typeof player.markers["punchingBag.extraHp"] === "number"
          ? (player.markers["punchingBag.extraHp"] as number)
          : 0,
      healthFloor =
        typeof player.markers.healthFloor === "number"
          ? (player.markers.healthFloor as number)
          : -1,
      usesExtra = damageType !== "shield";
    const slimeLoss = usesExtra ? Math.min(slimeBefore, finalDamage) : 0,
      slimeDepleted = slimeLoss > 0 && slimeLoss === slimeBefore;
    if (slime && slimeLoss > 0) {
      slime.runtime.specialLayerRemaining = slimeBefore - slimeLoss;
      tx.emit("specialLayer.lost", {
        seat,
        layerId: "giantSlime.temporaryHp",
        sourceRef: slimeRef!,
        amount: slimeLoss,
        remaining: slimeBefore - slimeLoss,
        attackId,
        segmentId,
      });
    }
    const afterSlime = slimeDepleted ? 0 : finalDamage - slimeLoss,
      punchingLoss = usesExtra ? Math.min(extraBefore, afterSlime) : 0;
    actualSpecialLayerLoss = slimeLoss + punchingLoss;
    if (punchingLoss > 0) {
      player.markers["punchingBag.extraHp"] = extraBefore - punchingLoss;
      tx.emit("specialLayer.lost", {
        seat,
        layerId: "punchingBag.extraHp",
        amount: punchingLoss,
        remaining: extraBefore - punchingLoss,
        attackId,
        segmentId,
      });
    }
    const routedDamage = afterSlime - punchingLoss;
    if (damageType === "hp") {
      const hpBefore = player.hp;
      player.hp = Math.max(healthFloor, player.hp - routedDamage);
      actualHpLoss = hpBefore - player.hp;
    } else if (damageType === "shield") {
      actualShieldLoss = Math.min(player.shield, routedDamage);
      player.shield -= actualShieldLoss;
    } else if (damageType === "normal" || damageType === "true") {
      actualShieldLoss = Math.min(player.shield, routedDamage);
      player.shield -= actualShieldLoss;
      const overflow = routedDamage - actualShieldLoss,
        blueShield =
          player.initialTalentIds.includes("talent.blue_shield") &&
          shieldBefore > 0;
      if (overflow > 0 && !blueShield) {
        const hpBefore = player.hp;
        player.hp = Math.max(healthFloor, player.hp - overflow);
        actualHpLoss = hpBefore - player.hp;
      }
    } else throw new Error("DAMAGE_TYPE_REQUIRES_RULE_RESOLVER");
    receivedEvent =
      actualSpecialLayerLoss + actualHpLoss + actualShieldLoss > 0;
    if (shieldBefore > 0 && player.shield === 0) {
      player.markers.shieldBroken = true;
      tx.emit("shield.broken", { seat, attackId, segmentId });
    }
    if (slimeDepleted && slimeRef) {
      depletedSlimeRef = slimeRef;
    }
  }
  const actualDamage = actualSpecialLayerLoss + actualHpLoss + actualShieldLoss;
  if (actualDamage > 0 && isUnderground(tx.draft, seat))
    exitUnderground(tx, seat, "actualPositiveDamage");
  const inertiaSourceSeat =
    attack.directDamage === true
      ? typeof attack.damageSourceSeat === "number"
        ? (Number(attack.damageSourceSeat) as Seat)
        : null
      : (Number(attack.attackerSeat) as Seat);
  if (ruleset)
    recordNecromancerAppliedDamage(tx, ruleset, {
      sourceSeat: inertiaSourceSeat,
      targetSeat: seat,
      actualDamage,
      markExtraActual: Math.min(markExtraPotential, actualDamage),
    });
  recordPunchingBagInertia(tx, seat, inertiaSourceSeat, actualDamage);
  if (redLord && redLordRef && actualDamage > 0) {
    const count =
      Number(redLord.runtime["redLord.actualPositiveDamageCount"] ?? 0) + 1;
    redLord.runtime["redLord.actualPositiveDamageCount"] = count;
    tx.emit("boss.counter.changed", {
      seat,
      sourceRef: redLordRef,
      counterId: "redLord.actualPositiveDamageCount",
      value: count,
      attackId,
      segmentId,
      repeatIndex,
    });
    if (count >= 4) {
      if (!ruleset) throw new Error("RED_LORD_RULESET_REQUIRED");
      expireBossInTransaction(tx, redLordRef, "fourthActualDamage");
      applyStatusInTransaction(tx, ruleset, {
        ownerSeat: seat,
        statusId: "status.frozen",
        sourceRef: redLordRef,
        metadata: { reason: "boss.red_lord.fourthActualDamage" },
      });
      applyStatusInTransaction(tx, ruleset, {
        ownerSeat: seat,
        statusId: "status.electrified",
        sourceRef: redLordRef,
        metadata: { reason: "boss.red_lord.fourthActualDamage" },
      });
    }
  }
  tx.emit("damage.finalized", {
    attackId,
    targetRef,
    segmentId,
    repeatIndex,
    element,
    finalDamage,
    actualDamage,
    actualSpecialLayerLoss,
    actualHpLoss,
    actualShieldLoss,
    receivedEvent,
  });
  if (receivedEvent)
    tx.emit("damage.received", {
      attackId,
      targetRef,
      segmentId,
      repeatIndex,
      element,
      actualDamage,
      actualSpecialLayerLoss,
      actualHpLoss,
      actualShieldLoss,
      deadWithoutBars,
    });
  if (actualShieldLoss > 0)
    tx.emit("shield.shieldLost", {
      seat,
      amount: actualShieldLoss,
      attackId,
      segmentId,
    });
  if (actualHpLoss > 0)
    tx.emit("health.hpLost", {
      seat,
      amount: actualHpLoss,
      attackId,
      segmentId,
    });
  if (actualDamage > 0)
    tx.emit("damage.applied", {
      attackId,
      targetRef,
      segmentId,
      repeatIndex,
      element,
      actualDamage,
      actualSpecialLayerLoss,
    });
  tx.emit("damage.after", {
    attackId,
    targetRef,
    segmentId,
    repeatIndex,
    element,
    actualDamage,
  });
  if (depletedSlimeRef) {
    expireBossInTransaction(tx, depletedSlimeRef, "temporaryLayerDepleted");
    tx.emit("specialLayer.depleted", {
      seat,
      layerId: "giantSlime.temporaryHp",
      sourceRef: depletedSlimeRef,
      attackId,
      segmentId,
    });
    const backlash = applyDirectDamageInTransaction(tx, {
      damageId: `damage:giant-slime-backlash:${depletedSlimeRef}:${attackId}:${segmentId}:${repeatIndex}`,
      sourceSeat: seat,
      targetRef,
      amount: 5,
      damageType: "normal",
      element: "none",
      isAdditional: false,
      ignoreArmor: true,
      ...(ruleset ? { ruleset } : {}),
    });
    tx.emit("boss.effect.resolved", {
      sourceRef: depletedSlimeRef,
      modeId: "temporaryLayerBacklash",
      targetSeat: seat,
      actualDamage: backlash.actualDamage,
    });
    interruptedByDying = player.hp !== null && player.hp <= 0;
  }
  if (boxDepleted && armor && armor.card.templateId === "armor.a02")
    removeDepletedArmor(tx, seat, armor.ref);
  return {
    segmentId,
    repeatIndex,
    element,
    proposedDamage,
    finalDamage,
    actualDamage,
    actualSpecialLayerLoss,
    actualHpLoss,
    actualShieldLoss,
    receivedEvent,
    prevented: immune || boxActive,
    ...(interruptedByDying ? { interruptedByDying: true } : {}),
  };
}
export function applyDirectDamageInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  input: {
    damageId: string;
    sourceSeat: Seat | null;
    targetRef: string;
    amount: number;
    damageType: string;
    element: string;
    isAdditional: boolean;
    ignoreArmor?: boolean;
    attackType?: string;
    ruleset?: LoadedRuleset;
  },
): AppliedDamageSegment {
  const context: AttackRecord = {
      attackId: input.damageId,
      attackerSeat: input.sourceSeat ?? 1,
      attackTypes: input.attackType ? [input.attackType] : [],
      ignoreArmor: input.ignoreArmor ?? false,
      directDamage: true,
      damageSourceSeat: input.sourceSeat,
    },
    segment: SegmentRecord = {
      segmentId: input.damageId,
      deliveryType: "direct",
      attackType: input.attackType ?? "effect",
      damageType: input.damageType,
      element: input.element,
      amount: input.amount,
      repeat: 1,
      isAdditional: input.isAdditional,
      overflowPolicy: "normal",
    };
  tx.draft.combat.damageSegment = structuredClone(segment);
  const result = applyOne(
    tx,
    context,
    segment,
    0,
    {},
    input.targetRef,
    input.ruleset,
  );
  tx.draft.combat.damageSegment = null;
  const queued = Array.isArray(context.afterAttackQueue)
    ? context.afterAttackQueue.filter(
        (item): item is AttackRecord =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
  if (queued.length) {
    const [first, ...remaining] = structuredClone(queued);
    first!.continuationQueue = remaining as unknown as JsonValue;
    tx.draft.combat.attack = first!;
    tx.draft.combat.targetQueue = Array.isArray(first!.targetRefs)
      ? first!.targetRefs.filter(
          (ref): ref is string => typeof ref === "string",
        )
      : [];
    tx.draft.combat.currentTargetRef = tx.draft.combat.targetQueue[0] ?? null;
    tx.emit("attack.queued.started", {
      attackId: String(first!.attackId),
      parentDamageId: input.damageId,
    });
  }
  return result;
}
function cleanupAttackCards(
  tx: EngineTransaction<AuthoritativeGameState>,
  attack: AttackRecord,
): void {
  const draft = tx.draft,
    refs = [...new Set([
      ...(Array.isArray(attack.killCardRefs)?attack.killCardRefs.filter((ref):ref is string=>typeof ref==="string"):[]),
      ...(Array.isArray(attack.costCardRefs)?attack.costCardRefs.filter((ref):ref is string=>typeof ref==="string"):[]),
    ])];
  for (const ref of refs) {
    const card = draft.cards[ref];
    if (!card || card.zoneRef !== "resolving") continue;
    const zone = draft.zones.resolving!,
      index = zone.orderedCardRefs.indexOf(ref);
    zone.orderedCardRefs.splice(index, 1);
    draft.zones.discardPile!.orderedCardRefs.push(ref);
    card.zoneRef = "discardPile";
    card.ownerSeat = null;
    card.controllerSeat = null;
    card.faceUp = true;
    tx.emit("card.moved", {
      cardRef: ref,
      fromZoneRef: "resolving",
      toZoneRef: "discardPile",
      moveKind: "systemMove",
    });
  }
}
function restorePlayWindow(
  tx: EngineTransaction<AuthoritativeGameState>,
  attack: AttackRecord,
): void {
  const draft = tx.draft,
    deadline = attack.resumePlayDeadlineAt,
    seat = Number(attack.attackerSeat) as Seat;
  if (typeof deadline !== "number" || draft.lifecycle !== "inProgress") return;
  const kind = "playPhaseAction",
    promptId = `prompt:${kind}:${draft.round}:${seat}:${draft.stateRevision + 1}`;
  draft.pendingWindows.push({
    promptId,
    kind,
    prioritySeat: seat,
    mandatory: false,
    deadlineAt: deadline,
    timeoutPolicy: "pass",
    legalOfferIds: [`offer:${kind}:finish`],
    context: {},
  });
  tx.emit("choice.requested", { seat, kind, resumedAfterAttack: true });
}
export function resolveCurrentAttackTarget(
  state: AuthoritativeGameState,
  ruleset?: LoadedRuleset,
  deadlineAt = Date.now(),
  allowDamageResponseWindows = false,
): TransactionCommit<AuthoritativeGameState> {
  const attack = record(state.combat.attack, "ATTACK_CONTEXT_MISSING"),
    targetRef = state.combat.currentTargetRef;
  if (!targetRef || typeof attack.currentTargetHit !== "boolean")
    throw new Error("ATTACK_HIT_NOT_DETERMINED");
  const tx = new EngineTransaction(state),
    draft = tx.draft,
    draftAttack = record(draft.combat.attack, "ATTACK_CONTEXT_MISSING"),
    attackId = String(draftAttack.attackId),
    results: AppliedDamageSegment[] = [];
  const weaponJudgmentTimings = (() => {
    if (!ruleset || typeof attack.weaponId !== "string") return new Set<string>();
    const document = ruleset.documents.get("weapon-rules.json") as { templates: Array<{ weaponId: string; judgments?: Array<{ timing: string }> }> };
    return new Set(document.templates.find((item) => item.weaponId === attack.weaponId)?.judgments?.map((item) => item.timing) ?? []);
  })();
  const hasMissResolvingSegments =
    draftAttack.currentTargetHit === false &&
    Array.isArray(draftAttack.damageSegments) &&
    draftAttack.damageSegments.some(
      (segment) =>
        segment &&
        typeof segment === "object" &&
        !Array.isArray(segment) &&
        (segment as Record<string, JsonValue>).resolvesOnMiss === true,
    );
  if (draftAttack.currentTargetHit === true || hasMissResolvingSegments) {
    const target = draft.players.find(
        (item) => item.seat === targetSeat(targetRef),
      )!,
      adaptive = hasEffectiveTalent(
        draft,
        target.seat,
        "talent.adaptive_evolution",
      ),
      elementBudget: Record<string, number> =
        draftAttack.currentTargetElementBudget &&
        typeof draftAttack.currentTargetElementBudget === "object" &&
        !Array.isArray(draftAttack.currentTargetElementBudget)
          ? (draftAttack.currentTargetElementBudget as Record<string, number>)
          : {
              fire:
                adaptive && target.markers["druid.adaptation.fire"] === true
                  ? 1
                  : 0,
              poison:
                adaptive && target.markers["druid.adaptation.poison"] === true
                  ? 1
                  : 0,
            };
    if (!Array.isArray(draftAttack.pendingDamageOccurrences)) {
      armRefinedStaff(tx, draftAttack, targetRef, targetSeat(targetRef));
      const segments = offensiveElementSegments(
          tx,
          draftAttack,
          Array.isArray(draftAttack.damageSegments)
            ? draftAttack.damageSegments.filter(
                (segment) =>
                  draftAttack.currentTargetHit === true ||
                  (segment &&
                    typeof segment === "object" &&
                    !Array.isArray(segment) &&
                    (segment as Record<string, JsonValue>).resolvesOnMiss ===
                      true),
              )
            : [],
          targetRef,
        ),
        occurrences: JsonValue[] = [];
      for (const rawSegment of segments) {
        const segment = record(rawSegment, "DAMAGE_SEGMENT_INVALID"),
          repeat = Number(segment.repeat);
        if (!Number.isInteger(repeat) || repeat < 0)
          throw new Error("DAMAGE_REPEAT_INVALID");
        for (let repeatIndex = 0; repeatIndex < repeat; repeatIndex++)
          occurrences.push({ segment, repeatIndex });
      }
      draftAttack.pendingDamageOccurrences = occurrences;
      draftAttack.currentTargetDamageResults = [];
      draftAttack.currentTargetElementBudget = elementBudget as JsonValue;
    }
    const occurrences = draftAttack.pendingDamageOccurrences as JsonValue[];
    while (occurrences.length) {
      const occurrence = record(occurrences[0]!, "DAMAGE_OCCURRENCE_INVALID"),
        segment = record(occurrence.segment!, "DAMAGE_SEGMENT_INVALID"),
        repeatIndex = Number(occurrence.repeatIndex),
        occurrenceKey = `${attackId}:${targetRef}:${String(segment.segmentId)}:${repeatIndex}`;
      const parallelController = parallelTraversalController(
          draft,
          Number(draftAttack.attackerSeat) as Seat,
          target.seat,
        ),
        positiveOccurrence =
          Number(segment.amount) +
            (repeatIndex === 0
              ? Number(segment.firstRepeatElementBonus ?? 0)
              : 0) >
          0;
      if (draftAttack.parallelTraversalPassedOccurrenceKey === occurrenceKey)
        delete draftAttack.parallelTraversalPassedOccurrenceKey;
      else if (parallelController && positiveOccurrence && ruleset) {
        const initialized = tx.commit();
        initialized.state.history.domainEvents.push(...initialized.events);
        validateAuthoritativeState(initialized.state);
        return beginParallelTraversalJudgment(initialized.state, ruleset, {
          controllerSeat: parallelController,
          occurrenceKey,
          attackId,
          targetRef,
          deadlineAt,
        });
      }
      if (
        draftAttack.parallelTraversalPreventedOccurrenceKey === occurrenceKey
      ) {
        delete draftAttack.parallelTraversalPreventedOccurrenceKey;
        occurrences.shift();
        const prevented: AppliedDamageSegment = {
          segmentId: String(segment.segmentId),
          repeatIndex,
          element: String(segment.element ?? "none"),
          proposedDamage: Number(segment.amount),
          finalDamage: 0,
          actualDamage: 0,
          actualSpecialLayerLoss: 0,
          actualHpLoss: 0,
          actualShieldLoss: 0,
          receivedEvent: false,
          prevented: true,
        };
        const stored = Array.isArray(draftAttack.currentTargetDamageResults)
          ? draftAttack.currentTargetDamageResults
          : [];
        draftAttack.currentTargetDamageResults = [
          ...stored,
          prevented as unknown as JsonValue,
        ];
        tx.emit("damage.prevented", {
          attackId,
          targetRef,
          segmentId: String(segment.segmentId),
          repeatIndex,
          reason: "talent.parallel_traversal",
        });
        if (allowDamageResponseWindows && occurrences.length) {
          const committed = tx.commit();
          committed.state.history.domainEvents.push(...committed.events);
          validateAuthoritativeState(committed.state);
          return committed;
        }
        continue;
      }
      if (draftAttack.divineBarrierPassedOccurrenceKey === occurrenceKey)
        delete draftAttack.divineBarrierPassedOccurrenceKey;
      else if (
        allowDamageResponseWindows &&
        ruleset &&
        openDivineBarrierDamageWindowInTransaction(tx, ruleset, {
          targetSeat: target.seat,
          attackId,
          targetRef,
          segmentId: String(segment.segmentId),
          repeatIndex,
          occurrenceKey,
          deadlineAt,
        })
      ) {
        const committed = tx.commit();
        committed.state.history.domainEvents.push(...committed.events);
        validateAuthoritativeState(committed.state);
        return committed;
      }
      occurrences.shift();
      draft.combat.damageSegment = structuredClone(segment);
      const result = applyOne(
        tx,
        draftAttack,
        segment,
        repeatIndex,
        elementBudget,
        undefined,
        ruleset,
      );
      results.push(result);
      const stored = Array.isArray(draftAttack.currentTargetDamageResults)
        ? draftAttack.currentTargetDamageResults
        : [];
      draftAttack.currentTargetDamageResults = [
        ...stored,
        result as unknown as JsonValue,
      ];
      if (result.interruptedByDying) break;
      if (
        weaponJudgmentTimings.has("damage.applied.after") &&
        segment.isAdditional !== true
      ) {
        draftAttack.status = "weaponJudgmentPerSegment";
        draftAttack.pendingWeaponJudgmentOccurrenceKey = occurrenceKey;
        draft.combat.damageSegment = null;
        const committed = tx.commit();
        committed.state.history.domainEvents.push(...committed.events);
        validateAuthoritativeState(committed.state);
        return committed;
      }
      if (allowDamageResponseWindows && occurrences.length) {
        draft.combat.damageSegment = null;
        const committed = tx.commit();
        committed.state.history.domainEvents.push(...committed.events);
        validateAuthoritativeState(committed.state);
        return committed;
      }
    }
    if (results.at(-1)?.interruptedByDying === true && occurrences.length > 0) {
      draft.combat.damageSegment = null;
      target.lifeState = "dying";
      draft.combat.dyingStack.push(targetRef);
      draftAttack.status = "awaitingSegmentDying";
      tx.emit("dying.check", { attackId, targetRef, hp: target.hp });
      tx.emit("dying.enter", {
        attackId,
        targetRef,
        reason: "giantSlimeBacklashBeforeRemainingSegments",
      });
      const committed = tx.commit();
      committed.state.history.domainEvents.push(...committed.events);
      validateAuthoritativeState(committed.state);
      return committed;
    }
    if (
      weaponJudgmentTimings.has("attack.baseDamageSegments.after") &&
      draftAttack.baseDamageAfterJudgmentCompleted !== true
    ) {
      draftAttack.baseDamageAfterJudgmentCompleted = true;
      draftAttack.status = "weaponJudgmentAfterBase";
      draftAttack.pendingWeaponJudgmentOccurrenceKey = "afterBase";
      draft.combat.damageSegment = null;
      const committed = tx.commit();
      committed.state.history.domainEvents.push(...committed.events);
      validateAuthoritativeState(committed.state);
      return committed;
    }
    const allResults = Array.isArray(draftAttack.currentTargetDamageResults)
      ? (draftAttack.currentTargetDamageResults as unknown as AppliedDamageSegment[])
      : results;
    results.splice(0, results.length, ...allResults);
    delete draftAttack.pendingDamageOccurrences;
    delete draftAttack.currentTargetDamageResults;
    delete draftAttack.currentTargetElementBudget;
    if (adaptive)
      for (const element of ["fire", "poison"]) {
        const marker = `druid.adaptation.${element}`;
        if (
          target.markers[marker] !== true &&
          results.some(
            (item) => item.element === element && item.actualDamage > 0,
          )
        ) {
          target.markers[marker] = true;
          tx.emit("marker.added", {
            seat: target.seat,
            markerId: marker,
            value: true,
            reason: "talent.adaptive_evolution.firstElementAfterAttack",
          });
        }
      }
  } else queueMissReflection(tx, draftAttack, targetRef);
  draft.combat.damageSegment = null;
  const summary = {
    actualDamage: results.reduce((sum, item) => sum + item.actualDamage, 0),
    actualSpecialLayerLoss: results.reduce(
      (sum, item) => sum + item.actualSpecialLayerLoss,
      0,
    ),
    actualHpLoss: results.reduce((sum, item) => sum + item.actualHpLoss, 0),
    actualShieldLoss: results.reduce(
      (sum, item) => sum + item.actualShieldLoss,
      0,
    ),
  };
  draftAttack.currentTargetDamage = summary;
  if (
    ruleset &&
    draftAttack.currentTargetHit === true &&
    Array.isArray(draftAttack.onHitStatuses)
  )
    for (const statusId of draftAttack.onHitStatuses)
      if (typeof statusId === "string")
        applyStatusInTransaction(tx, ruleset, {
          ownerSeat: targetSeat(targetRef),
          statusId,
          sourceRef:
            typeof draftAttack.weaponRef === "string"
              ? draftAttack.weaponRef
              : null,
          metadata: { attackId, reason: "attack.onHitStatus" },
        });
  queueCrystalCrabCounter(tx, draftAttack, targetRef, summary.actualDamage);
  tx.emit("attack.target.after", {
    attackId,
    targetRef,
    attackerSeat: Number(draftAttack.attackerSeat),
    sourceRef:
      typeof draftAttack.weaponRef === "string"
        ? draftAttack.weaponRef
        : `character:${Number(draftAttack.attackerSeat)}`,
    attackTypes: Array.isArray(draftAttack.attackTypes)
      ? draftAttack.attackTypes
      : [],
    tags: Array.isArray(draftAttack.tags) ? draftAttack.tags : [],
    hit: String(draftAttack.status) === "targetHit",
    demonNatureDurationCount: Number(draftAttack.demonNatureDurationCount ?? 0),
    demonNatureIronShieldGain: Number(
      draftAttack.demonNatureIronShieldGain ?? 0,
    ),
    ...summary,
  });
  if (ruleset)
    applyAttackTargetHpLossBenefits(
      tx,
      ruleset,
      draftAttack,
      targetRef,
      summary.actualHpLoss,
    );
  const seat = targetSeat(targetRef),
    player = draft.players.find((item) => item.seat === seat)!;
  tx.emit("dying.check", { attackId, targetRef, hp: player.hp });
  draft.combat.targetQueue = draft.combat.targetQueue.filter(
    (ref) => ref !== targetRef,
  );
  if (
    player.hp !== null &&
    player.hp <= 0 &&
    player.lifeState !== "eliminated"
  ) {
    player.lifeState = "dying";
    draft.combat.dyingStack.push(targetRef);
    draftAttack.status = "awaitingDying";
    tx.emit("dying.enter", { attackId, targetRef });
  } else if (draft.combat.targetQueue.length) {
    draft.combat.currentTargetRef = draft.combat.targetQueue[0]!;
    const profiles = draftAttack.targetProfiles;
    if (profiles && typeof profiles === "object" && !Array.isArray(profiles)) {
      const profile = (profiles as Record<string, JsonValue>)[
        draft.combat.currentTargetRef
      ];
      if (profile && typeof profile === "object" && !Array.isArray(profile)) {
        const data = profile as Record<string, JsonValue>;
        draftAttack.attackTypes = structuredClone(data.attackTypes ?? []);
        draftAttack.damageSegments = structuredClone(data.damageSegments ?? []);
        if (data.cannotMeleeBlock === true) draftAttack.cannotMeleeBlock = true;
        else delete draftAttack.cannotMeleeBlock;
      }
    }
    delete draftAttack.currentTargetHit;
    delete draftAttack.currentTargetResult;
    delete draftAttack.currentTargetDamage;
    if (draftAttack.precisionStrikeCriticalTargetRef === targetRef) {
      delete draftAttack.critical;
      delete draftAttack.precisionStrikeCriticalTargetRef;
    }
    if (draftAttack.precisionStrikeNoHandDodgeTargetRef === targetRef) {
      delete draftAttack.cannotHandDodge;
      delete draftAttack.precisionStrikeNoHandDodgeTargetRef;
    }
    draftAttack.status = "committed";
  } else finalizeCurrentAttack(tx, draftAttack, () => deadlineAt);
  const committed = tx.commit();
  committed.state.history.domainEvents.push(...committed.events);
  validateAuthoritativeState(committed.state);
  return committed;
}
