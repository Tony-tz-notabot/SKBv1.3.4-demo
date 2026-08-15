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

  it("ATTACK_DECLARED 空目标 → ATTACK_TARGETED 补齐箭头（真实服务端场景）", () => {
    let s = createStage();
    s = stageReducer(s, ev(1, "ATTACK_DECLARED", { attackerSeat: 1, targetRefs: [] }));
    expect(s.arrows).toHaveLength(0);
    s = stageReducer(s, ev(2, "ATTACK_TARGETED", { sourceRef: "public:system", targetRefs: ["public:seat_2", "public:seat_4"] }));
    expect(s.arrows).toHaveLength(2);
    expect(s.arrows.every((a) => a.phase === "standby" && a.from === 1 && a.opacity === 1)).toBe(true);
    // 重复 ATTACK_TARGETED（targeted 与 targets.chosen 各映射一次）不重复建箭头
    s = stageReducer(s, ev(3, "ATTACK_TARGETED", { sourceRef: "public:system", targetRefs: ["public:seat_2"] }));
    expect(s.arrows).toHaveLength(2);
    expect(s.operations[0]!.targetSeats).toEqual([2, 4]);
  });

  it("ATTACK_TARGETED 先于声明（重放场景）→ 以未知来源起操作", () => {
    let s = createStage();
    s = stageReducer(s, ev(1, "ATTACK_TARGETED", { sourceRef: "public:system", targetRefs: ["public:seat_3"] }));
    expect(s.operations).toHaveLength(1);
    expect(s.arrows).toHaveLength(1);
    expect(s.arrows[0]!.from).toBe("center");
  });

  it("响应后命中（outcome=hit）→ 箭头进入淡出 arrive、操作完成（不再停留 solid）", () => {
    let s = createStage();
    s = stageReducer(s, ev(1, "ATTACK_DECLARED", { attackerSeat: 1, targetRefs: ["public:seat_3"] }));
    s = stageReducer(s, ev(2, "RESPONSE_RESOLVED", { responderSeat: 3, result: "passed" }));
    s = stageReducer(s, ev(3, "ATTACK_RESOLVED", { attackId: "a1", result: "resolved", outcome: "hit" }));
    expect(s.arrows[0]!.phase).toBe("arrive");
    expect(s.operations[0]!.state).toBe("done");
  });

  it("攻击箭头基线效果色：元素攻击取元素色（火/毒/感电），普通攻击伤害红", () => {
    let s = createStage();
    s = stageReducer(s, ev(1, "ATTACK_DECLARED", { attackerSeat: 1, targetRefs: ["public:seat_3"], damageSegments: [{ amount: 2, repeat: 1, element: "fire", damageType: "damage" }] }));
    expect(s.arrows[0]!.effect).toBe("fire");
    // 命中（扣盾）不覆盖元素色——效果主体是元素
    s = stageReducer(s, ev(2, "DAMAGE_SEGMENT_APPLIED", { targetRef: "public:seat_3", segmentIndex: 1, totalSegments: 1, amount: 2, hpLost: 0, shieldLost: 2 }));
    expect(s.arrows[0]!.effect).toBe("fire");
    expect(s.arrows[0]!.phase).toBe("arrive");
    // 普通攻击命中扣盾 → 盾灰；扣血 → 血红
    let n = createStage();
    n = stageReducer(n, ev(1, "ATTACK_DECLARED", { attackerSeat: 1, targetRefs: ["public:seat_3"] }));
    n = stageReducer(n, ev(2, "DAMAGE_SEGMENT_APPLIED", { targetRef: "public:seat_3", segmentIndex: 1, totalSegments: 1, amount: 2, hpLost: 0, shieldLost: 2 }));
    expect(n.arrows[0]!.effect).toBe("shield");
  });

  it("多目标攻击：单个目标结算（perTarget）只完成该目标箭头，其余目标箭头保留；整次攻击结束才收尾", () => {
    let s = createStage();
    s = stageReducer(s, ev(1, "ATTACK_DECLARED", { attackerSeat: 1, targetRefs: [] }, "op-m"));
    s = stageReducer(s, ev(2, "ATTACK_TARGETED", { attackerSeat: 1, targetRefs: ["public:seat_2", "public:seat_3"] }, "op-m"));
    expect(s.arrows.filter((a) => a.opId === "op-m")).toHaveLength(2);
    s = stageReducer(s, ev(3, "DAMAGE_SEGMENT_APPLIED", { targetRef: "public:seat_2", segmentIndex: 1, totalSegments: 1, amount: 2, hpLost: 2, shieldLost: 0 }, "op-m"));
    s = stageReducer(s, ev(4, "ATTACK_RESOLVED", { attackId: "a1", result: "resolved", outcome: "hit", perTarget: [{ targetRef: "public:seat_2", hpLost: 2, shieldLost: 0 }] }, "op-m"));
    const arrow2 = s.arrows.find((a) => a.to === 2)!;
    const arrow3 = s.arrows.find((a) => a.to === 3)!;
    expect(arrow2.completed).toBe(true);
    expect(arrow2.phase).toBe("arrive");
    expect(arrow3.completed).toBeUndefined();
    expect(arrow3.phase).toBe("standby"); // 目标2箭头保留
    expect(s.operations[0]!.state).toBe("active");
    // 整次攻击结束（无 perTarget）→ 目标3箭头也淡出、操作收尾
    s = stageReducer(s, ev(5, "ATTACK_RESOLVED", { attackId: "a1", result: "resolved", outcome: "hit" }, "op-m"));
    expect(s.arrows.find((a) => a.to === 3)!.phase).toBe("arrive");
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
  it("出牌进主区（带 templateId → 主区可显示牌面）；新操作开始摊入临时弃牌；操作结束 → 弃牌堆", () => {
    let s = createStage();
    s = stageReducer(s, ev(1, "CARD_PLAYED", { seat: 1, cardRef: "private:u1:c1", templateId: "basic.kill.blue", purpose: "attack" }));
    expect(s.mainCards.map((c) => c.ref)).toContain("private:u1:c1");
    expect(s.mainCards[0]!.templateId).toBe("basic.kill.blue");
    s = stageReducer(s, ev(2, "ATTACK_DECLARED", { attackerSeat: 1, targetRefs: ["public:seat_3"] }, "op-x"));
    expect(s.tempDiscard.map((c) => c.ref)).toContain("private:u1:c1");
    s = stageReducer(s, ev(3, "ATTACK_RESOLVED", { attackId: "a1", result: "resolved", outcome: "hit" }, "op-x"));
    expect(s.discardRefs.some((d) => d.ref === "private:u1:c1")).toBe(true);
    expect(s.discardRefs.find((d) => d.ref === "private:u1:c1")!.templateId).toBe("basic.kill.blue");
    expect(s.tempDiscard).toHaveLength(0);
  });

  it("真实事件顺序：CARD_PLAYED 晚于 ATTACK_TARGETED——操作结束牌仍停留主区，下一操作开始才清走", () => {
    let s = createStage();
    s = stageReducer(s, ev(1, "ATTACK_DECLARED", { attackerSeat: 1, targetRefs: ["public:seat_3"] }, "op-x"));
    s = stageReducer(s, ev(2, "ATTACK_TARGETED", { attackerSeat: 1, targetRefs: ["public:seat_3"] }, "op-x"));
    s = stageReducer(s, ev(3, "CARD_PLAYED", { seat: 1, cardRef: "private:u1:c1", templateId: "basic.kill.blue", purpose: "attack" }));
    expect(s.mainCards.map((c) => c.ref)).toContain("private:u1:c1");
    s = stageReducer(s, ev(4, "ATTACK_RESOLVED", { attackId: "a1", result: "resolved", outcome: "hit" }, "op-x"));
    expect(s.mainCards.map((c) => c.ref)).toContain("private:u1:c1"); // 操作结束牌仍停留主区
    expect(s.discardRefs).toHaveLength(0);
    s = stageReducer(s, ev(5, "ATTACK_DECLARED", { attackerSeat: 2, targetRefs: ["public:seat_1"] }, "op-y"));
    expect(s.mainCards).toHaveLength(0); // 下一操作开始才清走
    expect(s.tempDiscard.map((c) => c.ref)).toContain("private:u1:c1");
    s = stageReducer(s, ev(6, "ATTACK_RESOLVED", { attackId: "a2", result: "resolved", outcome: "hit" }, "op-y"));
    expect(s.discardRefs.some((d) => d.ref === "private:u1:c1")).toBe(true);
  });

  it("弃牌堆超过上限只保留最新（队列结构）", () => {
    let s = createStage();
    for (let i = 1; i <= 15; i++) {
      s = stageReducer(s, ev(i, "CARD_PLAYED", { seat: 1, cardRef: `private:u1:c${i}`, purpose: "attack" }));
      s = stageReducer(s, ev(1000 + i, "ATTACK_DECLARED", { attackerSeat: 1, targetRefs: ["public:seat_3"] }, `op-${i}`));
      s = stageReducer(s, ev(2000 + i, "ATTACK_RESOLVED", { attackId: `a${i}`, result: "resolved", outcome: "hit" }, `op-${i}`));
    }
    expect(s.discardRefs.length).toBe(DISCARD_CAP);
    expect(s.discardRefs[0]!.ref).toBe("private:u1:c4");
    expect(s.discardRefs[DISCARD_CAP - 1]!.ref).toBe("private:u1:c15");
  });

  it("弃牌事件（CARD_DISCARDED）直接入弃牌堆并保留 templateId（弃牌堆显示正面图）", () => {
    let s = createStage();
    s = stageReducer(s, ev(1, "CARD_DISCARDED", { seat: 1, cardRef: "private:u1:c9", templateId: "basic.kill.white", reason: "discard" }));
    expect(s.discardRefs.some((d) => d.ref === "private:u1:c9" && d.templateId === "basic.kill.white")).toBe(true);
    expect(s.mainCards).toHaveLength(0);
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

describe("stageMachine 各类操作命中特效（132 §4.3 修订：效果色填充闪光）", () => {
  it("回复（HEALTH_CHANGED recovered）：自指环 heal 色闪光，操作立即结束（arrive 阶段）", () => {
    let s = createStage();
    s = stageReducer(s, ev(1, "HEALTH_CHANGED", { seat: 1, change: "recovered", amount: 2 }));
    expect(s.arrows).toHaveLength(1);
    expect(s.arrows[0]).toMatchObject({ selfLoop: true, phase: "arrive", effect: "heal" });
    expect(s.operations[0]!.state).toBe("done");
  });

  it("掉血（HEALTH_CHANGED lost）不产生回复闪光", () => {
    let s = createStage();
    s = stageReducer(s, ev(1, "HEALTH_CHANGED", { seat: 3, change: "hpLost", amount: 1 }));
    expect(s.arrows).toHaveLength(0);
  });

  it("控制（STATUS_CHANGED applied 冰冻）：目标自指环 frozen 色闪光", () => {
    let s = createStage();
    s = stageReducer(s, ev(1, "STATUS_CHANGED", { targetRef: "public:seat_2", statusId: "status.frozen", change: "applied" }));
    expect(s.arrows[0]).toMatchObject({ to: 2, selfLoop: true, effect: "frozen", phase: "arrive" });
  });

  it("控制（STATUS_CHANGED applied 感电）：electric 色", () => {
    let s = createStage();
    s = stageReducer(s, ev(1, "STATUS_CHANGED", { targetRef: "public:seat_2", statusId: "status.electrified", change: "applied" }));
    expect(s.arrows[0]!.effect).toBe("electric");
  });

  it("技能/触发（TRIGGER_RESOLVED）：施放者自指环 cost 金闪光", () => {
    let s = createStage();
    s = stageReducer(s, ev(1, "TRIGGER_RESOLVED", { seat: 1, action: "ability", abilityId: "skill.knight.charge" }));
    expect(s.arrows[0]).toMatchObject({ selfLoop: true, effect: "cost", phase: "arrive" });
    expect(s.operations[0]!.kind).toBe("ability");
  });

  it("非控制状态不产生闪光（STATUS_CHANGED invincible）", () => {
    let s = createStage();
    s = stageReducer(s, ev(1, "STATUS_CHANGED", { targetRef: "public:seat_2", statusId: "status.invincible", change: "applied" }));
    expect(s.arrows).toHaveLength(0);
  });
});;
