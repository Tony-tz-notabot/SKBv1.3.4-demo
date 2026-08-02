import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RulesetLoadError } from "./errors.js";
import { loadFrozenRuleset } from "./loadRuleset.js";

const sourceRuleset = resolve(import.meta.dirname, "../../../rulesets/v1.3.4");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function copyRuleset(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), "skb-ruleset-"));
  temporaryDirectories.push(directory);
  await cp(sourceRuleset, directory, { recursive: true });
  return directory;
}

describe("loadFrozenRuleset", () => {
  it("loads the exact frozen v1.3.4 package", async () => {
    const ruleset = await loadFrozenRuleset(sourceRuleset);
    expect(ruleset.manifest.status).toBe("frozen_baseline");
    expect(ruleset.documents.size).toBe(17);
    expect(ruleset.settings.defaultAttackCount).toBe(1);
    expect(ruleset.settings.setup).toMatchObject({ initialHandCount: 4, redraw: { drawCount: 4, discardAll: true, maxUsesPerPlayer: 1 } });
    expect(ruleset.settings.boss.allowGenericDismantle).toBe(true);
  });

  it("rejects a modified frozen document", async () => {
    const directory = await copyRuleset();
    const settingsPath = resolve(directory, "settings.json");
    const source = await readFile(settingsPath, "utf8");
    await writeFile(settingsPath, source.replace('"defaultAttackCount": 1', '"defaultAttackCount": 2'));
    await expect(loadFrozenRuleset(directory)).rejects.toMatchObject({ code: "HASH_MISMATCH" } satisfies Partial<RulesetLoadError>);
  });

  it("rejects a non-frozen manifest", async () => {
    const directory = await copyRuleset();
    const manifestPath = resolve(directory, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.status = "draft";
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(loadFrozenRuleset(directory)).rejects.toMatchObject({ code: "INVALID_MANIFEST" } satisfies Partial<RulesetLoadError>);
  });
});
