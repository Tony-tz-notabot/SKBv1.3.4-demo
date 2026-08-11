import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const version = "1.3.4";
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const out = path.join(root, "rulesets", `v${version}`, "nonboss-rules.json");
const cards = JSON.parse(read(`rulesets/v${version}/cards.json`)).items
  .filter((card) => !["weapon", "boss"].includes(card.category));
const testDoc = read("docs/整理/21-v1.3.4非BOSS牌测试清单.md");
const rows = (text) => text.split(/\r?\n/)
  .filter((line) => /^\|.*\|$/.test(line))
  .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()))
  .filter((cells) => !cells.every((cell) => /^:?-+:?$/.test(cell)));

const healAmount = (base) => ({
  add: [base, {
    if: { hasEffectiveAbility: ["$controller", "talent.strong_potion"] },
    then: 1,
    else: 0
  }]
});
const recover = (base, target) => ({
  op: "recoverHp",
  target,
  params: { amount: healAmount(base), sourceCardFamily: "$card.familyId" }
});

const basicFamilies = {
  kill: {
    familyId: "basic.kill",
    displayName: "杀",
    usageKind: "attackCost",
    windows: ["owner.phase.play"],
    costBinding: {
      event: "attack.costs.paid",
      count: 1,
      printedColorPreserved: true,
      moveKind: "play"
    },
    effects: [{
      op: "createAttack",
      params: {
        source: "$controller",
        weaponResolution: "currentPreselectedValidWeaponOrHandBlade",
        attackCountCost: 1,
        killCardRef: "$card",
        failBeforeCommitIfNoValidPreselection: true
      }
    }]
  },
  dodge: {
    familyId: "basic.dodge",
    displayName: "闪",
    usageKind: "response",
    windows: ["attack.response"],
    responseFilter: { attackAllowsDodge: true, responderIsTarget: true },
    effects: [{
      op: "invalidateAttack",
      params: { attack: "$attack", result: "miss", allDamageSegments: true }
    }]
  },
  potion: {
    familyId: "basic.potion",
    displayName: "药水",
    usageKind: "multiWindowUse",
    modes: [{
      modeId: "play_self_heal",
      window: "owner.phase.play",
      targetRule: { selector: "self", min: 1, max: 1 },
      effects: [recover(2, "$controller")]
    }, {
      modeId: "dying_rescue",
      window: "dying.rescue.window.opened",
      targetRule: { selector: "currentDyingCharacter", min: 1, max: 1 },
      effects: [recover(2, "$dyingCharacter")]
    }]
  },
  horn: {
    familyId: "basic.horn",
    displayName: "号角",
    usageKind: "multiModeUse",
    modes: [{
      modeId: "play_self_heal",
      window: "owner.phase.play",
      targetRule: { selector: "self", min: 1, max: 1 },
      effects: [recover(1, "$controller")]
    }, {
      modeId: "play_prepare_critical",
      window: "owner.phase.play",
      targetRule: { min: 0, max: 0 },
      effects: [{
        op: "createDuration",
        target: "$controller",
        params: {
          durationId: "duration.hornGuaranteedCritical",
          stackPolicy: "replaceByPriority",
          appliesTo: "nextCommittedWeaponAttack",
          consumeAt: "attack.commit",
          effect: { op: "applyCritical", params: { mode: "guaranteed" } }
        },
        expiry: { point: "currentTurn.end", skipPolicy: "expireOnSkippedBoundary" }
      }]
    }, {
      modeId: "dying_self_rescue",
      window: "dying.rescue.window.opened",
      requires: { controllerIsCurrentDyingCharacter: true },
      targetRule: { selector: "self", min: 1, max: 1 },
      effects: [recover(1, "$controller")]
    }]
  },
  coin: {
    familyId: "basic.coin",
    displayName: "金币",
    usageKind: "resource",
    normalInstance: { mayEnterHand: true },
    temporaryInstance: {
      mayEnterHand: false,
      tags: ["temporary.coin"],
      mustChooseImmediateLegalUse: true,
      passOrTimeoutDestination: "outsideDeck"
    },
    legalUseDiscovery: "effectsAcceptingCoinResource"
  }
};

const armorGate = { controllerHasCardEquipped: true, equipmentEffectsEnabled: true,
  attackLacksTag: "ignoreArmor" };
