import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";

const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, "rulesets", "v1.3.4");
const load = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
const fail = (message) => {
  throw new Error(`ruleset validation failed: ${message}`);
};
const unique = (values, label) => {
  if (new Set(values).size !== values.length) fail(`duplicate ${label}`);
};

const manifest = load("manifest.json");
const settings = load("settings.json");
const characters = load("characters.json").items;
const cards = load("cards.json").items;
const deck = load("deck.json");
const resources = load("resources.json").items;
const ontology = load("ontology.json");
const schema = load("dsl.schema.json");
const core = load("core-rules.json");
const examples = load("dsl-examples.json");
const generalRules = load("general-rules.json").rules;
const characterRulePack = load("character-rules.json");
const characterAbilities = characterRulePack.abilities;
const characterRules = characterRulePack.rules;
const weaponRulePack = load("weapon-rules.json");
const weaponTemplates = weaponRulePack.templates;
const weaponRules = weaponRulePack.rules;
const weaponSynthesisRecipes = weaponRulePack.synthesisRecipes ?? [];
const nonbossRulePack = load("nonboss-rules.json");
const nonbossTemplates = nonbossRulePack.templates;
const nonbossFamilies = nonbossRulePack.effectFamilies;
const nonbossRules = nonbossRulePack.rules;
const bossRulePack = load("boss-rules.json");
const bossTemplates = bossRulePack.templates;
const bossFamilies = bossRulePack.effectFamilies;
const bossRules = bossRulePack.rules;
const eventProduction = load("event-production.json");
const pipelineGraph = load("pipeline-graph.json");
const freeze = load("freeze.json");

for (const filename of Object.values(manifest.files)) {
  if (!fs.existsSync(path.join(dir, filename))) fail(`manifest file missing: ${filename}`);
}
if (manifest.status !== "frozen_baseline") fail(`manifest is not frozen: ${manifest.status}`);
if (freeze.rulesetId !== manifest.rulesetId || freeze.version !== manifest.version ||
    freeze.status !== manifest.status || freeze.hashAlgorithm !== "sha256") {
  fail("freeze identity mismatch");
}
const frozenFilenames = freeze.files.map((item) => item.filename);
unique(frozenFilenames, "frozen filename");
const expectedFrozenFilenames = Object.values(manifest.files)
  .filter((filename) => filename !== manifest.files.freeze).sort();
if (JSON.stringify([...frozenFilenames].sort()) !== JSON.stringify(expectedFrozenFilenames)) {
  fail("freeze file set mismatch");
}
for (const item of freeze.files) {
  const actualHash = crypto.createHash("sha256")
    .update(fs.readFileSync(path.join(dir, item.filename))).digest("hex");
  if (actualHash !== item.sha256) fail(`freeze hash mismatch ${item.filename}`);
}
if (settings.rulesetVersion !== "1.3.4") fail("settings version");
if (characters.length !== 25) fail(`character count ${characters.length}`);
if (cards.length !== 203) fail(`card template count ${cards.length}`);
if (cards.some((item) => item.effectEncodingStatus !== "encoded_in_category_rule_pack")) {
  fail("card fact layer still contains pending DSL status");
}
if (deck.totalCount !== 337) fail(`deck total ${deck.totalCount}`);
unique(characters.map((item) => item.characterId), "characterId");
unique(cards.map((item) => item.cardId), "cardId");
unique(resources.map((item) => item.resourceKey), "resourceKey");
const actualMissingAssets = resources.filter((item) => !item.assetPath)
  .map((item) => item.resourceKey).sort();
const allowedMissingAssets = [...freeze.allowedMissingSpecificAssets].sort();
unique(allowedMissingAssets, "allowed missing asset");
if (JSON.stringify(actualMissingAssets) !== JSON.stringify(allowedMissingAssets)) {
  fail("missing asset whitelist mismatch");
}
for (const resource of resources.filter((item) => !item.assetPath)) {
  if (!resource.fallbackResourceKey) fail(`missing asset has no fallback ${resource.resourceKey}`);
}

const byCardId = new Map(cards.map((item) => [item.cardId, item]));
for (const entry of deck.entries) {
  const card = byCardId.get(entry.cardId);
  if (!card) fail(`deck references missing card ${entry.cardId}`);
  if (entry.count <= 0 || entry.count !== card.initialDeckCount) {
    fail(`deck count mismatch ${entry.cardId}`);
  }
}
const expectedTotals = {
  basic: 132, weapon: 61, armor: 8, talent: 50,
  mount: 11, statue: 50, special: 16, boss: 9
};
for (const [category, count] of Object.entries(expectedTotals)) {
  if (deck.categoryTotals[category] !== count) fail(`category total ${category}`);
}

const eventTypes = Object.entries(ontology.eventNamespaces)
  .flatMap(([namespace, names]) => names.map((name) => `${namespace}.${name}`));
const ontologyOps = Object.values(ontology.effectOps).flat();
const schemaOps = schema.$defs.effect.properties.op.enum;
unique(eventTypes, "event type");
unique(ontologyOps, "effect op");
if (ontologyOps.some((op) => !schemaOps.includes(op)) ||
    schemaOps.some((op) => !ontologyOps.includes(op))) {
  fail("ontology/schema effect op mismatch");
}
if (core.phaseGraph.order.join(",") !== ontology.phases.join(",")) {
  fail("phase order differs from ontology");
}

