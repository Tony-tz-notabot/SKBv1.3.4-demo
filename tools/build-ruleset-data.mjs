import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const version = "1.3.4";
const outDir = path.join(root, "rulesets", `v${version}`);
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const writeJson = (name, value) => {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(value, null, 2)}\n`);
};
const tableRows = (text) =>
  text.split(/\r?\n/).filter((line) => /^\|.*\|$/.test(line))
    .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()))
    .filter((cells) => !cells.every((cell) => /^:?-+:?$/.test(cell)));
const stripCode = (value) => value.replaceAll("`", "");

const characterDoc = read("docs/整理/16-v1.3.4角色规则正文.md");
const weaponDoc = read("docs/整理/18-v1.3.4武器规则正文.md");
const cardDoc = read("docs/整理/20-v1.3.4非BOSS牌规则正文.md");
const bossDoc = read("docs/整理/22-v1.3.4BOSS牌规则正文.md");
const resourceMapping = JSON.parse(read("rulesets/v1.3.4/resource-mapping.json"));
const settingsConfig = JSON.parse(read("rulesets/v1.3.4/settings.json"));

const source = {
  general: "docs/整理/01-统一规则总纲.md",
  characters: "docs/整理/16-v1.3.4角色规则正文.md",
  weapons: "docs/整理/18-v1.3.4武器规则正文.md",
  cards: "docs/整理/20-v1.3.4非BOSS牌规则正文.md",
  bosses: "docs/整理/22-v1.3.4BOSS牌规则正文.md"
};

const characterRows = tableRows(characterDoc).filter(
  (row) => /^\d+$/.test(row[0]) && row[1].startsWith("`character.")
);
const characterRulePackPath = path.join(root, "rulesets", `v${version}`, "character-rules.json");
const abilityCatalog = JSON.parse(fs.readFileSync(characterRulePackPath, "utf8")).abilities;
const characters = characterRows.map((row) => {
  const characterId = stripCode(row[1]);
  const ownedAbilities = abilityCatalog.filter((ability) => ability.ownerCharacterId === characterId);
  return {
  characterId,
  displayName: row[2],
  maxHp: Number(row[3]),
  maxShield: Number(row[4]),
  initialTalentDisplayName: row[5],
  initialTalentIds: ownedAbilities.filter((ability) => ability.abilityId.startsWith("talent."))
    .map((ability) => ability.abilityId),
  skillIds: ownedAbilities.filter((ability) => ability.abilityId.startsWith("skill."))
    .map((ability) => ability.abilityId),
  rulesetVersion: version,
  ruleSource: source.characters
  };
});

const colorMap = { 白: "white", 绿: "green", 蓝: "blue", 橙: "orange", 红: "red" };
const assetCategory = resourceMapping.categoryDirectories;
const assetFiles = [];
for (const category of Object.values(assetCategory)) {
  const dir = path.join(root, "assets", category);
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isFile() && resourceMapping.allowedExtensions.includes(path.extname(name).toLowerCase())) {
      assetFiles.push(path.relative(root, full).replaceAll("\\", "/"));
    }
  }
}
const exactAsset = (category, displayName) => {
  const prefix = `assets/${assetCategory[category]}/`;
  return assetFiles.find((file) =>
    file.startsWith(prefix) && path.parse(file).name === displayName
  ) ?? null;
};
const makeCard = ({
  cardId, displayName, category, color, count, sourceFile, legacyId = null,
  assetDisplayName = displayName
}) => ({
  cardId,
  displayName,
  category,
  color,
  initialDeckCount: count,
  legacyId,
  resourceKey: `card.${cardId}`,
  assetPath: exactAsset(category, resourceMapping.displayNameOverrides[`card.${cardId}`] ?? assetDisplayName),
  fallbackResourceKey: `placeholder.${category}`,
  rulesetVersion: version,
  ruleSource: sourceFile,
  effectEncodingStatus: "encoded_in_category_rule_pack"
});