const armorFamilies = {
  "armor.a01": { familyId: "armor.a01", displayName: "双截棍", usageKind: "armorResponse",
    windows: ["attack.response"], requires: armorGate,
    limit: { scope: "perAttack", max: 1, consumeAt: "judgment.requested" },
    effects: [{ op: "judgeColor", params: { matchedColors: ["orange"],
      onMatched: { op: "invalidateAttack", params: { result: "miss", allDamageSegments: true } },
      onUnmatched: { op: "noop", params: { continueResponseWindow: true } } } }] },
  "armor.a02": { familyId: "armor.a02", displayName: "箱子", usageKind: "lockedArmor",
    requires: armorGate, state: { durability: { initial: 3, min: 0 } },
    triggers: [{ event: "damage.replacement.before", mandatory: true,
      filter: { targetIsController: true, damageAmountPositive: true, durabilityAtLeast: 1 },
      effects: [{ op: "preventDamage", params: { amount: "all", priority: "beforeIronShield" } },
        { op: "modifyValue", params: { path: "$card.durability", delta: -1 } },
        { op: "if", params: { condition: { equals: ["$card.durability", 0] }, then: {
          op: "scheduleEffect", params: { point: "currentDamageSegment.after", effect: {
            op: "loseCard", target: "$card", params: { destination: "discardPile", reason: "durabilityDepleted" } } } } } }] }] },
  "armor.a03": { familyId: "armor.a03", displayName: "光剑土豪金", usageKind: "armorResponse",
    windows: ["attack.response"], requires: armorGate,
    limit: { scope: "perAttack", max: 1, consumeAt: "judgment.requested" },
    effects: [{ op: "judgeColor", params: { matchedColors: ["blue", "orange"],
      onMatched: { op: "invalidateAttack", params: { result: "miss", allDamageSegments: true } },
      onUnmatched: { op: "noop", params: { continueResponseWindow: true } } } }] },
  "armor.a04": { familyId: "armor.a04", displayName: "盾牌", usageKind: "lockedArmor", requires: armorGate,
    triggers: [{ event: "attack.killInvalidation.check", mandatory: true,
      filter: { killPrintedColorIn: ["white", "blue"] }, effects: [{ op: "invalidateAttack", params: {
        result: "invalidBeforeCommit", costsRemainPaid: true, attackCountRemainsSpent: true,
        chargeStateUnchanged: true } }] }] },
  "armor.a05": { familyId: "armor.a05", displayName: "幽灵王冠", usageKind: "lockedArmor", requires: armorGate,
    triggers: [{ event: "phase.after", mandatory: true,
      filter: { phase: "play", actorIsController: true, committedWeaponAttacksThisTurn: 0, chargeActionsThisTurn: 0 },
      effects: [{ op: "createDuration", target: "$controller", params: {
        durationId: "duration.ghostCrownRangedInvalidation", stackPolicy: "refresh",
        attackFilter: { attackType: "ranged", excludesAttackType: "laser", targetIsDurationOwner: true },
        effect: { op: "invalidateAttack", params: { result: "invalid", sourceKind: "armor" } } },
        expiry: { point: "owner.nextPhase.prepare.before", skipPolicy: "expireOnSkippedBoundary" } }] }] },
  "armor.a06": { familyId: "armor.a06", displayName: "精致法杖", usageKind: "lockedArmor", requires: armorGate,
    limit: { scope: "ownerRound", max: 1, resetAt: "owner.phase.prepare" },
    triggers: [{ event: "attack.hit", mandatory: true,
      filter: { targetIsController: true, attackType: "ranged", quotaAvailable: true },
      effects: [{ op: "consumeLimit", params: { limit: "firstHitRangedAttackPerOwnerRound" } },
        { op: "setAttackTag", params: { tag: "refinedStaffPendingFirstPositiveSegment" } }] },
    { event: "damage.modified", mandatory: true,
      filter: { targetIsController: true, damageAmountPositive: true,
        attackHasTag: "refinedStaffPendingFirstPositiveSegment" },
      effects: [{ op: "modifyDamage", params: { delta: -2, minimum: 0 } },
        { op: "setAttackTag", params: { removeTag: "refinedStaffPendingFirstPositiveSegment" } }] }] },
  "armor.a07": { familyId: "armor.a07", displayName: "斩首者", usageKind: "armorResponse",
    windows: ["attack.response"], requires: { ...armorGate, attackType: "ranged", attackAllowsMeleeBlock: true },
    costs: [{ kind: "playCardFromHand", cardFamilyId: "basic.kill", count: 1 }],
    effects: [{ op: "invalidateAttack", params: { result: "miss", allDamageSegments: true } },
      { op: "emitEvent", params: { eventType: "response.resolved", tags: ["meleeBlock"] } }] },
  "armor.a08": { familyId: "armor.a08", displayName: "圆盾", usageKind: "activeArmor",
    windows: ["owner.phase.play"], requires: armorGate,
    limit: { scope: "ownerTurn", max: 1, resetAt: "owner.turn.started" },
    effects: [{ op: "selectColor", params: { visibility: "controllerOnly",
      options: ["white", "blue", "orange", "red"] } },
    { op: "createDuration", target: "$controller", params: {
      durationId: "duration.roundShieldKillColorLock", stackPolicy: "independentBySource",
      selectedColor: "$selection.color", visibility: "secretUntilFirstMatchedInvalidation",
      event: "attack.killInvalidation.check", filter: { killPrintedColorEquals: "$selection.color" },
      effect: { op: "invalidateAttack", params: { result: "invalidBeforeCommit",
        revealSelectedColorOnFirstMatch: true, costsRemainPaid: true, attackCountRemainsSpent: true,
        chargeStateUnchanged: true } } },
      expiry: { point: "owner.nextPhase.prepare.before", skipPolicy: "expireOnSkippedBoundary" } }] },
  "armor.a09": { familyId: "armor.a09", displayName: "陷阱箱", usageKind: "synthesizedLockedArmor",
    requires: armorGate, state: { durability: { initial: 3, min: 0 } },
    synthesis: { inputs: ["armor.a02", "special.sp03"], outputLeavesTo: "outsideDeck" },
    triggers: [{ event: "damage.replacement.before", mandatory: true,
      filter: { targetIsController: true, damageAmountPositive: true, durabilityAtLeast: 1 },
      effects: [{ op: "preventDamage", params: { amount: "all", priority: "beforeIronShield" } },
        { op: "modifyValue", params: { path: "$card.durability", delta: -1 } },
        { op: "scheduleEffect", params: { point: "rootAttack.after", order: "durabilityConsumptionOrder",
          effect: { op: "createAttack", params: { source: "$controller", targets: ["$damage.source"],
            attackType: "ranged", distance: 2, rangeCheck: false, damage: 2, attackCountCost: 0,
            killCost: 0, passiveCounterattack: true } } } },
        { op: "if", params: { condition: { equals: ["$card.durability", 0] }, then: {
          op: "scheduleEffect", params: { point: "lastGeneratedCounterattack.after", effect: {
            op: "loseCard", target: "$card", params: { destination: "outsideDeck", reason: "durabilityDepleted" } } } } } }] }] }
};

const talentGate = { talentEffectiveForController: true,
  initialTalentIgnoresOrdinaryEquipmentDisable: true };