const validateStaticEventRefs = (value, location = "ruleset") => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateStaticEventRefs(item, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (["listen", "event", "eventType"].includes(key)) {
      const refs = Array.isArray(child) ? child : [child];
      for (const ref of refs) {
        if (typeof ref === "string" && ref.includes(".") && !ref.startsWith("$") &&
            !eventTypes.includes(ref)) {
          fail(`unknown static event reference ${location}.${key}: ${ref}`);
        }
      }
    }
    validateStaticEventRefs(child, `${location}.${key}`);
  }
};
validateStaticEventRefs(core, "core-rules");
validateStaticEventRefs(generalRules, "general-rules");
validateStaticEventRefs(characterRulePack, "character-rules");
validateStaticEventRefs(weaponRulePack, "weapon-rules");
validateStaticEventRefs(nonbossRulePack, "nonboss-rules");
validateStaticEventRefs(bossRulePack, "boss-rules");

if (eventProduction.rulesetVersion !== settings.rulesetVersion) {
  fail("event production version");
}
unique(eventProduction.producers.map((item) => item.producerId), "event producerId");
const producedEvents = eventProduction.producers.flatMap((item) => item.events);
unique(producedEvents, "event production assignment");
for (const eventType of producedEvents) {
  if (!eventTypes.includes(eventType)) fail(`producer declares unknown event ${eventType}`);
}
const referencedStaticEvents = new Set();
const collectStaticEventRefs = (value) => {
  if (Array.isArray(value)) return value.forEach(collectStaticEventRefs);
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (["listen", "event", "eventType"].includes(key)) {
      for (const ref of (Array.isArray(child) ? child : [child])) {
        if (typeof ref === "string" && ref.includes(".") && !ref.startsWith("$")) {
          referencedStaticEvents.add(ref);
        }
      }
    }
    collectStaticEventRefs(child);
  }
};
collectStaticEventRefs(generalRules);
collectStaticEventRefs(characterRulePack);
collectStaticEventRefs(weaponRulePack);
collectStaticEventRefs(nonbossRulePack);
collectStaticEventRefs(bossRulePack);
for (const eventType of referencedStaticEvents) {
  if (!producedEvents.includes(eventType)) fail(`event has no registered producer ${eventType}`);
}

if (pipelineGraph.rulesetVersion !== settings.rulesetVersion) fail("pipeline graph version");
unique(pipelineGraph.pipelines, "pipeline id");
const pipelineIds = new Set(pipelineGraph.pipelines);
for (const rootId of pipelineGraph.roots) {
  if (!pipelineIds.has(rootId)) fail(`pipeline root missing ${rootId}`);
}
unique(pipelineGraph.edges.map((edge) => `${edge.from}->${edge.to}`), "pipeline edge");
for (const edge of pipelineGraph.edges) {
  if (!pipelineIds.has(edge.from) || !pipelineIds.has(edge.to) || !edge.cause) {
    fail(`invalid pipeline edge ${edge.from}->${edge.to}`);
  }
}
const reachablePipelines = new Set(pipelineGraph.roots);
let graphChanged = true;
while (graphChanged) {
  graphChanged = false;
  for (const edge of pipelineGraph.edges) {
    if (reachablePipelines.has(edge.from) && !reachablePipelines.has(edge.to)) {
      reachablePipelines.add(edge.to);
      graphChanged = true;
    }
  }
}
for (const pipelineId of pipelineIds) {
  if (!reachablePipelines.has(pipelineId)) fail(`unreachable pipeline ${pipelineId}`);
}
const requiredPipelineEntryOps = new Set([
  "useCard", "playCard", "respondCard", "createAttack", "openResponseWindow",
  "requestSpecialPlay", "judgeColor", "replaceJudgment", "createDamage", "checkDying",
  "createDuration", "expireDuration", "scheduleEffect", "cancelScheduledEffect"
]);
for (const [op, pipelineId] of Object.entries(pipelineGraph.operationEntrypoints)) {
  if (!schemaOps.includes(op)) fail(`pipeline entry unknown op ${op}`);
  if (!pipelineIds.has(pipelineId)) fail(`pipeline entry target missing ${op}: ${pipelineId}`);
}
for (const op of requiredPipelineEntryOps) {
  if (!pipelineGraph.operationEntrypoints[op]) fail(`pipeline entry op unmapped ${op}`);
}

