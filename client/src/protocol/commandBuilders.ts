import type {
  EmptyPayload, CreateRoomPayload, JoinRoomPayload, SetReadyPayload, ChangeSeatPayload, UpdateRoomSettingsPayload,
  TargetUserPayload, PreselectCharacterPayload, LockCharacterPayload, RoomSendChatPayload, RoomCommand
} from "@skb-protocol/room-protocol";
import type { ExecuteOfferPayload, SetPreselectionPayload, SendChatPayload, GameCommand } from "@skb-protocol/client-protocol";

type RoomPayloadMap = {
  CREATE_ROOM: CreateRoomPayload; JOIN_ROOM: JoinRoomPayload; LEAVE_ROOM: EmptyPayload; SET_READY: SetReadyPayload;
  CHANGE_SEAT: ChangeSeatPayload; UPDATE_ROOM_SETTINGS: UpdateRoomSettingsPayload; KICK_PLAYER: TargetUserPayload;
  TRANSFER_HOST: TargetUserPayload; START_GAME: EmptyPayload; CLOSE_ROOM: EmptyPayload; DISBAND_ROOM: EmptyPayload;
  PRESELECT_CHARACTER: PreselectCharacterPayload; LOCK_CHARACTER: LockCharacterPayload; SEND_CHAT: RoomSendChatPayload;
};
type GamePayloadMap = { EXECUTE_OFFER: ExecuteOfferPayload; SET_PRESELECTION: SetPreselectionPayload; SEND_CHAT: SendChatPayload; FORFEIT: Record<string, never> };

export type CommandIdFactory = () => string;
export const randomCommandId: CommandIdFactory = () => crypto.randomUUID();

export function buildRoomCommand<K extends keyof RoomPayloadMap>(
  command: K, payload: RoomPayloadMap[K], context: { roomId?: string | null; expectedRoomRevision?: number | null } = {}, id: CommandIdFactory = randomCommandId
): RoomCommand {
  const beforeJoin = command === "CREATE_ROOM" || command === "JOIN_ROOM";
  if (!beforeJoin && (!context.roomId || context.expectedRoomRevision == null)) throw new Error(`${command} requires roomId and expectedRoomRevision`);
  return { type: "ROOM_COMMAND", commandId: id(), roomId: context.roomId ?? null, expectedRoomRevision: context.expectedRoomRevision ?? null, command, payload } as RoomCommand;
}

export function buildGameCommand<K extends keyof GamePayloadMap>(
  command: K, payload: GamePayloadMap[K], context: { gameId: string; expectedStateRevision: number; promptId?: string | null; offerId?: string | null }, id: CommandIdFactory = randomCommandId
): GameCommand {
  if (command === "EXECUTE_OFFER" && (!context.promptId || !context.offerId)) throw new Error("EXECUTE_OFFER requires promptId and offerId");
  if (command !== "EXECUTE_OFFER" && (context.promptId || context.offerId)) throw new Error(`${command} cannot bind promptId or offerId`);
  return { type: "GAME_COMMAND", commandId: id(), gameId: context.gameId, expectedStateRevision: context.expectedStateRevision, promptId: context.promptId ?? null, offerId: context.offerId ?? null, command, payload } as GameCommand;
}
