import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const load = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const clientSchema = load("protocol/v1.3.4/client-protocol.schema.json");
const roomSchema = load("protocol/v1.3.4/room-protocol.schema.json");
const suites = [
  { name: "client", schema: clientSchema, examples: load("protocol/v1.3.4/examples/client-protocol.examples.json") },
  { name: "room", schema: roomSchema, examples: load("protocol/v1.3.4/examples/room-protocol.examples.json") }
];

const typeMatches = (type, value) => {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
};

const validateNode = (schemaRoot, node, value, at = "$") => {
  if (node.$ref) return validateNode(schemaRoot, schemaRoot.$defs[node.$ref.split("/").at(-1)], value, at);
  if (node.const !== undefined && value !== node.const) return [`${at}: expected constant ${JSON.stringify(node.const)}`];
  if (node.enum && !node.enum.some((item) => Object.is(item, value))) return [`${at}: value is not in enum`];
  if (node.anyOf || node.oneOf) {
    const branches = node.anyOf ?? node.oneOf;
    const results = branches.map((branch) => validateNode(schemaRoot, branch, value, at));
    const matches = results.filter((errors) => errors.length === 0).length;
    if (node.oneOf && matches !== 1) return [`${at}: expected exactly one matching schema, found ${matches}`];
    if (node.anyOf && matches === 0) return [`${at}: expected at least one matching schema`];
    return [];
  }
  if (node.type) {
    const types = Array.isArray(node.type) ? node.type : [node.type];
    if (!types.some((type) => typeMatches(type, value))) return [`${at}: expected type ${types.join("|")}`];
  }
  const errors = [];
  if (typeof value === "string") {
    if (node.minLength !== undefined && value.length < node.minLength) errors.push(`${at}: shorter than minLength`);
    if (node.maxLength !== undefined && value.length > node.maxLength) errors.push(`${at}: longer than maxLength`);
    if (node.pattern && !new RegExp(node.pattern).test(value)) errors.push(`${at}: pattern mismatch`);
  }
  if (typeof value === "number") {
    if (node.minimum !== undefined && value < node.minimum) errors.push(`${at}: below minimum`);
    if (node.maximum !== undefined && value > node.maximum) errors.push(`${at}: above maximum`);
  }
  if (Array.isArray(value)) {
    if (node.minItems !== undefined && value.length < node.minItems) errors.push(`${at}: fewer than minItems`);
    if (node.maxItems !== undefined && value.length > node.maxItems) errors.push(`${at}: more than maxItems`);
    if (node.items) value.forEach((item, index) => errors.push(...validateNode(schemaRoot, node.items, item, `${at}[${index}]`)));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const key of node.required ?? []) if (!(key in value)) errors.push(`${at}.${key}: required`);
    const properties = node.properties ?? {};
    for (const [key, item] of Object.entries(value)) {
      if (properties[key]) errors.push(...validateNode(schemaRoot, properties[key], item, `${at}.${key}`));
      else if (node.additionalProperties === false) errors.push(`${at}.${key}: additional property`);
      else if (node.additionalProperties && typeof node.additionalProperties === "object") errors.push(...validateNode(schemaRoot, node.additionalProperties, item, `${at}.${key}`));
    }
  }
  return errors;
};

const validateMappedPayload = (schema, definitionName, discriminator, value) => {
  const definition = schema.$defs[definitionName];
  const payloadName = definition["x-commandPayloadMap"]?.[discriminator] ?? definition["x-eventPayloadMap"]?.[discriminator];
  return payloadName ? validateNode(schema, schema.$defs[payloadName], value, "$.payload") : [`$: missing payload map for ${discriminator}`];
};

