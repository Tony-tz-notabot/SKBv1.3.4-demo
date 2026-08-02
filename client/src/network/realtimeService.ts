import type { GameCommand } from "@skb-protocol/client-protocol";
import type { RoomCommand } from "@skb-protocol/room-protocol";
import { createProtocolGateway } from "../protocol/gateway";
import { useConnectionStore } from "../stores/connection";
import { useServerProjectionStore } from "../stores/serverProjection";
import { useCommandFeedbackStore } from "../stores/commandFeedback";
import { WebSocketClient } from "./WebSocketClient";

const commandResultId = (message: unknown) => {
  if (!message || typeof message !== "object") return null;
  const candidate = message as { type?: unknown; commandId?: unknown };
  return typeof candidate.commandId === "string" && ["COMMAND_ACCEPTED", "COMMAND_REJECTED", "ROOM_COMMAND_ACCEPTED", "ROOM_COMMAND_REJECTED"].includes(String(candidate.type)) ? candidate.commandId : null;
};

export function createRealtimeService(url: string) {
  const projection = useServerProjectionStore();
  const connection = useConnectionStore();
  const feedback = useCommandFeedbackStore();
  let client: WebSocketClient;
  const gateway = createProtocolGateway(
    { send: (command) => { client.send(command); connection.setPendingCommands(client.pendingCount); } },
    {
      onGameMessage: projection.acceptGameMessage,
      onRoomMessage: projection.acceptRoomMessage,
      onProtocolError: (_kind, errors) => projection.reportProtocolError(errors)
    }
  );
  client = new WebSocketClient({
    url,
    onState: connection.setState,
    onLatency: connection.setLatency,
    onMessage: (channel, message) => {
      gateway.receive(channel, message);
      const commandId = commandResultId(message);
      if (commandId) {
        client.acknowledge(commandId); connection.setPendingCommands(client.pendingCount);
        const result = message as { type: string; commandId: string; reasonCode?: string; messageKey?: string; refreshRequired?: boolean };
        if (result.type.endsWith("REJECTED")) feedback.rejected({ commandId, reasonCode: result.reasonCode ?? "UNKNOWN", messageKey: result.messageKey ?? "command.unknown", refreshRequired: Boolean(result.refreshRequired) }); else feedback.accepted(commandId);
      }
    }
  });
  return {
    connect: () => client.connect(),
    disconnect: () => client.disconnect(),
    sendRoomCommand: (command: RoomCommand) => gateway.sendRoomCommand(command),
    sendGameCommand: (command: GameCommand) => gateway.sendGameCommand(command)
  };
}
