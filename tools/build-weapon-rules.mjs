import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const version = "1.3.4";
const out = path.join(root, "rulesets", `v${version}`, "weapon-rules.json");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const rows = (text) => text.split(/\r?\n/)
  .filter((line) => /^\|.*\|$/.test(line))
  .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()))
  .filter((cells) => !cells.every((cell) => /^:?-+:?$/.test(cell)));

const weaponDoc = read("docs/整理/18-v1.3.4武器规则正文.md");
const testDoc = read("docs/整理/19-v1.3.4武器规则测试清单.md");
const colorMap = { 白: "white", 绿: "green", 蓝: "blue", 橙: "orange", 红: "red" };
const typeMap = {
  远程: "ranged", 近战: "melee", 激光: "laser", 场地: "field",
  散弹: "scatter", 连击: "combo", 蓄力: "charge",
  特殊武器: "special", 第三武器: "thirdWeapon", 形态: "transformed"
};
const normalizeRule = (value) => value.replaceAll("`", "");
const weaponRows = rows(weaponDoc).filter((row) => /^W-\d{2}$/.test(row[0]));
const cardFacts = JSON.parse(read(`rulesets/v${version}/cards.json`)).items;
const related = {
  W010:["weapon.w01"],W011:["weapon.w02"],W012:["weapon.w03"],W013:["weapon.w04"],
  W014:["weapon.w05"],W015:["weapon.w07"],W016:["weapon.w10"],W017:["weapon.w12"],
  W018:["weapon.w12"],W019:["weapon.w15"],W020:["weapon.w16"],W021:["weapon.w18"],
  W022:["weapon.w20"],W023:["weapon.w21"],W024:["weapon.w25"],W025:["weapon.w26"],
  W026:["weapon.w29"],W027:["weapon.w30"],W028:["weapon.w33"],W029:["weapon.w37"],
  W030:["weapon.w37"],W031:["weapon.w39"],W032:["weapon.w42"],W033:["weapon.w43"],
  W034:["weapon.w48"],W035:["weapon.w49"],W036:["weapon.w50"],
  W037:["weapon.w54","weapon.w66"],W038:["weapon.w54"],W039:["weapon.w55"],
  W040:["weapon.w56"],W041:["weapon.w56"],W042:["weapon.w57"],W043:["weapon.w58"],
  W044:["weapon.w59"],W045:["weapon.w60"],W046:["weapon.w61"],
  W047:["weapon.w62","weapon.w63"],W048:["weapon.w64"],W049:["weapon.w64"],
  W050:["weapon.w66"],W052:["weapon.w19"]
};
const complexPattern = /判定|追加|蓄力|方式|自动档|目标|形态|CD|耐久|瞄准|诅咒|不可攻击|每发|每个命中|转为|离开|不耗|血量|使用者|追击|展示|获得|给予|拆|回复|距离|整次/;
const synthesizedIds = new Set([
  "weapon.w24","weapon.w26","weapon.w29","weapon.w33",
  "weapon.w37","weapon.w38","weapon.w42","weapon.w48"
]);
const transformIds = new Set(["weapon.w39"]);
const synthesisRecipes = [
  { recipeId:"synthesis.weapon.w24", inputs:[{templateId:"weapon.w23",count:2}], outputTemplateId:"weapon.w24" },
  { recipeId:"synthesis.weapon.w26", inputs:[{templateId:"weapon.w25",count:1},{templateId:"weapon.w04",count:1}], outputTemplateId:"weapon.w26" },
  { recipeId:"synthesis.weapon.w29", inputs:[{templateId:"weapon.w27",count:1},{templateId:"weapon.w28",count:1}], outputTemplateId:"weapon.w29" },
  { recipeId:"synthesis.weapon.w33", inputs:[{templateId:"weapon.w32",count:4}], outputTemplateId:"weapon.w33" },
  { recipeId:"synthesis.weapon.w37", inputs:[{templateId:"weapon.w34",count:1},{templateId:"weapon.w35",count:1},{templateId:"weapon.w36",count:1}], outputTemplateId:"weapon.w37" },
  { recipeId:"synthesis.weapon.w38", inputs:[{templateId:"weapon.w34",count:1},{templateId:"weapon.w36",count:1}], outputTemplateId:"weapon.w38" },
  { recipeId:"synthesis.weapon.w42", inputs:[{templateId:"weapon.w40",count:1},{templateId:"weapon.w41",count:1}], outputTemplateId:"weapon.w42" },
  { recipeId:"synthesis.weapon.w48", inputs:[{templateId:"weapon.w47",count:1},{templateId:"weapon.w17",count:1}], outputTemplateId:"weapon.w48" },
  { recipeId:"synthesis.weapon.w49", inputs:[{templateId:"weapon.w44",count:1},{templateId:"weapon.w01",count:1}], outputTemplateId:"weapon.w49" },
  { recipeId:"synthesis.armor.a09", inputs:[{templateId:"weapon.w52",count:1},{templateId:"armor.a02",count:1}], outputTemplateId:"armor.a09" }
].map(recipe=>({...recipe,window:"owner.phase.play",inputZones:["hand","equipment"],inputMoveKind:"synthesizeConsume",inputsDestination:"discardPile",outputZone:"hand",generatedInstanceExitZone:"outsideDeck"}));
const segment = (segmentId, attackType, amount, {
  repeat = 1, damageType = "normal", element = "none", isAdditional = false
} = {}) => ({
  segmentId, deliveryType: "attack", attackType, damageType, element,
  amount, repeat, isAdditional, overflowPolicy: "normal"
});
const mode = (range, attackType, damageSegments, extra = {}) => ({
  modeId: "default",
  costs: { killCards: 1, attackCount: 1 },
  targetRule: { min: 1, max: 1, distinct: true },
  range,
  attackTypes: [attackType],
  responsePolicy: attackType === "field" ? "fieldDefault" :
    attackType === "laser" ? "laserDefault" : "standardAttack",
  damageSegments,
  ...extra
});
const judgment = (judgmentId, timing, outcomes, extra = {}) => ({
  judgmentId,
  timing,
  purpose: "criticalAndWeaponEffect",
  oncePer: "attackTarget",
  outcomes,
  ...extra
});
const additionalDamage = (
  segmentId, attackType, amount, repeat, element = "none", requiresAttackHit = true
) => ({
  op: "createDamage",
  target: "$attackTarget",
  params: {
    segment: segment(segmentId, attackType, amount, {
      repeat, element, isAdditional: true
    }),
    responsePolicy: "none",
    requiresAttackHit
  }
});
const applyControl = (statusId) => ({
  op: "applyStatus",
  target: "$attackTarget",
  params: { statusId, stackPolicy: "uniqueRefresh" }
});
const scatterDimension = (base, segmentIds = ["base"]) => ({
  dimensionId: "scatter",
  base,
  affectedSegmentIds: segmentIds,
  modifierSourceTag: "talent.scatterIncrease",
  modifier: { add: 1 }
});
const comboDimension = (base, segmentIds = ["base"]) => ({
  dimensionId: "combo",
  base,
  affectedSegmentIds: segmentIds,
  modifierSourceTag: "talent.comboIncrease",
  modifier: { add: 1 }
});
const automaticRangeTiers = (tiers) => ({
  selectionPolicy: "smallestRangeCoveringEffectiveDistance",
  selectableByPlayer: false,
  zeroRangeOnlyCoversEffectiveDistanceZero: true,
  tiers
});
const chargeState = (maxProgress, tiers) => ({
  counterId: "chargeProgress",
  visibility: "public",
  initial: 0,
  min: 0,
  max: maxProgress,
  chargeAction: {
    phase: "owner.play",
    costs: { killCards: 1, attackCount: 1 },
    targetRule: { min: 0, max: 0 },
    increment: 1,
    clampToMax: true
  },
  tierSelectionPolicy: "exactCurrentProgress",
  selectableByPlayer: false,
  requirementModifier: {
    sourceTag: "talent.chargeAcceleration",
    reduceRequiredProgressBy: 1,
    minimumRequiredProgress: 0,
    zeroRequiredProgressDoesNotCountAsChargeAction: true
  },
  clearOn: ["attack.commit", "weaponResolution.commit", "moveToNonEquipmentZone"],
  preserveOn: ["equipmentToEquipmentTransfer", "equipmentEffectsDisabled"],
  borrowedWeaponPolicy: "temporaryChargeZeroSnapshot",
  tiers
});
const displayDamageResolution = (resolutionId, count, colors) => ({
  resolutionId,
  kind: "directEffect",
  range: 2,
  targetRule: { min: 1, max: 1, distinct: true },
  costs: { killCards: 1, attackCount: 1 },
  createsAttack: false,
  opensResponseWindow: false,
  effects: [
    {
      op: "displayCards",
      params: {
        count,
        countModifier: { sourceTag: "talent.comboIncrease", add: 2 },
        from: "drawPile",
        resultVar: "$displayedCards",
        reshuffleOnExhaustion: true,
        remainingCardsExit: { zone: "discardPile", moveKind: "discard" }
      }
    },
    {
      op: "forEach",
      params: { items: "$displayedCards", mode: "serial" },
      effects: [{
        op: "if",
        params: { condition: { in: [{ get: ["$item", "color"] }, colors] } },
        then: [{
          op: "createDamage",
          target: "$target",
          params: {
            segment: {
              ...segment("display_hit", "field", 1, { isAdditional: true }),
              deliveryType: "directEffect"
            },
            deliveryType: "directEffect",
            responsePolicy: "none"
          }
        }]
      }],
      maxIterations: count + 2
    }
  ]
});
const manualModeSelection = (modeIds, defaultModeId) => ({
  modeIds,
  defaultModeId,
  persistence: "weaponPreselectionSubstate",
  playerSelectable: true,
  switchTiming: "outsideCommittedAttack",
  switchCosts: {},
  switchIsRulesAction: false,
  cannotChangeWeaponDuringCommittedAttack: true
});
const anubisCurseEffect = () => ({
  op: "applyStatus",
  target: "$item.target",
  params: {
    statusId: "status.anubisCurse",
    stackPolicy: "uniqueRefresh",
    restrictions: [
      { kind: "disableAbilities", filter: { locked: false } },
      { kind: "forbidEquippedWeaponAttacks" }
    ],
    temporaryWeaponOverride: {
      templateId: "weapon.w32",
      instanceOrigin: "temporaryOutsideDeck",
      doesNotEnterEquipmentZone: true,
      automaticallyUsedForAttacks: true,
      removeWithStatus: true
    }
  },
  expiry: {
    point: "target.nextPhase.prepare.before",
    skipPolicy: "expireOnSkippedBoundary"
  }
});