const cards = [];
const basicSpecs = [
  ["kill", "杀", ["白", "绿", "蓝", "橙", "红"], 16],
  ["dodge", "闪", ["白", "绿", "蓝", "橙", "红"], 7],
  ["potion", "药水", ["白", "绿", "蓝", "橙", "红"], 2],
  ["horn", "号角", ["白", "绿", "蓝", "橙", "红"], 1],
  ["coin", "金币", ["白", "红"], 1]
];
for (const [kind, displayName, colors, count] of basicSpecs) {
  for (const colorZh of colors) {
    const color = colorMap[colorZh];
    const printedName = kind === "horn" && colorZh === "白" ? "号角" : `${displayName}-${colorZh}`;
    cards.push(makeCard({
      cardId: `basic.${kind}.${color}`,
      displayName,
      category: "basic",
      color,
      count,
      sourceFile: source.cards,
      legacyId: printedName,
      assetDisplayName: printedName
    }));
  }
}

const weaponRows = tableRows(weaponDoc).filter((row) => /^W-\d{2}$/.test(row[0]));
for (const row of weaponRows) {
  cards.push(makeCard({
    cardId: `weapon.${row[0].toLowerCase().replace("-", "")}`,
    displayName: row[1],
    category: "weapon",
    color: colorMap[row[2]],
    count: Number(row[3]),
    sourceFile: source.weapons,
    legacyId: row[0]
  }));
}

const armorRows = tableRows(cardDoc).filter((row) => /^A-\d{2}$/.test(row[0]));
for (const row of armorRows) {
  cards.push(makeCard({
    cardId: `armor.${row[0].toLowerCase().replace("-", "")}`,
    displayName: row[1],
    category: "armor",
    color: colorMap[row[2]],
    count: row[0] === "A-09" ? 0 : 1,
    sourceFile: source.cards,
    legacyId: row[0]
  }));
}

const talentRows = tableRows(cardDoc).filter(
  (row) => /^\d+$/.test(row[0]) && row[1].startsWith("`talent.")
);
for (const row of talentRows) {
  cards.push(makeCard({
    cardId: stripCode(row[1]),
    displayName: row[2],
    category: "talent",
    color: colorMap[row[3]],
    count: 2,
    sourceFile: source.cards
  }));
}

const mountRows = tableRows(cardDoc).filter((row) => /^M-\d{2}$/.test(row[0]));
for (const row of mountRows) {
  cards.push(makeCard({
    cardId: `mount.${row[0].toLowerCase().replace("-", "")}`,
    displayName: row[1],
    category: "mount",
    color: colorMap[row[2]],
    count: 1,
    sourceFile: source.cards,
    legacyId: row[0]
  }));
}

const statueRows = tableRows(cardDoc).filter(
  (row) => row[0]?.startsWith("`statue.") && row[0].endsWith(".*`")
);
for (const row of statueRows) {
  const family = stripCode(row[0]).replace(".*", "");
  for (const [colorZh, color] of Object.entries(colorMap)) {
    cards.push(makeCard({
      cardId: `${family}.${color}`,
      displayName: row[1],
      category: "statue",
      color,
      count: 1,
      sourceFile: source.cards,
      legacyId: `${row[1]}-${colorZh}`
    }));
  }
}

const specialRows = tableRows(cardDoc).filter((row) => /^SP-\d{2}$/.test(row[0]));
for (const row of specialRows) {
  cards.push(makeCard({
    cardId: `special.${row[0].toLowerCase().replace("-", "")}`,
    displayName: row[1],
    category: "special",
    color: colorMap[row[2]],
    count: Number(row[3]),
    sourceFile: source.cards,
    legacyId: row[0]
  }));
}

const bossRows = tableRows(bossDoc).filter((row) => /^B-\d{2}$/.test(row[0]));
for (const row of bossRows) {
  cards.push(makeCard({
    cardId: stripCode(row[1]),
    displayName: row[2],
    category: "boss",
    color: colorMap[row[3]],
    count: 1,
    sourceFile: source.bosses,
    legacyId: row[0]
  }));
}

