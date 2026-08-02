import type { ClientProtocolMessage, GameCommand } from "@skb-protocol/client-protocol";
import type { RoomCommand, RoomProtocolMessage } from "@skb-protocol/room-protocol";
import { validateProtocolMessage, type ProtocolKind } from "./validation";

export interface ProtocolTransport {
  send(message: GameCommand | RoomCommand): void;
}

export type ProtocolHandlers = {
  onGameMessage(message: ClientProtocolMessage): void;
  onRoomMessage(message: RoomProtocolMessage): void;
  onProtocolError(kind: ProtocolKind, errors: readonly string[]): void;
};

export function createProtocolGateway(transport: ProtocolTransport, handlers: ProtocolHandlers) {
  return {
    receive(kind: ProtocolKind, input: unknown) {
      const result = kind === "game" ? validateProtocolMessage("game", input) : validateProtocolMessage("room", input);
      if (!result.ok) return handlers.onProtocolError(kind, result.errors);
      if (kind === "game") handlers.onGameMessage(result.value as ClientProtocolMessage);
      else handlers.onRoomMessage(result.value as RoomProtocolMessage);
    },
    sendGameCommand(command: GameCommand) { transport.send(command); },
    sendRoomCommand(command: RoomCommand) { transport.send(command); }
  };
}