const talent = (cardId, displayName, body) => ({
  familyId: cardId, displayName, usageKind: "equippedTalent", requires: talentGate,
  equipPolicy: {
    duplicateByFamilyIncludingInitialTalent: "illegalLoseHandCardThenDrawOne",
    duplicateLossMoveKind: "lose",
    initialTalent: { occupiesSlot: false, removable: false }
  },
  ...body
});
const talentFamilies = {
  "talent.strong_potion": talent("talent.strong_potion", "强力药水", {
    modifiers: [{ query: "recovery.amount", filter: { controllerIsTalentOwner: true,
      sourceCardFamilyIn: ["basic.potion", "basic.horn"] }, operation: { add: 1 } }]
  }),
  "talent.triple_wield": talent("talent.triple_wield", "三持", {
    modifiers: [{ query: "equipment.slotCapacity", slot: "weaponSlot", operation: { add: 1 } }],
    triggers: [{ event: "card.lost", filter: { cardIsThisTalent: true, regularWeaponCountAboveCapacity: true },
      mandatory: true, effects: [{ op: "selectCards", params: { chooser: "$controller", min: 1, max: 1,
        selector: { zone: "weaponSlot", category: "weapon" }, timeoutPolicy: "randomLegal" } },
      { op: "discardCard", target: "$selection.card", params: { reason: "weaponSlotOverflow" } }] }]
  }),
  "talent.max_hp_up": talent("talent.max_hp_up", "血量上限增加", {
    onEquip: [{ op: "changeMaxHp", target: "$controller", params: { delta: 2 } },
      { op: "recoverHp", target: "$controller", params: { amount: 2 } }],
    onLose: [{ op: "changeMaxHp", target: "$controller", params: { delta: -2,
      clampCurrentOnlyAboveNewMaximum: true } }, { op: "checkDying", target: "$controller" }]
  }),
  "talent.max_shield_up": talent("talent.max_shield_up", "护盾上限增加", {
    onEquip: [{ op: "changeMaxShield", target: "$controller", params: { delta: 1 } },
      { op: "recoverShield", target: "$controller", params: { amount: 1 } }],
    onLose: [{ op: "changeMaxShield", target: "$controller", params: { delta: -1,
      clampCurrentOnlyAboveNewMaximum: true } }]
  }),
  "talent.melee_counter": talent("talent.melee_counter", "近反", {
    triggers: [{ event: "response.resolved", filter: { controllerIsResponder: true, tag: "meleeBlock" },
      effects: [{ op: "createAttack", params: { source: "$controller", targets: ["$attack.source"],
        reflectedAttackSnapshot: "$attack", costPolicy: "none", recursionPolicy: "cannotReflectBackToSameAttack" } }] }]
  }),
  "talent.poison_shield": talent("talent.poison_shield", "毒盾", {
    immunities: [{ element: "poison" }],
    modifiers: [{ query: "attack.elementRepeat", scope: "perTargetPerAttack", element: "poison",
      includeAdditional: true, excludeTag: "ignoresTalent", operation: { add: 1 } }]
  }),
  "talent.hand_limit_up": talent("talent.hand_limit_up", "能量上限增加", {
    modifiers: [{ query: "hand.limit", operation: { add: 1 }, minimumFinalValue: 0 }]
  }),
  "talent.shop_discount": talent("talent.shop_discount", "商店半价", {
    cooldown: { value: 1, tickAt: "owner.phase.prepare", continuesWhileDisabled: true },
    triggers: [{ event: "phase.body", mandatory: true,
      filter: { phase: "draw", actorIsController: true, cooldownReady: true }, effects: [
        { op: "modifyEvent", params: { event: "$drawEvent", field: "drawCount", delta: 1 } },
        { op: "startCooldown", params: { value: 1, readyAfterOwnerRoundCount: 2 } }] }]
  }),
  "talent.blood_box": talent("talent.blood_box", "血箱", {
    triggers: [{ event: "card.lost", filter: { controllerOwnedLostCard: true,
      lostCardWasEquippedIn: "armorSlot" }, effects: [{ op: "recoverHp", target: "$controller",
        params: { amount: 2 } }] }]
  }),
  "talent.life_steal": talent("talent.life_steal", "吸血", {
    aggregate: { metric: "actualHpLoss", scope: "perTargetPerAttack", threshold: 2, maxTriggers: 1,
      excludeTargetsWithoutActualHpLoss: true },
    triggers: [{ event: "damage.applied", filter: { attackSourceIsController: true,
      aggregateCrossedThreshold: 2 }, effects: [{ op: "recoverHp", target: "$controller",
        params: { amount: 1 } }, { op: "consumeLimit", params: { scope: "perTargetPerAttack" } }] }]
  }),
  "talent.blue_shield": talent("talent.blue_shield", "蓝盾", {
    replacements: [{ event: "damage.finalized", scope: "perDamageSegment",
      filter: { targetIsController: true, shieldAtSegmentStartPositive: true, damageType: "normal" },
      effects: [{ op: "modifyDamage", params: { overflowPolicy: "noHpOverflowForThisSegment" } }] }]
  }),
  "talent.ice_shield": talent("talent.ice_shield", "冰盾", {
    immunities: [{ status: "status.frozen" }],
    triggers: [{ event: "status.applied", filter: { sourceIsController: true,
      statusId: "status.frozen", resultIn: ["applied", "refreshed"] },
      effects: [{ op: "createDamage", target: "$event.target", params: { amount: 1,
        deliveryType: "direct", damageType: "normal", element: "poison", isAdditional: true } }] }]
  }),
  "talent.mana_siphon": talent("talent.mana_siphon", "吸蓝", {
    aggregate: { metric: "actualHpLoss", scope: "perTargetPerAttack", threshold: 2, maxTriggers: 1,
      excludeTargetsWithoutActualHpLoss: true },
    triggers: [{ event: "damage.applied", filter: { attackSourceIsController: true,
      aggregateCrossedThreshold: 2 }, effects: [{ op: "drawCards", target: "$controller",
        params: { count: 1 } }, { op: "consumeLimit", params: { scope: "perTargetPerAttack" } }] }]
  }),
  "talent.electric_shield": talent("talent.electric_shield", "电盾", {
    immunities: [{ status: "status.electrified" }],
    attackModifiers: [{ filter: { sourceIsController: true, attackType: "laser" },
      addTags: ["ignoreArmor", "cannotMeleeBlock"] }],
    electricMark: { immuneToGain: true, clearOnEquip: true }
  }),
  "talent.combo_up": talent("talent.combo_up", "连击增加", {
    modifiers: [{ query: "weapon.attackDimension", dimension: "combo", requiresExplicitDimension: true,
      operation: { add: 1 } }]
  }),
  "talent.fire_shield": talent("talent.fire_shield", "火盾", {
    immunities: [{ element: "fire" }],
    modifiers: [{ query: "attack.elementRepeat", scope: "perTargetPerAttack", element: "fire",
      includeAdditional: true, excludeTag: "ignoresTalent", operation: { add: 1 } }]
  }),
  "talent.spike_shield": talent("talent.spike_shield", "刺盾", {
    triggers: [{ event: "damage.modified", mandatory: true,
      filter: { targetIsController: true, parentAttackType: "melee", damageAmountPositive: true,
        firstPositiveSegmentForTargetInAttack: true }, effects: [{ op: "modifyDamage",
        params: { delta: -1, minimum: 0 } }] }]
  }),
  "talent.critical_penetration": talent("talent.critical_penetration", "暴击穿透", {
    triggers: [{ event: "attack.hit", optional: true, filter: { sourceIsController: true,
      attackIsCritical: true, attackLacksTag: "criticalPenetrationFollowup" },
      costs: [{ kind: "playCardFromHand", cardFamilyId: "basic.kill", count: 1 }],
      effects: [{ op: "selectTargets", params: { min: 1, max: 1, distinctFrom: "$attack.targets",
        selector: "otherCharacterLegalForOriginalWeapon", timeoutPolicy: "pass" } },
      { op: "createAttack", params: { weaponRef: "$attack.weaponRef", weaponMode: "$attack.modeId",
        cannotChangeWeapon: true, targets: ["$selection.target"], attackCountCost: 0,
        killCostAlreadyPaid: true, tags: ["criticalPenetrationFollowup"] } }] }]
  }),
  "talent.scatter_up": talent("talent.scatter_up", "散弹增加", {
    modifiers: [{ query: "weapon.attackDimension", dimension: "scatter", requiresExplicitDimension: true,
      operation: { add: 1 } }]
  }),
  "talent.melee_range_up": talent("talent.melee_range_up", "近战距离增加", {
    modifiers: [{ query: "attack.range", filter: { sourceIsController: true, attackType: "melee",
      requiresRangeCheck: true }, operation: { add: 1 } }]
  }),
  "talent.shield_breaker": talent("talent.shield_breaker", "碎盾", {
    triggers: [{ event: "shield.broken", optional: true, filter: { targetIsController: true,
      causedByDamage: true, sourceHasDismantlableCard: true }, effects: [
        { op: "selectCards", params: { chooser: "$controller", min: 0, max: 1,
          selector: { owner: "$damage.source", dismantlable: true }, timeoutPolicy: "pass" } },
        { op: "dismantleCard", target: "$selection.card", params: { ifSelected: true } }] }]
  }),
  "talent.precision_strike": talent("talent.precision_strike", "精确打击", {
    triggers: [{ event: "attack.targeted", mandatory: true, scope: "perTargetPerAttack",
      filter: { sourceIsController: true, weaponAttack: true }, effects: [{ op: "judgeColor", params: {
        matchedColors: ["red", "orange"], purpose: "critical",
        onMatched: [{ op: "applyCritical", params: { attack: "$attack", target: "$target" } },
          { op: "applyRestriction", target: "$target", params: { restrictionId: "noHandDodgeForAttack",
            attackRef: "$attack", stillAllows: ["abilityDodge", "armorResponse", "meleeBlock"] } }] } }] }]
  }),
  "talent.charge_acceleration": talent("talent.charge_acceleration", "蓄力加快", {
    modifiers: [{ query: "weapon.chargeRequirement", operation: { add: -1, minimum: 0 },
      zeroRequirementDoesNotCreateChargeAction: true }]
  }),
  "talent.statue_double_trigger": talent("talent.statue_double_trigger", "雕像双触", {
    triggers: [{ event: "card.played", mandatory: true, filter: { controllerIsPlayer: true,
      cardCategory: "statue" }, effects: [{ op: "judgeColor", params: { matchedColors: ["blue"],
        purpose: "additionalEffect", onMatched: { op: "scheduleEffect", params: {
          point: "playedStatue.effectFlow.after", survivesEffectInvalidation: true,
          effect: { op: "moveCard", target: "$playedCard", params: { fromResolvedDestination: true,
            to: "hand", moveKind: "return" } } } } } }] }]
  }),
  "talent.extra_gem": talent("talent.extra_gem", "额外宝石", {
    limit: { scope: "perEquippedInstance", max: 1, consumeAt: "dying.enter" },
    triggers: [{ event: "dying.enter", mandatory: true, filter: { targetIsController: true,
      limitAvailable: true }, effects: [{ op: "drawCards", target: "$controller", params: { count: 3 } },
      { op: "consumeLimit", params: { scope: "perEquippedInstance" } },
      { op: "scheduleEffect", params: { point: "thisDyingFlow.result", effectsByResult: {
        rescued: [{ op: "removeCard", target: "$card", params: { timing: "immediateAfterRescue" } }],
        death: [{ op: "selectTargets", params: { min: 1, max: 1, selector: "inPlayCharacter",
          timeoutPolicy: "randomLegal" } }, { op: "giveCard", params: { cards: "$controller.hand.all",
          to: "$selection.target" } }, { op: "removeCard", target: "$card",
          params: { timing: "afterDeathHandTransfer" } }] } } }] }]
  })
};