// 第一批：只编码“判定/附加伤害”本身已闭合的武器。
// 多档、蓄力、形态、特殊费用等机制留给后续批次，避免用自然语言猜测。
const complexEncodings = {
  "weapon.w03": {
    attackModes: [
      mode(1, "melee", [segment("base", "melee", 3)], { modeId: "charge_0_2" }),
      mode(3, "field", [segment("base", "field", 6)], {
        modeId: "charge_3",
        targetRule: { min: 1, max: 2, distinct: true },
        targetResolution: "counterclockwiseSerial"
      })
    ],
    charge: chargeState(3, [
      { progress: 0, attackModeId: "charge_0_2", attackAllowed: true },
      { progress: 1, attackModeId: "charge_0_2", attackAllowed: true },
      { progress: 2, attackModeId: "charge_0_2", attackAllowed: true },
      { progress: 3, attackModeId: "charge_3", attackAllowed: true }
    ])
  },
  "weapon.w01": {
    attackModes: [mode(2, "ranged", [segment("base", "ranged", 2)])],
    judgments: [judgment("on_hit", "attack.hit.beforeDamage", {
      orange: { matched: true, effects: [additionalDamage("fire_additional", "ranged", 1, 2, "fire")] },
      default: { matched: false, effects: [] }
    })]
  },
  "weapon.w02": {
    attackModes: [mode(1, "melee", [segment("base", "melee", 2)])],
    judgments: [judgment("after_hit_result", "attack.hitDetermined.beforeDamage", {
      blue: { matched: true, effects: [additionalDamage("normal_additional", "melee", 3, 1)] },
      green: { matched: true, effects: [additionalDamage("normal_additional", "melee", 3, 1)] },
      default: { matched: false, effects: [] }
    }, { runOnHit: true, runOnMiss: true, effectsRequireAttackHit: false })]
  },
  "weapon.w04": {
    attackModes: [mode(1, "field", [segment("base", "field", 1)], {
      targetRule: { min: 1, max: 2, distinct: true },
      targetResolution: "counterclockwiseSerial"
    })],
    judgments: [judgment("per_hit_target", "attack.hit.beforeDamage", {
      red: { matched: true, effects: [additionalDamage("fire_additional", "field", 1, 2, "fire")] },
      default: { matched: false, effects: [] }
    })]
  },
  "weapon.w05": {
    attackModes: [
      mode(1, "laser", [segment("base", "laser", 1)], { modeId: "charge_0_1" }),
      mode(3, "laser", [segment("base", "laser", 7)], {
        modeId: "charge_2",
        targetRule: { min: 1, max: 2, distinct: true },
        targetResolution: "counterclockwiseSerial"
      })
    ],
    charge: chargeState(2, [
      { progress: 0, attackModeId: "charge_0_1", attackAllowed: true },
      { progress: 1, attackModeId: "charge_0_1", attackAllowed: true },
      { progress: 2, attackModeId: "charge_2", attackAllowed: true }
    ])
  },
  "weapon.w07": {
    attackModes: [mode(2, "ranged", [segment("base", "ranged", 2)])],
    onAttackMiss: [{
      op: "selectTargets",
      params: {
        min: 0,
        max: 1,
        distinct: true,
        timeoutPolicy: "pass",
        filter: {
          inPlay: true,
          excludeRefs: ["$attackTarget"],
          withinRangeOfAttacker: 2,
          withinDistanceOfOriginalTarget: 1
        },
        onlyIfAttackLacksTag: "particleEagleFollowUp",
        resultVar: "$followUpTargets"
      }
    }, {
      op: "if",
      params: { condition: { exists: "$followUpTargets[0]" } },
      then: [{
        op: "createAttack",
        target: "$followUpTargets[0]",
        params: {
          weaponId: "weapon.w07",
          costs: { killCards: 0, attackCount: 0 },
          tags: ["particleEagleFollowUp"],
          suppressEffects: ["particleEagleFollowUp"]
        }
      }]
    }],
    followUpPolicy: {
      maximumPerRootAttack: 1,
      sourceAttackMustMiss: true,
      followUpCannotChain: true,
      sourceDeathPolicy: "cancelOptionalSelection"
    }
  },
  "weapon.w08": {
    attackModes: [mode(2, "ranged", [segment("base", "ranged", 2)])],
    judgments: [judgment("on_hit", "attack.hit.beforeDamage", {
      green: { matched: true, effects: [additionalDamage("poison_additional", "ranged", 1, 2, "poison")] },
      default: { matched: false, effects: [] }
    })]
  },
  "weapon.w10": {
    attackModes: [
      mode(0, "ranged", [segment("base", "ranged", 1, { repeat: 4 })], { modeId: "range_0" }),
      mode(1, "ranged", [segment("base", "ranged", 1, { repeat: 3 })], { modeId: "range_1" }),
      mode(2, "ranged", [segment("base", "ranged", 1)], { modeId: "range_2" })
    ],
    rangeTiers: automaticRangeTiers([
      { modeId: "range_0", range: 0 },
      { modeId: "range_1", range: 1 },
      { modeId: "range_2", range: 2 }
    ]),
    damageDimensions: [scatterDimension({
      byModeId: { range_0: 4, range_1: 3, range_2: 1 }
    })]
  },
  "weapon.w11": {
    attackModes: [
      mode(2, "ranged", [segment("base", "ranged", 2)], { modeId: "charge_0" }),
      mode(3, "ranged", [segment("base", "ranged", 4)], { modeId: "charge_1" })
    ],
    charge: chargeState(1, [
      { progress: 0, attackModeId: "charge_0", attackAllowed: true },
      { progress: 1, attackModeId: "charge_1", attackAllowed: true }
    ])
  },
  "weapon.w12": {
    attackModes: [
      mode(2, "laser", [segment("base", "laser", 2)], { modeId: "charge_0" })
    ],
    resolutionModes: [
      displayDamageResolution("charge_1_display", 5, ["blue", "red"]),
      displayDamageResolution("charge_2_display", 7, ["blue", "orange", "red"])
    ],
    charge: chargeState(2, [
      { progress: 0, attackModeId: "charge_0", attackAllowed: true },
      { progress: 1, resolutionModeId: "charge_1_display", attackAllowed: false, resolutionAllowed: true },
      { progress: 2, resolutionModeId: "charge_2_display", attackAllowed: false, resolutionAllowed: true }
    ])
  },
  "weapon.w15": {
    attackModes: [
      mode(2, "ranged", [segment("base", "ranged", 3)], { modeId: "standard" }),
      mode(2, "ranged", [segment("base", "ranged", 2)], {
        modeId: "no_kill",
        costs: { killCards: 0, attackCount: 1 }
      })
    ],
    modeSelection: manualModeSelection(["standard", "no_kill"], "standard")
  },
  "weapon.w16": {
    attackModes: [mode(4, "ranged", [segment("base", "ranged", 2)])],
    judgments: [judgment("after_targeting", "attack.targeted.beforeResponse", {
      blue: { matched: true, attackPatch: { replaceBaseAmount: 4, addTags: ["ignoreArmor"] }, effects: [] },
      default: { matched: false, effects: [] }
    })]
  },
  "weapon.w17": {
    attackModes: [
      mode(0, "ranged", [segment("base", "ranged", 2, { repeat: 2 })], { modeId: "range_0" }),
      mode(2, "ranged", [segment("base", "ranged", 1, { repeat: 2 })], { modeId: "range_2" })
    ],
    rangeTiers: automaticRangeTiers([
      { modeId: "range_0", range: 0 },
      { modeId: "range_2", range: 2 }
    ]),
    damageDimensions: [scatterDimension(2)]
  },
  "weapon.w18": {
    attackModes: [
      mode(3, "ranged", [segment("base", "ranged", 1)], { modeId: "charge_0" }),
      mode(3, "ranged", [segment("base", "ranged", 3)], { modeId: "charge_1" }),
      mode(3, "ranged", [segment("base", "ranged", 3, { repeat: 2 })], {
        modeId: "charge_2",
        responseGrouping: "singleWindowForWholeAttack"
      })
    ],
    damageDimensions: [scatterDimension(2)],
    charge: chargeState(2, [
      { progress: 0, attackModeId: "charge_0", attackAllowed: true },
      { progress: 1, attackModeId: "charge_1", attackAllowed: true },
      { progress: 2, attackModeId: "charge_2", attackAllowed: true }
    ]),
    onAttackCommit: [{
      op: "if",
      params: { condition: { eq: ["$attack.modeId", "charge_2"] } },
      then: [{
        op: "scheduleEffect",
        params: {
          scheduleId: "heavenly_fist_repeat",
          activationPoint: "owner.nextPhase.prepare.start",
          sourceLeavePolicy: "continueFromSnapshot",
          sourceEliminatedPolicy: "continueFromSnapshot",
          snapshot: {
            attackModeId: "charge_2",
            attackerRef: "$attack.attacker",
            targetRef: "$attackTarget",
            noCosts: true,
            suppressScheduleIds: ["heavenly_fist_repeat"]
          },
          revalidate: {
            targetNotEliminated: true,
            targetNotLeftPlay: true,
            targetAlive: true,
            withinSnapshotRange: true
          },
          onInvalid: "cancel"
        },
        effects: [{
          op: "createAttack",
          target: "$scheduled.targetRef",
          params: {
            fromSnapshot: "$scheduled.snapshot",
            costs: { killCards: 0, attackCount: 0 },
            suppressScheduleIds: ["heavenly_fist_repeat"]
          }
        }]
      }]
    }]
  },
  "weapon.w20": {
    attackModes: [mode(1, "melee", [segment("base", "melee", 2)])],
    judgments: [judgment("on_hit", "attack.hit.beforeDamage", {
      blue: { matched: true, effects: [additionalDamage("field_additional", "field", 1, 2)] },
      default: { matched: false, effects: [] }
    })],
    modifiers: [{ sourceTag: "talent.scatterIncrease", targetSegmentId: "field_additional", modifyRepeat: 1 }]
  },
  "weapon.w21": {
    attackModes: [
      mode(1, "melee", [segment("base", "melee", 3)], { modeId: "melee_close" }),
      mode(2, "ranged", [segment("base", "ranged", 3)], { modeId: "ranged_far" })
    ],
    rangeTiers: automaticRangeTiers([
      { modeId: "melee_close", range: 1 },
      { modeId: "ranged_far", range: 2 }
    ])
  },
  "weapon.w23": {
    attackModes: [
      mode(0, "ranged", [segment("base", "ranged", 1, { repeat: 3 })], { modeId: "range_0" }),
      mode(1, "ranged", [segment("base", "ranged", 1, { repeat: 2 })], { modeId: "range_1" }),
      mode(2, "ranged", [segment("base", "ranged", 1)], { modeId: "range_2" })
    ],
    rangeTiers: automaticRangeTiers([
      { modeId: "range_0", range: 0 },
      { modeId: "range_1", range: 1 },
      { modeId: "range_2", range: 2 }
    ]),
    damageDimensions: [scatterDimension({
      byModeId: { range_0: 3, range_1: 2, range_2: 1 }
    })]
  },
  "weapon.w24": {
    attackModes: [
      mode(0, "ranged", [segment("base", "ranged", 2, { repeat: 3 })], { modeId: "range_0" }),
      mode(1, "ranged", [segment("base", "ranged", 2, { repeat: 2 })], { modeId: "range_1" }),
      mode(2, "ranged", [segment("base", "ranged", 2)], { modeId: "range_2" })
    ],
    rangeTiers: automaticRangeTiers([
      { modeId: "range_0", range: 0 },
      { modeId: "range_1", range: 1 },
      { modeId: "range_2", range: 2 }
    ]),
    damageDimensions: [scatterDimension({
      byModeId: { range_0: 3, range_1: 2, range_2: 1 }
    })]
  },
  "weapon.w25": {
    attackModes: [mode(1, "melee", [segment("base", "melee", 3)])],
    judgments: [judgment("on_hit", "attack.hit.beforeDamage", {
      white: { matched: true, effects: [applyControl("status.electrified")] },
      default: { matched: false, effects: [] }
    })]
  },
  "weapon.w26": {
    attackModes: [mode(1, "melee", [
      segment("melee_base", "melee", 3),
      segment("field_base", "field", 1, { repeat: 2 })
    ], { responseGrouping: "singleWindowForWholeAttack" })],
    judgments: [judgment("on_hit", "attack.hit.beforeDamage", {
      red: { matched: true, effects: [additionalDamage("fire_additional", "field", 1, 2, "fire")] },
      default: { matched: false, effects: [] }
    })]
  },
  "weapon.w27": {
    attackModes: [mode(3, "ranged", [segment("base", "ranged", 3)])],
    judgments: [judgment("on_hit", "attack.hit.beforeDamage", {
      white: { matched: true, effects: [applyControl("status.frozen")] },
      blue: { matched: true, effects: [applyControl("status.frozen")] },
      default: { matched: false, effects: [] }
    })]
  },
  "weapon.w28": {
    attackModes: [mode(3, "ranged", [segment("base", "ranged", 3)])],
    judgments: [judgment("on_hit", "attack.hit.beforeDamage", {
      white: { matched: true, effects: [additionalDamage("fire_additional", "ranged", 1, 2, "fire")] },
      blue: { matched: true, effects: [additionalDamage("fire_additional", "ranged", 1, 2, "fire")] },
      default: { matched: false, effects: [] }
    })]
  },
  "weapon.w29": {
    attackModes: [mode(4, "ranged", [segment("base", "ranged", 4)], {
      attackTags: ["ignoreArmor", "cannotMeleeBlock"]
    })],
    judgments: [judgment("on_hit", "attack.hit.beforeDamage", {
      white: { matched: true, attackPatch: { replaceBaseAmount: 6 }, effects: [] },
      blue: { matched: true, attackPatch: { replaceBaseAmount: 6 }, effects: [] },
      default: { matched: false, effects: [] }
    })]
  },
  "weapon.w30": {
    attackModes: [
      mode(1, "field", [segment("base", "field", 99)], { modeId: "charge_3" })
    ],
    charge: chargeState(3, [
      { progress: 0, attackAllowed: false },
      { progress: 1, attackAllowed: false },
      { progress: 2, attackAllowed: false },
      { progress: 3, attackModeId: "charge_3", attackAllowed: true }
    ]),
    onAttackCommit: [{
      op: "transformCard",
      target: "$weaponInstance",
      params: {
        toTemplateId: "weapon.w39",
        sameInstance: true,
        triggerOnlyForModeId: "charge_3"
      }
    }]
  },
  "weapon.w31": {
    attackModes: [mode(4, "ranged", [segment("base", "ranged", 4)])],
    judgments: [judgment("after_targeting", "attack.targeted.beforeResponse", {
      orange: { matched: true, attackPatch: { replaceBaseAmount: 5, addTags: ["ignoreArmor"] }, effects: [] },
      red: { matched: true, attackPatch: { replaceBaseAmount: 5, addTags: ["ignoreArmor"] }, effects: [] },
      default: { matched: false, effects: [] }
    })]
  },
  "weapon.w33": {
    attackModes: [mode(4, "field", [])],
    judgments: [judgment("critical_result", "attack.targeted.beforeResponse", {
      white: { matched: true, replacementSegments: [segment("white", "field", 6)] },
      green: { matched: true, replacementSegments: [segment("green", "field", 3, { repeat: 2, element: "poison" })] },
      blue: { matched: true, replacementSegments: [segment("blue", "field", 4)], effects: [applyControl("status.frozen")] },
      orange: { matched: true, replacementSegments: [segment("orange", "field", 4)], effects: [applyControl("status.electrified")] },
      red: { matched: true, replacementSegments: [segment("red", "field", 3, { repeat: 2, element: "fire" })] }
    })]
  },
  "weapon.w37": {
    attackModes: [
      mode(2, "melee", [
        segment("melee_group", "melee", 2, { repeat: 3 }),
        segment("ranged_group", "ranged", 2, { repeat: 3 })
      ], {
        modeId: "range_2_composite",
        attackTypes: ["melee", "ranged"],
        responseGrouping: "singleWindowForWholeAttack"
      }),
      mode(3, "ranged", [
        segment("ranged_group", "ranged", 2, { repeat: 3 })
      ], { modeId: "range_3_ranged" })
    ],
    rangeTiers: automaticRangeTiers([
      { modeId: "range_2_composite", range: 2 },
      { modeId: "range_3_ranged", range: 3 }
    ]),
    damageDimensions: [scatterDimension(3, ["melee_group", "ranged_group"])]
  },
  "weapon.w38": {
    attackModes: [
      mode(1, "melee", [segment("base", "melee", 3)], { modeId: "charge_0" }),
      mode(3, "laser", [segment("base", "laser", 6)], {
        modeId: "charge_1",
        attackTags: ["ignoreArmor"]
      })
    ],
    charge: chargeState(1, [
      { progress: 0, attackModeId: "charge_0", attackAllowed: true },
      { progress: 1, attackModeId: "charge_1", attackAllowed: true }
    ])
  },
  "weapon.w39": {
    attackModes: [
      mode(1, "melee", [segment("base", "melee", 3)], { modeId: "charge_1" })
    ],
    charge: chargeState(1, [
      { progress: 0, attackAllowed: false },
      { progress: 1, attackModeId: "charge_1", attackAllowed: true }
    ]),
    transformedInstance: {
      baseTemplateId: "weapon.w30",
      restoreOnLeaveEquipment: true,
      sameInstance: true
    }
  },
  "weapon.w43": {
    attackModes: [],
    activatedAbilities: [{
      abilityId: "weapon.w43.rescue",
      activationWindow: "owner.dying.rescue",
      requires: {
        equipped: true,
        equipmentEffective: true,
        ownerIsCurrentDyingCharacter: true,
        preselectionRequired: false
      },
      optional: true,
      timeoutPolicy: "pass",
      costs: {},
      effects: [{
        op: "recoverHp",
        target: "$owner",
        params: { amount: { subtract: ["$owner.maxHp", "$owner.hp"] } }
      }, {
        op: "loseCard",
        target: "$weaponInstance",
        params: { to: "discardPile", moveKind: "lose" }
      }]
    }],
    cannotAttack: true
  },
  "weapon.w44": {
    attackModes: [mode(2, "ranged", [segment("base", "ranged", 2)])],
    judgments: [judgment("on_hit", "attack.hit.beforeDamage", {
      green: { matched: true, effects: [applyControl("status.frozen")] },
      default: { matched: false, effects: [] }
    })]
  },
  "weapon.w48": {
    attackModes: [mode(3, "ranged", [
      segment("base", "ranged", 1, { repeat: 6 })
    ], {
      responseGrouping: "singleWindowForWholeAttack",
      repeatFormula: {
        multiply: [
          { dimension: "scatter" },
          { dimension: "combo" }
        ]
      }
    })],
    damageDimensions: [
      scatterDimension(3),
      comboDimension(2)
    ]
  },
  "weapon.w49": {
    attackModes: [mode(2, "ranged", [segment("base", "ranged", 1, { repeat: 2 })])],
    judgments: [judgment("on_hit", "attack.hit.beforeDamage", {
      orange: { matched: true, effects: [additionalDamage("fire_additional", "ranged", 1, 2, "fire")] },
      green: { matched: true, effects: [applyControl("status.frozen")] },
      default: { matched: false, effects: [] }
    })]
  },
  "weapon.w50": {
    attackModes: [
      mode(3, "ranged", [segment("base", "ranged", 2)], { modeId: "mode_1_fire" }),
      mode(3, "ranged", [segment("base", "ranged", 2)], { modeId: "mode_1_ice" }),
      mode(2, "ranged", [segment("base", "ranged", 1, { repeat: 2 })], { modeId: "mode_2" })
    ],
    modeSelection: {
      ...manualModeSelection(["mode_1", "mode_2"], "mode_1"),
      resolution: {
        mode_1: {
          byInstanceState: {
            stateId: "elementForm",
            fire: "mode_1_fire",
            ice: "mode_1_ice"
          }
        },
        mode_2: { attackModeId: "mode_2" }
      }
    },
    instanceState: {
      stateId: "elementForm",
      visibility: "public",
      initial: "fire",
      values: ["fire", "ice"],
      playerSelectable: false
    },
    judgments: [
      judgment("mode_1_fire_on_hit", "attack.hit.beforeDamage", {
        blue: { matched: true, effects: [additionalDamage("fire_additional", "ranged", 2, 1, "fire")] },
        orange: { matched: true, effects: [additionalDamage("fire_additional", "ranged", 2, 1, "fire")] },
        default: { matched: false, effects: [] }
      }, { modeFilter: ["mode_1_fire"] }),
      judgment("mode_1_ice_on_hit", "attack.hit.beforeDamage", {
        blue: { matched: true, effects: [applyControl("status.frozen")] },
        orange: { matched: true, effects: [applyControl("status.frozen")] },
        default: { matched: false, effects: [] }
      }, { modeFilter: ["mode_1_ice"] }),
      judgment("mode_2_on_hit", "attack.hit.beforeDamage", {
        blue: { matched: true, effects: [applyControl("status.frozen")] },
        orange: { matched: true, effects: [additionalDamage("fire_additional", "ranged", 2, 1, "fire")] },
        default: { matched: false, effects: [] }
      }, { modeFilter: ["mode_2"] })
    ],
    onAttackCommit: [{
      op: "setValue",
      target: "$weaponInstance",
      params: {
        path: "state.elementForm",
        whenModeIn: ["mode_1_fire", "mode_1_ice"],
        toggle: { fire: "ice", ice: "fire" }
      }
    }]
  },
  "weapon.w51": {
    attackModes: [
      mode(1, "field", [segment("base", "field", 1, { repeat: 2, element: "fire" })], {
        modeId: "field_fire"
      }),
      mode(3, "laser", [segment("base", "laser", 3)], { modeId: "laser" })
    ],
    modeSelection: manualModeSelection(["field_fire", "laser"], "field_fire"),
    judgments: [judgment("laser_on_hit", "attack.hit.beforeDamage", {
      red: { matched: true, effects: [additionalDamage("fire_additional", "laser", 1, 2, "fire")] },
      orange: { matched: true, effects: [additionalDamage("fire_additional", "laser", 1, 2, "fire")] },
      default: { matched: false, effects: [] }
    }, { modeFilter: ["laser"] })]
  },
  "weapon.w52": {
    attackModes: [
      mode(1, "ranged", [segment("base", "ranged", 1, { repeat: 3 })], { modeId: "range_1" }),
      mode(2, "ranged", [segment("base", "ranged", 1, { repeat: 2 })], { modeId: "range_2" })
    ],
    rangeTiers: automaticRangeTiers([
      { modeId: "range_1", range: 1 },
      { modeId: "range_2", range: 2 }
    ]),
    damageDimensions: [scatterDimension({
      byModeId: { range_1: 3, range_2: 2 }
    })],
    judgments: [judgment("after_all_base_segments", "attack.baseDamageSegments.after", {
      green: { matched: true, effects: [additionalDamage("poison_additional", "ranged", 1, 2, "poison")] },
      default: { matched: false, effects: [] }
    }, { oncePer: "attackTarget", requiresAtLeastOneBaseSegmentHit: true })]
  },
  "weapon.w54": {
    attackModes: [
      mode(1, "ranged", [segment("base", "ranged", 1)], { modeId: "standard" }),
      mode(4, "field", [segment("base", "field", 3)], {
        modeId: "coin",
        costs: {
          killCards: 0,
          attackCount: 0,
          cards: [{
            count: 1,
            consumeAs: "use",
            acceptsTemplateIds: ["basic.coin.white", "basic.coin.red"],
            acceptsTemporaryResourceTag: "temporary.coin"
          }]
        }
      })
    ],
    modeSelection: manualModeSelection(["standard", "coin"], "standard"),
    judgments: [judgment("coin_mode", "attack.hit.beforeDamage", {
      green: { matched: true, effects: [additionalDamage("coin_additional", "field", 2, 1)] },
      blue: { matched: true, effects: [additionalDamage("coin_additional", "field", 2, 1)] },
      orange: { matched: true, effects: [additionalDamage("coin_additional", "field", 2, 1)] },
      red: { matched: true, effects: [additionalDamage("coin_additional", "field", 2, 1)] },
      default: { matched: false, effects: [] }
    }, { modeFilter: ["coin"] })]
  },
  "weapon.w55": {
    attackModes: [mode(2, "ranged", [segment("base", "ranged", 1, { repeat: 2 })])],
    judgments: [judgment("per_base_segment", "damage.applied.after", {
      green: { matched: true, effects: [additionalDamage("poison_additional", "ranged", 1, 2, "poison")] },
      blue: { matched: true, effects: [applyControl("status.frozen")] },
      orange: { matched: true, effects: [additionalDamage("fire_additional", "ranged", 1, 2, "fire")] },
      default: { matched: false, effects: [] }
    }, { oncePer: "baseDamageSegment", excludeAdditionalSegments: true })]
  },
  "weapon.w56": {
    attackModes: [],
    damageDimensions: [scatterDimension(2, ["projectile"])],
    specialActions: [{
      actionId: "anubis_projectile_batch",
      phase: "owner.play",
      requires: { preselectedWeapon: true, equipmentEffective: true },
      costs: { killCards: 1, attackCount: 1 },
      projectileCount: {
        dimensionId: "scatter",
        base: 2,
        modifierSourceTag: "talent.scatterIncrease",
        modifier: { add: 1 }
      },
      projectileAttack: {
        range: 4,
        attackType: "ranged",
        damageSegment: segment("projectile", "ranged", 0),
        eachProjectileSelectsTarget: true,
        targetMayRepeat: true,
        eachProjectileHasIndependentResponseWindow: true,
        costsPerProjectile: { killCards: 0, attackCount: 0 },
        recordHitCountByTarget: "$projectileHitCounts"
      },
      afterAllProjectiles: [{
        op: "forEach",
        params: { items: "$projectileHitCounts", mode: "counterclockwiseSerial" },
        effects: [{
          op: "switch",
          params: { expression: "$item.hitCount" },
          cases: {
            "3": { effects: [anubisCurseEffect()] },
            "2": {
              effects: [{
                op: "judgeColor",
                target: "$item.target",
                params: {
                  purpose: "weaponEffect",
                  matchedColors: ["white", "green", "orange", "red"],
                  onMatched: [anubisCurseEffect()]
                }
              }]
            },
            "1": {
              effects: [{
                op: "judgeColor",
                target: "$item.target",
                params: {
                  purpose: "weaponEffect",
                  matchedColors: ["orange", "red"],
                  onMatched: [anubisCurseEffect()]
                }
              }]
            }
          }
        }],
        maxIterations: 4
      }]
    }],
    curseDefinition: {
      statusId: "status.anubisCurse",
      immediate: true,
      stackPolicy: "uniqueRefresh",
      expiryPoint: "target.nextPhase.prepare.before",
      temporaryWeaponTemplateId: "weapon.w32",
      temporaryWeaponExitZone: "outsideDeck"
    }
  },
  "weapon.w57": {
    attackModes: [
      mode(3, "melee", [segment("base", "melee", 4)], {
        modeId: "hp_at_least_2",
        costs: {
          killCards: 0,
          attackCount: 1,
          hpModification: {
            amount: -1,
            damage: false,
            recovery: false,
            payAt: "attack.costs.paid"
          }
        }
      }),
      mode(2, "melee", [segment("base", "melee", 3)], { modeId: "hp_equals_1" })
    ],
    automaticMode: {
      selectableByPlayer: false,
      evaluateAt: "attack.weapon.resolve",
      branches: [
        { condition: { gte: ["$attacker.hp", 2] }, attackModeId: "hp_at_least_2" },
        { condition: { eq: ["$attacker.hp", 1] }, attackModeId: "hp_equals_1" }
      ]
    }
  },
  "weapon.w58": {
    attackModes: [],
    activatedAbilities: [{
      abilityId: "weapon.w58.meteor",
      activationWindow: "owner.phase.play",
      requires: {
        equipped: true,
        equipmentEffective: true,
        preselectionRequired: false,
        cooldownReady: true
      },
      costs: { killCards: 1, attackCount: 1 },
      targetSelector: {
        inPlay: true,
        includeSelf: true,
        order: "counterclockwiseFromUser"
      },
      effects: [{
        op: "forEach",
        params: {
          items: { selector: "characters.inPlay.counterclockwiseFromSource" },
          mode: "serial"
        },
        effects: [{
          op: "createAttack",
          target: "$item",
          params: {
            attackType: "field",
            rangeCheck: false,
            responsePolicy: "fieldDefault",
            costs: { killCards: 0, attackCount: 0 },
            damageSegments: [segment("meteor", "field", 3)]
          }
        }, {
          op: "checkDying",
          target: "$item",
          params: { mode: "completeNestedFirst" }
        }],
        maxIterations: 4
      }, {
        op: "startCooldown",
        target: "$weaponInstance",
        params: {
          cooldownId: "weapon.w58.cooldown",
          printedCd: 2,
          readyAfterOwnerRoundCount: 3,
          tickAt: "owner.phase.prepare.start"
        }
      }]
    }],
    cooldown: {
      cooldownId: "weapon.w58.cooldown",
      printedCd: 2,
      readyAfterOwnerRoundCount: 3,
      visibility: "public"
    }
  },
  "weapon.w59": {
    attackModes: [mode(1, "melee", [segment("base", "melee", 3)])],
    judgments: [judgment("on_hit", "attack.hit.beforeDamage", {
      red: { matched: true, effects: [additionalDamage("coffin", "field", 2, 1, "fire")] },
      orange: { matched: true, effects: [additionalDamage("coffin", "field", 2, 1, "fire")] },
      default: { matched: false, effects: [] }
    })]
  },
  "weapon.w60": {
    attackModes: [mode(1, "melee", [segment("base", "melee", 3)])],
    judgments: [
      judgment("on_hit", "attack.hit.beforeDamage", {
        white: { matched: true, effects: [additionalDamage("coffin_hit", "field", 1, 1)] },
        default: { matched: false, effects: [] }
      }),
      judgment("on_miss", "attack.miss", {
        red: { matched: true, effects: [additionalDamage("coffin_miss", "field", 2, 1, "none", false)] },
        white: { matched: true, effects: [additionalDamage("coffin_miss", "field", 2, 1, "none", false)] },
        default: { matched: false, effects: [] }
      }, { purpose: "weaponEffect", effectsRequireAttackHit: false })
    ]
  },
  "weapon.w61": {
    attackModes: [mode(2, "ranged", [segment("base", "ranged", 1, { repeat: 2 })], {
      repeatFromState: "durability.current"
    })],
    durability: {
      stateId: "durability",
      visibility: "public",
      baseMax: 2,
      initialCurrent: 2,
      damageRepeatEqualsCurrent: true,
      modifier: {
        sourceTag: "talent.scatterIncrease",
        onGain: { max: 1, current: 1 },
        onLose: { max: -1, clampCurrentToMax: true }
      },
      preserveWhenEquipmentDisabled: true,
      onZero: {
        op: "loseCard",
        target: "$weaponInstance",
        params: { destinationByInstanceOrigin: true }
      }
    },
    onAttackHitBeforeDamage: [{
      op: "requestChoice",
      params: {
        choiceId: "wrench_damage_or_dismantle",
        options: ["dealDamage", "replaceWithDismantle"],
        optionalOption: "replaceWithDismantle",
        timeoutPolicy: "useDefault",
        defaultOption: "dealDamage"
      }
    }, {
      op: "if",
      params: { condition: { eq: ["$choice", "replaceWithDismantle"] } },
      then: [{
        op: "preventDamage",
        params: { attack: "$attack", allSegments: true, result: "hitWithZeroDamage" }
      }, {
        op: "selectCards",
        target: "$attackTarget",
        params: {
          count: 1,
          zones: "any",
          filter: { dismantlable: true },
          publicCardsFaceUp: true,
          handCards: {
            shuffleServerSide: true,
            showUniformBacksOnly: true,
            doNotRevealUnchosen: true
          },
          timeoutPolicy: "randomLegal"
        }
      }, {
        op: "dismantleCard",
        target: "$selectedCards[0]"
      }, {
        op: "modifyValue",
        target: "$weaponInstance",
        params: { path: "durability.current", add: -1, min: 0 }
      }]
    }]
  },
  "weapon.w62": {
    attackModes: [
      mode(2, "ranged", [segment("base", "ranged", 2)], {
        costs: {
          killCards: 1,
          attackCount: {
            expression: { eq: ["$weapon.turnAttemptCountBeforeIncrement", 0] },
            trueValue: 1,
            falseValue: 0
          }
        }
      })
    ],
    turnAttemptCounter: {
      counterId: "turnAttemptCount",
      scope: "ownerTurn",
      visibility: "public",
      incrementAt: "attack.costs.paid",
      incrementEvenIfLaterKillInvalidated: true,
      resetAt: "owner.turn.start"
    }
  },
  "weapon.w63": {
    attackModes: [
      mode(1, "melee", [segment("base", "melee", 2)], {
        costs: {
          killCards: 1,
          attackCount: {
            expression: { eq: ["$weapon.turnAttemptCountBeforeIncrement", 0] },
            trueValue: 1,
            falseValue: 0
          }
        }
      })
    ],
    turnAttemptCounter: {
      counterId: "turnAttemptCount",
      scope: "ownerTurn",
      visibility: "public",
      incrementAt: "attack.costs.paid",
      incrementEvenIfLaterKillInvalidated: true,
      resetAt: "owner.turn.start"
    }
  },
  "weapon.w64": {
    attackModes: [mode(3, "laser", [segment("base", "laser", 2)], {
      modeId: "locked_attack",
      costs: { killCards: 0, attackCount: 1 }
    })],
    judgments: [judgment("locked_attack_on_hit", "attack.hit.beforeDamage", {
      white: { matched: true, effects: [applyControl("status.frozen")] },
      blue: { matched: true, effects: [applyControl("status.frozen")] },
      default: { matched: false, effects: [] }
    }, { modeFilter: ["locked_attack"] })],
    aimingState: {
      stateId: "aimTarget",
      visibility: "public",
      initial: null,
      clearWhenTarget: ["eliminated", "leftPlay"],
      retainWhenTargetOutOfRange: true
    },
    specialActions: [{
      actionId: "laserFishAim",
      phase: "owner.play",
      requires: { aimTargetAbsent: true, preselectedWeapon: true },
      targetRule: { min: 1, max: 1, distinct: true, range: 3 },
      costs: { killCards: 1, attackCount: 1 },
      createsAttack: false,
      effects: [{
        op: "setValue",
        target: "$weaponInstance",
        params: { path: "state.aimTarget", value: "$selectedTargets[0]" }
      }, {
        op: "emitEvent",
        params: { eventType: "limit.changed", subject: "$owner.attackCount" }
      }]
    }, {
      actionId: "laserFishCancelAim",
      phase: "owner.play",
      requires: { aimTargetPresent: true },
      targetRule: { min: 0, max: 0 },
      costs: { killCards: 1, attackCount: 0 },
      effects: [{
        op: "setValue",
        target: "$weaponInstance",
        params: { path: "state.aimTarget", value: null }
      }]
    }],
    lockedTriggers: [{
      listen: ["phase.start", "limit.changed"],
      filter: {
        ownerPlayPhase: true,
        aimTargetPresent: true,
        positiveAttackCount: true
      },
      mandatory: true,
      effects: [{
        op: "repeat",
        params: { count: "$owner.attackCountAtTrigger" },
        effects: [{
          op: "modifyAttackCount",
          target: "$owner",
          params: { add: -1 }
        }, {
          op: "if",
          params: {
            condition: {
              and: [
                { exists: "$weapon.state.aimTarget" },
                { lte: ["$distanceToAimTarget", 3] }
              ]
            }
          },
          then: [{
            op: "createAttack",
            target: "$weapon.state.aimTarget",
            params: {
              modeId: "locked_attack",
              costs: { killCards: 0, attackCount: 0 }
            }
          }]
        }],
        maxIterations: 32
      }],
      reentrancyGuard: "laserFishConsumeLoop"
    }]
  },
  "weapon.w65": {
    attackModes: [mode(1, "melee", [segment("base", "melee", 3)])],
    judgments: [judgment("on_hit", "attack.hit.beforeDamage", {
      green: { matched: true, effects: [applyControl("status.frozen")] },
      default: { matched: false, effects: [] }
    })]
  },
  "weapon.w66": {
    attackModes: [mode(9, "field", [segment("base", "field", 0)], {
      targetRule: { min: 1, max: 1, distinct: true, includeSelf: true }
    })],
    onAttackHitAfterDamage: [{
      op: "createCard",
      target: "$attackTarget",
      params: {
        objectKind: "temporaryResource",
        templateSemantic: "coin",
        tags: ["temporary.coin"],
        entersZone: null,
        resultVar: "$temporaryCoin"
      }
    }, {
      op: "requestChoice",
      target: "$attackTarget",
      params: {
        choiceId: "temporary_coin_immediate_use",
        optionsSelector: "legalUses.acceptingTemporaryCoin",
        allowPass: true,
        timeoutPolicy: "pass",
        ifNoLegalOptions: "pass"
      },
      effects: [{
        op: "useCard",
        target: "$temporaryCoin",
        params: {
          selectedUse: "$choice",
          automatic: true,
          controller: "$attackTarget"
        }
      }]
    }, {
      op: "removeCard",
      target: "$temporaryCoin",
      params: {
        when: { not: { eq: ["$temporaryCoin.status", "consumed"] } },
        destination: "outsideDeck"
      }
    }],
    temporaryResourcePolicy: {
      doesNotEnterHand: true,
      immediateUseOnly: true,
      controllerIsTarget: true,
      passOrTimeoutRemoves: true
    }
  }
};
const parseSimpleMode = (canonicalRule, weaponTypes) => {
  const match = canonicalRule.match(/(\d+):(场地|激光|近战|远程)?(\d+)(?:×(\d+))?/);
  if (!match) return [];
  const explicitType = match[2] ? typeMap[match[2]] : null;
  const attackType = explicitType ??
    weaponTypes.find((type) => ["melee", "ranged", "laser", "field"].includes(type));
  if (!attackType) return [];
  return [{
    modeId: "default",
    costs: { killCards: 1, attackCount: 1 },
    targetRule: { min: 1, max: 1, distinct: true },
    range: Number(match[1]),
    attackTypes: [attackType],
    responsePolicy: attackType === "field" ? "fieldDefault" :
      attackType === "laser" ? "laserDefault" : "standardAttack",
    damageSegments: [{
      segmentId: "base",
      deliveryType: "attack",
      attackType,
      damageType: "normal",
      element: "none",
      amount: Number(match[3]),
      repeat: Number(match[4] ?? 1),
      isAdditional: false,
      overflowPolicy: "normal"
    }]
  }];
};

