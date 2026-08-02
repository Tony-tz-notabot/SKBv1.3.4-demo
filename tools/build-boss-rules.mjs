import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const version = "1.3.4";
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const out = path.join(root, "rulesets", `v${version}`, "boss-rules.json");
const cards = JSON.parse(read(`rulesets/v${version}/cards.json`)).items
  .filter((card) => card.category === "boss");
const testDoc = read("docs/整理/23-v1.3.4BOSS牌测试清单.md");
const rows = testDoc.split(/\r?\n/).filter((line) => /^\|.*\|$/.test(line))
  .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()))
  .filter((row) => /^B\d{3}$/.test(row[0]));

const commonPolicy = {
  policyId: "boss.common.v1.3.4",
  perPlayerUseLimit: { scope: "perTurnAny", max: 1, consumeAt: "card.use.committed",
    offTurnUseCountsAgainstCurrentTurnOnly: true },
  slot: { slotId: "bossSlot", capacity: 1, isEquipmentZone: false,
    unaffectedByEquipmentDisable: true,
    persistentBossRequiresEmptyOrLegallyReplaceableSlot: true,
    instantBossDoesNotOccupySlot: true },
  replacement: { defaultActiveDiscard: "forbidden", defaultActiveReplace: "forbidden",
    exceptionCardId: "boss.iron_pirate_king", exceptionOnlyBeforeDeath: true },
  genericDismantle: { settingKey: "rules.boss.allowGenericDismantle", default: true,
    trueAllowsGenericPublicCardDismantle: true,
    categoryRestrictedDismantleStillRespectsCategory: true },
  exit: { defaultDestination: "discardPile", cancelUncreatedEffects: true,
    committedAttacksDamageAndTriggersContinue: true, holderEliminationCausesExit: true },
  attackDefaults: { killCost: 0, attackCountCost: 0,
    stillUsesNormalAttackResponseHitDamageAndDyingPipeline: true },
  specialWindow: { availableInOriginalPrepareTimingOfStasisTurnOnlyWhenCardExplicitlyAllows: true,
    isNotPhase: true, doesNotEmitPhaseEvents: true, disallowsUnrelatedActions: true },
  controlImmunity: { preventsExternalControl: true,
    doesNotPreventSelfGrantedStasisOrPhaseReplacement: true },
  timeout: { optionalOrBeneficial: "pass", forcedOrHarmful: "randomLegal",
    cardSpecificPolicyOverrides: true }
};

