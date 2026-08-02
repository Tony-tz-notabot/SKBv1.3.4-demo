import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const schemaPath = path.join(root, "protocol", "v1.3.4", "room-protocol.schema.json");
const outputPath = path.join(root, "shared", "src", "generated", "room-protocol.ts");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const fail = (message) => { throw new Error(`room protocol validation failed: ${message}`); };
const refs = [];
const walk = (value) => {
  if (Array.isArray(value)) return value.forEach(walk);
  if (!value || typeof value !== "object") return;
  if (value.$ref) refs.push(value.$ref);
  Object.values(value).forEach(walk);
};
walk(schema);
for (const ref of refs) {
  const name = ref.split("/").at(-1);
  if (!ref.startsWith("#/$defs/") || !schema.$defs[name]) fail(`unresolved ref ${ref}`);
}
const requiredDefs = ["LobbySnapshot", "RoomPreview", "RoomSnapshot", "RoomCommand", "RoomCommandAccepted", "RoomCommandRejected", "PrivateCharacterSelection"];
for (const name of requiredDefs) if (!schema.$defs[name]) fail(`missing definition ${name}`);
const commands = schema.$defs.RoomCommand.properties.command.enum;
const payloadMap = schema.$defs.RoomCommand["x-commandPayloadMap"];
if (Object.keys(payloadMap).length !== commands.length) fail("command payload map coverage");
for (const command of commands) if (!schema.$defs[payloadMap[command]]) fail(`command payload missing ${command}`);
const roomCodePattern = new RegExp(schema.$defs.RoomCode.pattern);
if (!roomCodePattern.test("7KQ9MT") || roomCodePattern.test("0O1ILA")) fail("room code pattern");
const before = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : null;
const result = spawnSync(process.execPath, [path.join(import.meta.dirname, "build-room-protocol.mjs")], { cwd: root, encoding: "utf8" });
if (result.status !== 0) fail(result.stderr || "generator failed");
const after = fs.readFileSync(outputPath, "utf8");
if (before !== null && before !== after) fail("generated TypeScript was stale; regenerated it, rerun validation");
console.log(JSON.stringify({ schemaDefinitions: Object.keys(schema.$defs).length, refs: refs.length, commands: commands.length, generatedTypeScript: true, result: "ok" }, null, 2));
