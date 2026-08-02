import type { LoadedRuleset } from "../ruleset/types.js";
import { elfAimTargetRef } from "./elfAim.js";
import {
  calculateTargetOffer,
  validateTargetSelection,
  type TargetOffer,
} from "./targets.js";
import { handCards, type AuthoritativeGameState, type Seat } from "./state.js";
import { validateAuthoritativeState } from "./stateValidation.js";
import { EngineTransaction } from "./transaction.js";
import type { JsonValue, TransactionCommit } from "./types.js";
import { weaponSlotRefs } from "./preselection.js";
import {
  evaluateKillInvalidation,
  revealMatchedRoundShield,
  type KillPrintedColor,
} from "./killInvalidation.js";
import { consumeGuaranteedCriticalForCommittedAttack } from "./guaranteedCritical.js";
import { recordCommittedWeaponAttack } from "./armorRuntime.js";
import { calculateEffectiveDistance } from "./distance.js";
import { applyWeaponCommitEffects } from "./weaponCommitEffects.js";

interface DamageSegmentData {
  segmentId: string;
  deliveryType: string;
  attackType: string;
  damageType: string;
  element: string;
  amount: number;
  repeat: number;
  isAdditional: boolean;
  overflowPolicy: string;
}
export interface AttackModeData {
  modeId: string;
  costs: {
    killCards: number;
    attackCount: number;
    hpModification?: {
      amount: number;
      damage: boolean;
      recovery: boolean;
      payAt: string;
    };
    cards?: Array<{
      count: number;
      consumeAs: string;
      acceptsTemplateIds?: string[];
      acceptsTemporaryResourceTag?: string;
    }>;
  };
  targetRule: { min: number; max: number; distinct?: boolean };
  range: number | "unlimited";
  attackTypes: string[];
  responsePolicy: string;
  damageSegments: DamageSegmentData[];
  targetResolution?: string;
  repeatFormula?: { multiply?: Array<{ dimension: string }> };
  repeatFromState?: string;
}
interface ModeSelectionData {
  modeIds?: string[];
  defaultModeId?: string;
  playerSelectable?: boolean;
  resolution?: Record<
    string,
    {
      attackModeId?: string;
      byInstanceState?: { stateId: string; [value: string]: string };
    }
  >;
}
interface WeaponData {
  weaponId: string;
  weaponTypes?: string[];
  attackModes: AttackModeData[];
  charge?: {
    counterId: string;
    tiers: Array<{
      progress: number;
      attackModeId: string;
      attackAllowed: boolean;
    }>;
  };
  modeSelection?: ModeSelectionData;
  turnAttemptCounter?: {
    counterId: string;
    scope: string;
    incrementAt: string;
    resetAt: string;
  };
  damageDimensions?: Array<{
    dimensionId: string;
    base: number | { byModeId: Record<string, number> };
    affectedSegmentIds: string[];
    modifier?: { add: number };
  }>;
}
function ownerTurnKey(state: AuthoritativeGameState, seat: Seat): string {
  return `${state.round}:${seat}`;
}
function repeatAttemptWaivesAttackCount(
  state: AuthoritativeGameState,
  source: ResolvedAttackSource,
  ruleset: LoadedRuleset,
): boolean {
  if (source.kind !== "weapon" || !source.weaponRef || !source.weaponId)
    return false;
  const document = ruleset.documents.get(
    "weapon-rules.json",
  ) as WeaponRulesDocument;
  const weapon = document.templates.find(
    (item) => item.weaponId === source.weaponId,
  );
  if (!weapon?.turnAttemptCounter) return false;
  const card = state.cards[source.weaponRef]!;
  return (
    card.runtime.turnAttemptOwnerTurnKey ===
      ownerTurnKey(state, source.kind === "weapon" ? state.activeSeat! : 1) &&
    Number(card.runtime[weapon.turnAttemptCounter.counterId] ?? 0) >= 1
  );
}
function recordTurnAttempt(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  source: ResolvedAttackSource,
  seat: Seat,
): void {
  if (source.kind !== "weapon" || !source.weaponRef || !source.weaponId) return;
  const document = ruleset.documents.get(
    "weapon-rules.json",
  ) as WeaponRulesDocument;
  const weapon = document.templates.find(
    (item) => item.weaponId === source.weaponId,
  );
  if (!weapon?.turnAttemptCounter) return;
  const card = tx.draft.cards[source.weaponRef]!,
    key = ownerTurnKey(tx.draft, seat);
  if (card.runtime.turnAttemptOwnerTurnKey !== key) {
    card.runtime.turnAttemptOwnerTurnKey = key;
    card.runtime[weapon.turnAttemptCounter.counterId] = 0;
  }
  const before = Number(card.runtime[weapon.turnAttemptCounter.counterId] ?? 0),
    after = before + 1;
  card.runtime[weapon.turnAttemptCounter.counterId] = after;
  tx.emit("weapon.counter.changed", {
    cardRef: source.weaponRef,
    weaponId: source.weaponId,
    counterId: weapon.turnAttemptCounter.counterId,
    before,
    after,
    scope: weapon.turnAttemptCounter.scope,
  });
}
interface WeaponRulesDocument {
  templates: WeaponData[];
}

