import type {
  ClientProtocolMessage, GameCommand, GameSnapshot, PresentationEvent, Seat, SetupSnapshot,
} from "@skb-protocol/client-protocol";
import type { RoomCommand, RoomProtocolMessage, RoomSnapshot } from "@skb-protocol/room-protocol";
import { reactive } from "vue";
import { WebSocketClient, type ConnectionState, type OutboundCommand, type SocketLike } from "../network/WebSocketClient";
import { createProtocolGateway } from "../protocol/gateway";
import { buildGameCommand, buildRoomCommand, randomCommandId } from "../protocol/commandBuilders";

// 测试驱动：单页面内每座位一条真实 WS 连接，各自持有本地投影（绕开全局 Pinia 单例）。
// 消息经 createProtocolGateway 走与真实客户端相同的 schema+语义校验。

export interface SeatHarnessState {
  snapshot: GameSnapshot | SetupSnapshot | null;
  room: RoomSnapshot | null;
  events: PresentationEvent[];
  lastEventSeq: number;
  lastStateRevision: number;
  pendingCount: number;
  connectionState: ConnectionState;
  rejected: { commandId: string; reasonCode: string; messageKey: string; refreshRequired: boolean } | null;
  protocolErrors: string[];
}

export type Selections = Record<string, Array<string | number | boolean>>;

export interface SeatHarnessOptions { socketFactory?: (url: string) => SocketLike }

export class SeatHarness {
  readonly seat: Seat;
  readonly token: string;
  readonly userId: string;
  state: SeatHarnessState;
  private client: WebSocketClient;
  private gateway: ReturnType<typeof createProtocolGateway>;

  constructor(seat: Seat, token: string, userId: string, wsUrlBase: string, options: SeatHarnessOptions = {}) {
    this.seat = seat;
    this.token = token;
    this.userId = userId;
    this.state = reactive<SeatHarnessState>({ snapshot: null, room: null, events: [], lastEventSeq: 0, lastStateRevision: 0, pendingCount: 0, connectionState: "offline", rejected: null, protocolErrors: [] });
    let client: WebSocketClient;
    let gateway: ReturnType<typeof createProtocolGateway>;
    client = new WebSocketClient({
      url: `${wsUrlBase}${wsUrlBase.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`,
      onMessage: (channel, message) => gateway.receive(channel, message),
      onState: (state) => { this.state.connectionState = state; },
      ...(options.socketFactory ? { socketFactory: options.socketFactory } : {}),
    });
    gateway = createProtocolGateway(
      { send: (command) => client.send(command as OutboundCommand) },
      {
        onGameMessage: (message) => this.acceptGame(message),
        onRoomMessage: (message) => this.acceptRoom(message),
        onProtocolError: (_kind, errors) => { this.state.protocolErrors = [...errors]; },
      },
    );
    this.client = client;
    this.gateway = gateway;
  }

  connect() { this.client.connect(); }
  disconnect() { this.client.disconnect(); }
  get pendingCount() { return this.client.pendingCount; }

  // 以下命令构造与真实客户端一致（buildGameCommand 纯函数），发送走本座位连接。
  execute(offerId: string, selections: Selections) {
    const snapshot = this.state.snapshot; if (!snapshot) return;
    this.gateway.sendGameCommand(buildGameCommand("EXECUTE_OFFER", { selections }, { gameId: snapshot.gameId, expectedStateRevision: snapshot.stateRevision, promptId: snapshot.interaction.prompt?.promptId ?? null, offerId }));
  }
  preselect(weaponSlot: string | null, modeId: string | null) {
    const snapshot = this.state.snapshot; if (!snapshot) return;
    this.gateway.sendGameCommand(buildGameCommand("SET_PRESELECTION", { weaponSlot, modeId }, { gameId: snapshot.gameId, expectedStateRevision: snapshot.stateRevision }));
  }
  chat(channel: "all" | "team", text: string) {
    const snapshot = this.state.snapshot; if (!snapshot) return;
    this.gateway.sendGameCommand(buildGameCommand("SEND_CHAT", { channel, clientMessageId: randomCommandId(), text }, { gameId: snapshot.gameId, expectedStateRevision: snapshot.stateRevision }));
  }
  forfeit() {
    const snapshot = this.state.snapshot; if (!snapshot) return;
    this.gateway.sendGameCommand(buildGameCommand("FORFEIT", {}, { gameId: snapshot.gameId, expectedStateRevision: snapshot.stateRevision }));
  }
  disband() {
    const room = this.state.room; if (!room) return;
    this.gateway.sendRoomCommand(buildRoomCommand("DISBAND_ROOM", {}, { roomId: room.roomId, expectedRoomRevision: room.roomRevision }));
  }

  private acceptGame(message: ClientProtocolMessage) {
    if (message.type === "GAME_SNAPSHOT" || message.type === "SETUP_SNAPSHOT") {
      this.state.snapshot = message;
      this.state.events = [];
      this.state.lastEventSeq = message.lastEventSeq;
      this.state.lastStateRevision = message.stateRevision;
    } else if (message.type === "PRESENTATION_EVENT" && message.eventSeq > this.state.lastEventSeq) {
      this.state.events = [...this.state.events, message];
      this.state.lastEventSeq = message.eventSeq;
    } else if (message.type === "COMMAND_ACCEPTED") {
      this.client.acknowledge(message.commandId);
      this.state.pendingCount = this.client.pendingCount;
    } else if (message.type === "COMMAND_REJECTED") {
      this.client.acknowledge(message.commandId);
      this.state.pendingCount = this.client.pendingCount;
      this.state.rejected = message;
    }
  }

  private acceptRoom(message: RoomProtocolMessage) {
    if (message.type === "ROOM_SNAPSHOT") {
      this.state.room = message;
    } else if (message.type === "LOBBY_SNAPSHOT") {
      this.state.room = null;
      this.state.snapshot = null;
      this.state.events = [];
    } else if (message.type === "ROOM_COMMAND_ACCEPTED") {
      this.client.acknowledge(message.commandId);
      this.state.pendingCount = this.client.pendingCount;
    } else if (message.type === "ROOM_COMMAND_REJECTED") {
      this.client.acknowledge(message.commandId);
      this.state.pendingCount = this.client.pendingCount;
    }
  }
}