const walkEffects = (effects) => {
  if (!effects) return;
  if (!Array.isArray(effects)) effects = [effects];
  for (const effect of effects) {
    if (!schemaOps.includes(effect.op)) fail(`unknown example op ${effect.op}`);
    if (effect.op === "createDuration" &&
        (!effect.expiry || typeof effect.expiry.point !== "string" ||
         !effect.expiry.skipPolicy)) {
      fail(`duration missing canonical expiry ${effect.effectId ?? JSON.stringify(effect.params ?? {})}`);
    }
    if ((effect.op === "repeat" || effect.op === "whileBounded") &&
        !Number.isInteger(effect.maxIterations)) {
      fail(`unbounded loop ${effect.effectId ?? effect.op}`);
    }
    if (effect.effects) walkEffects(effect.effects);
    if (effect.cleanupEffects) walkEffects(effect.cleanupEffects);
    if (effect.then) walkEffects(effect.then);
    if (effect.else) walkEffects(effect.else);
    if (effect.params?.onMatched) walkEffects(effect.params.onMatched);
    if (effect.params?.onUnmatched) walkEffects(effect.params.onUnmatched);
    if (effect.params?.then) walkEffects(effect.params.then);
    if (effect.params?.else) walkEffects(effect.params.else);
    if (effect.params?.effect?.op || Array.isArray(effect.params?.effect)) {
      walkEffects(effect.params.effect);
    }
    for (const resultEffects of Object.values(effect.params?.effectsByResult ?? {})) {
      walkEffects(resultEffects);
    }
    for (const branch of Object.values(effect.params?.cases ?? {})) {
      if (branch.effects) walkEffects(branch.effects);
    }
  }
};
walkEffects(examples.effects);
for (const rule of generalRules) {
  if (!eventTypes.includes(rule.listen)) fail(`unknown rule listen event ${rule.ruleId}: ${rule.listen}`);
  walkEffects(rule.effects);
}
const expectedGeneralTests = Array.from({ length: 43 }, (_, index) =>
  `G${String(index + 1).padStart(3, "0")}`);
const mappedGeneralTests = generalRules.flatMap((rule) => rule.testIds);
unique(mappedGeneralTests, "general test mapping");
for (const testId of expectedGeneralTests) {
  if (!mappedGeneralTests.includes(testId)) fail(`unmapped general test ${testId}`);
}
for (const testId of mappedGeneralTests) {
  if (!expectedGeneralTests.includes(testId)) fail(`unknown general test ${testId}`);
}
const characterIds = new Set(characters.map((item) => item.characterId));
unique(characterAbilities.map((item) => item.abilityId), "abilityId");
for (const ability of characterAbilities) {
  if (!characterIds.has(ability.ownerCharacterId)) {
    fail(`ability owner missing ${ability.abilityId}: ${ability.ownerCharacterId}`);
  }
}
for (const character of characters) {
  const expectedAbilities = characterAbilities
    .filter((ability) => ability.ownerCharacterId === character.characterId);
  const expectedTalents = expectedAbilities.filter((ability) => ability.abilityId.startsWith("talent."))
    .map((ability) => ability.abilityId);
  const expectedSkills = expectedAbilities.filter((ability) => ability.abilityId.startsWith("skill."))
    .map((ability) => ability.abilityId);
  if (JSON.stringify(character.initialTalentIds) !== JSON.stringify(expectedTalents)) {
    fail(`character initial talents mismatch ${character.characterId}`);
  }
  if (JSON.stringify(character.skillIds) !== JSON.stringify(expectedSkills)) {
    fail(`character skills mismatch ${character.characterId}`);
  }
}
for (const rule of characterRules) {
  if (!eventTypes.includes(rule.listen)) fail(`unknown character listen ${rule.ruleId}: ${rule.listen}`);
  if (rule.characterId !== "*" && !characterIds.has(rule.characterId)) {
    fail(`character rule owner missing ${rule.ruleId}: ${rule.characterId}`);
  }
  for (const abilityId of rule.abilityIds) {
    const ability = characterAbilities.find((item) => item.abilityId === abilityId);
    if (!ability) fail(`character rule ability missing ${rule.ruleId}: ${abilityId}`);
    if (rule.characterId !== "*" && ability.ownerCharacterId !== rule.characterId) {
      fail(`character rule ability owner mismatch ${rule.ruleId}: ${abilityId}`);
    }
  }
  walkEffects(rule.effects);
}
const expectedCharacterTests = Array.from({ length: 50 }, (_, index) =>
  `R${String(index + 1).padStart(3, "0")}`);