const bossFamilies = {
  "boss.purple_lord": {
    familyId: "boss.purple_lord", displayName: "紫爵士", bossType: "persistent",
    activation: { point: "owner.currentPhase.end.start", anchorTurn: "useTurnN" },
    duration: { from: "activation", expiry: "owner.nthTurn.1.phase.end.start",
      earlyExitCancelsUncreatedEffects: true },
    activeState: { ironShield: 1, statuses: ["status.stasis"],
      equipmentEffectsEnabled: false, controlImmunity: "externalOnly" },
    specialWindows: [{ windowId: "purpleLord.heroBlade", point: "owner.nthTurn.1.originalPrepareTiming",
      maxUses: 1, optional: true, timeoutPolicy: "pass", noMakeupIfPassed: true,
      effects: [{ op: "selectTargets", params: { min: 1, max: 1, optional: true,
        selector: { inPlay: true, withinRange: 4 }, timeoutPolicy: "pass" } },
      { op: "createAttack", params: { ifTargetSelected: true, source: "$controller",
        targets: ["$selection.target"], range: 4, attackType: "melee", killCost: 0,
        attackCountCost: 0, responsePolicy: { dodge: true, armor: true, meleeBlock: false },
        damageSegments: [{ segmentId: "heroBlade", deliveryType: "attack", attackType: "melee",
          damageType: "normal", element: "none", amount: 4, repeat: 1, isAdditional: false }] } }]
    }],
    triggers: [{ triggerId: "purpleLord.demonBlade", event: "phase.before", mandatory: true,
      filter: { phase: "prepare", actorIsOtherInPlayCharacter: true, bossActive: true },
      effects: [{ op: "createAttack", params: { source: "$controller", targets: ["$phase.actor"],
        range: "unlimited", attackType: "melee", killCost: 0, attackCountCost: 0,
        triggerEvenIfPhaseWillBeSkipped: true,
        damageSegments: [{ segmentId: "demonBlade", deliveryType: "attack", attackType: "melee",
          damageType: "normal", element: "none", amount: 2, repeat: 1, isAdditional: false }],
        onHit: [{ op: "judgeColor", params: { matchedColors: ["white", "blue"], purpose: "status",
          triggerOnHitEvenWhenActualDamageZero: true, onMatched: { op: "applyStatus",
            target: "$phase.actor", params: { statusId: "status.frozen", stackPolicy: "uniqueRefresh" } } } }] } }]
    }],
    cleanup: [{ op: "modifyIronShield", target: "$controller", params: { removeBossContribution: true } },
      { op: "removeStatus", target: "$controller", params: { statusId: "status.stasis",
        sourceRef: "$card" } }, { op: "enableEquipmentEffects", target: "$controller",
        params: { removeSourceDisable: "$card" } }]
  },
  "boss.red_lord": {
    familyId: "boss.red_lord", displayName: "红爵士", bossType: "persistent",
    activation: { point: "owner.currentPhase.end.start", anchorTurn: "useTurnN" },
    duration: { from: "activation", expiry: "owner.nthTurn.2.phase.end.start",
      naturalExpiryDoesNotApplyBacklash: true },
    activeState: { ironShield: 1, statuses: ["status.stasis"],
      equipmentEffectsEnabled: false, controlImmunity: "externalOnly",
      counters: [{ counterId: "redLord.actualPositiveDamageCount", initial: 0, max: 4 }] },
    replacements: [{ event: "damage.finalized", priority: "mandatoryModifier",
      filter: { targetIsController: true, bossActive: true, finalizedAmountPositive: true,
        afterImmunityPreventionArmorReductionAndIronShield: true },
      effects: [{ op: "modifyDamage", params: { setAmount: 1 } },
        { op: "modifyMarker", params: { markerId: "redLord.actualPositiveDamageCount",
          deltaAfterActualDeduction: 1 } }, { op: "if", params: { condition: {
          equals: ["$marker.redLord.actualPositiveDamageCount", 4] }, then: { op: "sequence",
          effects: [{ op: "expireDuration", params: { bossRef: "$card", reason: "fourthDamage" } },
            { op: "applyStatus", target: "$controller", params: { statusId: "status.frozen",
              stackPolicy: "uniqueRefresh" } }, { op: "applyStatus", target: "$controller",
              params: { statusId: "status.electrified", stackPolicy: "uniqueRefresh" } }] } } }]
    }],
    specialWindows: [{ windowId: "redLord.sealingHammer", points: [
      "owner.nthTurn.1.originalPrepareTiming", "owner.nthTurn.2.originalPrepareTiming"],
      maxUsesPerPoint: 1, optional: true, timeoutPolicy: "pass",
      effects: [{ op: "selectTargets", params: { chooser: "$controller", min: 0, max: 1,
        optional: true, selector: { inPlay: true, withinRange: 4 }, saveAs: "meleeTarget",
        timeoutPolicy: "pass" } }, { op: "selectTargets", params: { chooser: "$controller",
        min: 0, max: 1, optional: true, distinctFrom: "$meleeTarget",
        selector: { inPlay: true, withinRange: 4 }, saveAs: "laserTarget", timeoutPolicy: "pass" } },
      { op: "createAttack", params: { attackObject: "singleCompositeMultiTargetAttack",
        source: "$controller", killCost: 0, attackCountCost: 0,
        targetGroups: [{ ifSelected: "$meleeTarget", target: "$meleeTarget", independentResponse: true,
          attackType: "melee", range: 4, damage: 3, dodge: true },
        { ifSelected: "$laserTarget", target: "$laserTarget", independentResponse: true,
          attackType: "laser", range: 4, damage: 3, dodge: true, meleeBlock: false }],
        emptyGroupsCreateNoTargetEffect: true, targetOrder: "counterclockwiseSerial" } }]
    }],
    cleanup: [{ op: "modifyIronShield", target: "$controller", params: { removeBossContribution: true } },
      { op: "removeStatus", target: "$controller", params: { statusId: "status.stasis",
        sourceRef: "$card" } }, { op: "enableEquipmentEffects", target: "$controller",
        params: { removeSourceDisable: "$card" } }]
  },
  "boss.iron_pirate_king": {
    familyId: "boss.iron_pirate_king", displayName: "钢铁破浪者号", bossType: "persistent",
    duration: { expiry: "permanentUntilExitOrHolderElimination" },
    replacementPolicy: { activeDiscardOrReplaceBeforeDeath: true,
      activeDiscardOrReplaceAfterDeath: false, externalDismantleAllowedByGlobalSetting: true },
    deathReplacement: { event: "elimination.before", filter: { ownerDeathOccurred: true,
      bossInSlot: true }, effects: [{ op: "preventEvent", params: { event: "$elimination" } },
      { op: "setValue", params: { path: "$controller.lifeState", value: "deadNotEliminated" } },
      { op: "setValue", params: { path: "$controller.hpBar", value: null } },
      { op: "setValue", params: { path: "$controller.shieldBar", value: null } },
      { op: "removeStatus", target: "$controller", params: { statusId: "status.dying" } },
      { op: "disableAbility", target: "$controller", params: { selector: "allNonLockedAbilities" } },
      { op: "setValue", params: { path: "$card.postDeathOwnTurnCount", value: 0 } }] },
    deadNotEliminatedRules: {
      inPlay: true, occupiesDistance: true, countsAsTeamNotEliminated: true,
      retains: ["seat", "turns", "hand", "equipment", "lockedAbilities"],
      healthShieldOperations: { actualDamage: 0, actualHpLoss: 0, actualShieldLoss: 0,
        recovery: "prevented", modifyHpShield: "prevented", payHpShieldCost: "illegal" },
      damageEvent: { stillCreateReceivedEvent: true, attacksCanHit: true,
        hitAndReceivedFollowupsStillTrigger: true, actualDamageBenefitsDoNotTrigger: true }
    },
    triggers: [{ event: "turn.start", mandatory: true, filter: { actorIsController: true,
      lifeState: "deadNotEliminated", excludesTurnContainingDeath: true }, effects: [
      { op: "modifyValue", params: { path: "$card.postDeathOwnTurnCount", delta: 1 } }] },
    { event: "phase.start", mandatory: true, filter: { phase: "end", actorIsController: true,
      lifeState: "deadNotEliminated", postDeathOwnTurnCount: 2 }, effects: [
      { op: "eliminateCharacter", target: "$controller", params: { reason: "ironPirateTwoTurnsElapsed" } }] },
    { event: "card.lost", mandatory: true, filter: { cardIsThisBoss: true,
      ownerLifeState: "deadNotEliminated" }, effects: [{ op: "eliminateCharacter",
      target: "$controller", params: { reason: "ironPirateLostAfterDeath", atomicWithCardLoss: true } }] }]
  },
  "boss.crystal_crab": {
    familyId: "boss.crystal_crab", displayName: "水晶巨蟹", bossType: "persistent",
    activation: { point: "owner.currentTurn.end" },
    duration: { expiry: "owner.nthTurn.2.end", includesBoundaryUntilEnd: true },
    activeState: { ironShield: 1, statuses: ["status.stasis"], equipmentEffectsEnabled: false },
    offTurnWindow: { from: "owner.previousTurn.end", to: "owner.nextTurn.before",
      state: { actualPassivePincerAttacksLaunched: 0 } },
    phaseReplacement: { points: ["owner.nthTurn.1", "owner.nthTurn.2"],
      replaceWholeTurn: true, effects: [{ op: "recoverHp", target: "$controller", params: { amount: 1 } }] },
    pincerAttack: { range: "unlimited", attackType: "melee", damage: 1, killCost: 0,
      attackCountCost: 0, onHit: [{ op: "judgeColor", params: { matchedColors: ["white", "blue"],
        purpose: "status", onMatched: { op: "applyStatus", target: "$pincerTarget",
          params: { statusId: "status.frozen", stackPolicy: "uniqueRefresh" } } } }] },
    triggers: [{ event: "attack.resolved", mandatory: true, filter: { inOwnerOffTurnWindow: true,
      ownerWasTarget: true, aggregateActualDamageToOwnerPositive: true,
      firstTriggerForThisAttack: true }, effects: [{ op: "scheduleEffect", params: {
        point: "rootAttackAndOwnerDyingFlow.after", effect: { op: "if", params: { condition: {
          and: [{ notEliminated: "$controller" }, { legalAttackSource: "$attack.source" }] }, then: {
          op: "sequence", effects: [{ op: "createAttack", params: { templateRef: "$family.pincerAttack",
            source: "$controller", targets: ["$attack.source"] } }, { op: "modifyValue", params: {
            path: "$window.actualPassivePincerAttacksLaunched", delta: 1,
            onlyIfAttackCommitted: true } }] } } } } }] }],
    specialWindows: [{ point: "owner.nextTurn.originalPrepareTiming", optional: true,
      filter: { actualPassivePincerAttacksLaunched: 0 }, timeoutPolicy: "pass",
      effects: [{ op: "selectTargets", params: { min: 0, max: 1, optional: true,
        selector: { inPlay: true, legalForAttackTemplate: "$family.pincerAttack" },
        timeoutPolicy: "pass" } }, { op: "createAttack", params: { ifTargetSelected: true,
        templateRef: "$family.pincerAttack", source: "$controller", targets: ["$selection.target"] } }]
    }],
    cleanup: [{ op: "modifyIronShield", target: "$controller", params: { removeBossContribution: true } },
      { op: "removeStatus", target: "$controller", params: { statusId: "status.stasis",
        sourceRef: "$card" } }, { op: "enableEquipmentEffects", target: "$controller",
        params: { removeSourceDisable: "$card" } }]
  },
  "boss.c6h8o6": {
    familyId: "boss.c6h8o6", displayName: "C6H8O6", bossType: "hybrid",
    declaration: { chooseBranchBeforeLegalityAndPayment: true, sharedCost: {
      kind: "attackCount", amount: 1, payOnlyAfterAllBranchLegalityPasses: true } },
    modes: [{ modeId: "laserSweep", occupiesBossSlot: false,
      choices: [{ kind: "cardFamily", options: ["basic.kill", "basic.dodge"], saveAs: "requestedFamily" }],
      effects: [{ op: "requestSpecialPlay", params: { eligiblePlayers: {
        selector: "otherInPlayCharactersCounterclockwise" }, requestedFamily: "$requestedFamily",
        allowedMethods: ["handCard", "explicitPlayAsAbility", "explicitPlayAsEquipment"],
        discardDoesNotCount: true, opportunitiesPerPlayer: 1, collectAllBeforeConsequences: true,
        saveNonRespondersAs: "nonResponders" } }, { op: "setVar", params: { name: "x",
        value: { count: "$nonResponders" } } }, { op: "if", params: { condition: { gt: ["$x", 0] },
        then: { op: "forEach", params: { items: "$nonResponders.counterclockwise", mode: "serial",
          maxIterations: 25 }, effects: [{ op: "createDamage", target: "$item", params: {
            source: "$controller", deliveryType: "direct", attackType: "laser", damageType: "normal",
            amount: { switch: { expression: "$x", cases: { 3: 2, 2: 3, 1: 5 } } } } },
          { op: "checkDying", target: "$item", mode: "completeNestedFirst" }] } } }]
    }, { modeId: "focusedBombardment", occupiesBossSlot: true,
      legality: { bossSlotEmptyOrPreDeathIronPirateReplaceable: true },
      targetRule: { selector: "inPlayCharacter", range: 1, min: 1, max: 1 },
      choices: [{ kind: "cardFamily", options: ["basic.kill", "basic.dodge"], saveAs: "requestedFamily" }],
      delayed: { point: "target.nextPhase.play.after", fireWhenPhaseSkipped: true,
        cancelIfTargetEliminatedOrLeftPlay: true, deadNotEliminatedStillTriggers: true,
        effects: [{ op: "repeat", maxIterations: 2, params: { exactly: 2 }, effects: [
          { op: "requestSpecialPlay", params: { eligiblePlayers: ["$target"], requestedFamily: "$requestedFamily",
            opportunitiesPerPlayer: 1, saveSuccessCountAs: "playedCount" } }] },
        { op: "switch", params: { expression: "$playedCount", cases: {
          0: { effects: [{ op: "createDamage", target: "$target", params: { source: "$controller",
            deliveryType: "direct", attackType: "field", damageType: "normal", amount: 5 } }] },
          1: { effects: [{ op: "createDamage", target: "$target", params: { source: "$controller",
            deliveryType: "direct", attackType: "field", damageType: "normal", amount: 2 } }] },
          2: { effects: [{ op: "noop" }] } } } }, { op: "discardCard", target: "$card" }] }
    }]
  },
  "boss.dark_grand_knight": {
    familyId: "boss.dark_grand_knight", displayName: "暗黑大骑士", bossType: "persistent",
    activation: { point: "owner.currentPhase.end.start" },
    duration: { expiry: "owner.nthTurn.2.phase.end.start" },
    activeState: { ironShieldDelta: -1, equipmentEffectsEnabled: false,
      disableAbilities: "nonLockedOnly", attackCountSet: 0, preventAllHpShieldRecovery: true,
      stillAllowsLegalCardsAndResponses: true },
    blackSword: { objectKind: "marker", max: 2, dismantlable: false,
      createAction: { window: "owner.phase.play", maxUsesPerPhase: 2,
        illegalAtMaximumWithoutCosts: true, effects: [{ op: "changeHp", target: "$controller",
          params: { delta: -1, semantic: "modifyNotDamage" } }, { op: "changeMaxHp", target: "$controller",
          params: { delta: -1, clampCurrentOnlyAboveNewMaximum: true } },
        { op: "checkDying", target: "$controller" }, { op: "addMarker", params: {
          markerId: "darkKnight.blackSword", amount: 1 } }] } },
    attackModes: [{ modeId: "thrust", costMarker: 1, range: 4, attackType: "ranged",
      tags: ["scatter", "ignoreArmor", "cannotMeleeBlock"], damage: { amount: 2, repeat: 2 }, dodge: true },
    { modeId: "slash", costMarker: 1, range: 2, attackType: "melee", tags: ["ignoreArmor"],
      damage: { amount: 4, repeat: 1 }, dodge: true },
    { modeId: "hammer", costMarker: 1, range: 2, attackType: "field", tags: ["ignoreArmor"],
      damage: { amount: 2, repeat: 1 }, dodge: false, onHit: [{ op: "applyStatus", target: "$target",
        params: { statusId: "status.electrified", stackPolicy: "uniqueRefresh" } }] }],
    deathReplacement: { event: "elimination.before", effects: [{ op: "preventEvent",
      params: { event: "$elimination", untilFinalStrikeEnds: true } }, { op: "repeat", maxIterations: 2,
      params: { whileMarkerAvailable: "darkKnight.blackSword", optionalEachIteration: true,
        timeoutPolicy: "abortRemaining" }, effects: [{ op: "selectTargets", params: { min: 0, max: 1,
        selector: { inPlay: true }, timeoutPolicy: "abortRemaining" } }, { op: "consumeMarker", params: {
        markerId: "darkKnight.blackSword", amount: 1, ifTargetSelected: true } },
      { op: "createAttack", params: { ifTargetSelected: true, source: "$controller",
        targets: ["$selection.target"], range: "unlimited", attackType: "melee", damage: 3,
        killCost: 0, attackCountCost: 0, tags: ["ignoreArmor", "cannotMeleeBlock"],
        completeTargetAndDyingBeforeNextIteration: true } }] }, { op: "eliminateCharacter",
      target: "$controller", params: { afterCommittedFinalStrikesAndDyingComplete: true } }] },
    earlyExit: [{ op: "resetMarker", params: { markerId: "darkKnight.blackSword" } },
      { op: "eliminateCharacter", target: "$controller", params: {
        ifFinalStrikePending: true, cancelUncommittedOnly: true } }]
  },
  "boss.giant_slime": {
    familyId: "boss.giant_slime", displayName: "大史莱姆", bossType: "persistent",
    activation: { point: "card.use.committed", immediate: true },
    duration: { expiry: "owner.nthTurn.2.phase.end.start" },
    specialLayer: { layerId: "giantSlime.temporaryHp", initial: 5, recoverable: false,
      routingPriority: "afterBoxAndIronShieldBeforeShieldAndHp",
      acceptsDamageTypes: ["normal", "hp", "true"], excludes: ["shield", "modify"],
      countsAsActualHpLoss: false, overflowPolicyOnDepletion: "stopCurrentSegment" },
    triggers: [{ event: "layer.depleted", mandatory: true, filter: {
      layerId: "giantSlime.temporaryHp" }, effects: [{ op: "expireDuration", params: {
      bossRef: "$card", reason: "temporaryLayerDepleted" } }, { op: "createDamage",
      target: "$controller", params: { source: "$controller", deliveryType: "direct",
      attackType: "field", damageType: "normal", amount: 5 } },
      { op: "checkDying", target: "$controller", mode: "completeNestedFirst" },
      { op: "return", params: { to: "originalAttackNextDamageSegment" } }] }],
    cleanup: [{ op: "removeSpecialLayer", target: "$controller", params: {
      layerId: "giantSlime.temporaryHp", noBacklashUnlessDepletedByDamage: true } }]
  },
  "boss.golden_mask": {
    familyId: "boss.golden_mask", displayName: "金面猴王", bossType: "persistent",
    activation: { point: "owner.nthTurn.1.before" },
    duration: { expiry: "owner.nthTurn.2.phase.end.start" },
    phaseReplacement: { ownerTurns: [1, 2], phases: ["draw", "play"],
      onlyIfPhaseWouldActuallyOccur: true, skippedPhaseDoesNotTrigger: true,
      replacementEffect: [{ op: "judgeColor", params: { purpose: "branch", isCritical: false,
        branches: { white: { action: "noAttack" }, green: { template: "pineapple" },
          blue: { template: "stoneCrab" }, orange: { template: "explosivePack" },
          red: { template: "airSupport" } } } }, { op: "selectTargets", params: {
        min: 0, max: 1, optional: true, selector: { inPlay: true,
          withinRangeOfSelectedTemplate: true }, timeoutPolicy: "pass", skipForWhite: true } },
      { op: "createAttack", params: { ifTargetSelected: true, templateRef: "$judgment.branch.template",
        source: "$controller", targets: ["$selection.target"], killCost: 0, attackCountCost: 0,
        isWeaponAttack: false } }] },
    attackTemplates: {
      pineapple: { range: 3, attackType: "ranged", dimensions: { combo: 3 },
        ignoresWeaponDimensionTalents: true, damage: { amount: 1, repeat: 3 } },
      stoneCrab: { range: 2, attackType: "melee", dimensions: { combo: 3 },
        ignoresWeaponDimensionTalents: true, damage: { amount: 1, repeat: 3 } },
      explosivePack: { range: 1, attackType: "field", damage: { amount: 2, repeat: 1 },
        onHit: [{ op: "judgeColor", params: { matchedColors: ["red", "orange"], purpose: "additionalEffect",
          isCritical: false, triggerOnHitEvenWhenActualDamageZero: true, onMatched: {
            op: "createDamage", target: "$target", params: { deliveryType: "attack",
              attackType: "field", damageType: "normal", element: "fire", amount: 1,
              isAdditional: true } } } }] },
      airSupport: { range: 4, attackType: "field", damage: { amount: 2, repeat: 1 },
        onHit: [{ op: "applyStatus", target: "$target", params: {
          statusId: "status.electrified", stackPolicy: "uniqueRefresh" } }] }
    }
  },
  "boss.valkyrie": {
    familyId: "boss.valkyrie", displayName: "瓦尔基里", bossType: "instantResponse",
    occupiesBossSlot: false,
    response: { event: "card.use.committed", timing: "afterCostsBeforeResolution",
      filter: { cardCategory: "boss", cardFamilyNot: "boss.valkyrie",
        originalControllerIsOtherPlayer: true, responderBossUseLimitAvailable: true },
      responseOrder: "normalPriorityLastInFirstOut", multipleRespondersAllowed: true,
      originalBossContinuesAfterResponses: true },
    effects: [{ op: "copyCard", target: "$respondedBoss.template", params: {
      copyTemplateOnly: true, exclude: ["paidCosts", "choices", "targets", "progress", "markers"],
      createPhysicalInstance: true, generatedInstanceExitZone: "outsideDeck",
      retainAllTemplateRulesIncludingIronPirate: true, saveAs: "bossCopy" } },
      { op: "gainCard", target: "$bossCopy", params: { to: "$controller.hand" } }],
    copiedInstancePolicy: { mayBeUsedGainedOrLostNormally: true,
      revalidateAndRepayAllCostsOnUse: true, anyZoneExitGoesToOutsideDeck: true,
      neverEntersDiscardOrReshuffle: true, instancesIndependent: true }
  }
};