const mount = (cardId, displayName, slots, defenseDelta, offenseDelta, extra = {}) => ({
  familyId: cardId,
  displayName,
  usageKind: "equippedMount",
  requires: { cardEquipped: true, equipmentEffectsEnabled: true },
  occupiedSlots: slots,
  replacementPolicy: {
    replaceEveryCardOccupyingAnyRequiredSlot: true,
    dualSlotMountLeavesAsSingleInstance: true,
    releaseAllOccupiedSlotsOnLeave: true,
    moveKind: "replace",
    destination: "discardPile"
  },
  distanceModifier: {
    appliesOnlyWhenRangeCheckRequired: true,
    ignoresUnlimitedRange: true,
    defenseDelta,
    offenseDelta,
    finalEffectiveDistanceMinimum: 0
  },
  ...extra
});
const mountFamilies = {
  "mount.m01": mount("mount.m01", "野猪", ["mountDefenseSlot"], 1, 0),
  "mount.m02": mount("mount.m02", "温顺雪人", ["mountDefenseSlot"], 1, 0),
  "mount.m03": mount("mount.m03", "暴走野猪", ["mountOffenseSlot"], 0, -1),
  "mount.m04": mount("mount.m04", "水晶虫", ["mountDefenseSlot"], 1, 0),
  "mount.m05": mount("mount.m05", "蜣螂", ["mountOffenseSlot"], 0, -1),
  "mount.m06": mount("mount.m06", "蜘蛛", ["mountOffenseSlot"], 0, -1),
  "mount.m07": mount("mount.m07", "白龙马", ["mountDefenseSlot", "mountOffenseSlot"], 2, 0),
  "mount.m08": mount("mount.m08", "浮游装置", ["mountDefenseSlot", "mountOffenseSlot"], 1, -1),
  "mount.m09": mount("mount.m09", "铁拳", ["mountOffenseSlot"], 0, -2),
  "mount.m10": mount("mount.m10", "瓦克恩", ["mountDefenseSlot", "mountOffenseSlot"], 0, -3),
  "mount.m11": mount("mount.m11", "百变怪", ["mountDefenseSlot", "mountOffenseSlot"], 0, 0, {
    dynamicDistanceModifier: {
      evaluateAt: "distance.calculate",
      effectiveTalentQuery: {
        includesInitialTalents: true,
        includesEnabledEquippedTalents: true,
        excludesDisabledEquippedTalents: true
      },
      offenseDelta: { mul: [-1, { count: { effectiveTalentIdIn:
        ["talent.fire_shield", "talent.poison_shield"] } }] },
      defenseDelta: { count: { effectiveTalentIdIn:
        ["talent.ice_shield", "talent.electric_shield"] } },
      disabledWhenThisMountEffectsDisabled: true,
      finalEffectiveDistanceMinimum: 0
    }
  })
};