const mappedCharacterTests = characterRules.flatMap((rule) => rule.testIds);
unique(mappedCharacterTests, "character test mapping");
for (const testId of expectedCharacterTests) {
  if (!mappedCharacterTests.includes(testId)) fail(`unmapped character test ${testId}`);
}
for (const testId of mappedCharacterTests) {
  if (!expectedCharacterTests.includes(testId)) fail(`unknown character test ${testId}`);
}
if (weaponTemplates.length !== 66) fail(`weapon template count ${weaponTemplates.length}`);
unique(weaponTemplates.map((item) => item.weaponId), "weaponId");
if(weaponSynthesisRecipes.length!==10)fail(`weapon synthesis recipe count ${weaponSynthesisRecipes.length}`);
unique(weaponSynthesisRecipes.map(item=>item.recipeId),"weapon synthesis recipeId");
for(const recipe of weaponSynthesisRecipes){if(recipe.window!=="owner.phase.play"||JSON.stringify(recipe.inputZones)!==JSON.stringify(["hand","equipment"])||recipe.inputMoveKind!=="synthesizeConsume"||recipe.inputsDestination!=="discardPile"||recipe.outputZone!=="hand"||recipe.generatedInstanceExitZone!=="outsideDeck")fail(`invalid weapon synthesis lifecycle ${recipe.recipeId}`);if(!cards.some(card=>card.cardId===recipe.outputTemplateId))fail(`unknown synthesis output ${recipe.recipeId}`);for(const input of recipe.inputs??[])if(!Number.isInteger(input.count)||input.count<1||!cards.some(card=>card.cardId===input.templateId))fail(`invalid synthesis input ${recipe.recipeId}`);}
const weaponCardFacts = cards.filter((item) => item.category === "weapon");
for (const weapon of weaponTemplates) {
  const card = weaponCardFacts.find((item) => item.cardId === weapon.weaponId);
  if (!card) fail(`weapon template card missing ${weapon.weaponId}`);
  if (card.initialDeckCount !== weapon.initialDeckCount || card.color !== weapon.color) {
    fail(`weapon fact mismatch ${weapon.weaponId}`);
  }
  if (weapon.effectEncodingStatus === "base_attack_encoded") {
    if (weapon.attackModes.length !== 1) fail(`base weapon mode missing ${weapon.weaponId}`);
    const mode = weapon.attackModes[0];
    if (!mode.damageSegments.length || mode.range < 0) fail(`invalid base weapon mode ${weapon.weaponId}`);
  }
  if (weapon.judgments?.length) {
    if (!weapon.attackModes.length) fail(`judgment weapon mode missing ${weapon.weaponId}`);
    if (!weapon.judgments?.length) fail(`judgment definition missing ${weapon.weaponId}`);
    for (const judgment of weapon.judgments) {
      const judgmentColors = ["white", "green", "blue", "orange", "red"];
      const hasExhaustiveColors = judgmentColors.every((color) =>
        Object.hasOwn(judgment.outcomes ?? {}, color));
      if (!judgment.judgmentId || !judgment.timing || !judgment.purpose ||
          !judgment.oncePer || (!judgment.outcomes?.default && !hasExhaustiveColors)) {
        fail(`invalid judgment definition ${weapon.weaponId}`);
      }
      for (const outcome of Object.values(judgment.outcomes)) {
        if (typeof outcome.matched !== "boolean") {
          fail(`judgment outcome missing matched flag ${weapon.weaponId}`);
        }
        if (outcome.effects) walkEffects(outcome.effects);
        for (const effect of outcome.effects ?? []) {
          const damageSegment = effect.op === "createDamage" ? effect.params?.segment : null;
          if (damageSegment && damageSegment.isAdditional !== true) {
            fail(`judgment-created damage must be additional ${weapon.weaponId}`);
          }
        }
        for (const damageSegment of outcome.replacementSegments ?? []) {
          if (damageSegment.isAdditional !== false) {
            fail(`replacement base damage cannot be additional ${weapon.weaponId}`);
          }
        }
      }
      for (const modeId of judgment.modeFilter ?? []) {
        if (!weapon.attackModes.some((item) => item.modeId === modeId)) {
          fail(`judgment mode filter missing ${weapon.weaponId}: ${modeId}`);
        }
      }
    }
  }
  if (weapon.effectEncodingStatus === "range_dimensions_encoded") {
    if (!weapon.attackModes.length) fail(`range/dimension weapon mode missing ${weapon.weaponId}`);
    const modeIds = weapon.attackModes.map((item) => item.modeId);
    unique(modeIds, `weapon modeId ${weapon.weaponId}`);
    if (weapon.rangeTiers) {
      if (weapon.rangeTiers.selectionPolicy !==
          "smallestRangeCoveringEffectiveDistance" ||
          weapon.rangeTiers.selectableByPlayer !== false ||
          weapon.rangeTiers.zeroRangeOnlyCoversEffectiveDistanceZero !== true) {
        fail(`invalid automatic range policy ${weapon.weaponId}`);
      }
      const tierRanges = weapon.rangeTiers.tiers.map((tier) => tier.range);
      if (tierRanges.some((range, index) => index > 0 && range <= tierRanges[index - 1])) {
        fail(`range tiers not strictly ascending ${weapon.weaponId}`);
      }
      for (const tier of weapon.rangeTiers.tiers) {
        if (!modeIds.includes(tier.modeId)) fail(`range tier mode missing ${weapon.weaponId}`);
        const attackMode = weapon.attackModes.find((item) => item.modeId === tier.modeId);
        if (attackMode.range !== tier.range) fail(`range tier value mismatch ${weapon.weaponId}`);
      }
    }
    const dimensions = weapon.damageDimensions ?? [];
    unique(dimensions.map((item) => item.dimensionId), `damage dimension ${weapon.weaponId}`);
    for (const dimension of dimensions) {
      if (!["scatter", "combo"].includes(dimension.dimensionId) ||
          !dimension.modifierSourceTag || dimension.modifier?.add !== 1) {
        fail(`invalid damage dimension ${weapon.weaponId}`);
      }
      const segmentIds = new Set(weapon.attackModes.flatMap((item) =>
        item.damageSegments.map((damageSegment) => damageSegment.segmentId)));
      for (const segmentId of dimension.affectedSegmentIds) {
        if (!segmentIds.has(segmentId)) {
          fail(`damage dimension segment missing ${weapon.weaponId}: ${segmentId}`);
        }
      }
    }
  }
  if (weapon.effectEncodingStatus === "charge_delay_encoded") {
    const charge = weapon.charge;
    if (!charge || charge.counterId !== "chargeProgress" ||
        charge.visibility !== "public" || charge.initial !== 0 ||
        charge.min !== 0 || !Number.isInteger(charge.max) ||
        charge.max < 1 || charge.selectableByPlayer !== false ||
        charge.tierSelectionPolicy !== "exactCurrentProgress") {
      fail(`invalid charge state ${weapon.weaponId}`);
    }
    if (!charge.clearOn.includes("attack.commit") ||
        !charge.clearOn.includes("moveToNonEquipmentZone") ||
        !charge.preserveOn.includes("equipmentToEquipmentTransfer") ||
        !charge.preserveOn.includes("equipmentEffectsDisabled") ||
        charge.borrowedWeaponPolicy !== "temporaryChargeZeroSnapshot") {
      fail(`invalid charge lifecycle ${weapon.weaponId}`);
    }
    if (charge.tiers.length !== charge.max + 1) fail(`charge tier count ${weapon.weaponId}`);
    const attackModeIds = new Set(weapon.attackModes.map((item) => item.modeId));
    const resolutionModeIds = new Set((weapon.resolutionModes ?? [])
      .map((item) => item.resolutionId));
    for (let progress = 0; progress <= charge.max; progress += 1) {
      const tier = charge.tiers.find((item) => item.progress === progress);
      if (!tier) fail(`charge tier missing ${weapon.weaponId}: ${progress}`);
      if (tier.attackModeId && !attackModeIds.has(tier.attackModeId)) {
        fail(`charge attack mode missing ${weapon.weaponId}: ${tier.attackModeId}`);
      }
      if (tier.resolutionModeId && !resolutionModeIds.has(tier.resolutionModeId)) {
        fail(`charge resolution mode missing ${weapon.weaponId}: ${tier.resolutionModeId}`);
      }
      if (tier.attackAllowed && !tier.attackModeId) {
        fail(`charge allowed tier lacks attack ${weapon.weaponId}: ${progress}`);
      }
      if (tier.resolutionAllowed && !tier.resolutionModeId) {
        fail(`charge allowed tier lacks resolution ${weapon.weaponId}: ${progress}`);
      }
    }
    for (const resolutionMode of weapon.resolutionModes ?? []) {
      if (resolutionMode.createsAttack !== false ||
          resolutionMode.opensResponseWindow !== false) {
        fail(`non-attack charge resolution flags ${weapon.weaponId}`);
      }
      walkEffects(resolutionMode.effects);
    }
    walkEffects(weapon.onAttackCommit ?? []);
  }
  if (weapon.effectEncodingStatus === "modes_costs_encoded") {
    if (!weapon.attackModes.length) fail(`mode/cost weapon mode missing ${weapon.weaponId}`);
    const attackModeIds = new Set(weapon.attackModes.map((item) => item.modeId));
    if (weapon.modeSelection) {
      if (!weapon.modeSelection.playerSelectable ||
          weapon.modeSelection.switchIsRulesAction !== false ||
          weapon.modeSelection.cannotChangeWeaponDuringCommittedAttack !== true ||
          !weapon.modeSelection.modeIds.includes(weapon.modeSelection.defaultModeId)) {
        fail(`invalid manual mode selection ${weapon.weaponId}`);
      }
      for (const modeId of weapon.modeSelection.modeIds) {
        const resolution = weapon.modeSelection.resolution?.[modeId];
        if (!attackModeIds.has(modeId) && !resolution) {
          fail(`manual mode unresolved ${weapon.weaponId}: ${modeId}`);
        }
        if (resolution?.attackModeId && !attackModeIds.has(resolution.attackModeId)) {
          fail(`manual attack mode missing ${weapon.weaponId}: ${resolution.attackModeId}`);
        }
        for (const mappedModeId of Object.entries(resolution?.byInstanceState ?? {})
          .filter(([key, value]) => key !== "stateId" && typeof value === "string")
          .map(([, value]) => value)) {
          if (!attackModeIds.has(mappedModeId)) {
            fail(`state attack mode missing ${weapon.weaponId}: ${mappedModeId}`);
          }
        }
      }
    }
    if (weapon.instanceState) {
      if (weapon.instanceState.playerSelectable !== false ||
          !weapon.instanceState.values.includes(weapon.instanceState.initial)) {
        fail(`invalid automatic instance state ${weapon.weaponId}`);
      }
    }
    if (weapon.automaticMode) {
      if (weapon.automaticMode.selectableByPlayer !== false ||
          !weapon.automaticMode.branches.length) {
        fail(`invalid automatic mode ${weapon.weaponId}`);
      }
      for (const branch of weapon.automaticMode.branches) {
        if (!attackModeIds.has(branch.attackModeId)) {
          fail(`automatic attack mode missing ${weapon.weaponId}: ${branch.attackModeId}`);
        }
      }
    }
    if (weapon.turnAttemptCounter) {
      if (weapon.turnAttemptCounter.scope !== "ownerTurn" ||
          weapon.turnAttemptCounter.incrementAt !== "attack.costs.paid" ||
          weapon.turnAttemptCounter.incrementEvenIfLaterKillInvalidated !== true ||
          weapon.turnAttemptCounter.resetAt !== "owner.turn.start") {
        fail(`invalid turn attempt counter ${weapon.weaponId}`);
      }
    }
    walkEffects(weapon.onAttackCommit ?? []);
  }
  if (weapon.effectEncodingStatus === "special_instances_encoded") {
    for (const effectList of [
      weapon.onAttackMiss,
      weapon.onAttackHitBeforeDamage,
      weapon.onAttackHitAfterDamage
    ]) {
      walkEffects(effectList ?? []);
    }
    for (const ability of weapon.activatedAbilities ?? []) {
      if (!ability.abilityId || !ability.activationWindow ||
          !ability.requires || !Array.isArray(ability.effects)) {
        fail(`invalid weapon activated ability ${weapon.weaponId}`);
      }
      walkEffects(ability.effects);
    }
    for (const action of weapon.specialActions ?? []) {
      if (!action.actionId || !action.costs) fail(`invalid weapon special action ${weapon.weaponId}`);
      walkEffects(action.effects ?? []);
      walkEffects(action.afterAllProjectiles ?? []);
    }
    if (weapon.followUpPolicy &&
        (weapon.followUpPolicy.maximumPerRootAttack !== 1 ||
         weapon.followUpPolicy.followUpCannotChain !== true)) {
      fail(`invalid follow-up bound ${weapon.weaponId}`);
    }
    if (weapon.curseDefinition) {
      if (weapon.curseDefinition.expiryPoint !== "target.nextPhase.prepare.before" ||
          weapon.curseDefinition.temporaryWeaponTemplateId !== "weapon.w32" ||
          weapon.curseDefinition.temporaryWeaponExitZone !== "outsideDeck") {
        fail(`invalid curse definition ${weapon.weaponId}`);
      }
    }
    if (weapon.cooldown &&
        (weapon.cooldown.printedCd !== 2 ||
         weapon.cooldown.readyAfterOwnerRoundCount !== 3)) {
      fail(`invalid cooldown encoding ${weapon.weaponId}`);
    }
    if (weapon.durability) {
      if (weapon.durability.baseMax !== 2 ||
          weapon.durability.initialCurrent !== 2 ||
          weapon.durability.modifier?.sourceTag !== "talent.scatterIncrease") {
        fail(`invalid durability encoding ${weapon.weaponId}`);
      }
      walkEffects([weapon.durability.onZero]);
    }
    for (const trigger of weapon.lockedTriggers ?? []) {
      for (const eventType of trigger.listen ?? []) {
        if (!eventTypes.includes(eventType)) {
          fail(`unknown weapon trigger event ${weapon.weaponId}: ${eventType}`);
        }
      }
      if (!trigger.reentrancyGuard) fail(`weapon trigger lacks guard ${weapon.weaponId}`);
      walkEffects(trigger.effects);
    }
    if (weapon.temporaryResourcePolicy &&
        (weapon.temporaryResourcePolicy.doesNotEnterHand !== true ||
         weapon.temporaryResourcePolicy.immediateUseOnly !== true ||
         weapon.temporaryResourcePolicy.passOrTimeoutRemoves !== true)) {
      fail(`invalid temporary resource policy ${weapon.weaponId}`);
    }
  }
  if (weapon.effectEncodingStatus === "simple_parse_failed") {
    fail(`simple weapon parse failed ${weapon.weaponId}`);
  }
}
if (weaponTemplates.reduce((sum, item) => sum + item.initialDeckCount, 0) !== 61) {
  fail("weapon deck total");
}
const expectedWeaponTests = Array.from({ length: 53 }, (_, index) =>
  `W${String(index + 1).padStart(3, "0")}`);
