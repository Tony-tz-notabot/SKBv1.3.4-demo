// 中央战斗区状态机 TDD（132 §4/§10 M1）：操作组聚合（启发式+operationId 两模式）、
// 箭头状态机（standby→solid/voided→flow→arrive）、嵌套操作透明度降级、主区/临时弃牌/弃牌堆牌流。
import { describe, expect, it } from "vitest";
import { createStage, stageReducer, DISCARD_CAP, type StageEvent } from "./stageMachine";

const ev = (seq: number, eventType: string, payload: Record<string, unknown>, operationId?: string): StageEvent =>
  ({ eventSeq: seq, eventType, payload, ...(operationId ? { operationId } : {}) });

describe("stageMachine 操作组与箭头状态机", () => {
  it("攻击声明创建操作与 standby 箭头（多目标多箭头）", () => {
    let s = createStage();
    s = stageReducer(s, ev(1, "ATTACK_DECLARED", { attackerSeat: 1, targetRefs: ["public:seat_3", "public:seat_4"] }));
    expect(s.operations).toHaveLength(1);
    expect(s.operations[0]!.kind).toBe("attack");
    expect(s.operations[0]!.targetSeats).toEqual([3, 4]);
    expect(s.arrows).toHaveLength(2);
    expect(s.arrows.every((a) => a.phase === "standby" && a.from === 1 && a.opacity === 1)).toBe(true);
  });

  it("目标含自己 → selfLoop 环箭头", () => {
    let s = createStage();
    s = stageReducer(s, ev(1, "ATTACK_DECLARED", { attackerSeat: 1, targetRefs: ["public:seat_1"] }));
    expect(s.arrows[0]!.selfLoop).toBe(true);
    expect(s.arrows[0]!.to).toBe(1);
  });

  it("响应后命中（outcome=hit）→ 箭头实体化 solid、操作完成", () => {
    let s = createStage();
    s = stageReducer(s, ev(1, "ATTACK_DECLARED", { attackerSeat: 1, targetRefs: ["public:seat_3"] }));
    s = stageReducer(s, ev(2, "RESPONSE_RESOLVED", { responderSeat: 3, result: "passed" }));
    s = stageReducer(s, ev(3, "ATTACK_RESOLVED", { attackId: "a1", result: "resolved", outcome: "hit" }));
    expect(s.arrows[0]!.phase).toBe("solid");
    expect(s.operations[0]!.state).toBe("done");
  });

  it("对方使全部效果无效（outcome=invalidated）→ voided 淡出", () => {
    let s = createStage();
    s = stageReducer(s, ev(1, "ATTACK_DECLARED", { attackerSeat: 1, targetRefs: ["public:seat_3"] }));
    s = stageReducer(s, ev(2, "ATTACK_RESOLVED", { attackId: "a1", result: "invalidated", outcome: "invalidated", sourceKind: "armor" }));
    expect(s.arrows[0]!.phase).toBe("voided");
    expect(s.operations[0]!.state).toBe("voided");
  });

  it("未命中（outcome=miss，如近战格挡）→ voided", () => {
    let s = createStage();
    s = stageReducer(s, ev(1, "ATTACK_DECLARED", { attackerSeat: 1, targetRefs: ["public:seat_3"] }));
    s = stageReducer(s, ev(2, "ATTACK_RESOLVED", { attackId: "a1", result: "meleeBlock", outcome: "miss" }));
    expect(s.arrows[0]!.phase).toBe("voided");
  });

  it("伤害段驱动 flow→arrive（每段一次脉冲，末段到达）", () => {
    let s = createStage();
    s = stageReducer(s, ev(1, "ATTACK_DECLARED", { attackerSeat: 1, targetRefs: ["public:seat_3"] }));
    s = stageReducer(s, ev(2, "DAMAGE_SEGMENT_APPLIED", { targetRef: "public:seat_3", segmentIndex: 0, totalSegments: 2, amount: 1, hpLost: 0, shieldLost: 1 }));
    expect(s.arrows[0]!.phase).toBe("flow");
    expect(s.arrows[0]!.effect).toBe("shield");
    expect(s.arrows[0]!.segments).toHaveLength(1);
    s = stageReducer(s, ev(3, "DAMAGE_SEGMENT_APPLIED", { targetRef: "public:seat_3", segmentIndex: 1, totalSegments: 2, amount: 2, hpLost: 2, shieldLost: 0 }));
    expect(s.arrows[0]!.phase).toBe("arrive");
    expect(s.arrows[0]!.segments).toHaveLength(2);
  });

  it("反击嵌套：新操作压栈，旧箭头透明度降级，新操作结束恢复", () => {
    let s = createStage();
    s = stageReducer(s, ev(1, "ATTACK_DECLARED", { attackerSeat: 1, targetRefs: ["public:seat_3"] }));
    // 反击在旧操作未结束期间开始
    s = stageReducer(s, ev(2, "ATTACK_DECLARED", { attackerSeat: 3, targetRefs: ["public:seat_1"] }));
    expect(s.operations).toHaveLength(2);
    expect(s.operations[1]!.depth).toBe(1);
    expect(s.arrows.find((a) => a.from === 1)!.opacity).toBe(0.35);
    expect(s.arrows.find((a) => a.from === 3)!.opacity).toBe(1);
    s = stageReducer(s, ev(3, "ATTACK_RESOLVED", { attackId: "a2", result: "resolved", outcome: "hit" }));
    expect(s.operations[1]!.state).toBe("done");
    expect(s.arrows.find((a) => a.from === 1)!.opacity).toBe(1);
  });

  it("operationId 模式：跨事件正确分组（交织事件不串组）", () => {
    let s = createStage();
    s = stageReducer(s, ev(1, "ATTACK_DECLARED", { attackerSeat: 1, targetRefs: ["public:seat_3"] }, "op-a"));
    s = stageReducer(s, ev(2, "ATTACK_DECLARED", { attackerSeat: 3, targetRefs: ["public:seat_1"] }, "op-b"));
    s = stageReducer(s, ev(3, "DAMAGE_SEGMENT_APPLIED", { targetRef: "public:seat_1", segmentIndex: 0, totalSegments: 2, amount: 1, hpLost: 1, shieldLost: 0 }, "op-b"));
    expect(s.arrows.find((a) => a.from === 3)!.phase).toBe("flow");
    expect(s.arrows.find((a) => a.from === 1)!.phase).toBe("standby");
  });
});

