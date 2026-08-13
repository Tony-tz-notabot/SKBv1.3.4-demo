// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

vi.mock("./seatHarness", () => ({
  SeatHarness: class {
    state = { snapshot: null, room: null, events: [], lastEventSeq: 0, lastStateRevision: 0, pendingCount: 0, connectionState: "online", rejected: null, protocolErrors: [] };
    connect = vi.fn();
    disconnect = vi.fn();
    execute = vi.fn();
    preselect = vi.fn();
    chat = vi.fn();
    forfeit = vi.fn();
    disband = vi.fn();
  },
}));
vi.mock("./testApiClient", () => ({
  TestApiClient: class {
    async setup() {
      return {
        ok: true, gameId: "g", roomId: "r", roomCode: "T", firstSeat: 1, lifecycle: "inProgress", stateRevision: 0,
        players: [1, 2, 3, 4].map(seat => ({ seat, userId: `u${seat}`, displayName: `座${seat}`, token: `t${seat}`, characterId: "character.knight" })),
      };
    }
    async state() { return null; }
    async hand() { return {}; }
    async deck() { return {}; }
  },
}));

describe("TestDriverView 冒烟", () => {
  it("挂载后渲染工具栏，可切换座位", async () => {
    const { default: TestDriverView } = await import("../views/TestDriverView.vue");
    const wrapper = mount(TestDriverView);
    await flushPromises();
    expect(wrapper.find(".test-toolbar").exists()).toBe(true);
    const seatButtons = wrapper.findAll(".test-toolbar button").filter(button => /座位[1-4]/.test(button.text()));
    expect(seatButtons).toHaveLength(4);
    const seat2 = seatButtons.find(button => button.text().includes("座位2"))!;
    await seat2.trigger("click");
    expect(seat2.classes()).toContain("active");
    wrapper.unmount();
  });
});