function resolveSelectedMode(
  weapon: WeaponData,
  weaponRuntime: Record<string, JsonValue>,
  selectedModeId: string | null,
): AttackModeData | undefined {
  const selection = weapon.modeSelection;
  if (!selection?.playerSelectable) return undefined;
  const publicModeId = selectedModeId ?? selection.defaultModeId;
  if (!publicModeId || !selection.modeIds?.includes(publicModeId))
    throw new Error("ATTACK_MODE_NOT_PRESELECTED");
  const resolution = selection.resolution?.[publicModeId];
  if (!resolution)
    return weapon.attackModes.find((mode) => mode.modeId === publicModeId);
  if (resolution.attackModeId)
    return weapon.attackModes.find(
      (mode) => mode.modeId === resolution.attackModeId,
    );
  const byState = resolution.byInstanceState;
  if (!byState) throw new Error("ATTACK_MODE_RESOLUTION_INVALID");
  const stateValue = weaponRuntime[byState.stateId];
  if (typeof stateValue !== "string")
    throw new Error("ATTACK_MODE_INSTANCE_STATE_INVALID");
  const resolvedModeId = byState[stateValue];
  if (typeof resolvedModeId !== "string")
    throw new Error("ATTACK_MODE_INSTANCE_STATE_INVALID");
  return weapon.attackModes.find((mode) => mode.modeId === resolvedModeId);
}

function automaticRangeEnvelope(
  weapon: WeaponData,
): AttackModeData | undefined {
  if (weapon.modeSelection?.playerSelectable || weapon.charge) return undefined;
  if (weapon.attackModes.length < 2) return weapon.attackModes[0];
  const modes = weapon.attackModes.filter(
    (mode) => typeof mode.range === "number",
  );
  if (modes.length !== weapon.attackModes.length) return undefined;
  return [...modes].sort(
    (a, b) => (b.range as number) - (a.range as number),
  )[0];
}

function resolveAutomaticRangeMode(
  state: AuthoritativeGameState,
  seat: Seat,
  weapon: WeaponData,
  targetRefs: readonly string[],
): AttackModeData {
  const requiredRange = Math.max(
    ...targetRefs.map((ref) =>
      calculateEffectiveDistance(state, seat, seatFromTarget(ref)),
    ),
    0,
  );
  const candidates = weapon.attackModes
    .filter((mode) => mode.range === "unlimited" || mode.range >= requiredRange)
    .sort((a, b) => {
      const ar = a.range === "unlimited" ? Number.POSITIVE_INFINITY : a.range;
      const br = b.range === "unlimited" ? Number.POSITIVE_INFINITY : b.range;
      return ar - br;
    });
  const mode = candidates[0];
  if (!mode) throw new Error("TARGET_NO_LONGER_LEGAL");
  return mode;
}
interface CardFact {
  cardId: string;
  color: KillPrintedColor;
}

export interface PaidAttackContinuation {
  attackId: string;
  attackerSeat: Seat;
  sourceKind: "weapon" | "handKnife";
  weaponRef: string | null;
  weaponId: string | null;
  mode: AttackModeData;
  targetRefs: string[];
  killCardRefs: string[];
  resumePlayDeadlineAt: number | null;
}

function discardPaidKills(
  tx: EngineTransaction<AuthoritativeGameState>,
  refs: string[],
  reason: string,
): void {
  for (const cardRef of refs) {
    const card = tx.draft.cards[cardRef];
    if (!card || card.zoneRef !== "resolving") continue;
    const index = tx.draft.zones.resolving!.orderedCardRefs.indexOf(cardRef);
    if (index >= 0) tx.draft.zones.resolving!.orderedCardRefs.splice(index, 1);
    tx.draft.zones.discardPile!.orderedCardRefs.push(cardRef);
    card.zoneRef = "discardPile";
    card.ownerSeat = null;
    card.controllerSeat = null;
    card.faceUp = true;
    tx.emit("card.moved", {
      cardRef,
      fromZoneRef: "resolving",
      toZoneRef: "discardPile",
      moveKind: "systemMove",
      reason,
    });
  }
}

function restorePaidAttackPlayWindow(
  tx: EngineTransaction<AuthoritativeGameState>,
  continuation: PaidAttackContinuation,
  reason: string,
): void {
  if (continuation.resumePlayDeadlineAt === null) return;
  tx.draft.pendingWindows.push({
    promptId: `prompt:playPhaseAction:${tx.draft.round}:${continuation.attackerSeat}:${tx.draft.stateRevision + 1}`,
    kind: "playPhaseAction",
    prioritySeat: continuation.attackerSeat,
    mandatory: false,
    deadlineAt: continuation.resumePlayDeadlineAt,
    timeoutPolicy: "pass",
    legalOfferIds: ["offer:playPhaseAction:finish"],
    context: {},
  });
  tx.emit("choice.requested", {
    seat: continuation.attackerSeat,
    kind: "playPhaseAction",
    resumedAfterPaidAttackCancellation: reason,
  });
}