const mappedWeaponTests = weaponRules.flatMap((rule) => rule.testIds);
unique(mappedWeaponTests, "weapon test mapping");
for (const testId of expectedWeaponTests) {
  if (!mappedWeaponTests.includes(testId)) fail(`unmapped weapon test ${testId}`);
}
for (const rule of weaponRules) {
  if (rule.encodingStatus !== "effect_dsl_encoded") {
    fail(`weapon acceptance not effect encoded ${rule.testIds[0]}`);
  }
  for (const weaponId of rule.relatedWeaponIds) {
    if (weaponId !== "*" && !weaponTemplates.some((item) => item.weaponId === weaponId)) {
      fail(`weapon test reference missing ${rule.testIds[0]}: ${weaponId}`);
    }
  }
}
if (nonbossTemplates.length !== 128) fail(`nonboss template count ${nonbossTemplates.length}`);
if (nonbossTemplates.reduce((sum, item) => sum + item.initialDeckCount, 0) !== 267) {
  fail("nonboss physical card total");
}
unique(nonbossTemplates.map((item) => item.cardId), "nonboss cardId");
for (const template of nonbossTemplates) {
  const card = cards.find((item) => item.cardId === template.cardId);
  if (!card || ["weapon", "boss"].includes(card.category)) {
    fail(`nonboss fact missing ${template.cardId}`);
  }
  if (card.category !== template.category || card.color !== template.color ||
      card.initialDeckCount !== template.initialDeckCount) {
    fail(`nonboss fact mismatch ${template.cardId}`);
  }
}
if (nonbossFamilies.length !== 71) fail(`nonboss encoded family count ${nonbossFamilies.length}`);
const basicEncoded = nonbossTemplates.filter((item) =>
  item.effectEncodingStatus === "basic_effect_encoded");