const templates = weaponRows.map((row) => {
  const weaponId = `weapon.${row[0].toLowerCase().replace("-", "")}`;
  const card = cardFacts.find((item) => item.cardId === weaponId);
  if (!card) throw new Error(`missing card fact ${weaponId}`);
  const weaponTypes = row[4].split("/").map((item) => typeMap[item] ?? item);
  const canonicalRule = normalizeRule(row[5]);
  const isComplex = complexPattern.test(canonicalRule);
  const complexEncoding = complexEncodings[weaponId];
  const attackModes = complexEncoding?.attackModes ??
    (isComplex ? [] : parseSimpleMode(canonicalRule, weaponTypes));
  return {
    weaponId,
    legacyId: row[0],
    displayName: row[1],
    color: colorMap[row[2]],
    initialDeckCount: Number(row[3]),
    weaponTypes,
    slotType: row[4].includes("第三武器") ? "thirdWeapon" : "regularWeapon",
    canonicalRule,
    attackModes,
    ...(complexEncoding ? Object.fromEntries(Object.entries(complexEncoding)
      .filter(([key]) => key !== "attackModes")) : {}),
    instanceOriginPolicy: synthesizedIds.has(weaponId) ? "synthesizedOutsideDeck" :
      transformIds.has(weaponId) ? "transformedSameInstance" : "initialOrCopied",
    effectEncodingStatus: complexEncoding ?
      (complexEncoding.followUpPolicy || complexEncoding.activatedAbilities ||
        complexEncoding.curseDefinition || complexEncoding.durability ||
        complexEncoding.aimingState || complexEncoding.temporaryResourcePolicy ?
        "special_instances_encoded" :
        complexEncoding.modeSelection || complexEncoding.automaticMode ||
        complexEncoding.turnAttemptCounter ? "modes_costs_encoded" :
        complexEncoding.charge ? "charge_delay_encoded" :
        complexEncoding.rangeTiers || complexEncoding.damageDimensions ?
          "range_dimensions_encoded" : "judgment_effects_encoded") :
      isComplex ? "complex_pending_dsl" :
      attackModes.length === 1 ? "base_attack_encoded" : "simple_parse_failed",
    resourceKey: card.resourceKey,
    ruleSource: "docs/整理/18-v1.3.4武器规则正文.md",
    rulesetVersion: version
  };
});

