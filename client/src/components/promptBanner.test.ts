// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import PromptBanner from "./PromptBanner.vue";

afterEach(() => { vi.useRealTimers(); });

const prompt = (over: Partial<any> = {}): any => ({
  promptId: "p:1",
  kind: "playPhaseAction",
  mandatory: false,
  deadlineAt: Date.now() + 10000,
  prioritySeat: 1,
  timeoutPolicy: "pass",
  ...over,
});

describe("PromptBanner 倒计时（task18）", () => {
  it("本地时钟前进了 5s 后收到新快照（serverTime 前进 5s、deadline 不变），剩余时间应保持 5s 而非被拉回 0", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const wrapper = mount(PromptBanner, {
      props: { prompt: prompt({ deadlineAt: 11000 }), viewerSeat: 1, serverTime: 1000 },
    });
    const time = () => wrapper.find("time").text();
    expect(time()).toBe("10s");
    // 同一份快照下本地时钟走 5s：估计服务器 now = 1000 + 5s = 6000，剩 5s
    vi.advanceTimersByTime(5000);
    await Promise.resolve();
    await Promise.resolve();
    expect(time()).toBe("5s");
    // 新快照到达：serverTime 前进到 6000（deadline 仍是 11000，服务器未延窗口）。
    // 正确估计：服务器 now ≈ 6000，剩余 5s。旧实现把 receivedAt 冻结在挂载时刻(1000)，
    // 会算出 6000+(6000-1000)=11000 → 剩余 0。此断言暴露该漂移 bug。
    wrapper.setProps({ prompt: prompt({ deadlineAt: 11000 }), serverTime: 6000 });
    await Promise.resolve();
    await Promise.resolve();
    expect(time()).toBe("5s");
  });

  it("服务器延长窗口（deadline 与 serverTime 同增）时，本地锚点重置后剩余按新 serverTime 计算", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2000);
    const wrapper = mount(PromptBanner, {
      props: { prompt: prompt({ deadlineAt: 12000 }), viewerSeat: 1, serverTime: 2000 },
    });
    // 本地走 3s，同一快照下剩 7s
    vi.advanceTimersByTime(3000);
    await Promise.resolve();
    await Promise.resolve();
    expect(wrapper.find("time").text()).toBe("7s");
    // 新快照：serverTime 5000、deadline 15000（窗口顺延）。正确剩余 = 15-5 = 10s。
    // 旧实现冻结锚点：estimated = 5000+(5000-2000)=8000 → 剩 7s。
    wrapper.setProps({ prompt: prompt({ deadlineAt: 15000 }), serverTime: 5000 });
    await Promise.resolve();
    await Promise.resolve();
    expect(wrapper.find("time").text()).toBe("10s");
  });
});

describe("PromptBanner 非轮转玩家也显示倒计时（其他玩家可见）", () => {
  const base = { deadlineAt: Date.now() + 10000, timeoutPolicy: "pass" as const, mandatory: false };

  it("prompt 为 null（非轮转玩家）但 activeWindow 存在时，仍渲染 <time> 倒计时（来源 activeWindow.deadlineAt）", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const wrapper = mount(PromptBanner, {
      props: {
        prompt: null,
        viewerSeat: 1,
        serverTime: 1000,
        activeWindow: { kind: "playPhaseAction", prioritySeat: 3, deadlineAt: 11000, attackerSeat: null, abilityId: null },
        characterNameOf: (seat: number) => (seat === 3 ? "游侠" : `玩家${seat}`),
      },
    });
    const time = wrapper.find("time");
    expect(time.exists(), "非轮转玩家也应看到倒计时 <time>").toBe(true);
    expect(time.text()).toBe("10s");
    expect(wrapper.find(".prompt-banner").exists(), "activeWindow 存在时渲染信息条而非占位符").toBe(true);
    expect(wrapper.find(".prompt-banner strong").text()).toBe("游侠行动阶段");
  });

  it("activeWindow 的 deadlineAt 已过期时，非轮转玩家倒计时显示 0s", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const wrapper = mount(PromptBanner, {
      props: {
        prompt: null,
        viewerSeat: 1,
        serverTime: 1000,
        activeWindow: { kind: "playPhaseAction", prioritySeat: 3, deadlineAt: 500, attackerSeat: null, abilityId: null },
        characterNameOf: (seat: number) => `玩家${seat}`,
      },
    });
    expect(wrapper.find("time").text()).toBe("0s");
  });
});