if (basicEncoded.length !== 22 || basicEncoded.some((item) => !item.effectFamilyId)) {
  fail("basic template encoding");
}
const armorEncoded = nonbossTemplates.filter((item) =>
  item.effectEncodingStatus === "armor_effect_encoded");
if (armorEncoded.length !== 9 || armorEncoded.some((item) => !item.effectFamilyId)) {
  fail("armor template encoding");
}
const talentEncoded = nonbossTemplates.filter((item) =>
  item.effectEncodingStatus === "talent_effect_encoded");
if (talentEncoded.length !== 25 || talentEncoded.some((item) => !item.effectFamilyId)) {
  fail("talent template encoding");
}
const mountEncoded = nonbossTemplates.filter((item) =>
  item.effectEncodingStatus === "mount_effect_encoded");
if (mountEncoded.length !== 11 || mountEncoded.some((item) => !item.effectFamilyId)) {
  fail("mount template encoding");
}
const statueEncoded = nonbossTemplates.filter((item) =>
  item.effectEncodingStatus === "statue_effect_encoded");
if (statueEncoded.length !== 50 || statueEncoded.some((item) => !item.effectFamilyId)) {
  fail("statue template encoding");
}
const specialEncoded = nonbossTemplates.filter((item) =>
  item.effectEncodingStatus === "special_effect_encoded");
