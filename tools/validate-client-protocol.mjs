import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const schemaPath = path.join(root, "protocol", "v1.3.4", "client-protocol.schema.json");
const outputPath = path.join(root, "shared", "src", "generated", "client-protocol.ts");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const fail = (message) => { throw new Error(`client protocol validation failed: ${message}`); };
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
const before = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : null;
const result = spawnSync(process.execPath, [path.join(import.meta.dirname, "build-client-protocol.mjs")], { cwd: root, encoding: "utf8" });
if (result.status !== 0) fail(result.stderr || "generator failed");
const after = fs.readFileSync(outputPath, "utf8");
if (before !== null && before !== after) fail("generated TypeScript was stale; regenerated it, rerun validation");
const requiredDefs = ["SetupSnapshot", "SetupCardView", "SetupSeatState", "GameSnapshot", "GameCommand", "CommandAccepted", "CommandRejected", "PresentationEvent", "InteractionOffer", "CardView", "PlayerView"];
for (const name of requiredDefs) if (!schema.$defs[name]) fail(`missing definition ${name}`);
const eventNames = schema.$defs.PresentationEvent.properties.eventType.enum;
const eventPayloadMap = schema.$defs.PresentationEvent["x-eventPayloadMap"];
if (eventNames.length !== 32 || Object.keys(eventPayloadMap).length !== eventNames.length) fail("event payload map coverage");
for (const eventName of eventNames) if (!schema.$defs[eventPayloadMap[eventName]]) fail(`event payload missing ${eventName}`);
const commandNames = schema.$defs.GameCommand.properties.command.enum;
const commandPayloadMap = schema.$defs.GameCommand["x-commandPayloadMap"];
if (Object.keys(commandPayloadMap).length !== commandNames.length) fail("command payload map coverage");
for (const commandName of commandNames) if (!schema.$defs[commandPayloadMap[commandName]]) fail(`command payload missing ${commandName}`);
console.log(JSON.stringify({ schemaDefinitions: Object.keys(schema.$defs).length, refs: refs.length, generatedTypeScript: true, result: "ok" }, null, 2));
