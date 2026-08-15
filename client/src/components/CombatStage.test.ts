// @vitest-environment jsdom
// CombatStage 中央战斗区子区 TDD（132 §3/R5：主区/牌堆/弃牌堆 + 主区词条；临时弃牌区已移除）。
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { describe, expect, it, vi } from "vitest";
import CombatStage from "./CombatStage.vue";
import type { StageEvent } from "../stage/stageMachine";

const ev = (seq: number, eventType: string, payload: Record<string, unknown>): StageEvent => ({ eventSeq: seq, eventType, payload });
const ctx = { characterName: (seat: number | null) => (seat ? `角色${seat}` : "系统"), relationshipCls: () => null };

const mountStage = (events: StageEvent[], drawPileCount: number | null = 30) =>
  mount(CombatStage, {
    props: { events, drawPileCount, characterName: ctx.characterName, relationshipCls: ctx.relationshipCls },
    global: { stubs: { StageArrow: true } },
  });

describe("CombatStage 中央战斗区子区（R5）", () => {
  it("渲染子区：主区（占满宽度）/牌堆/弃牌堆；临时弃牌区已移除", () => {
    const w = mountStage([]);
    expect(w.find(".combat-stage").exists()).toBe(true);
    expect(w.find(".combat-stage__center").exists(), "子区应收进紧凑中心面板").toBe(true);
    expect(w.find(".combat-stage__center .stage-main").exists()).toBe(true);
    expect(w.find(".combat-stage__center .stage-temp").exists(), "临时弃牌区已移除").toBe(false);
    expect(w.find(".combat-stage__center .stage-pile").exists()).toBe(true);
    expect(w.find(".combat-stage__center .stage-discard").exists()).toBe(true);
    expect(w.find(".combat-stage .stage-arrows").exists(), "箭头层应在表格级覆盖层").toBe(true);
  });

  it("牌堆显示卡背与数量", () => {
    const w = mountStage([], 42);
    expect(w.find(".stage-pile .pile-count").text()).toBe("42");
    expect(w.find(".stage-pile .pile-back").exists()).toBe(true);
  });

  it("出牌进主区；新操作开始主区清空（内部经临时弃牌中转，不渲染）；操作结束入弃牌堆条状区", async () => {
    const w = mountStage([ev(1, "CARD_PLAYED", { seat: 1, cardRef: "private:u1:c1", purpose: "attack" })]);
    expect(w.find(".stage-main .stage-card").exists()).toBe(true);
    await w.setProps({
      events: [
        ...w.props("events"),
        ev(2, "ATTACK_DECLARED", { attackerSeat: 1, targetRefs: ["public:seat_3"] }),
        ev(3, "ATTACK_RESOLVED", { attackId: "a1", result: "resolved", outcome: "hit" }),
      ],
    });
    expect(w.find(".stage-main .stage-card").exists()).toBe(false);
    expect(w.find(".stage-discard .stage-card").exists()).toBe(true);
    expect(w.find(".stage-discard .stage-card img").exists(), "弃牌堆显示正面图").toBe(true);
  });

  it("主区词条：攻击目标叙述（角色名+关系色 token）", () => {
    const w = mountStage([ev(1, "ATTACK_TARGETED", { attackerSeat: 1, targetRefs: ["public:seat_3"] })]);
    expect(w.find(".stage-narration").exists()).toBe(true);
    expect(w.find(".stage-narration").text()).toContain("角色1攻击角色3");
  });

  it("摸牌事件产出词条（数量，不泄牌名）", () => {
    const w = mountStage([ev(1, "CARD_DRAWN", { seat: 2, count: 3, cardRefs: [] })]);
    expect(w.find(".stage-narration").text()).toContain("角色2摸3张");
  });

  it("摸牌飞行卡：本人 draw 正面、他人 draw 背面，从牌堆飞向座位（--dx/--dy），到时移除", async () => {
    vi.useFakeTimers();
    try {
      const w = mountStage([ev(1, "CARD_DRAWN", { seat: 2, count: 2, cardRefs: ["private:u2:c1", "private:u2:c2"] })]);
      expect(w.findAll(".stage-flight").length).toBe(2);
      expect(w.find(".stage-flight--face").exists()).toBe(true);
      const flight = w.find(".stage-flight--face");
      expect((flight.element as HTMLElement).style.getPropertyValue("--fx")).toBeTruthy();
      expect((flight.element as HTMLElement).style.getPropertyValue("--fy")).toBeTruthy();
      await w.setProps({ events: [...w.props("events"), ev(2, "CARD_DRAWN", { seat: 3, count: 1, cardRefs: [] })] });
      expect(w.findAll(".stage-flight").length).toBe(3);
      expect(w.find(".stage-flight--back").exists()).toBe(true);
      vi.advanceTimersByTime(900);
      await nextTick();
      expect(w.findAll(".stage-flight")).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("判定翻牌进主区 + 判定完成：判定卡高亮（success）", () => {
    const w = mountStage([
      ev(1, "JUDGMENT_REVEALED", { card: { ref: "public:j1", displayName: "红牌", printedColor: "red" }, printedColor: "red" }),
      ev(2, "JUDGMENT_RESULT_CHANGED", { from: "red", to: "red", reason: "resolved" }),
    ]);
    const card = w.find(".stage-main .stage-card");
    expect(card.exists()).toBe(true);
    expect(card.classes()).toContain("stage-card--success");
    expect(card.classes()).toContain("stage-card--flip-in");
  });

  it("多目标攻击：多根箭头按序扇形弯曲（bend 值不同）", () => {
    const w = mountStage([ev(1, "ATTACK_DECLARED", { attackerSeat: 1, targetRefs: ["public:seat_3", "public:seat_4"] })]);
    const arrows = w.findAllComponents({ name: "StageArrow" });
    expect(arrows.length).toBe(2);
    const bends = arrows.map((a) => (a.props() as { bend?: number }).bend ?? 0);
    expect(new Set(bends).size, `多目标箭头应扇形弯曲，实际 bends=${bends.join(",")}`).toBe(2);
  });

  it("操作结束后箭头按时间保留（让 solid/arrive 动画播放）再清理", async () => {
    vi.useFakeTimers();
    try {
      const w = mountStage([
        ev(1, "ATTACK_DECLARED", { attackerSeat: 1, targetRefs: ["public:seat_3"] }),
        ev(2, "ATTACK_RESOLVED", { attackId: "a1", result: "resolved", outcome: "hit" }),
      ]);
      expect(w.findAllComponents({ name: "StageArrow" }).length).toBe(1); // 结束事件刚发生，保留播放期
      await w.setProps({ events: [...w.props("events"), ev(3, "CARD_DRAWN", { seat: 1, count: 1, cardRefs: [] })] });
      expect(w.findAllComponents({ name: "StageArrow" }).length).toBe(1); // 保留期（<1200ms）内仍在
      vi.advanceTimersByTime(1700);
      await w.setProps({ events: [...w.props("events"), ev(4, "CARD_DRAWN", { seat: 1, count: 1, cardRefs: [] })] });
      expect(w.findAllComponents({ name: "StageArrow" }).length).toBe(0); // 超出保留窗口 → 清理
    } finally {
      vi.useRealTimers();
    }
  });
});
