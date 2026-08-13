// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { SeatHarness } from "./seatHarness";

function fakeSocket() {
  return {
    readyState: 1 as number,
    onopen: null as (() => void) | null,
    onmessage: null as ((event: { data: string }) => void) | null,
    onclose: null as (() => void) | null,
    onerror: null as (() => void) | null,
    sent: [] as string[],
    send(this: { sent: string[] }, data: string) { this.sent.push(data); },
    close() {},
  };
}
type FakeSocket = ReturnType<typeof fakeSocket>;

function makeHarness(socket: FakeSocket) {
  const harness = new SeatHarness(1, "tok1", "u1", "ws://test", { socketFactory: () => socket });
  harness.connect();
  socket.onopen?.();
  return harness;
}
function accept(harness: SeatHarness, message: unknown) {
  (harness as unknown as { acceptGame: (m: unknown) => void }).acceptGame(message);
}
function snapshot(gameId: string, stateRevision: number, lastEventSeq: number) {
  return {
    type: "GAME_SNAPSHOT", gameId, rulesetVersion: "1.3.4", stateRevision, lastEventSeq, serverTime: 1,
    viewer: { userId: "u", seat: 1, team: "A" }, publicView: {}, privateView: {},
    interaction: { prompt: { promptId: "p1", kind: "playPhaseAction", mandatory: false, deadlineAt: 1, prioritySeat: 1, timeoutPolicy: "pass" }, offers: [], disabledHints: [] },
    activeWindow: null, chat: [],
  };
}

describe("SeatHarness", () => {
  it("接收 GAME_SNAPSHOT 存储投影并更新序号", () => {
    const harness = makeHarness(fakeSocket());
    expect(harness.state.connectionState).toBe("online");
    accept(harness, snapshot("g1", 5, 3));
    expect((harness.state.snapshot as { gameId: string }).gameId).toBe("g1");
    expect(harness.state.lastStateRevision).toBe(5);
    expect(harness.state.lastEventSeq).toBe(3);
    harness.disconnect();
  });

  it("PRESENTATION_EVENT 按 eventSeq 去重", () => {
    const harness = makeHarness(fakeSocket());
    accept(harness, snapshot("g1", 5, 3));
    accept(harness, { type: "PRESENTATION_EVENT", eventSeq: 4, stateRevision: 6, eventType: "PHASE_CHANGED", payload: {} });
    accept(harness, { type: "PRESENTATION_EVENT", eventSeq: 4, stateRevision: 6, eventType: "PHASE_CHANGED", payload: {} });
    accept(harness, { type: "PRESENTATION_EVENT", eventSeq: 5, stateRevision: 6, eventType: "TURN_CHANGED", payload: { seat: 1, round: 1 } });
    expect(harness.state.events).toHaveLength(2);
    expect(harness.state.lastEventSeq).toBe(5);
    accept(harness, snapshot("g1", 7, 5));
    expect(harness.state.events).toHaveLength(0);
    harness.disconnect();
  });

  it("execute/preselect 构造命令并委托给本座位连接发送", () => {
    const socket = fakeSocket();
    const harness = makeHarness(socket);
    accept(harness, snapshot("g1", 5, 3));
    harness.execute("offer:finish", { confirm: [false] });
    harness.preselect("weapon:1:1", null);
    expect(socket.sent).toHaveLength(2);
    const executeWire = JSON.parse(socket.sent[0]!) as any;
    expect(executeWire.type).toBe("COMMAND");
    expect(executeWire.channel).toBe("game");
    expect(executeWire.command.command).toBe("EXECUTE_OFFER");
    expect(executeWire.command.gameId).toBe("g1");
    expect(executeWire.command.expectedStateRevision).toBe(5);
    expect(executeWire.command.promptId).toBe("p1");
    expect(executeWire.command.offerId).toBe("offer:finish");
    expect(executeWire.command.payload.selections.confirm).toEqual([false]);
    const preselectWire = JSON.parse(socket.sent[1]!) as any;
    expect(preselectWire.command.command).toBe("SET_PRESELECTION");
    expect(preselectWire.command.expectedStateRevision).toBe(5);
    expect(preselectWire.command.promptId).toBeNull();
    harness.disconnect();
  });
});