describe("stageMachine 主区/临时弃牌/弃牌堆牌流", () => {
  it("出牌进主区；新操作开始（步骤推进）→ 临时弃牌摊开；操作结束 → 弃牌堆", () => {
    let s = createStage();
    s = stageReducer(s, ev(1, "CARD_PLAYED", { seat: 1, cardRef: "private:u1:c1", purpose: "attack" }));
    expect(s.mainCards.map((c) => c.ref)).toContain("private:u1:c1");
    s = stageReducer(s, ev(2, "ATTACK_DECLARED", { attackerSeat: 1, targetRefs: ["public:seat_3"] }, "op-x"));
    expect(s.tempDiscard.map((c) => c.ref)).toContain("private:u1:c1");
    s = stageReducer(s, ev(3, "ATTACK_RESOLVED", { attackId: "a1", result: "resolved", outcome: "hit" }, "op-x"));
    expect(s.discardRefs).toContain("private:u1:c1");
    expect(s.tempDiscard).toHaveLength(0);
  });

  it("弃牌堆超过上限只保留最新（队列结构）", () => {
    let s = createStage();
    for (let i = 1; i <= 15; i++) {
      s = stageReducer(s, ev(i, "CARD_PLAYED", { seat: 1, cardRef: `private:u1:c${i}`, purpose: "attack" }));
      s = stageReducer(s, ev(1000 + i, "ATTACK_DECLARED", { attackerSeat: 1, targetRefs: ["public:seat_3"] }, `op-${i}`));
      s = stageReducer(s, ev(2000 + i, "ATTACK_RESOLVED", { attackId: `a${i}`, result: "resolved", outcome: "hit" }, `op-${i}`));
    }
    expect(s.discardRefs.length).toBe(DISCARD_CAP);
    expect(s.discardRefs[0]).toBe("private:u1:c4");
    expect(s.discardRefs[DISCARD_CAP - 1]).toBe("private:u1:c15");
  });

  it("判定翻牌进主区；判定完成高亮（成功）", () => {
    let s = createStage();
    s = stageReducer(s, ev(1, "JUDGMENT_REVEALED", { card: { ref: "public:j1", displayName: "红牌", printedColor: "red" }, printedColor: "red" }));
    expect(s.mainCards.some((c) => c.ref === "public:j1" && c.highlight === null)).toBe(true);
    s = stageReducer(s, ev(2, "JUDGMENT_RESULT_CHANGED", { from: "red", to: "red", reason: "resolved" }));
    expect(s.mainCards.find((c) => c.ref === "public:j1")!.highlight).toBe("success");
  });

  it("摸牌记录：本人见牌（cardRefs 非空→正面），他人只见数量（背面）", () => {
    let s = createStage();
    s = stageReducer(s, ev(1, "CARD_DRAWN", { seat: 2, count: 2, cardRefs: ["private:u2:c1", "private:u2:c2"] }));
    expect(s.draws).toHaveLength(1);
    expect(s.draws[0]).toMatchObject({ seat: 2, count: 2, faceUp: true });
    s = stageReducer(s, ev(2, "CARD_DRAWN", { seat: 3, count: 1, cardRefs: [] }));
    expect(s.draws[1]).toMatchObject({ seat: 3, count: 1, faceUp: false });
  });
});
