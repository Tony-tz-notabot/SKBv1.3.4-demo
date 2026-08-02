import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketClient, type SocketLike } from "./WebSocketClient";
import { buildRoomCommand } from "../protocol/commandBuilders";

class FakeSocket implements SocketLike {
  readyState = 0; onopen: (() => void) | null = null; onmessage: ((event: { data: string }) => void) | null = null; onclose: (() => void) | null = null; onerror: (() => void) | null = null;
  sent: string[] = [];
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }); }
}

describe("WebSocketClient", () => {
  beforeEach(() => vi.useFakeTimers());
  it("queues offline command and sends it after connection", () => {
    const sockets: FakeSocket[] = [];
    const client = new WebSocketClient({ url: "ws://test", socketFactory: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; }, onMessage: vi.fn() });
    const command = buildRoomCommand("JOIN_ROOM", { roomCode: "7KQ9MT", password: null, asSpectator: false }, {}, () => "cmd_1");
    client.send(command); client.connect(); sockets[0]!.open();
    expect(JSON.parse(sockets[0]!.sent[0]!).command.commandId).toBe("cmd_1");
    expect(client.pendingCount).toBe(1);
  });
  it("resends the same command id after reconnect and removes only on acknowledge", () => {
    const sockets: FakeSocket[] = [];
    const client = new WebSocketClient({ url: "ws://test", socketFactory: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; }, reconnectBaseMs: 100, random: () => 0.5, onMessage: vi.fn() });
    client.connect(); sockets[0]!.open();
    client.send(buildRoomCommand("SET_READY", { ready: true }, { roomId: "r1", expectedRoomRevision: 2 }, () => "stable_id"));
    sockets[0]!.close(); vi.advanceTimersByTime(100); sockets[1]!.open();
    expect(JSON.parse(sockets[1]!.sent[0]!).command.commandId).toBe("stable_id");
    client.acknowledge("stable_id"); expect(client.pendingCount).toBe(0);
  });
  it("sends heartbeat and reports pong latency", () => {
    const socket = new FakeSocket(); const latency = vi.fn();
    const client = new WebSocketClient({ url: "ws://test", socketFactory: () => socket, heartbeatMs: 100, heartbeatTimeoutMs: 50, now: () => 1000, onLatency: latency, onMessage: vi.fn() });
    client.connect(); socket.open(); vi.advanceTimersByTime(100);
    expect(JSON.parse(socket.sent[0]!).type).toBe("PING"); socket.receive({ type: "PONG", sentAt: 990, serverTime: 1000 }); expect(latency).toHaveBeenCalledWith(10);
  });
  it("does not reconnect after manual disconnect", () => {
    const factory = vi.fn(() => new FakeSocket());
    const client = new WebSocketClient({ url: "ws://test", socketFactory: factory, reconnectBaseMs: 10, onMessage: vi.fn() });
    client.connect(); client.disconnect(); vi.advanceTimersByTime(1000); expect(factory).toHaveBeenCalledTimes(1); expect(client.connectionState).toBe("offline");
  });
});
