import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { RulesetLoadError } from "./errors.js";
import type { LoadedRuleset, RulesetFreeze, RulesetManifest, RulesetSettings } from "./types.js";

async function readJson<T>(path: string): Promise<T> {
  let source: string;
  try { source = await readFile(path, "utf8"); }
  catch { throw new RulesetLoadError("FILE_MISSING", `规则包文件不存在：${path}`); }
  try { return JSON.parse(source) as T; }
  catch { throw new RulesetLoadError("INVALID_JSON", `规则包文件不是有效JSON：${path}`); }
}

function assertFrozen(manifest: RulesetManifest, freeze: RulesetFreeze, expectedVersion: string): void {
  if (manifest.status !== "frozen_baseline" || freeze.status !== "frozen_baseline" || manifest.version !== expectedVersion || freeze.version !== expectedVersion || manifest.rulesetId !== freeze.rulesetId) {
    throw new RulesetLoadError("INVALID_MANIFEST", `规则包身份、版本或冻结状态不符合要求：${expectedVersion}`);
  }
  if (freeze.hashAlgorithm !== "sha256") throw new RulesetLoadError("INVALID_MANIFEST", "冻结清单只允许sha256");
}

export async function loadFrozenRuleset(directory: string, expectedVersion = "1.3.4"): Promise<LoadedRuleset> {
  const root = resolve(directory);
  const manifest = await readJson<RulesetManifest>(resolve(root, "manifest.json"));
  const freeze = await readJson<RulesetFreeze>(resolve(root, "freeze.json"));
  assertFrozen(manifest, freeze, expectedVersion);

  const expectedFiles = new Set(freeze.files.map((entry) => entry.filename));
  const actualFrozenFiles = new Set((await readdir(root)).filter((name) => expectedFiles.has(name)));
  if (actualFrozenFiles.size !== expectedFiles.size || [...expectedFiles].some((name) => !actualFrozenFiles.has(name))) {
    throw new RulesetLoadError("FREEZE_SET_MISMATCH", "冻结文件集合不完整");
  }

  const documents = new Map<string, unknown>();
  for (const entry of freeze.files) {
    const path = resolve(root, entry.filename);
    let bytes: Buffer;
    try { bytes = await readFile(path); }
    catch { throw new RulesetLoadError("FILE_MISSING", `冻结文件不存在：${entry.filename}`); }
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== entry.sha256) throw new RulesetLoadError("HASH_MISMATCH", `冻结文件哈希不匹配：${entry.filename}`);
    try { documents.set(entry.filename, JSON.parse(bytes.toString("utf8")) as unknown); }
    catch { throw new RulesetLoadError("INVALID_JSON", `冻结文件不是有效JSON：${entry.filename}`); }
  }

  const settings = documents.get("settings.json") as RulesetSettings | undefined;
  if (!settings || settings.rulesetVersion !== expectedVersion || settings.players !== 4 || settings.turnDirection !== "counterclockwise") {
    throw new RulesetLoadError("INVALID_MANIFEST", "规则设置与引擎版本约束不一致");
  }
  const resources = documents.get("resources.json") as { items?: Array<{ resourceKey?: string; assetPath?: string | null }> } | undefined;
  const actualMissing = (resources?.items ?? []).filter((item) => !item.assetPath).map((item) => item.resourceKey).filter((key): key is string => !!key).sort();
  const allowedMissing = [...freeze.allowedMissingSpecificAssets].sort();
  if (JSON.stringify(actualMissing) !== JSON.stringify(allowedMissing)) {
    throw new RulesetLoadError("ASSET_WHITELIST_MISMATCH", `缺图白名单不一致：实际${actualMissing.length}项，冻结允许${allowedMissing.length}项`);
  }
  return Object.freeze({ directory: root, manifest: Object.freeze(manifest), freeze: Object.freeze(freeze), settings: Object.freeze(settings), documents });
}
