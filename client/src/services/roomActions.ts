import type { RoomCommand, RoomSettings } from "@skb-protocol/room-protocol";
import { buildRoomCommand } from "../protocol/commandBuilders";
import { useCommandFeedbackStore } from "../stores/commandFeedback";
import { useServerProjectionStore } from "../stores/serverProjection";

let sender: ((command: RoomCommand) => void) | null = null;
export const configureRoomCommandSender = (value: (command: RoomCommand) => void) => { sender = value; };
const dispatch = (command: RoomCommand) => { if (!sender) throw new Error("room command sender is not configured"); useCommandFeedbackStore().begin(command.commandId); sender(command); };
const context = () => { const snapshot = useServerProjectionStore().roomSnapshot; if (!snapshot) throw new Error("room snapshot required"); return { roomId: snapshot.roomId, expectedRoomRevision: snapshot.roomRevision }; };

export const roomActions = {
  create(settings: RoomSettings, password: string | null) { dispatch(buildRoomCommand("CREATE_ROOM", { settings, password })); },
  join(roomCode: string, password: string | null, asSpectator = false) { dispatch(buildRoomCommand("JOIN_ROOM", { roomCode: roomCode.toUpperCase(), password, asSpectator })); },
  leave() { dispatch(buildRoomCommand("LEAVE_ROOM", {}, context())); },
  setReady(ready: boolean) { dispatch(buildRoomCommand("SET_READY", { ready }, context())); },
  changeSeat(userId: string, seat: 1 | 2 | 3 | 4) { dispatch(buildRoomCommand("CHANGE_SEAT", { userId, seat }, context())); },
  updateSettings(settings: RoomSettings) { dispatch(buildRoomCommand("UPDATE_ROOM_SETTINGS", { settings }, context())); },
  kickPlayer(userId: string) { dispatch(buildRoomCommand("KICK_PLAYER", { userId }, context())); },
  transferHost(userId: string) { dispatch(buildRoomCommand("TRANSFER_HOST", { userId }, context())); },
  startGame() { dispatch(buildRoomCommand("START_GAME", {}, context())); },
  closeRoom() { dispatch(buildRoomCommand("CLOSE_ROOM", {}, context())); },
  preselectCharacter(characterId: string | null) { dispatch(buildRoomCommand("PRESELECT_CHARACTER", { characterId }, context())); },
  lockCharacter(characterId: string) { dispatch(buildRoomCommand("LOCK_CHARACTER", { characterId }, context())); },
  sendChat(channel: "all" | "team", text: string) { dispatch(buildRoomCommand("SEND_CHAT", { channel, clientMessageId: crypto.randomUUID(), text }, context())); }
};
