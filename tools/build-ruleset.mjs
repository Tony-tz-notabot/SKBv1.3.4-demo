import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const rulesetDir = path.join(root, "rulesets", "v1.3.4");
const builders = [
  "build-weapon-rules.mjs",
  "build-ruleset-data.mjs",
  "build-nonboss-rules.mjs",
  "build-boss-rules.mjs"
];

for (const builder of builders) {
  const result = spawnSync(process.execPath, [path.join(import.meta.dirname, builder)], {
    cwd: root,
    stdio: "inherit"
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(rulesetDir, "manifest.json"), "utf8"));
const resourceMapping = JSON.parse(fs.readFileSync(path.join(rulesetDir, "resource-mapping.json"), "utf8"));
const hash = (filename) => crypto.createHash("sha256")
  .update(fs.readFileSync(path.join(rulesetDir, filename)))
  .digest("hex");
const files = Object.values(manifest.files)
  .filter((filename) => filename !== "freeze.json")
  .sort()
  .map((filename) => ({ filename, sha256: hash(filename) }));
const freeze = {
  rulesetId: manifest.rulesetId,
  version: manifest.version,
  status: manifest.status,
  hashAlgorithm: "sha256",
  files,
  allowedMissingSpecificAssets: resourceMapping.allowedMissingSpecificAssets
};
fs.writeFileSync(path.join(rulesetDir, "freeze.json"), `${JSON.stringify(freeze, null, 2)}\n`);

const validation = spawnSync(process.execPath, [path.join(import.meta.dirname, "validate-ruleset.mjs")], {
  cwd: root,
  stdio: "inherit"
});
process.exit(validation.status ?? 1);