if (specialEncoded.length !== 11 || specialEncoded.some((item) => !item.effectFamilyId)) {
  fail("special template encoding");
}
for (const family of nonbossFamilies) {
  for (const mode of family.modes ?? []) walkEffects(mode.effects ?? []);
  for (const trigger of family.triggers ?? []) walkEffects(trigger.effects ?? []);
  for (const replacement of family.replacements ?? []) walkEffects(replacement.effects ?? []);
  walkEffects(family.delayedTrigger?.effects ?? []);
  walkEffects(family.onEquip ?? []);
  walkEffects(family.onLose ?? []);
  walkEffects(family.cleanupEffects ?? []);
  walkEffects(family.grantedAbility?.trigger?.effects ?? []);
  walkEffects(family.effects ?? []);
}
const expectedNonbossTests = Array.from({ length: 52 }, (_, index) =>
  `P${String(index + 1).padStart(3, "0")}`);
const mappedNonbossTests = nonbossRules.flatMap((rule) => rule.testIds);
unique(mappedNonbossTests, "nonboss test mapping");
for (const testId of expectedNonbossTests) {
  if (!mappedNonbossTests.includes(testId)) fail(`unmapped nonboss test ${testId}`);
}
for (const rule of nonbossRules) {
  if (!rule.relatedCardIds.length) fail(`nonboss test has no relation ${rule.testIds[0]}`);
}

if (bossTemplates.length !== 9 || bossTemplates.some((item) => item.initialDeckCount !== 1)) {
  fail("boss template/deck count");
}
unique(bossTemplates.map((item) => item.cardId), "boss template cardId");
for (const template of bossTemplates) {
  const card = cards.find((item) => item.cardId === template.cardId);
  if (!card || card.category !== "boss" || card.color !== template.color ||
      card.initialDeckCount !== template.initialDeckCount) fail(`boss fact mismatch ${template.cardId}`);
}
const expectedBossTests = Array.from({ length: 50 }, (_, index) =>
  `B${String(index + 1).padStart(3, "0")}`);
const mappedBossTests = bossRules.flatMap((rule) => rule.testIds);
unique(mappedBossTests, "boss test mapping");
for (const testId of expectedBossTests) {
  if (!mappedBossTests.includes(testId)) fail(`unmapped boss test ${testId}`);
}
if (bossRules.filter((rule) => rule.encodingStatus === "common_dsl_encoded").length !== 8) {
  fail("boss common encoded test count");
}
const bossEncoded = bossTemplates.filter((item) => item.effectEncodingStatus === "boss_effect_encoded");
if (bossEncoded.length !== 9 || bossFamilies.length !== 9 ||
    bossEncoded.some((item) => !item.effectFamilyId)) fail("boss first batch encoding");

// The three executable category packs must form an exact partition of cards.json.
// This prevents a newly added card from silently remaining outside the server rule layer,
// and also prevents one card from being implemented by two category packs.
const categoryRuleCardIds = [
  ...weaponTemplates.map((item) => item.weaponId),
  ...nonbossTemplates.map((item) => item.cardId),
  ...bossTemplates.map((item) => item.cardId)
];
unique(categoryRuleCardIds, "category rule cardId");
const factCardIds = new Set(cards.map((item) => item.cardId));
const categoryRuleCardIdSet = new Set(categoryRuleCardIds);
for (const cardId of factCardIds) {
  if (!categoryRuleCardIdSet.has(cardId)) fail(`card missing category rule template ${cardId}`);
}
for (const cardId of categoryRuleCardIdSet) {
  if (!factCardIds.has(cardId)) fail(`category rule template missing card fact ${cardId}`);
}