const related = {
  B001:["boss.*"],B002:["boss.*"],B003:["boss.iron_pirate_king"],B004:["boss.*"],
  B005:["boss.*"],B006:["boss.purple_lord","boss.red_lord"],B007:["boss.purple_lord","boss.red_lord"],
  B008:["boss.*"],B009:["boss.purple_lord"],B010:["boss.purple_lord"],B011:["boss.purple_lord"],
  B012:["boss.red_lord"],B013:["boss.red_lord"],B014:["boss.red_lord"],B015:["boss.red_lord"],
  B016:["boss.iron_pirate_king"],B017:["boss.iron_pirate_king"],B018:["boss.iron_pirate_king"],
  B019:["boss.iron_pirate_king"],B020:["boss.crystal_crab"],B021:["boss.crystal_crab"],
  B022:["boss.crystal_crab"],B023:["boss.crystal_crab"],B024:["boss.c6h8o6"],
  B025:["boss.c6h8o6"],B026:["boss.c6h8o6"],B027:["boss.c6h8o6"],B028:["boss.c6h8o6"],
  B029:["boss.dark_grand_knight"],B030:["boss.dark_grand_knight"],B031:["boss.dark_grand_knight"],
  B032:["boss.dark_grand_knight"],B033:["boss.dark_grand_knight"],B034:["boss.giant_slime"],
  B035:["boss.giant_slime"],B036:["boss.giant_slime"],B037:["boss.giant_slime"],
  B038:["boss.golden_mask"],B039:["boss.golden_mask"],B040:["boss.golden_mask"],
  B041:["boss.golden_mask"],B042:["boss.golden_mask"],B043:["boss.valkyrie"],
  B044:["boss.valkyrie"],B045:["boss.valkyrie"],B046:["boss.valkyrie","boss.iron_pirate_king"],
  B047:["boss.valkyrie"],B048:["boss.valkyrie"],B049:["boss.*"],B050:["boss.*"]
};

