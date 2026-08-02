import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import clientSchema from "../../../protocol/v1.3.4/client-protocol.schema.json";
import roomSchema from "../../../protocol/v1.3.4/room-protocol.schema.json";
import type { ClientProtocolMessage, GameCommand, PresentationEvent } from "@skb-protocol/client-protocol";
import type { RoomCommand, RoomProtocolMessage, RoomSnapshot } from "@skb-protocol/room-protocol";

export type ProtocolKind = "game" | "room";
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validators: Record<ProtocolKind, ValidateFunction> = {
  game: ajv.compile(clientSchema),
  room: ajv.compile(roomSchema)
};

const describeErrors = (errors: ErrorObject[] | null | undefined) =>
  (errors ?? []).map((error) => `${error.instancePath || "$"} ${error.message ?? "协议错误"}`);

const validateMappedPayload = (schema: typeof clientSchema | typeof roomSchema, definitionName: "GameCommand" | "PresentationEvent" | "RoomCommand", discriminator: string, payload: unknown) => {
  const definitions = schema.$defs as unknown as Record<string, Record<string, Record<string, string>>>;
  const definition = definitions[definitionName];
  if (!definition) return [`缺少${definitionName}定义`];
  const map = definition["x-commandPayloadMap"] ?? definition["x-eventPayloadMap"];
  const payloadDefinition = map?.[discriminator];
  if (!payloadDefinition) return [`缺少${discriminator}的载荷映射`];
  const validate = ajv.compile({ $ref: `${schema.$id}#/$defs/${payloadDefinition}` });
  return validate(payload) ? [] : describeErrors(validate.errors);
};

const gameSemantics = (message: ClientProtocolMessage): string[] => {
  if (message.type === "GAME_COMMAND") {
    const command = message as GameCommand;
    const errors = validateMappedPayload(clientSchema, "GameCommand", command.command, command.payload);
    if (command.command === "EXECUTE_OFFER" && (!command.promptId || !command.offerId)) errors.push("EXECUTE_OFFER必须绑定promptId和offerId");
    if (command.command !== "EXECUTE_OFFER" && (command.promptId || command.offerId)) errors.push("非报价命令不得绑定promptId或offerId");
    return errors;
  }
  if (message.type === "PRESENTATION_EVENT") {
    const event = message as PresentationEvent;
    return validateMappedPayload(clientSchema, "PresentationEvent", event.eventType, event.payload);
  }
  if (message.type === "GAME_SNAPSHOT") {
    const seats = message.publicView.players.map((player) => player.seat);
    const errors = new Set(seats).size === seats.length ? [] : ["对局快照存在重复座位"];
    if (message.privateView.concealedChoices.some((ref) => !ref.startsWith("concealed:"))) errors.push("隐藏候选必须使用concealed引用");
    return errors;
  }
  if (message.type === "SETUP_SNAPSHOT") {
    const seats = message.seats.map((entry) => entry.seat);
    const errors = new Set(seats).size === 4 ? [] : ["开局快照座位必须完整且唯一"];
    if (message.viewer.seat === null && message.hand.length) errors.push("观战者不得收到开局私有手牌");
    if (message.hand.some((card) => !card.ref.startsWith("private:"))) errors.push("开局手牌必须使用private引用");
    if (message.discardPile.some((card) => !card.ref.startsWith("public:"))) errors.push("开局弃牌必须使用public引用");
    if (message.interaction.offers.length && message.viewer.seat === null) errors.push("观战者不得收到开局报价");
    return errors;
  }
  return [];
};

const roomSemantics = (message: RoomProtocolMessage): string[] => {
  if (message.type === "ROOM_COMMAND") {
    const command = message as RoomCommand;
    const errors = validateMappedPayload(roomSchema, "RoomCommand", command.command, command.payload);
    const beforeJoin = command.command === "CREATE_ROOM" || command.command === "JOIN_ROOM";
    if (!beforeJoin && (!command.roomId || command.expectedRoomRevision === null || command.expectedRoomRevision === undefined)) errors.push("房间内命令必须绑定roomId和expectedRoomRevision");
    return errors;
  }
  if (message.type !== "ROOM_SNAPSHOT") return [];
  const snapshot = message as RoomSnapshot;
  const errors: string[] = [];
  const seats = snapshot.players.map((player) => player.seat);
  const users = snapshot.players.map((player) => player.userId);
  if (new Set(seats).size !== seats.length) errors.push("房间快照存在重复座位");
  if (new Set(users).size !== users.length) errors.push("房间快照存在重复用户");
  if (snapshot.players.filter((player) => player.isHost).length !== 1) errors.push("房间必须且只能有一名房主");
  for (const player of snapshot.players) {
    const expectedTeam = player.seat === 1 || player.seat === 4 ? "A" : "B";
    if (player.team !== expectedTeam) errors.push(`${player.seat}号座位队伍错误`);
    if (player.selectionState === "revealed" ? !player.revealedCharacterId : Boolean(player.revealedCharacterId)) errors.push(`${player.seat}号角色公开状态错误`);
  }
  const viewer = snapshot.players.find((player) => player.userId === snapshot.viewerUserId);
  if (snapshot.viewerSeat !== null && viewer?.seat !== snapshot.viewerSeat) errors.push("观看者座位与用户不一致");
  if (snapshot.characterSelection) {
    if (!viewer) errors.push("观战者不得收到私密角色候选");
    const candidates = snapshot.characterSelection.candidates.map((candidate) => candidate.characterId);
    for (const selected of [snapshot.characterSelection.preselectedCharacterId, snapshot.characterSelection.lockedCharacterId]) if (selected !== null && !candidates.includes(selected)) errors.push("选中角色不在私密候选内");
  }
  return errors;
};

export function validateProtocolMessage(kind: "game", input: unknown): ValidationResult<ClientProtocolMessage>;
export function validateProtocolMessage(kind: "room", input: unknown): ValidationResult<RoomProtocolMessage>;
export function validateProtocolMessage(kind: ProtocolKind, input: unknown): ValidationResult<ClientProtocolMessage | RoomProtocolMessage> {
  const validate = validators[kind];
  if (!validate(input)) return { ok: false, errors: describeErrors(validate.errors) };
  const value = input as ClientProtocolMessage | RoomProtocolMessage;
  const semanticErrors = kind === "game" ? gameSemantics(value as ClientProtocolMessage) : roomSemantics(value as RoomProtocolMessage);
  return semanticErrors.length ? { ok: false, errors: semanticErrors } : { ok: true, value };
}