unique(nonbossFamilies.map((item) => item.familyId), "nonboss effect familyId");
const nonbossFamilyIds = new Set(nonbossFamilies.map((item) => item.familyId));
for (const template of nonbossTemplates) {
  if (!nonbossFamilyIds.has(template.effectFamilyId)) {
    fail(`nonboss effect family missing ${template.cardId}: ${template.effectFamilyId}`);
  }
}
unique(bossFamilies.map((item) => item.familyId), "boss effect familyId");
const bossFamilyIds = new Set(bossFamilies.map((item) => item.familyId));
for (const template of bossTemplates) {
  if (!bossFamilyIds.has(template.effectFamilyId)) {
    fail(`boss effect family missing ${template.cardId}: ${template.effectFamilyId}`);
  }
}
if (bossRules.filter((rule) => rule.encodingStatus === "effect_dsl_encoded").length !== 42) {
  fail("boss first batch test count");
}
for (const family of bossFamilies) {
  for (const trigger of family.triggers ?? []) walkEffects(trigger.effects ?? []);
  for (const replacement of family.replacements ?? []) walkEffects(replacement.effects ?? []);
  for (const window of family.specialWindows ?? []) walkEffects(window.effects ?? []);
  walkEffects(family.deathReplacement?.effects ?? []);
  walkEffects(family.phaseReplacement?.effects ?? []);
  walkEffects(family.pincerAttack?.onHit ?? []);
  for (const mode of family.modes ?? []) {
    walkEffects(mode.effects ?? []);
    walkEffects(mode.delayed?.effects ?? []);
  }
  walkEffects(family.blackSword?.createAction?.effects ?? []);
  for (const mode of family.attackModes ?? []) walkEffects(mode.onHit ?? []);
  walkEffects(family.earlyExit ?? []);
  walkEffects(family.phaseReplacement?.replacementEffect ?? []);
  for (const template of Object.values(family.attackTemplates ?? {})) {
    walkEffects(template.onHit ?? []);
  }
  walkEffects(family.effects ?? []);
  walkEffects(family.cleanup ?? []);
}

console.log(JSON.stringify({
  rulesetVersion: settings.rulesetVersion,
  characters: characters.length,
  cardTemplates: cards.length,
  deckTotal: deck.totalCount,
  eventTypes: eventTypes.length,
  referencedStaticEvents: referencedStaticEvents.size,
  eventProducers: eventProduction.producers.length,
  pipelines: pipelineGraph.pipelines.length,
  pipelineEdges: pipelineGraph.edges.length,
  pipelineEntryOps: Object.keys(pipelineGraph.operationEntrypoints).length,
  frozenFiles: freeze.files.length,
  effectOps: ontologyOps.length,
  exampleEffects: examples.effects.length,
  generalRules: generalRules.length,
  mappedGeneralTests: mappedGeneralTests.length,
  characterAbilities: characterAbilities.length,
  characterRules: characterRules.length,
  mappedCharacterTests: mappedCharacterTests.length,
  weaponTemplates: weaponTemplates.length,
  weaponSynthesisRecipes: weaponSynthesisRecipes.length,
  baseWeaponAttacksEncoded: weaponTemplates.filter((item) =>
    item.effectEncodingStatus === "base_attack_encoded").length,
  judgmentWeaponsEncoded: weaponTemplates.filter((item) =>
    item.effectEncodingStatus === "judgment_effects_encoded").length,
  rangeDimensionWeaponsEncoded: weaponTemplates.filter((item) =>
    item.effectEncodingStatus === "range_dimensions_encoded").length,
  chargeDelayWeaponsEncoded: weaponTemplates.filter((item) =>
    item.effectEncodingStatus === "charge_delay_encoded").length,
  modesCostsWeaponsEncoded: weaponTemplates.filter((item) =>
    item.effectEncodingStatus === "modes_costs_encoded").length,
  specialInstanceWeaponsEncoded: weaponTemplates.filter((item) =>
    item.effectEncodingStatus === "special_instances_encoded").length,
  complexWeaponsPending: weaponTemplates.filter((item) =>
    item.effectEncodingStatus === "complex_pending_dsl").length,
  mappedWeaponTests: mappedWeaponTests.length,
  nonbossTemplates: nonbossTemplates.length,
  nonbossPhysicalCards: nonbossTemplates.reduce((sum, item) => sum + item.initialDeckCount, 0),
  basicCardTemplatesEncoded: basicEncoded.length,
  armorCardTemplatesEncoded: armorEncoded.length,
  talentCardTemplatesEncoded: talentEncoded.length,
  mountCardTemplatesEncoded: mountEncoded.length,
  statueCardTemplatesEncoded: statueEncoded.length,
  specialCardTemplatesEncoded: specialEncoded.length,
  nonbossTemplatesPending: nonbossTemplates.filter((item) =>
    item.effectEncodingStatus === "category_pending_dsl").length,
  mappedNonbossTests: mappedNonbossTests.length,
  bossTemplates: bossTemplates.length,
  bossCommonTestsEncoded: bossRules.filter((rule) =>
    rule.encodingStatus === "common_dsl_encoded").length,
  bossEffectTestsEncoded: bossRules.filter((rule) =>
    rule.encodingStatus === "effect_dsl_encoded").length,
  bossEffectsEncoded: bossEncoded.length,
  bossEffectsPending: bossTemplates.filter((item) =>
    item.effectEncodingStatus === "boss_effect_pending_dsl").length,
  mappedBossTests: mappedBossTests.length,
  missingSpecificAssets: resources.filter((item) => !item.assetPath).length,
  result: "ok"
}, null, 2));