const statue = (familyId, displayName, body) => ({
  familyId,
  displayName,
  usageKind: "statueCard",
  defaultWindow: "owner.phase.play",
  attackCountCost: 0,
  useFlow: { enter: "resolving", defaultExit: "discardPile", exitMoveKind: "discard" },
  ...body
});
const statueFamilies = {
  "statue.wizard": statue("statue.wizard", "巫师雕像", {
    effects: [{ op: "drawCards", target: "$controller", params: { count: 2 } }]
  }),
  "statue.werewolf": statue("statue.werewolf", "狼人雕像", {
    targetRule: { selector: "inPlayCharacter", min: 1, max: 1, range: 2 },
    modes: [{ modeId: "drain_shield", effects: [{ op: "createDamage", target: "$target",
      params: { deliveryType: "direct", damageType: "shield", amount: 2,
        saveActualDamageAs: "actualDrain" } }, { op: "recoverShield", target: "$controller",
      params: { amount: "$actualDrain", skipWhenZero: true } }] },
    { modeId: "drain_hp", effects: [{ op: "createDamage", target: "$target",
      params: { deliveryType: "direct", damageType: "hp", amount: 1,
        saveActualDamageAs: "actualDrain" } }, { op: "recoverHp", target: "$controller",
      params: { amount: "$actualDrain", skipWhenZero: true } }] }]
  }),
  "statue.elf": statue("statue.elf", "珺之精灵雕像", {
    targetRule: { selector: "inPlayCharacter", min: 1, max: 1, range: "unlimited" },
    effects: [{ op: "selectCards", params: { chooser: "$controller", min: 1, max: 1,
      selector: { owner: "$target", zones: "allSelectableCardZones", dismantlable: true,
        excludesInitialTalent: true }, visibility: { publicCards: "faceUpByIdentity",
        handCards: "serverShuffledCardBackOnly" }, timeoutPolicy: "randomLegal" } },
    { op: "dismantleCard", target: "$selection.card", params: { destinationByCardRule: true } }]
  }),
  "statue.rogue": statue("statue.rogue", "盗贼雕像", {
    targetRule: { selector: "inPlayCharacter", min: 1, max: 1, range: 1 },
    effects: [{ op: "selectCards", params: { chooser: "$controller", min: 1, max: 1,
      selector: { owner: "$target", zones: "allSelectableCardZones", gainable: true,
        excludesInitialTalent: true }, visibility: { publicCards: "faceUpByIdentity",
        handCards: "serverShuffledCardBackOnly" }, timeoutPolicy: "randomLegal" } },
    { op: "gainCard", target: "$selection.card", params: { to: "$controller.hand",
      moveKind: "gain" } }]
  }),
  "statue.berserker": statue("statue.berserker", "狂战士雕像", {
    effects: [{ op: "modifyAttackCount", target: "$controller", params: { delta: 1,
      scope: "currentTurn" } }]
  }),
  "statue.paladin": statue("statue.paladin", "圣骑士雕像", {
    defaultWindow: null,
    usageKind: "effectResponse",
    response: { window: "card.effect.before", targetFilter: { controllerIsOtherPlayer: true,
      cardCategory: "statue" }, excludesCategories: ["special", "basic", "equipment", "boss"],
      stackPolicy: "lastInFirstOut", mayRespondToSameFamily: true },
    effects: [{ op: "preventEvent", params: { event: "$respondedStatue.effect",
      doesNotCancelIndependentReturnSchedule: true } }]
  }),
  "statue.priest": statue("statue.priest", "牧师雕像", {
    effects: [{ op: "displayCards", params: { count: { count: { selector: "inPlayCharacter" } },
      replenishByReshuffle: true, saveAs: "displayedCards" } },
    { op: "forEach", params: { items: { selector: "notEliminatedCharactersFromControllerCounterclockwise" },
      mode: "serial", maxIterations: 25 }, effects: [{ op: "selectCards", params: {
        chooser: "$item", min: 0, max: 1, selector: "$displayedCards.remaining",
        optional: true, timeoutPolicy: "pass", onlyOneOpportunityPerCharacter: true } },
      { op: "gainCard", target: "$selection.card", params: { ifSelected: true,
        to: "$item.hand", moveKind: "gain" } }] },
    { op: "forEach", params: { items: "$displayedCards.remaining", mode: "serial",
      maxIterations: 337 }, effects: [{ op: "discardCard", target: "$item" }] }]
  }),
  "statue.knight": statue("statue.knight", "骑士雕像", {
    targetRule: { selector: "inPlayCharacter", min: 1, max: 1 },
    effects: [{ op: "repeat", maxIterations: 160, params: {
      alternatingPlayers: ["$target", "$controller"], first: "$target",
      request: { cardFamilyId: "basic.kill", optional: true },
      stopAtFirstPassOrNoLegalCard: true, savePasserAs: "duelLoser", saveOtherAs: "duelWinner" },
      effects: [{ op: "requestSpecialPlay", params: { player: "$currentDuelPlayer",
        cardFamilyId: "basic.kill", timeoutPolicy: "pass" } }] },
    { op: "selectCards", params: { chooser: "$duelWinner", min: 0, max: 1, optional: true,
      selector: { owner: "$duelWinner", equipped: true, effective: true, category: "weapon" },
      timeoutPolicy: "pass" } },
    { op: "copyCard", target: "$selection.card", params: { ifSelected: true,
      temporary: true, chargeState: 0, preservesOriginalInstanceState: true,
      saveAs: "temporaryWeapon" } },
    { op: "createAttack", params: { if: "$temporaryWeapon.exists", source: "$duelWinner",
      targets: ["$duelLoser"], weaponRef: "$temporaryWeapon", killCost: 0, attackCountCost: 0,
      responsePolicy: { dodge: false, meleeBlock: false }, tags: ["ignoreArmor"],
      modePolicy: "currentLegalActiveModeAndAutomaticRangeTier",
      rangePolicy: "ifNoTierCoversUseMaximumRangeTierAndProceed" } }]
  }),
  "statue.assassin": statue("statue.assassin", "刺客雕像", {
    effects: [{ op: "createAttack", params: { source: "$controller",
      targets: { selector: "otherInPlayCharactersCounterclockwise" }, targetOrder: "counterclockwiseSerial",
      attackType: "ranged", range: "unlimited", killCost: 0, attackCountCost: 0,
      damageSegments: [{ segmentId: "dart", deliveryType: "attack", attackType: "ranged",
        damageType: "normal", element: "none", amount: 2, repeat: 1, isAdditional: false }] } }]
  }),
  "statue.engineer": statue("statue.engineer", "工程师雕像", {
    targetRule: { selector: "inPlayCharacter", min: 1, max: 1, range: "unlimited" },
    useFlow: { enter: "resolving", successExit: "judgment", defaultExit: null },
    effects: [{ op: "moveCard", target: "$card", params: { to: "$target.judgment",
      moveKind: "use", position: "end", persistentSource: "$controller" } }],
    delayedTrigger: { event: "phase.body", filter: { phase: "judgment" }, controller: "currentZoneOwner",
      loopSafety: { mayCycle: true, endsOn: ["matched", "dismantled", "game.end"] },
      effects: [{ op: "judgeColor", params: { matchedColors: ["green"], purpose: "branch",
        onMatched: [{ op: "createDamage", target: "$currentZoneOwner", params: { source: "$persistentSource",
          deliveryType: "direct", damageType: "hp", amount: 3,
          sourceEliminationDoesNotCancel: true } }, { op: "removeCard", target: "$card",
          params: { destination: "discardPile" } }],
        onUnmatched: { op: "moveCard", target: "$card", params: {
          to: "$nextInPlayCharacterCounterclockwise.judgment", position: "end",
          moveKind: "systemMove", preservePersistentSource: true } } } }]
    }
  })
};