const testRows = rows(testDoc).filter((row) => /^W\d{3}$/.test(row[0]));
const allWeaponsEncoded = templates.every((item) =>
  item.effectEncodingStatus !== "complex_pending_dsl" &&
  item.effectEncodingStatus !== "simple_parse_failed");
const rules = testRows.map((row) => ({
  ruleId: `weapon.acceptance.${row[0].toLowerCase()}`,
  testIds: [row[0]],
  relatedWeaponIds: related[row[0]] ??
    (["W001","W002","W003","W004","W005","W006","W007","W008","W009","W051","W053"].includes(row[0])
      ? ["*"] : []),
  scenario: row[1],
  assertion: row[2],
  encodingStatus: allWeaponsEncoded ? "effect_dsl_encoded" : "traceable_pending_effect_dsl"
}));

const expectedIds = Array.from({ length: 66 }, (_, index) =>
  `weapon.w${String(index + 1).padStart(2, "0")}`);
if (templates.length !== 66 || new Set(templates.map((item) => item.weaponId)).size !== 66) {
  throw new Error("weapon template count/uniqueness");
}
for (const id of expectedIds) if (!templates.some((item) => item.weaponId === id)) {
  throw new Error(`missing ${id}`);
}
if (templates.reduce((sum, item) => sum + item.initialDeckCount, 0) !== 61) {
  throw new Error("weapon initial deck total");
}
if (rules.length !== 53 || new Set(rules.flatMap((item) => item.testIds)).size !== 53) {
  throw new Error("weapon test count/uniqueness");
}
if (rules.some((rule) => rule.relatedWeaponIds.length === 0)) {
  throw new Error(`unrelated tests: ${rules.filter((rule) => rule.relatedWeaponIds.length === 0)
    .map((rule) => rule.testIds[0]).join(",")}`);
}