export function continuePaidAttackAfterBloodCurseInTransaction(
  tx: EngineTransaction<AuthoritativeGameState>,
  ruleset: LoadedRuleset,
  continuation: PaidAttackContinuation,
): void {
  const firstTarget = tx.draft.players.find(
    (player) => `character:${player.seat}` === continuation.targetRefs[0],
  );
  if (
    !firstTarget ||
    firstTarget.presence !== "inPlay" ||
    firstTarget.lifeState === "eliminated"
  ) {
    discardPaidKills(
      tx,
      continuation.killCardRefs,
      "bloodCurseTargetUnavailable",
    );
    tx.emit("attack.cancelled", {
      attackId: continuation.attackId,
      reason: "paidTargetBecameIllegalAfterBloodCurse",
      costsRemainPaid: true,
      attackCountRemainsSpent: true,
      chargeStateUnchanged: true,
    });
    restorePaidAttackPlayWindow(
      tx,
      continuation,
      "bloodCurseTargetUnavailable",
    );
    return;
  }
  recordTurnAttempt(
    tx,
    ruleset,
    {
      kind: continuation.sourceKind,
      weaponRef: continuation.weaponRef,
      weaponId: continuation.weaponId,
      mode: continuation.mode,
    },
    continuation.attackerSeat,
  );
  const cardFacts = new Map(
      (ruleset.documents.get("cards.json") as { items: CardFact[] }).items.map(
        (item) => [item.cardId, item],
      ),
    ),
    killColors = continuation.killCardRefs
      .map((ref) => cardFacts.get(tx.draft.cards[ref]!.templateId)?.color)
      .filter((color): color is KillPrintedColor => Boolean(color)),
    targetSeats = continuation.targetRefs.map(seatFromTarget),
    invalidation = evaluateKillInvalidation(
      tx.draft,
      targetSeats,
      killColors,
      continuation.mode.attackTypes.includes("field"),
    );
  tx.emit("attack.killInvalidation.check", {
    attackId: continuation.attackId,
    result: invalidation.invalidated ? "invalidated" : "notInvalidated",
    sourceKind: invalidation.sourceKind,
    sourceRef: invalidation.sourceRef,
    matchedColor: invalidation.matchedColor,
    resumedAfterBloodCurse: true,
  });
  if (invalidation.invalidated) {
    if (
      invalidation.sourceKind === "roundShield" &&
      invalidation.sourceRef &&
      invalidation.matchedColor
    )
      revealMatchedRoundShield(
        tx,
        invalidation.sourceRef,
        invalidation.matchedColor,
      );
    discardPaidKills(tx, continuation.killCardRefs, "attackInvalidated");
    tx.emit("attack.invalidated", {
      attackId: continuation.attackId,
      sourceKind: invalidation.sourceKind,
      sourceRef: invalidation.sourceRef,
      costsRemainPaid: true,
      attackCountRemainsSpent: true,
      chargeStateUnchanged: true,
    });
    restorePaidAttackPlayWindow(tx, continuation, "killInvalidated");
    return;
  }
  if (continuation.weaponRef) {
    const card = tx.draft.cards[continuation.weaponRef];
    if (card)
      for (const key of ["chargeProgress", "charge"])
        if (key in card.runtime) card.runtime[key] = 0;
  }
  const criticalGrant = consumeGuaranteedCriticalForCommittedAttack(
    tx,
    continuation.attackerSeat,
    continuation.sourceKind,
  );
  if (continuation.sourceKind === "weapon")
    recordCommittedWeaponAttack(tx, continuation.attackerSeat);
  applyWeaponCommitEffects(
    tx,
    ruleset,
    continuation.weaponRef,
    continuation.weaponId,
    continuation.mode.modeId,
    continuation.targetRefs,
    continuation.attackerSeat,
  );
  const orderedTargets = [...continuation.targetRefs].sort(
      (left, right) =>
        ((seatFromTarget(left) - continuation.attackerSeat + 4) % 4) -
        ((seatFromTarget(right) - continuation.attackerSeat + 4) % 4),
    ),
    attack = {
      attackId: continuation.attackId,
      attackerSeat: continuation.attackerSeat,
      weaponRef: continuation.weaponRef,
      weaponId: continuation.weaponId,
      modeId: continuation.mode.modeId,
      targetRefs: orderedTargets,
      killCardRefs: [...continuation.killCardRefs],
      range: continuation.mode.range,
      attackTypes: [...continuation.mode.attackTypes],
      responsePolicy: continuation.mode.responsePolicy,
      damageSegments: structuredClone(continuation.mode.damageSegments),
      resumePlayDeadlineAt: continuation.resumePlayDeadlineAt,
      status: "committed",
      ...(criticalGrant
        ? {
            guaranteedCritical: true,
            critical: true,
            criticalGrantId: criticalGrant.grantId,
          }
        : {}),
    };
  tx.draft.combat.attack = attack as unknown as JsonValue;
  tx.draft.combat.targetQueue = [...orderedTargets];
  tx.draft.combat.currentTargetRef = orderedTargets[0] ?? null;
  tx.emit("attack.commit", {
    attackId: continuation.attackId,
    attackerSeat: continuation.attackerSeat,
    guaranteedCritical: Boolean(criticalGrant),
    resumedAfterBloodCurse: true,
  });
}
export interface ResolvedAttackSource {
  kind: "weapon" | "handKnife";
  weaponRef: string | null;
  weaponId: string | null;
  mode: AttackModeData;
}
export interface AttackOffer {
  offerId: string;
  attackerSeat: Seat;
  source: ResolvedAttackSource;
  targets: TargetOffer;
  legalKillCardRefs: string[];
  legalResourceCardRefs: string[];
  attackCountAvailable: number;
  attackCountCost: number;
  attackCountCostWithoutAim: number;
  attackCountWaivedTargetRef: string | null;
  payable: boolean;
}
export interface CommitAttackInput {
  attackerSeat: Seat;
  targetRefs: string[];
  killCardRefs: string[];
  resourceCardRefs?: string[];
  killConversion?: {
    abilityId: string;
    requiredPhysicalKillCount: number;
    convertedCardCount: number;
  };
}