const special = (cardId, displayName, body) => ({
  familyId: cardId, displayName, usageKind: "specialCard",
  defaultWindow: "owner.phase.play", attackCountCost: 0,
  useFlow: { enter: "resolving", defaultExit: "discardPile" }, ...body
});
const specialDodgeCollection = (eligible, armorAllowed = true) => ({
  op: "requestSpecialPlay", params: {
    requestId: "specialRequest.dodge", cardFamilyId: "basic.dodge",
    eligiblePlayers: { selector: eligible }, order: "controllerThenCounterclockwise",
    collectAllBeforeConsequences: true, responseMayComeFrom: armorAllowed ?
      ["handCard", "ability", "armor"] : ["handCard", "ability"],
    isAttack: false, saveNonRespondersAs: "nonResponders"
  }
});
const specialFamilies = {
  "special.sp01": special("special.sp01", "网瘾少年", {
    effects: [specialDodgeCollection("otherInPlayCharacters"),
      { op: "setVar", params: { name: "x", value: { count: "$nonResponders" } } },
      { op: "if", params: { condition: { gt: ["$x", 0] }, then: { op: "forEach",
        params: { items: "$nonResponders.counterclockwise", mode: "serial", maxIterations: 25 },
        effects: [{ op: "createDamage", target: "$item", params: { source: "$controller",
          deliveryType: "direct", damageType: "normal", element: "electric", amount: "$x" } },
          { op: "addElectricMark", target: "$item", params: { amount: 1 } },
          { op: "checkDying", target: "$item", mode: "completeNestedFirst" }] } } },
      { op: "settleElectricMarks", params: { multiTargetPriority: true, recheck: true } }]
  }),
  "special.sp02": special("special.sp02", "网瘾少女", {
    effects: [specialDodgeCollection("otherInPlayCharacters"),
      { op: "setVar", params: { name: "x", value: { count: "$nonResponders" } } },
      { op: "if", params: { condition: { gt: ["$x", 0] }, then: { op: "forEach",
        params: { items: "$nonResponders.counterclockwise", mode: "serial", maxIterations: 25 },
        effects: [{ op: "createDamage", target: "$item", params: { source: "$controller",
          deliveryType: "direct", damageType: "normal", element: "electric", amount: "$x" } },
          { op: "addElectricMark", target: "$item", params: { amount: 1 } },
          { op: "checkDying", target: "$item", mode: "completeNestedFirst" }] } } },
      { op: "settleElectricMarks", params: { multiTargetPriority: true, recheck: true } }]
  }),
  "special.sp03": special("special.sp03", "羊叫兽", {
    synthesis: { inputsFromHand: ["special.sp01", "special.sp02"], window: "owner.phase.play",
      inputMoveKind: "synthesizeConsume", inputsDestination: "discardPile", outputTo: "hand",
      attackCountCost: 0, generatedInstanceExitZone: "outsideDeck" },
    useFlow: { enter: "resolving", defaultExit: "outsideDeck" },
    effects: [specialDodgeCollection("otherInPlayCharacters"),
      { op: "forEach", params: { items: "$nonResponders.counterclockwise", mode: "serial",
        maxIterations: 25 }, effects: [{ op: "createDamage", target: "$item", params: {
          source: "$controller", deliveryType: "direct", damageType: "normal",
          element: "electric", amount: 2 } }, { op: "addElectricMark", target: "$item",
        params: { amount: 1 } }, { op: "applyRestriction", target: "$item", params: {
          restrictionId: "cannotDodge", appliesToAllDodgeMethods: true } },
        { op: "checkDying", target: "$item", mode: "completeNestedFirst" }] },
      { op: "resolveTriggerWindow", params: { barrier: "allPhaseOneResponsesAndConsequencesComplete",
        disallowUnrelatedOptionalWindowsBetweenPhases: true } },
      { op: "createDuration", params: { durationId: "duration.sheepDodgeLocks",
        bindsExistingRestrictions: "cannotDodge" }, expiry: {
        point: "currentTurn.end", skipPolicy: "expireOnSkippedBoundary" } },
      { op: "sequence", params: { invokeEffectFamily: "special.sp01", asNestedPhase: true,
        independentResponseCollection: true } },
      { op: "settleElectricMarks", params: { multiTargetPriority: true, recheck: true } }]
  }),
  "special.sp04": special("special.sp04", "死亡笔记", {
    targetRule: { selector: "inPlayCharacter", min: 1, max: 1, range: "unlimited" },
    effects: [{ op: "if", params: { condition: { gt: ["$target.shield", 0] },
      then: { op: "setValue", params: { path: "$target.shield", value: 0,
        semantic: "modifyNotDamage" } }, else: { op: "setValue", params: {
        path: "$target.hp", value: 1, semantic: "modifyNotDamage" } } } }]
  }),
  "special.sp05": special("special.sp05", "重铸熔炉", {
    costs: [{ kind: "discardEquippedCard", selector: { category: "weapon", equipped: true },
      count: 1, payBeforeReveal: true, saveAs: "discardedWeapon" }],
    effects: [{ op: "repeat", maxIterations: 8, params: { stopWhen: {
      revealedWeaponColorRankAtLeast: "$discardedWeapon.colorRank" }, reshuffleImmediatelyIfExhausted: true,
      currentlyResolvingCardsExcludedFromReshuffle: true, saveAs: "revealedCards" },
      effects: [{ op: "revealCards", params: { count: 1, from: "drawPile" } }] },
    { op: "selectCards", params: { chooser: "$controller", min: { if: {
      any: { items: "$revealedCards", category: "weapon" } }, then: 1, else: 0 }, max: 1,
      selector: { items: "$revealedCards", category: "weapon" }, timeoutPolicy: "randomLegal" } },
    { op: "gainCard", target: "$selection.card", params: { ifSelected: true, to: "$controller.hand" } },
    { op: "forEach", params: { items: "$revealedCards.remaining", mode: "serial", maxIterations: 8 },
      effects: [{ op: "discardCard", target: "$item" }] }]
  }),
  "special.sp06": special("special.sp06", "起源熔炉", {
    costs: [{ kind: "discardEquippedCard", selector: { category: "weapon", equipped: true },
      count: 1, saveAs: "discardedWeapon" }],
    effects: [{ op: "drawCards", target: "$controller", params: { count: { switch: {
      expression: "$discardedWeapon.printedColor", cases: { white: 2, green: 2, blue: 3,
        orange: 3, red: 4 } } } } }]
  }),
  "special.sp07": special("special.sp07", "号角小队", {
    effects: [{ op: "createDuration", target: "$controller", params: {
      durationId: "duration.hornSquad", stackPolicy: "refresh", scope: "global",
      modifier: { query: "attack.attackCountCost", operation: { set: 0 }, filter: {
        actualKillCardPaid: true, generalWeaponAttackFlow: true,
        excludesExplicitAttackCountAbilityOrMode: true } } }, expiry: {
        point: "owner.nextPhase.prepare.before", skipPolicy: "expireOnSkippedBoundary" } }]
  }),
  "special.sp08": special("special.sp08", "拆迁大队", {
    effects: [{ op: "forEach", params: { items: { selector:
      "notEliminatedPlayersFromCurrentTurnPlayerCounterclockwise" }, mode: "serial", maxIterations: 25 },
      effects: [{ op: "selectCards", params: { chooser: "$item", min: 0, max: 1, optional: true,
        selector: { owner: "$item", equipped: true, category: "weapon",
          includesThirdWeapon: true }, timeoutPolicy: "pass" } },
        { op: "discardCard", target: "$selection.card", params: { ifSelected: true } }] },
    { op: "saveSnapshot", params: { snapshotId: "remainingWeaponsByPlayer",
      selector: { equipped: true, category: "weapon", includesThirdWeapon: true } } },
    { op: "forEach", params: { items: "$remainingWeaponsByPlayer", mode: "simultaneousFromSnapshot",
      maxIterations: 100 }, effects: [{ op: "giveCard", target: "$item.weapons", params: {
        to: "$item.counterclockwiseNextPlayer", preserveThirdWeaponClassification: true } }] },
    { op: "forEach", params: { items: { selector: "playersWithWeaponSlotOverflow" }, mode: "serial",
      maxIterations: 25 }, effects: [{ op: "selectCards", params: { chooser: "$item",
        min: "$item.weaponOverflowCount", max: "$item.weaponOverflowCount",
        selector: { owner: "$item", equipped: true, category: "weapon" },
        timeoutPolicy: "randomLegal" } }, { op: "forEach", params: { items: "$selection.cards",
        maxIterations: 3 }, effects: [{ op: "discardCard", target: "$item" }] }] }]
  }),
  "special.sp09": special("special.sp09", "超级大宝贝儿", {
    useFlow: { enter: "resolving", successExit: "judgment", defaultExit: null },
    effects: [{ op: "moveCard", target: "$card", params: { to: "$controller.judgment",
      position: "end", persistentSource: "$controller" } }],
    delayedTrigger: { event: "phase.body", filter: { phase: "judgment" }, onlyWhileInJudgmentZone: true,
      effects: [specialDodgeCollection("allInPlayCharacters", false),
        { op: "forEach", params: { items: "$nonResponders.counterclockwise", mode: "serial",
          maxIterations: 25 }, effects: [{ op: "createDamage", target: "$item", params: {
            source: "$persistentSource", deliveryType: "direct", damageType: "hp", amount: 3 } },
          { op: "checkDying", target: "$item", mode: "completeNestedFirst" }] },
        { op: "forEach", params: { items: { selector: "otherInPlayCharactersFromPersistentSourceCounterclockwise" },
          mode: "serial", maxIterations: 25 }, effects: [
          { op: "createDamage", target: "$item", params: { source: "$persistentSource",
            deliveryType: "direct", damageType: "normal", element: "fire", amount: 1 } },
          { op: "createDamage", target: "$item", params: { source: "$persistentSource",
            deliveryType: "direct", damageType: "normal", element: "poison", amount: 1 } },
          { op: "checkDying", target: "$item", mode: "completeNestedFirst" }] },
        { op: "discardCard", target: "$card" }]
    }
  }),
  "special.sp10": special("special.sp10", "奉献池", {
    legality: { controllerHasEquippedWeapon: true },
    costs: [{ kind: "discardEquippedCard", selector: { category: "weapon", equipped: true }, count: 1,
      uiConfirmWhenOnlyOneLegalWeapon: true }],
    effects: [{ op: "randomChoice", params: { resultHasNoRulesEffect: true,
      optionsConfigKey: "special.sp10.flavorLines", logResult: true } }, { op: "noop" }]
  }),
  "special.sp11": special("special.sp11", "鲜血祭坛", {
    effects: [{ op: "changeMaxHp", target: "$controller", params: { delta: -2,
      clampCurrentOnlyAboveNewMaximum: true } }, { op: "changeHp", target: "$controller", params: {
      delta: -2, semantic: "modifyNotDamage" } }, { op: "checkDying", target: "$controller" },
    { op: "modifyIronShield", target: "$controller", params: { setMinimum: 1 } },
    { op: "createDuration", target: "$controller", params: { durationId: "duration.bloodAltarIronShield",
      stackPolicy: "replaceByPriority", ironShieldValue: 1 }, expiry: {
      point: "owner.nextPhase.prepare.before", skipPolicy: "expireOnSkippedBoundary" },
      cleanupEffects: [{ op: "modifyIronShield", target: "$controller", params: {
        removeContributionFromDuration: true } }, { op: "if", params: { condition: {
        characterInPlay: "$controller" }, then: { op: "enableAbility", target: "$controller",
        params: { abilityId: "ability.bloodCurse", permanent: true } } } }] }],
    grantedAbility: { abilityId: "ability.bloodCurse", limit: { scope: "perTurnOwner", max: 1,
      resetAt: "owner.turn.start", consumeAt: "triggerCommitted" }, trigger: {
      event: "attack.costs.paid", timing: "afterLegalTargetAndKillPaymentBeforeKillInvalidation",
      filter: { sourceIsAbilityOwner: true, actualKillCardPaid: true }, effects: [
        { op: "createDamage", target: "$firstLegallySpecifiedTarget", params: { source: "$controller",
          deliveryType: "direct", attackType: "field", damageType: "normal", amount: 2 } },
        { op: "checkDying", target: "$firstLegallySpecifiedTarget", mode: "completeNestedFirst" },
        { op: "if", params: { condition: { targetNoLongerLegal: "$firstLegallySpecifiedTarget" },
          then: { op: "invalidateAttack", params: { result: "cancelledAfterPaidTargetBecameIllegal",
            costsRemainPaid: true } } } }, { op: "consumeLimit", params: { scope: "perTurnOwner" } }]
      }
    }
  })
};

