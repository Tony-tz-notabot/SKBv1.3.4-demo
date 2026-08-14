// 主区词条构建 TDD（132 §2.3/§5：全员可见叙述，token 复用 128 三色系）。
import { describe, expect, it } from "vitest";
import { buildNarration, type NarrationCtx } from "./narration";

const ctx: NarrationCtx = {
  characterName: (seat) => (seat ? `角色${seat}` : "系统"),
  relationshipCls: (seat) => (seat === 1 ? "rel-self" : seat === 2 ? "rel-ally" : "rel-enemy"),
};

const ev = (seq: number, eventType: string, payload: Record<string, unknown>) => ({ eventSeq: seq, eventType, payload });

describe("narration 主区词条", () => {
  it("攻击声明：谁攻击谁（关系色）", () => {
    const line = buildNarration(ev(1, "ATTACK_DECLARED", { attackerSeat: 1, targetRefs: ["public:seat_3"] }), ctx);
    expect(line).not.toBeNull();
    expect(line!.segments.map((s) => s.text)).toEqual(["角色1", "攻击", "角色3"]);
    expect(line!.segments[0]!.cls).toBe("rel-self");
    expect(line!.segments[2]!.cls).toBe("rel-enemy");
  });

  it("多目标攻击：目标列举", () => {
    const line = buildNarration(ev(1, "ATTACK_DECLARED", { attackerSeat: 2, targetRefs: ["public:seat_3", "public:seat_4"] }), ctx);
    expect(line!.segments.map((s) => s.text).join("")).toBe("角色2攻击角色3、角色4");
  });

  it("伤害段：护盾-2（sem-shield）", () => {
    const line = buildNarration(ev(3, "DAMAGE_SEGMENT_APPLIED", { targetRef: "public:seat_3", amount: 2, hpLost: 0, shieldLost: 2 }), ctx);
    expect(line!.segments.map((s) => s.text).join("")).toContain("护盾-2");
    expect(line!.segments.some((s) => s.cls === "sem-shield")).toBe(true);
  });

  it("伤害段：血量-2（sem-hp）", () => {
    const line = buildNarration(ev(4, "DAMAGE_SEGMENT_APPLIED", { targetRef: "public:seat_3", amount: 2, hpLost: 2, shieldLost: 0 }), ctx);
    expect(line!.segments.map((s) => s.text).join("")).toContain("血量-2");
    expect(line!.segments.some((s) => s.cls === "sem-hp")).toBe(true);
  });

  it("判定：翻出红牌（card-red）", () => {
    const line = buildNarration(ev(5, "JUDGMENT_REVEALED", { card: { ref: "public:j1", displayName: "红牌", printedColor: "red" }, printedColor: "red" }), ctx);
    expect(line!.segments.map((s) => s.text).join("")).toContain("翻出");
    expect(line!.segments.some((s) => s.cls === "card-red")).toBe(true);
  });

  it("摸牌：他人只见数量（不泄牌名）", () => {
    const line = buildNarration(ev(6, "CARD_DRAWN", { seat: 2, count: 3, cardRefs: [] }), ctx);
    expect(line!.segments.map((s) => s.text).join("")).toBe("角色2摸3张");
  });

  it("回复：sem-heal", () => {
    const line = buildNarration(ev(7, "HEALTH_CHANGED", { seat: 1, change: "recovered", amount: 2 }), ctx);
    expect(line!.segments.map((s) => s.text).join("")).toContain("回复");
    expect(line!.segments.some((s) => s.cls === "sem-heal")).toBe(true);
  });

  it("未知事件不产出词条", () => {
    expect(buildNarration(ev(8, "PHASE_CHANGED", { activeSeat: 1, phase: "draw" }), ctx)).toBeNull();
  });

  it("出牌：谁打出牌（公开安全，不泄牌名给他人）", () => {
    const line = buildNarration(ev(9, "CARD_PLAYED", { seat: 1, cardRef: "private:u1:c1", purpose: "attack" }), ctx);
    expect(line!.segments.map((s) => s.text).join("")).toBe("角色1打出1张牌");
  });

  it("响应：谁响应", () => {
    const line = buildNarration(ev(10, "RESPONSE_RESOLVED", { responderSeat: 3, result: "resolved" }), ctx);
    expect(line!.segments.map((s) => s.text).join("")).toBe("角色3响应");
  });

  it("攻击结果：命中", () => {
    const line = buildNarration(ev(11, "ATTACK_RESOLVED", { attackId: "a1", result: "resolved", outcome: "hit" }), ctx);
    expect(line!.segments.map((s) => s.text).join("")).toBe("命中");
  });

  it("攻击结果：被全部无效", () => {
    const line = buildNarration(ev(12, "ATTACK_RESOLVED", { attackId: "a1", result: "invalidated", outcome: "invalidated" }), ctx);
    expect(line!.segments.map((s) => s.text).join("")).toContain("无效");
  });

  it("攻击结果：未命中（近战格挡）", () => {
    const line = buildNarration(ev(13, "ATTACK_RESOLVED", { attackId: "a1", result: "meleeBlock", outcome: "miss" }), ctx);
    expect(line!.segments.map((s) => s.text).join("")).toContain("未命中");
  });

  it("回复带数值：回复+2", () => {
    const line = buildNarration(ev(14, "HEALTH_CHANGED", { seat: 1, change: "recovered", amount: 2 }), ctx);
    expect(line!.segments.map((s) => s.text).join("")).toBe("角色1回复+2");
  });

  it("失去生命带数值：失去2", () => {
    const line = buildNarration(ev(15, "HEALTH_CHANGED", { seat: 3, change: "lost", amount: 2 }), ctx);
    expect(line!.segments.map((s) => s.text).join("")).toBe("角色3失去2");
  });

  it("状态施加：谁获得状态（公开 statusId 尾段；中文状态名目录为后续增强）", () => {
    const line = buildNarration(ev(16, "STATUS_CHANGED", { targetRef: "public:seat_3", statusId: "status.frozen", change: "applied" }), ctx);
    expect(line!.segments.map((s) => s.text).join("")).toContain("获得");
    expect(line!.segments.map((s) => s.text).join("")).toContain("frozen");
    expect(line!.segments.some((s) => s.cls === "sem-extra")).toBe(true);
  });

  it("状态移除：谁失去状态", () => {
    const line = buildNarration(ev(17, "STATUS_CHANGED", { targetRef: "public:seat_3", statusId: "status.frozen", change: "removed" }), ctx);
    expect(line!.segments.map((s) => s.text).join("")).toContain("失去");
  });
});