const semanticClient = (message) => {
  const errors = [];
  if (message.type === "GAME_COMMAND") {
    errors.push(...validateMappedPayload(clientSchema, "GameCommand", message.command, message.payload));
    if (message.command === "EXECUTE_OFFER" && (!message.promptId || !message.offerId)) errors.push("$: EXECUTE_OFFER requires promptId and offerId");
    if (message.command !== "EXECUTE_OFFER" && (message.promptId || message.offerId)) errors.push("$: non-offer command cannot bind promptId or offerId");
  }
  if (message.type === "PRESENTATION_EVENT") errors.push(...validateMappedPayload(clientSchema, "PresentationEvent", message.eventType, message.payload));
  if (message.type === "GAME_SNAPSHOT") {
    const seats = message.publicView.players.map((player) => player.seat);
    if (new Set(seats).size !== seats.length) errors.push("$: duplicate player seat");
    for (const ref of message.privateView.concealedChoices) if (!ref.startsWith("concealed:")) errors.push("$: concealed choice must use concealed scope");
  }
  if (message.type === "SETUP_SNAPSHOT") {
    const seats = message.seats.map((entry) => entry.seat);
    if (new Set(seats).size !== 4) errors.push("$: setup seats must be complete and unique");
    if (message.viewer.seat === null && message.hand.length) errors.push("$: spectator cannot receive setup hand");
    for (const card of message.hand) if (!card.ref.startsWith("private:")) errors.push("$: setup hand must use private scope");
    for (const card of message.discardPile) if (!card.ref.startsWith("public:")) errors.push("$: setup discard must use public scope");
    if (message.viewer.seat === null && message.interaction.offers.length) errors.push("$: spectator cannot receive setup offer");
  }
  return errors;
};

const semanticRoom = (message) => {
  const errors = [];
  if (message.type === "ROOM_COMMAND") {
    errors.push(...validateMappedPayload(roomSchema, "RoomCommand", message.command, message.payload));
    const preJoin = message.command === "CREATE_ROOM" || message.command === "JOIN_ROOM";
    if (!preJoin && (!message.roomId || message.expectedRoomRevision === null || message.expectedRoomRevision === undefined)) errors.push("$: joined-room command requires roomId and expectedRoomRevision");
  }
  if (message.type === "ROOM_SNAPSHOT") {
    const seats = message.players.map((player) => player.seat);
    const users = message.players.map((player) => player.userId);
    if (new Set(seats).size !== seats.length) errors.push("$: duplicate player seat");
    if (new Set(users).size !== users.length) errors.push("$: duplicate room user");
    if (message.players.filter((player) => player.isHost).length !== 1) errors.push("$: room must have exactly one host");
    for (const player of message.players) {
      const expectedTeam = player.seat === 1 || player.seat === 4 ? "A" : "B";
      if (player.team !== expectedTeam) errors.push(`$: seat ${player.seat} must belong to team ${expectedTeam}`);
      if (player.selectionState === "revealed" ? !player.revealedCharacterId : Boolean(player.revealedCharacterId)) errors.push(`$: invalid revealed character visibility for seat ${player.seat}`);
    }
    const viewer = message.players.find((player) => player.userId === message.viewerUserId);
    if (message.viewerSeat !== null && (!viewer || viewer.seat !== message.viewerSeat)) errors.push("$: viewerSeat does not match viewerUserId");
    if (message.characterSelection) {
      if (!viewer) errors.push("$: spectator cannot receive private character selection");
      const ids = message.characterSelection.candidates.map((candidate) => candidate.characterId);
      if (new Set(ids).size !== ids.length) errors.push("$: duplicate private character candidate");
      for (const selected of [message.characterSelection.preselectedCharacterId, message.characterSelection.lockedCharacterId]) if (selected !== null && !ids.includes(selected)) errors.push("$: selected character is outside private candidates");
    }
  }
  return errors;
};

let total = 0;
let expectedInvalid = 0;
for (const suite of suites) {
  for (const testCase of suite.examples.cases) {
    total += 1;
    if (!testCase.valid) expectedInvalid += 1;
    const errors = [...validateNode(suite.schema, suite.schema, testCase.message), ...(suite.name === "client" ? semanticClient(testCase.message) : semanticRoom(testCase.message))];
    const actualValid = errors.length === 0;
    if (actualValid !== testCase.valid) throw new Error(`${suite.name} example '${testCase.name}' expected valid=${testCase.valid}, errors=${errors.join("; ") || "none"}`);
  }
}
console.log(JSON.stringify({ suites: suites.length, examples: total, expectedValid: total - expectedInvalid, expectedInvalid, result: "ok" }, null, 2));