const templates = cards.map((card) => {
  const familyKey = card.category === "basic" ? card.cardId.split(".")[1] : null;
  const statueFamilyId = card.category === "statue" ? card.cardId.split(".").slice(0, 2).join(".") : null;
  const family = familyKey ? basicFamilies[familyKey] :
    (armorFamilies[card.cardId] ?? talentFamilies[card.cardId] ?? mountFamilies[card.cardId] ??
      statueFamilies[statueFamilyId] ?? specialFamilies[card.cardId]);
  return {
    cardId: card.cardId,
    displayName: card.displayName,
    category: card.category,
    color: card.color,
    initialDeckCount: card.initialDeckCount,
    effectFamilyId: family?.familyId ?? null,
    effectEncodingStatus: family ? `${card.category}_effect_encoded` : "category_pending_dsl",
    resourceKey: card.resourceKey,
    ruleSource: "docs/整理/20-v1.3.4非BOSS牌规则正文.md",
    rulesetVersion: version
  };
});

const related = {
  P001:["basic.coin.*"],P002:["armor.*"],P003:["armor.a09","special.sp03"],P004:["basic.*"],
  P005:["armor.*"],P006:["armor.a02","armor.a09"],P007:["armor.a02"],P008:["armor.a01","armor.a03"],
  P009:["armor.a04"],P010:["armor.a05"],P011:["armor.a06"],P012:["armor.a07"],P013:["armor.a08"],
  P014:["armor.a09"],P015:["talent.*"],P016:["talent.triple_wield"],
  P017:["talent.poison_shield","talent.fire_shield"],P018:["talent.life_steal","talent.mana_siphon"],
  P019:["talent.shop_discount"],P020:["talent.ice_shield"],P021:["talent.electric_shield"],
  P022:["talent.spike_shield"],P023:["talent.precision_strike"],P024:["talent.statue_double_trigger"],
  P025:["talent.extra_gem"],P026:["mount.*"],P027:["mount.m07","mount.m08","mount.m10","mount.m11"],
  P028:["mount.m11"],P029:["mount.*"],P030:["statue.*"],P031:["statue.*"],
  P032:["statue.werewolf.*"],P033:["statue.rogue.*","statue.elf.*"],P034:["statue.paladin.*"],
  P035:["statue.priest.*"],P036:["statue.knight.*"],P037:["statue.assassin.*"],
  P038:["statue.engineer.*"],P039:["special.*"],P040:["special.sp01","special.sp02","special.sp03","special.sp09"],
  P041:["special.sp01","special.sp02"],P042:["special.sp03"],P043:["special.sp04"],
  P044:["special.sp05"],P045:["special.sp07"],P046:["special.sp08"],P047:["special.sp09"],
  P048:["special.sp10"],P049:["special.sp11"],P050:["special.sp11"],P051:["*"],P052:["*"]
};
const testRows = rows(testDoc).filter((row) => /^P\d{3}$/.test(row[0]));
const rules = testRows.map((row) => ({
  ruleId: `nonboss.acceptance.${row[0].toLowerCase()}`,
  testIds: [row[0]],
  relatedCardIds: related[row[0]] ?? [],
  scenario: row[1],
  assertion: row[2],
  encodingStatus: "effect_dsl_encoded"
}));

