import type { GameCommand } from "@skb-protocol/client-protocol";
import type { RoomCommand } from "@skb-protocol/room-protocol";

export type ConnectionState = "offline" | "connecting" | "online" | "reconnecting";
export type OutboundCommand = GameCommand | RoomCommand;
export type WireMessage =
  | { type: "MESSAGE"; channel: "game" | "room"; message: unknown }
  | { type: "COMMAND_RESULT"; channel: "game" | "room"; message: unknown }
  | { type: "PONG"; sentAt: number; serverTime: number };

export interface SocketLike {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface WebSocketClientOptions {
  url: string;
  socketFactory?: (url: string) => SocketLike;
  heartbeatMs?: number;
  heartbeatTimeoutMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  random?: () => number;
  now?: () => number;
  onState?: (state: ConnectionState) => void;
  onMessage: (channel: "game" | "room", message: unknown) => void;
  onLatency?: (latencyMs: number) => void;
}

const OPEN = 1;

export class WebSocketClient {
  private socket: SocketLike | null = null;
  private state: ConnectionState = "offline";
  private manuallyClosed = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatDeadline: ReturnType<typeof setTimeout> | null = null;
  private readonly pending = new Map<string, OutboundCommand>();
  private readonly socketFactory: (url: string) => SocketLike;
  private readonly heartbeatMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly random: () => number;
  private readonly now: () => number;

  constructor(private readonly options: WebSocketClientOptions) {
    this.socketFactory = options.socketFactory ?? ((url) => new WebSocket(url) as unknown as SocketLike);
    this.heartbeatMs = options.heartbeatMs ?? 15_000;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 8_000;
    this.reconnectBaseMs = options.reconnectBaseMs ?? 1_000;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 30_000;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
  }

  connect() {
    if (this.state === "connecting" || this.state === "online") return;
    this.manuallyClosed = false;
    this.setState(this.reconnectAttempt ? "reconnecting" : "connecting");
    const socket = this.socketFactory(this.options.url);
    this.socket = socket;
    socket.onopen = () => this.handleOpen(socket);
    socket.onmessage = (event) => this.handleMessage(event.data);
    socket.onerror = () => socket.close();
    socket.onclose = () => this.handleClose(socket);
  }

  disconnect() {
    this.manuallyClosed = true;
    this.clearTimers();
    this.socket?.close(1000, "client disconnect");
    this.socket = null;
    this.setState("offline");
  }

  send(command: OutboundCommand) {
    this.pending.set(command.commandId, command);
    this.sendWire({ type: "COMMAND", channel: command.type === "GAME_COMMAND" ? "game" : "room", command });
  }

  acknowledge(commandId: string) { this.pending.delete(commandId); }
  get pendingCount() { return this.pending.size; }
  get connectionState() { return this.state; }

  private handleOpen(socket: SocketLike) {
    if (socket !== this.socket) return;
    this.reconnectAttempt = 0;
    this.setState("online");
    this.startHeartbeat();
    for (const command of this.pending.values()) this.sendWire({ type: "COMMAND", channel: command.type === "GAME_COMMAND" ? "game" : "room", command });
  }

  private handleMessage(raw: string) {
    let wire: WireMessage;
    try { wire = JSON.parse(raw) as WireMessage; } catch { return; }
    if (wire.type === "PONG") {
      if (this.heartbeatDeadline) clearTimeout(this.heartbeatDeadline);
      this.heartbeatDeadline = null;
      this.options.onLatency?.(Math.max(0, this.now() - wire.sentAt));
      return;
    }
    if ((wire.type === "MESSAGE" || wire.type === "COMMAND_RESULT") && (wire.channel === "game" || wire.channel === "room")) this.options.onMessage(wire.channel, wire.message);
  }

  private handleClose(socket: SocketLike) {
    if (socket !== this.socket) return;
    this.socket = null;
    this.clearHeartbeat();
    if (this.manuallyClosed) return this.setState("offline");
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    this.reconnectAttempt += 1;
    this.setState("reconnecting");
    const ceiling = Math.min(this.reconnectMaxMs, this.reconnectBaseMs * 2 ** (this.reconnectAttempt - 1));
    const delay = Math.round(ceiling * (0.75 + this.random() * 0.5));
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect(); }, delay);
  }

  private startHeartbeat() {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const sentAt = this.now();
      this.sendWire({ type: "PING", sentAt });
      if (this.heartbeatDeadline) clearTimeout(this.heartbeatDeadline);
      this.heartbeatDeadline = setTimeout(() => this.socket?.close(4000, "heartbeat timeout"), this.heartbeatTimeoutMs);
    }, this.heartbeatMs);
  }

  private sendWire(message: unknown) {
    if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify(message));
  }
  private setState(state: ConnectionState) { if (this.state !== state) { this.state = state; this.options.onState?.(state); } }
  private clearHeartbeat() { if (this.heartbeatTimer) clearInterval(this.heartbeatTimer); if (this.heartbeatDeadline) clearTimeout(this.heartbeatDeadline); this.heartbeatTimer = null; this.heartbeatDeadline = null; }
  private clearTimers() { this.clearHeartbeat(); if (this.reconnectTimer) clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
}