const equipmentDisabled = (state: AuthoritativeGameState, seat: Seat) => {
  const player = state.players.find((item) => item.seat === seat)!;
  return (
    player.markers.equipmentEffectsDisabled === true ||
    player.statuses.some(
      (status) => status.statusId === "status.equipmentDisabled",
    )
  );
};
const talentEffective = (
  state: AuthoritativeGameState,
  seat: Seat,
  id: string,
) => {
  const p = state.players.find((x) => x.seat === seat)!;
  if (p.initialTalentIds.includes(id)) return true;
  if (equipmentDisabled(state, seat)) return false;
  return (state.zones[`talent:${seat}`]?.orderedCardRefs ?? []).some(
    (ref) => state.cards[ref]?.templateId === id,
  );
};
function applyWeaponTalentModifiers(
  state: AuthoritativeGameState,
  seat: Seat,
  weapon: WeaponData,
  input: AttackModeData,
  weaponRef?: string,
): AttackModeData {
  const mode = structuredClone(input),
    values = new Map<string, number>();
  if (mode.repeatFromState && weaponRef) {
    const runtimeKey =
      mode.repeatFromState === "durability.current"
        ? "durabilityCurrent"
        : mode.repeatFromState;
    const repeat = Math.max(
      0,
      Number(state.cards[weaponRef]?.runtime[runtimeKey] ?? 0),
    );
    for (const segment of mode.damageSegments) segment.repeat = repeat;
  }
  for (const d of weapon.damageDimensions ?? []) {
    const base =
        typeof d.base === "number"
          ? d.base
          : Number(d.base.byModeId[mode.modeId] ?? 0),
      id = d.dimensionId,
      enabled =
        id === "combo"
          ? talentEffective(state, seat, "talent.combo_up")
          : id === "scatter"
            ? talentEffective(state, seat, "talent.scatter_up")
            : false;
    values.set(id, base + (enabled ? Number(d.modifier?.add ?? 1) : 0));
    if (!mode.repeatFormula?.multiply)
      for (const segment of mode.damageSegments)
        if (d.affectedSegmentIds.includes(segment.segmentId))
          segment.repeat = base + (enabled ? Number(d.modifier?.add ?? 1) : 0);
  }
  if (mode.repeatFormula?.multiply) {
    const repeat = mode.repeatFormula.multiply.reduce(
      (n, x) => n * Number(values.get(x.dimension) ?? 1),
      1,
    );
    for (const segment of mode.damageSegments) segment.repeat = repeat;
  }
  for (const [dimension, talentId] of [
    ["combo", "talent.combo_up"],
    ["scatter", "talent.scatter_up"],
  ] as const)
    if (
      weapon.weaponTypes?.includes(dimension) &&
      !(weapon.damageDimensions ?? []).some(
        (d) => d.dimensionId === dimension,
      ) &&
      talentEffective(state, seat, talentId)
    ) {
      const segment = mode.damageSegments.find((x) => !x.isAdditional);
      if (segment) segment.repeat += 1;
    }
  if (
    mode.attackTypes.includes("melee") &&
    talentEffective(state, seat, "talent.melee_range_up") &&
    typeof mode.range === "number"
  )
    mode.range += 1;
  return mode;
}
const seatFromTarget = (ref: string): Seat => {
  const match = /^character:([1-4])$/.exec(ref);
  if (!match) throw new Error("ATTACK_TARGET_REF_INVALID");
  return Number(match[1]) as Seat;
};
function handKnifeMode(ruleset: LoadedRuleset, qigong = false): AttackModeData {
  const data = ruleset.settings.combat.handKnife;
  return {
    modeId: "handKnife",
    costs: { killCards: data.killCards, attackCount: data.attackCount },
    targetRule: { min: 1, max: 1, distinct: true },
    range: data.range,
    attackTypes: [data.attackType],
    responsePolicy: "standardAttack",
    damageSegments: [
      {
        segmentId: "base",
        deliveryType: "attack",
        attackType: data.attackType,
        damageType: "normal",
        element: "none",
        amount: data.damage + (qigong ? 1 : 0),
        repeat: 1,
        isAdditional: false,
        overflowPolicy: "normal",
      },
    ],
  };
}
export function resolvePreselectedAttackSource(
  state: AuthoritativeGameState,
  seat: Seat,
  ruleset: LoadedRuleset,
): ResolvedAttackSource {
  if(state.players.find(player=>player.seat===seat)!.statuses.some(status=>status.statusId==="status.anubisCurse")){const document=ruleset.documents.get("weapon-rules.json") as WeaponRulesDocument,weapon=document.templates.find(item=>item.weaponId==="weapon.w32"),mode=weapon?.attackModes[0];if(!weapon||!mode)throw new Error("ANUBIS_TEMPORARY_WEAPON_RULE_MISSING");return{kind:"weapon",weaponRef:null,weaponId:"weapon.w32",mode:applyWeaponTalentModifiers(state,seat,weapon,mode)};}
  const selected = state.preselection[seat],
    slots = weaponSlotRefs(seat),
    occupied = slots.flatMap((ref) => state.zones[ref]?.orderedCardRefs ?? []);
  if (!selected.weaponSlot) throw new Error("ATTACK_WEAPON_NOT_PRESELECTED");
  if (!slots.includes(selected.weaponSlot))
    throw new Error("PRESELECTION_SLOT_INVALID");
  const weaponRef =
    state.zones[selected.weaponSlot]!.orderedCardRefs[0] ?? null;
  if (!weaponRef) {
    if (occupied.length !== 0) throw new Error("ATTACK_EMPTY_SLOT_INVALID");
    return {
      kind: "handKnife",
      weaponRef: null,
      weaponId: null,
      mode: handKnifeMode(
        ruleset,
        state.players.find((player) => player.seat === seat)?.characterId ===
          "character.qi_master",
      ),
    };
  }
  if (equipmentDisabled(state, seat))
    throw new Error("ATTACK_WEAPON_INEFFECTIVE");
  const weaponId = state.cards[weaponRef]!.templateId,
    document = ruleset.documents.get(
      "weapon-rules.json",
    ) as WeaponRulesDocument,
    weapon = document.templates.find((item) => item.weaponId === weaponId);
  if (!weapon) throw new Error("ATTACK_WEAPON_RULE_MISSING");
  let mode: AttackModeData | undefined;
  if (weapon.charge) {
    const raw = state.cards[weaponRef]!.runtime[weapon.charge.counterId] ?? 0;
    if (typeof raw !== "number") throw new Error("ATTACK_CHARGE_INVALID");
    const accelerated = talentEffective(
        state,
        seat,
        "talent.charge_acceleration",
      )
        ? 1
        : 0,
      effectiveProgress = raw + accelerated,
      tier = [...weapon.charge.tiers]
        .sort((a, b) => b.progress - a.progress)
        .find(
          (item) => item.progress <= effectiveProgress && item.attackAllowed,
        );
    mode = weapon.attackModes.find(
      (item) => item.modeId === tier?.attackModeId,
    );
  } else if (weapon.attackModes.length === 1) mode = weapon.attackModes[0];
  else if (weapon.attackModes.some((item) => item.costs.hpModification)) {
    const hp = state.players.find((item) => item.seat === seat)!.hp;
    if (hp === null || hp < 1) throw new Error("ATTACK_HP_MODE_INVALID");
    mode = weapon.attackModes.find((item) =>
      hp >= 2 ? Boolean(item.costs.hpModification) : !item.costs.hpModification,
    );
  } else
    mode =
      resolveSelectedMode(
        weapon,
        state.cards[weaponRef]!.runtime,
        selected.modeId,
      ) ?? automaticRangeEnvelope(weapon);
  if (!mode) throw new Error("ATTACK_MODE_REQUIRES_RULE_RESOLVER");
  if (!Number.isInteger(mode.costs.attackCount) && weapon.turnAttemptCounter) {
    const raw = mode.costs.attackCount as unknown as {
      trueValue?: number;
      falseValue?: number;
    };
    const card = state.cards[weaponRef]!,
      currentKey = ownerTurnKey(state, seat);
    const count =
      card.runtime.turnAttemptOwnerTurnKey === currentKey
        ? Number(card.runtime[weapon.turnAttemptCounter.counterId] ?? 0)
        : 0;
    mode = structuredClone(mode);
    mode.costs.attackCount =
      count === 0 ? Number(raw.trueValue) : Number(raw.falseValue);
  }
  if (
    !Number.isInteger(mode.costs.killCards) ||
    !Number.isInteger(mode.costs.attackCount)
  )
    throw new Error("ATTACK_DYNAMIC_COST_REQUIRES_RULE_RESOLVER");
  return {
    kind: "weapon",
    weaponRef,
    weaponId,
    mode: applyWeaponTalentModifiers(state, seat, weapon, mode, weaponRef),
  };
}
export function buildAttackOffer(
  state: AuthoritativeGameState,
  seat: Seat,
  ruleset: LoadedRuleset,
  offerId = `offer:attack:${state.stateRevision}:${seat}`,
): AttackOffer {
  if (
    state.lifecycle !== "inProgress" ||
    state.phase !== "play" ||
    state.phaseBoundary !== "body" ||
    state.activeSeat !== seat
  )
    throw new Error("ATTACK_WRONG_PHASE");
  if (state.combat.attack !== null) throw new Error("ATTACK_ALREADY_RESOLVING");
  const source = resolvePreselectedAttackSource(state, seat, ruleset),
    targets = calculateTargetOffer(state, seat, {
      kind: "character",
      min: source.mode.targetRule.min,
      max: source.mode.targetRule.max,
      distinct: source.mode.targetRule.distinct ?? true,
      includeSelf: true,
      team: "any",
      presence: "inPlay",
      maxDistance: source.mode.range,
    });
  const legalKillCardRefs = handCards(state, seat).filter((ref) =>
      state.cards[ref]!.templateId.startsWith(
        ruleset.settings.combat.killTemplatePrefix,
      ),
    ),
    cardCost = source.mode.costs.cards?.[0],
    legalResourceCardRefs = cardCost
      ? handCards(state, seat).filter((ref) =>
          (cardCost.acceptsTemplateIds ?? []).includes(
            state.cards[ref]!.templateId,
          ),
        )
      : [],
    rawCount =
      state.players.find((player) => player.seat === seat)!.limits[
        ruleset.settings.combat.attackCountLimitId
      ] ?? 0,
    attackCountAvailable = typeof rawCount === "number" ? rawCount : 0,
    hornSquad =
      state.players.find((player) => player.seat === seat)!.markers
        .hornSquadActive !== undefined,
    printedAttackCountCost = repeatAttemptWaivesAttackCount(
      state,
      source,
      ruleset,
    )
      ? 0
      : hornSquad && source.kind === "weapon" && source.mode.costs.killCards > 0
        ? 0
        : source.mode.costs.attackCount,
    aimTargetRef = elfAimTargetRef(state, ruleset, seat),
    attackCountWaivedTargetRef =
      aimTargetRef && targets.legalTargetRefs.includes(aimTargetRef)
        ? aimTargetRef
        : null,
    attackCountCost = attackCountWaivedTargetRef ? 0 : printedAttackCountCost;
  return {
    offerId,
    attackerSeat: seat,
    source,
    targets,
    legalKillCardRefs,
    legalResourceCardRefs,
    attackCountAvailable,
    attackCountCost,
    attackCountCostWithoutAim: printedAttackCountCost,
    attackCountWaivedTargetRef,
    payable:
      legalKillCardRefs.length >= source.mode.costs.killCards &&
      legalResourceCardRefs.length >= (cardCost?.count ?? 0) &&
      attackCountAvailable >= attackCountCost &&
      targets.legalTargetRefs.length >= targets.spec.min,
  };
}
export function commitAttack(
  state: AuthoritativeGameState,
  ruleset: LoadedRuleset,
  input: CommitAttackInput,
): TransactionCommit<AuthoritativeGameState> {
  let offer = buildAttackOffer(state, input.attackerSeat, ruleset);
  validateTargetSelection(offer.targets, input.targetRefs);
  if (
    offer.source.kind === "weapon" &&
    offer.source.weaponId &&
    offer.source.weaponRef
  ) {
    const document = ruleset.documents.get(
      "weapon-rules.json",
    ) as WeaponRulesDocument;
    const weapon = document.templates.find(
      (item) => item.weaponId === offer.source.weaponId,
    )!;
    if (
      !weapon.charge &&
      !weapon.modeSelection?.playerSelectable &&
      weapon.attackModes.length > 1 &&
      !weapon.attackModes.some((item) => item.costs.hpModification)
    ) {
      const mode = applyWeaponTalentModifiers(
        state,
        input.attackerSeat,
        weapon,
        resolveAutomaticRangeMode(
          state,
          input.attackerSeat,
          weapon,
          input.targetRefs,
        ),
        offer.source.weaponRef ?? undefined,
      );
      offer = { ...offer, source: { ...offer.source, mode } };
    }
  }
  const convertedKill = input.killConversion;
  const resourceCardRefs = input.resourceCardRefs ?? [],
    cardCost = offer.source.mode.costs.cards?.[0],
    requiredResourceCount = cardCost?.count ?? 0;
  if (
    resourceCardRefs.length !== requiredResourceCount ||
    new Set(resourceCardRefs).size !== resourceCardRefs.length ||
    resourceCardRefs.some(
      (ref) =>
        !state.zones[`hand:${input.attackerSeat}`]!.orderedCardRefs.includes(
          ref,
        ) ||
        !(cardCost?.acceptsTemplateIds ?? []).includes(
          state.cards[ref]!.templateId,
        ),
    )
  )
    throw new Error("ATTACK_RESOURCE_COST_INVALID");
  if (
    (convertedKill
      ? offer.source.mode.costs.killCards !==
          convertedKill.requiredPhysicalKillCount ||
        input.killCardRefs.length !== convertedKill.convertedCardCount
      : input.killCardRefs.length !== offer.source.mode.costs.killCards) ||
    new Set(input.killCardRefs).size !== input.killCardRefs.length ||
    input.killCardRefs.some((ref) =>
      convertedKill
        ? !state.zones[`hand:${input.attackerSeat}`]!.orderedCardRefs.includes(
            ref,
          )
        : !offer.legalKillCardRefs.includes(ref),
    )
  )
    throw new Error("ATTACK_KILL_COST_INVALID");
  const aimedAttack = Boolean(
      offer.attackCountWaivedTargetRef &&
      input.targetRefs.includes(offer.attackCountWaivedTargetRef),
    ),
    selectedAttackCountCost = aimedAttack ? 0 : offer.attackCountCostWithoutAim;
  if (offer.attackCountAvailable < selectedAttackCountCost)
    throw new Error("ATTACK_COUNT_UNPAYABLE");
  const tx = new EngineTransaction(state),
    draft = tx.draft,
    attackId = `attack:${draft.stateRevision + 1}:${input.attackerSeat}`,
    playWindow = draft.pendingWindows.find(
      (window) =>
        window.kind === "playPhaseAction" &&
        window.prioritySeat === input.attackerSeat,
    );
  if (playWindow)
    draft.pendingWindows = draft.pendingWindows.filter(
      (window) => window.promptId !== playWindow.promptId,
    );
  tx.emit("attack.declare", { attackId, attackerSeat: input.attackerSeat });
  tx.emit("attack.weapon.resolve", {
    attackId,
    kind: offer.source.kind,
    weaponRef: offer.source.weaponRef,
    modeId: offer.source.mode.modeId,
  });
  tx.emit("attack.targets.chosen", { attackId, targetRefs: input.targetRefs });
  tx.emit("attack.legality.check", { attackId, result: "legal" });
  for (const cardRef of input.killCardRefs) {
    const hand = draft.zones[`hand:${input.attackerSeat}`]!,
      index = hand.orderedCardRefs.indexOf(cardRef);
    hand.orderedCardRefs.splice(index, 1);
    draft.zones.resolving!.orderedCardRefs.push(cardRef);
    const card = draft.cards[cardRef]!;
    card.zoneRef = "resolving";
    card.ownerSeat = input.attackerSeat;
    card.controllerSeat = input.attackerSeat;
    card.faceUp = true;
    tx.emit("card.played", {
      cardRef,
      seat: input.attackerSeat,
      purpose: convertedKill
        ? `${convertedKill.abilityId}.convertedKillCost`
        : "attack.killCost",
      conversionAbilityId: convertedKill?.abilityId ?? null,
    });
  }
  for (const cardRef of resourceCardRefs) {
    const hand = draft.zones[`hand:${input.attackerSeat}`]!,
      index = hand.orderedCardRefs.indexOf(cardRef);
    hand.orderedCardRefs.splice(index, 1);
    draft.zones.resolving!.orderedCardRefs.push(cardRef);
    Object.assign(draft.cards[cardRef]!, {
      zoneRef: "resolving",
      ownerSeat: input.attackerSeat,
      controllerSeat: input.attackerSeat,
      faceUp: true,
    });
    tx.emit("card.played", {
      cardRef,
      seat: input.attackerSeat,
      purpose: "attack.resourceCost",
      weaponId: offer.source.weaponId,
    });
  }
  const player = draft.players.find(
      (item) => item.seat === input.attackerSeat,
    )!,
    limitId = ruleset.settings.combat.attackCountLimitId;
  player.limits[limitId] = offer.attackCountAvailable - selectedAttackCountCost;
  const hpModification = offer.source.mode.costs.hpModification;
  if (hpModification) {
    if (player.hp === null || player.hp + hpModification.amount < 1)
      throw new Error("ATTACK_HP_COST_UNPAYABLE");
    const before = player.hp;
    player.hp += hpModification.amount;
    tx.emit("value.changed", {
      seat: input.attackerSeat,
      path: "hp",
      from: before,
      to: player.hp,
      reason: "weapon.attackCost",
      damage: hpModification.damage,
      recovery: hpModification.recovery,
    });
  }
  tx.emit("attack.costs.paid", {
    attackId,
    killCardRefs: input.killCardRefs,
    killConversionAbilityId: convertedKill?.abilityId ?? null,
    attackCount: selectedAttackCountCost,
    printedAttackCountCost: offer.source.mode.costs.attackCount,
    hornSquadApplied:
      selectedAttackCountCost !== offer.source.mode.costs.attackCount &&
      !aimedAttack,
    elfAimApplied: aimedAttack,
    elfAimTargetRef: aimedAttack ? offer.attackCountWaivedTargetRef : null,
  });
  tx.emit("attack.targeted", {
    attackId,
    targetRefs: input.targetRefs,
    stage: "afterPaymentBeforeInvalidation",
  });
  const bloodCurseTurnKey = `${draft.round}:${draft.activeSeat}`;
  if (
    input.killCardRefs.length > 0 &&
    player.markers.bloodCurseEnabled === true &&
    player.markers.bloodCurseUsedTurn !== bloodCurseTurnKey
  ) {
    const nonboss = ruleset.documents.get("nonboss-rules.json") as {
        effectFamilies: Array<{
          familyId: string;
          grantedAbility?: {
            abilityId?: string;
            trigger?: {
              effects?: Array<{ op?: string; params?: { amount?: number } }>;
            };
          };
        }>;
      },
      ability = nonboss.effectFamilies.find(
        (family) => family.familyId === "special.sp11",
      )?.grantedAbility,
      damage = ability?.trigger?.effects?.find(
        (effect) => effect.op === "createDamage",
      )?.params?.amount;
    if (ability?.abilityId !== "ability.bloodCurse" || damage !== 2)
      throw new Error("BLOOD_CURSE_RULE_INVALID");
    const continuation: PaidAttackContinuation = {
      attackId,
      attackerSeat: input.attackerSeat,
      sourceKind: offer.source.kind,
      weaponRef: offer.source.weaponRef,
      weaponId: offer.source.weaponId,
      mode: structuredClone(offer.source.mode),
      targetRefs: [...input.targetRefs],
      killCardRefs: [...input.killCardRefs],
      resumePlayDeadlineAt: playWindow?.deadlineAt ?? null,
    };
    player.markers.bloodCurseUsedTurn = bloodCurseTurnKey;
    draft.scheduledEffects.push(
      {
        scheduledId: `scheduled:blood-curse-damage:${attackId}`,
        sourceRef: null,
        controllerSeat: input.attackerSeat,
        executeAt: "immediate.damagePipeline",
        effect: {
          op: "createDamage",
          targetRef: input.targetRefs[0]!,
          amount: damage,
          damageType: "normal",
          element: "none",
          attackType: "field",
          ignoreArmor: true,
          sourceAbilityId: "ability.bloodCurse",
        },
        cancelled: false,
      },
      {
        scheduledId: `scheduled:blood-curse-continue:${attackId}`,
        sourceRef: null,
        controllerSeat: input.attackerSeat,
        executeAt: "immediate.damagePipeline",
        effect: {
          op: "continuePaidAttackAfterBloodCurse",
          continuation: continuation as unknown as JsonValue,
        },
        cancelled: false,
      },
    );
    tx.emit("ability.triggered", {
      abilityId: "ability.bloodCurse",
      seat: input.attackerSeat,
      attackId,
      targetRef: input.targetRefs[0]!,
      consumedForTurn: bloodCurseTurnKey,
    });
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    return committed;
  }
  recordTurnAttempt(tx, ruleset, offer.source, input.attackerSeat);
  const cardFacts = new Map(
      (ruleset.documents.get("cards.json") as { items: CardFact[] }).items.map(
        (item) => [item.cardId, item],
      ),
    ),
    killColors = input.killCardRefs
      .map((ref) => cardFacts.get(draft.cards[ref]!.templateId)?.color)
      .filter((color): color is KillPrintedColor => Boolean(color)),
    targetSeats = input.targetRefs.map(seatFromTarget),
    invalidation = evaluateKillInvalidation(
      draft,
      targetSeats,
      killColors,
      offer.source.mode.attackTypes.includes("field"),
    );
  tx.emit("attack.killInvalidation.check", {
    attackId,
    result: invalidation.invalidated ? "invalidated" : "notInvalidated",
    sourceKind: invalidation.sourceKind,
    sourceRef: invalidation.sourceRef,
    matchedColor: invalidation.matchedColor,
  });
  if (invalidation.invalidated) {
    if (
      invalidation.sourceKind === "roundShield" &&
      invalidation.sourceRef &&
      invalidation.matchedColor
    )
      revealMatchedRoundShield(
        tx,
        invalidation.sourceRef,
        invalidation.matchedColor,
      );
    for (const cardRef of [...input.killCardRefs, ...resourceCardRefs]) {
      const index = draft.zones.resolving!.orderedCardRefs.indexOf(cardRef);
      if (index >= 0) draft.zones.resolving!.orderedCardRefs.splice(index, 1);
      draft.zones.discardPile!.orderedCardRefs.push(cardRef);
      const card = draft.cards[cardRef]!;
      card.zoneRef = "discardPile";
      card.ownerSeat = null;
      card.controllerSeat = null;
      card.faceUp = true;
      tx.emit("card.moved", {
        cardRef,
        fromZoneRef: "resolving",
        toZoneRef: "discardPile",
        moveKind: "systemMove",
        reason: "attackInvalidated",
      });
    }
    tx.emit("attack.invalidated", {
      attackId,
      sourceKind: invalidation.sourceKind,
      sourceRef: invalidation.sourceRef,
      costsRemainPaid: true,
      attackCountRemainsSpent: true,
      chargeStateUnchanged: true,
    });
    if (playWindow) {
      draft.pendingWindows.push({
        ...playWindow,
        promptId: `prompt:playPhaseAction:${draft.round}:${input.attackerSeat}:${draft.stateRevision + 1}`,
      });
      tx.emit("choice.requested", {
        seat: input.attackerSeat,
        kind: "playPhaseAction",
        resumedAfterInvalidatedAttack: true,
      });
    }
    const committed = tx.commit();
    committed.state.history.domainEvents.push(...committed.events);
    validateAuthoritativeState(committed.state);
    return committed;
  }
  if (offer.source.weaponRef) {
    const card = draft.cards[offer.source.weaponRef]!;
    for (const key of ["chargeProgress", "charge"]) {
      if (key in card.runtime) card.runtime[key] = 0;
    }
  }
  const criticalGrant = consumeGuaranteedCriticalForCommittedAttack(
    tx,
    input.attackerSeat,
    offer.source.kind,
  );
  if (offer.source.kind === "weapon")
    recordCommittedWeaponAttack(tx, input.attackerSeat);
  applyWeaponCommitEffects(
    tx,
    ruleset,
    offer.source.weaponRef,
    offer.source.weaponId,
    offer.source.mode.modeId,
    input.targetRefs,
    input.attackerSeat,
  );
  const orderedTargets = [...input.targetRefs].sort(
      (left, right) =>
        ((seatFromTarget(left) - input.attackerSeat + 4) % 4) -
        ((seatFromTarget(right) - input.attackerSeat + 4) % 4),
    ),
    attack = {
      attackId,
      attackerSeat: input.attackerSeat,
      weaponRef: offer.source.weaponRef,
      weaponId: offer.source.weaponId,
      modeId: offer.source.mode.modeId,
      targetRefs: orderedTargets,
      killCardRefs: [...input.killCardRefs],
      costCardRefs: [...resourceCardRefs],
      range: offer.source.mode.range,
      attackTypes: [...offer.source.mode.attackTypes],
      responsePolicy: offer.source.mode.responsePolicy,
      damageSegments: structuredClone(offer.source.mode.damageSegments),
      resumePlayDeadlineAt: playWindow?.deadlineAt ?? null,
      status: "committed",
      ...(criticalGrant
        ? {
            guaranteedCritical: true,
            critical: true,
            criticalGrantId: criticalGrant.grantId,
          }
        : {}),
    };
  draft.combat.attack = attack as unknown as JsonValue;
  draft.combat.targetQueue = [...orderedTargets];
  draft.combat.currentTargetRef = orderedTargets[0] ?? null;
  tx.emit("attack.commit", {
    attackId,
    attackerSeat: input.attackerSeat,
    guaranteedCritical: Boolean(criticalGrant),
  });
  const committed = tx.commit();
  committed.state.history.domainEvents.push(...committed.events);
  validateAuthoritativeState(committed.state);
  return committed;
}