const templates = cards.map((card) => ({
  cardId: card.cardId, displayName: card.displayName, color: card.color,
  initialDeckCount: card.initialDeckCount, resourceKey: card.resourceKey,
  commonPolicyId: commonPolicy.policyId,
  effectFamilyId: bossFamilies[card.cardId]?.familyId ?? null,
  effectEncodingStatus: bossFamilies[card.cardId] ? "boss_effect_encoded" : "boss_effect_pending_dsl",
  ruleSource: "docs/整理/22-v1.3.4BOSS牌规则正文.md", rulesetVersion: version
}));
const rules = rows.map((row) => ({
  ruleId: `boss.acceptance.${row[0].toLowerCase()}`, testIds: [row[0]],
  relatedCardIds: related[row[0]], scenario: row[1], assertion: row[2],
  encodingStatus: Number(row[0].slice(1)) <= 8 ? "common_dsl_encoded" :
    "effect_dsl_encoded"
}));

if (templates.length !== 9 || templates.some((item) => item.initialDeckCount !== 1)) {
  throw new Error("boss template/deck count");
}
if (rules.length !== 50 || rules.some((rule) => !rule.relatedCardIds?.length)) {
  throw new Error("boss test mapping");
}

fs.writeFileSync(out, `${JSON.stringify({
  rulePackId: "skb.v1.3.4.boss", dslVersion: "1.0.0", rulesetVersion: version,
  source: "docs/整理/22-v1.3.4BOSS牌规则正文.md",
  testSource: "docs/整理/23-v1.3.4BOSS牌测试清单.md",
  commonPolicy, templates, effectFamilies: Object.values(bossFamilies), rules
}, null, 2)}\n`);

console.log(JSON.stringify({ templates: templates.length, physicalCards: 9,
  commonTestsEncoded: rules.filter((rule) => rule.encodingStatus === "common_dsl_encoded").length,
  effectTestsEncoded: rules.filter((rule) => rule.encodingStatus === "effect_dsl_encoded").length,
  bossEffectsEncoded: templates.filter((item) => item.effectEncodingStatus === "boss_effect_encoded").length,
  mappedTests: rules.length, bossEffectsPending: templates.filter((item) =>
    item.effectEncodingStatus === "boss_effect_pending_dsl").length }, null, 2));
