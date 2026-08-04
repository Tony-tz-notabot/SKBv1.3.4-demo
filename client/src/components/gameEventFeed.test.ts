// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import GameEventFeed from "./GameEventFeed.vue";

function event(overrides: Record<string, unknown> = {}) {
  return {
    type: "PRESENTATION_EVENT" as const,
    eventSeq: 1,
    stateRevision: 1,
    eventType: "TRIGGER_RESOLVED" as const,
    payload: { seat: 1, abilityId: "talent.blue_shield", action: "trigger" },
    ...overrides,
  } as any;
}

describe("GameEventFeed 技能发动日志", () => {
  it("TRIGGER_RESOLVED 显示技能中文名与效果描述", () => {
    const wrapper = mount(GameEventFeed, { props: { events: [event()] } });
    const text = wrapper.text();
    expect(text).toContain("蓝盾");
    expect(text).toContain("每段伤害开始时若仍有护盾");
  });

  it("TRIGGER_RESOLVED 未知技能显示回退占位", () => {
    const wrapper = mount(GameEventFeed, {
      props: { events: [event({ payload: { seat: 2, abilityId: "skill.unknown_skill", action: "trigger" } })] },
    });
    expect(wrapper.text()).toContain("skill.unknown_skill");
  });

  it("无技能 ID 的 TRIGGER_RESOLVED 仅显示动作与座位", () => {
    const wrapper = mount(GameEventFeed, {
      props: { events: [event({ payload: { seat: 3, action: "trigger" } })] },
    });
    expect(wrapper.text()).toContain("触发");
    expect(wrapper.text()).toContain("3");
  });
});