if (templates.length !== 128) throw new Error(`nonboss template count ${templates.length}`);
if (templates.reduce((sum, item) => sum + item.initialDeckCount, 0) !== 267) {
  throw new Error("nonboss physical card count");
}
if (templates.filter((item) => item.effectEncodingStatus === "basic_effect_encoded").length !== 22) {
  throw new Error("basic encoded template count");
}
if (templates.filter((item) => item.effectEncodingStatus === "armor_effect_encoded").length !== 9) {
  throw new Error("armor encoded template count");
}
if (templates.filter((item) => item.effectEncodingStatus === "talent_effect_encoded").length !== 25) {
  throw new Error("talent encoded template count");
}
if (templates.filter((item) => item.effectEncodingStatus === "mount_effect_encoded").length !== 11) {
  throw new Error("mount encoded template count");
}
if (templates.filter((item) => item.effectEncodingStatus === "statue_effect_encoded").length !== 50) {
  throw new Error("statue encoded template count");
}
if (templates.filter((item) => item.effectEncodingStatus === "special_effect_encoded").length !== 11) {
  throw new Error("special encoded template count");
}
if (rules.length !== 52 || rules.some((rule) => rule.relatedCardIds.length === 0)) {
  throw new Error("nonboss test mapping");
}

fs.writeFileSync(out, `${JSON.stringify({
  rulePackId: "skb.v1.3.4.nonboss",
  dslVersion: "1.0.0",
  rulesetVersion: version,
  source: "docs/整理/20-v1.3.4非BOSS牌规则正文.md",
  testSource: "docs/整理/21-v1.3.4非BOSS牌测试清单.md",
  effectFamilies: [...Object.values(basicFamilies), ...Object.values(armorFamilies),
    ...Object.values(talentFamilies), ...Object.values(mountFamilies),
    ...Object.values(statueFamilies), ...Object.values(specialFamilies)],
  templates,
  rules
}, null, 2)}\n`);

console.log(JSON.stringify({
  templates: templates.length,
  physicalCards: templates.reduce((sum, item) => sum + item.initialDeckCount, 0),
  effectFamilies: Object.keys(basicFamilies).length + Object.keys(armorFamilies).length +
    Object.keys(talentFamilies).length + Object.keys(mountFamilies).length +
    Object.keys(statueFamilies).length + Object.keys(specialFamilies).length,
  basicTemplatesEncoded: templates.filter((item) =>
    item.effectEncodingStatus === "basic_effect_encoded").length,
  armorTemplatesEncoded: templates.filter((item) =>
    item.effectEncodingStatus === "armor_effect_encoded").length,
  talentTemplatesEncoded: templates.filter((item) =>
    item.effectEncodingStatus === "talent_effect_encoded").length,
  mountTemplatesEncoded: templates.filter((item) =>
    item.effectEncodingStatus === "mount_effect_encoded").length,
  statueTemplatesEncoded: templates.filter((item) =>
    item.effectEncodingStatus === "statue_effect_encoded").length,
  specialTemplatesEncoded: templates.filter((item) =>
    item.effectEncodingStatus === "special_effect_encoded").length,
  categoryPending: templates.filter((item) =>
    item.effectEncodingStatus === "category_pending_dsl").length,
  mappedTests: rules.length
}, null, 2));