describe("PromptBanner 阶段文案（task18）", () => {
  const base = { deadlineAt: Date.now() + 10000, timeoutPolicy: "pass" as const, mandatory: false };

  it("出牌阶段：显示 x行动阶段（x 为角色名）", () => {
    const wrapper = mount(PromptBanner, {
      props: {
        prompt: { ...base, promptId: "p", kind: "playPhaseAction", prioritySeat: 3 },
        viewerSeat: 2,
        serverTime: Date.now(),
        activeWindow: { kind: "playPhaseAction", prioritySeat: 3, deadlineAt: base.deadlineAt, attackerSeat: null, abilityId: null },
        characterNameOf: (seat: number) => (seat === 3 ? "游侠" : `玩家${seat}`),
      },
    });
    expect(wrapper.find(".prompt-banner strong").text()).toBe("游侠行动阶段");
  });

  it("出牌阶段（轮到 viewer）：显示 轮到你操作", () => {
    const wrapper = mount(PromptBanner, {
      props: {
        prompt: { ...base, promptId: "p", kind: "playPhaseAction", prioritySeat: 2 },
        viewerSeat: 2,
        serverTime: Date.now(),
        activeWindow: { kind: "playPhaseAction", prioritySeat: 2, deadlineAt: base.deadlineAt, attackerSeat: null, abilityId: null },
        characterNameOf: () => "x",
      },
    });
    expect(wrapper.find(".prompt-banner strong").text()).toBe("轮到你操作");
  });

  it("响应阶段：显示 x响应y的攻击（x,y 为角色名）", () => {
    const wrapper = mount(PromptBanner, {
      props: {
        prompt: { ...base, promptId: "p", kind: "attackResponse", prioritySeat: 2 },
        viewerSeat: 1,
        serverTime: Date.now(),
        activeWindow: { kind: "attackResponse", prioritySeat: 2, deadlineAt: base.deadlineAt, attackerSeat: 4, abilityId: null },
        characterNameOf: (seat: number) => ({ 2: "骑士", 4: "狼人" }[seat] ?? `玩家${seat}`),
      },
    });
    expect(wrapper.find(".prompt-banner strong").text()).toBe("骑士响应狼人的攻击");
  });

  it("技能窗口：显示 x使用Z（Z 为技能名）", () => {
    const wrapper = mount(PromptBanner, {
      props: {
        prompt: { ...base, promptId: "p", kind: "divineBarrierDamage", prioritySeat: 3 },
        viewerSeat: 1,
        serverTime: Date.now(),
        activeWindow: { kind: "divineBarrierDamage", prioritySeat: 3, deadlineAt: base.deadlineAt, attackerSeat: 4, abilityId: "skill.paladin.divine_barrier" },
        characterNameOf: (seat: number) => ({ 3: "圣骑士", 4: "狼人" }[seat] ?? `玩家${seat}`),
        abilityNameOf: (id: string) => (id === "skill.paladin.divine_barrier" ? "神圣屏障" : id),
      },
    });
    expect(wrapper.find(".prompt-banner strong").text()).toBe("圣骑士使用神圣屏障");
  });

  it("思考窗口（圣骑士雕像使用思考）：x使用思考", () => {
    const wrapper = mount(PromptBanner, {
      props: {
        prompt: { ...base, promptId: "p", kind: "statuePaladinResponse", prioritySeat: 3 },
        viewerSeat: 1,
        serverTime: Date.now(),
        activeWindow: { kind: "statuePaladinResponse", prioritySeat: 3, deadlineAt: base.deadlineAt, attackerSeat: null, abilityId: "skill.statue.paladin_think" },
        characterNameOf: (seat: number) => ({ 3: "圣骑士" }[seat] ?? `玩家${seat}`),
        abilityNameOf: (id: string) => (id === "skill.statue.paladin_think" ? "思考" : id),
      },
    });
    expect(wrapper.find(".prompt-banner strong").text()).toBe("圣骑士使用思考");
  });

  it("思考窗口（萨满逆天改命思考）：x使用思考（判前干预）", () => {
    const wrapper = mount(PromptBanner, {
      props: {
        prompt: { ...base, promptId: "p", kind: "preJudgment", prioritySeat: 3 },
        viewerSeat: 1,
        serverTime: Date.now(),
        activeWindow: { kind: "preJudgment", prioritySeat: 3, deadlineAt: base.deadlineAt, attackerSeat: null, abilityId: "skill.shaman.defy_fate" },
        characterNameOf: (seat: number) => ({ 3: "萨满" }[seat] ?? `玩家${seat}`),
        abilityNameOf: (id: string) => (id === "skill.shaman.defy_fate" ? "思考" : id),
      },
    });
    expect(wrapper.find(".prompt-banner strong").text()).toBe("萨满使用思考");
  });

  it("无 activeWindow（无窗口）时回退显示 等待服务器推进", () => {
    const wrapper = mount(PromptBanner, {
      props: { prompt: null, viewerSeat: 1, serverTime: Date.now(), activeWindow: null, characterNameOf: () => "x", abilityNameOf: () => "z" },
    });
    expect(wrapper.find(".prompt-banner").exists()).toBe(false);
    expect(wrapper.find(".prompt-banner-placeholder").text()).toContain("等待服务器推进");
  });

  it("F2：剩余 ≤10s 时倒计时变紧急（urgent 类）；剩余较多时不加", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const urgent = mount(PromptBanner, { props: { prompt: prompt({ deadlineAt: 5000 }), viewerSeat: 1, serverTime: 1000 } });
    expect(urgent.find("time").classes(), "剩余 4s 应加 urgent 类").toContain("prompt-banner__time--urgent");
    const calm = mount(PromptBanner, { props: { prompt: prompt({ deadlineAt: 20000 }), viewerSeat: 1, serverTime: 1000 } });
    expect(calm.find("time").classes(), "剩余 19s 不应加 urgent 类").not.toContain("prompt-banner__time--urgent");
  });
});