fs.writeFileSync(out, `${JSON.stringify({
  rulePackId: "skb.v1.3.4.weapons",
  dslVersion: "1.0.0",
  rulesetVersion: version,
  source: "docs/整理/18-v1.3.4武器规则正文.md",
  testSource: "docs/整理/19-v1.3.4武器规则测试清单.md",
  synthesisRecipes,
  templates,
  rules
}, null, 2)}\n`);

console.log(JSON.stringify({
  weaponTemplates: templates.length,
  initialDeckCount: templates.reduce((sum, item) => sum + item.initialDeckCount, 0),
  simplePending: templates.filter((item) => item.effectEncodingStatus === "simple_pending_dsl").length,
  baseAttackEncoded: templates.filter((item) => item.effectEncodingStatus === "base_attack_encoded").length,
  judgmentEffectsEncoded: templates.filter((item) =>
    item.effectEncodingStatus === "judgment_effects_encoded").length,
  rangeDimensionsEncoded: templates.filter((item) =>
    item.effectEncodingStatus === "range_dimensions_encoded").length,
  chargeDelayEncoded: templates.filter((item) =>
    item.effectEncodingStatus === "charge_delay_encoded").length,
  modesCostsEncoded: templates.filter((item) =>
    item.effectEncodingStatus === "modes_costs_encoded").length,
  specialInstancesEncoded: templates.filter((item) =>
    item.effectEncodingStatus === "special_instances_encoded").length,
  simpleParseFailed: templates.filter((item) => item.effectEncodingStatus === "simple_parse_failed").length,
  complexPending: templates.filter((item) => item.effectEncodingStatus === "complex_pending_dsl").length,
  mappedTests: rules.length
}, null, 2));