const characterAssets = characters.map((item) => ({
  resourceKey: `character.${item.characterId}`,
  entityId: item.characterId,
  assetPath: exactAsset("character", item.displayName),
  fallbackResourceKey: "placeholder.character"
}));
const cardAssets = cards.map(({ resourceKey, cardId, assetPath, fallbackResourceKey }) => ({
  resourceKey,
  entityId: cardId,
  assetPath,
  fallbackResourceKey
}));
const deckTotal = cards.reduce((sum, item) => sum + item.initialDeckCount, 0);
const categoryTotals = Object.fromEntries(
  [...new Set(cards.map((item) => item.category))].map((category) => [
    category,
    cards.filter((item) => item.category === category)
      .reduce((sum, item) => sum + item.initialDeckCount, 0)
  ])
);
const assert = (condition, message) => {
  if (!condition) throw new Error(`ruleset validation failed: ${message}`);
};
assert(characters.length === 25, `expected 25 characters, got ${characters.length}`);
assert(new Set(characters.map((item) => item.characterId)).size === characters.length,
  "duplicate characterId");
assert(cards.length === 203, `expected 203 card templates, got ${cards.length}`);
assert(new Set(cards.map((item) => item.cardId)).size === cards.length, "duplicate cardId");
assert(deckTotal === 337, `expected deck total 337, got ${deckTotal}`);
for (const [category, expected] of Object.entries({
  basic: 132, weapon: 61, armor: 8, talent: 50,
  mount: 11, statue: 50, special: 16, boss: 9
})) {
  assert(categoryTotals[category] === expected,
    `expected ${category} total ${expected}, got ${categoryTotals[category]}`);
}
const resourceKeys = [...characterAssets, ...cardAssets].map((item) => item.resourceKey);
assert(new Set(resourceKeys).size === resourceKeys.length, "duplicate resourceKey");

writeJson("manifest.json", {
  rulesetId: "skb.v1.3.4",
  version,
  status: "frozen_baseline",
  generatedBy: "tools/build-ruleset.mjs",
  sources: source,
  files: {
    settings: "settings.json",
    characters: "characters.json",
    cards: "cards.json",
    deck: "deck.json",
    resources: "resources.json",
    resourceMapping: "resource-mapping.json",
    ontology: "ontology.json",
    dslSchema: "dsl.schema.json",
    coreRules: "core-rules.json",
    dslExamples: "dsl-examples.json",
    generalRules: "general-rules.json",
    characterRules: "character-rules.json",
    weaponRules: "weapon-rules.json",
  nonbossRules: "nonboss-rules.json",
    bossRules: "boss-rules.json",
    eventProduction: "event-production.json",
    pipelineGraph: "pipeline-graph.json",
    freeze: "freeze.json"
  }
});
writeJson("settings.json", settingsConfig);
writeJson("characters.json", { rulesetVersion: version, items: characters });
writeJson("cards.json", { rulesetVersion: version, items: cards });
writeJson("deck.json", {
  rulesetVersion: version,
  totalCount: deckTotal,
  categoryTotals,
  entries: cards.filter((item) => item.initialDeckCount > 0)
    .map(({ cardId, initialDeckCount }) => ({ cardId, count: initialDeckCount }))
});
writeJson("resources.json", {
  rulesetVersion: version,
  fallbackPolicy: resourceMapping.fallbackPolicy,
  items: [...characterAssets, ...cardAssets],
  inventory: assetFiles
});

console.log(JSON.stringify({
  characters: characters.length,
  cardTemplates: cards.length,
  deckTotal,
  categoryTotals,
  resources: characterAssets.length + cardAssets.length,
  missingSpecificAssets: [...characterAssets, ...cardAssets].filter((item) => !item.assetPath).length
}, null, 2));
