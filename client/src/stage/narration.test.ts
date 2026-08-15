// 主区词条构建 TDD（132 §2.3/§5 修订：当前正在进行的操作完整叙述，token 复用 128 三色系）。
import { describe, expect, it } from "vitest";
import { buildNarration, type NarrationCtx } from "./narration";

const ctx: NarrationCtx = {
  characterName: (seat) => (seat ? `角色${seat}` : "系统"),
  relationshipCls: (seat) => (seat === 1 ? "rel-self" : seat === 2 ? "rel-ally" : "rel-enemy"),
  cardName: (id) => `牌${id}`,
  cardCls: (color) => (color ? `card-${color}` : null),
  abilityName: (id) => `技${String(id).split(".").pop()}`,
  attackCtx: {},
};

const ev = (seq: number, eventType: string, payload: Record<string, unknown>) => ({ eventSeq: seq, eventType, payload });
const text = (line: { segments: { text: string }[] } | null) => (line ? line.segments.map((s) => s.text).join("") : "");

describe("narration 主区词条（当前正在进行的操作完整叙述）", () => {
  it("ATTACK_DECLARED 仅缓存武器/距离/伤害（不单独出词条）", () => {
    expect(buildNarration(ev(1, "ATTACK_DECLARED", { attackerSeat: 1, weaponTemplateId: "weapon.w08", weaponColor: "green", range: 2, attackTypes: ["ranged"], damageSegments: [{ amount: 2, repeat: 1, element: "none", damageType: "normal" }] }), ctx)).toBeNull();
  });

  it("攻击：骑士使用【剧毒之鹰】攻击 目标：距离+伤害段（卡色+元素色）", () => {
    buildNarration(ev(1, "ATTACK_DECLARED", { attackerSeat: 1, weaponTemplateId: "weapon.w08", weaponColor: "green", range: 2, attackTypes: ["ranged"], damageSegments: [{ amount: 2, repeat: 1, element: "none", damageType: "normal" }, { amount: 1, repeat: 2, element: "poison", damageType: "normal" }] }), ctx);
    const line = buildNarration(ev(2, "ATTACK_TARGETED", { attackerSeat: 1, targetRefs: ["public:seat_3"] }), ctx);
    expect(text(line)).toBe("角色1使用【牌weapon.w08】攻击角色3：远程2伤害2+1×2毒");
    expect(line!.segments[0]!.cls).toBe("rel-self");
    expect(line!.segments.find((s) => s.text === "牌weapon.w08")!.cls).toBe("card-green");
    expect(line!.segments.find((s) => s.text === "1×2毒")!.cls).toBe("sem-poison");
    expect(line!.segments.find((s) => s.text === "2")!.cls).toBe("sem-normal");
  });

  it("攻击：无武器（手刀）则省略武器名", () => {
    ctx.attackCtx = {};
    const line = buildNarration(ev(1, "ATTACK_TARGETED", { attackerSeat: 2, targetRefs: ["public:seat_4"] }), ctx);
    expect(text(line)).toBe("角色2攻击角色4");
  });

  it("多目标攻击：目标并列", () => {
    buildNarration(ev(1, "ATTACK_DECLARED", { attackerSeat: 1, weaponTemplateId: "weapon.w01", weaponColor: "red", range: 2, attackTypes: ["ranged"], damageSegments: [{ amount: 2, repeat: 1, element: "none", damageType: "normal" }] }), ctx);
    const line = buildNarration(ev(2, "ATTACK_TARGETED", { attackerSeat: 1, targetRefs: ["public:seat_3", "public:seat_4"] }), ctx);
    expect(text(line)).toBe("角色1使用【牌weapon.w01】攻击角色3、角色4：远程2伤害2");
  });

  it("伤害段结果：命中，目标护盾-2（sem-shield）", () => {
    const line = buildNarration(ev(3, "DAMAGE_SEGMENT_APPLIED", { targetRef: "public:seat_3", amount: 2, hpLost: 0, shieldLost: 2 }), ctx);
    expect(text(line)).toContain("命中");
    expect(text(line)).toContain("护盾-2");
    expect(line!.segments.some((s) => s.cls === "sem-shield")).toBe(true);
  });

  it("伤害段结果：命中，目标血-2（sem-hp）", () => {
    const line = buildNarration(ev(4, "DAMAGE_SEGMENT_APPLIED", { targetRef: "public:seat_3", amount: 2, hpLost: 2, shieldLost: 0 }), ctx);
    expect(text(line)).toContain("血-2");
    expect(line!.segments.some((s) => s.cls === "sem-hp")).toBe(true);
  });

  it("判定：翻出红牌（card-red）", () => {
    const line = buildNarration(ev(5, "JUDGMENT_REVEALED", { card: { ref: "public:j1", displayName: "红牌", printedColor: "red" }, printedColor: "red" }), ctx);
    expect(text(line)).toContain("翻出");
    expect(line!.segments.some((s) => s.cls === "card-red")).toBe(true);
  });

  it("摸牌：他人只见数量（不泄牌名）", () => {
    const line = buildNarration(ev(6, "CARD_DRAWN", { seat: 2, count: 3, cardRefs: [] }), ctx);
    expect(text(line)).toBe("角色2摸3张");
  });

  it("回复：sem-heal", () => {
    const line = buildNarration(ev(7, "HEALTH_CHANGED", { seat: 1, change: "recovered", amount: 2 }), ctx);
    expect(text(line)).toBe("角色1回复+2");
    expect(line!.segments.some((s) => s.cls === "sem-heal")).toBe(true);
  });

  it("未知事件不产出词条", () => {
    expect(buildNarration(ev(8, "PHASE_CHANGED", { activeSeat: 1, phase: "draw" }), ctx)).toBeNull();
  });

  it("出牌：谁使用【卡名】（templateId 显示牌名）", () => {
    const line = buildNarration(ev(9, "CARD_PLAYED", { seat: 1, cardRef: "public:card:x", templateId: "basic.potion.orange", purpose: "play" }), ctx);
    expect(text(line)).toBe("角色1使用【牌basic.potion.orange】");
  });

  it("装备：谁装备【卡名】", () => {
    const line = buildNarration(ev(9, "CARD_PLAYED", { seat: 1, cardRef: "public:card:x", templateId: "armor.a01", purpose: "equip" }), ctx);
    expect(text(line)).toBe("角色1装备【牌armor.a01】");
  });

  it("合成：谁合成【卡名】", () => {
    const line = buildNarration(ev(9, "CARD_PLAYED", { seat: 1, cardRef: "public:card:x", templateId: "weapon.w49", purpose: "synthesize" }), ctx);
    expect(text(line)).toBe("角色1合成【牌weapon.w49】");
  });

  it("技能：谁发动技能【名】（sem-extra）", () => {
    const line = buildNarration(ev(10, "TRIGGER_RESOLVED", { seat: 1, action: "ability", abilityId: "skill.wizard.spell_strike" }), ctx);
    expect(text(line)).toBe("角色1发动技能【技spell_strike】");
    expect(line!.segments.some((s) => s.cls === "sem-extra")).toBe(true);
  });

  it("雕像：谁的雕像【名】结算", () => {
    const line = buildNarration(ev(11, "TRIGGER_RESOLVED", { seat: 2, action: "statue", abilityId: "statue.werewolf" }), ctx);
    expect(text(line)).toBe("角色2的雕像【牌statue.werewolf】结算");
  });

  it("响应：放弃", () => {
    const line = buildNarration(ev(12, "RESPONSE_RESOLVED", { responderSeat: 3, result: "passed" }), ctx);
    expect(text(line)).toBe("角色3放弃响应");
  });

  it("响应：出【闪】闪避，不受伤害", () => {
    const line = buildNarration(ev(13, "RESPONSE_RESOLVED", { responderSeat: 3, result: "dodge" }), ctx);
    expect(text(line)).toContain("闪避");
    expect(text(line)).toContain("不受伤害");
  });

  it("攻击结果：命中", () => {
    const line = buildNarration(ev(14, "ATTACK_RESOLVED", { attackId: "a1", result: "resolved", outcome: "hit" }), ctx);
    expect(text(line)).toBe("命中");
  });

  it("攻击结果：未命中（近战格挡）", () => {
    const line = buildNarration(ev(15, "ATTACK_RESOLVED", { attackId: "a1", result: "meleeBlock", outcome: "miss" }), ctx);
    expect(text(line)).toContain("未命中");
  });

  it("攻击结果：被全部无效", () => {
    const line = buildNarration(ev(16, "ATTACK_RESOLVED", { attackId: "a1", result: "invalidated", outcome: "invalidated" }), ctx);
    expect(text(line)).toContain("无效");
  });

  it("失去生命带数值：失去2", () => {
    const line = buildNarration(ev(17, "HEALTH_CHANGED", { seat: 3, change: "lost", amount: 2 }), ctx);
    expect(text(line)).toBe("角色3失去2");
  });

  it("状态施加：谁获得状态", () => {
    const line = buildNarration(ev(18, "STATUS_CHANGED", { targetRef: "public:seat_3", statusId: "status.frozen", change: "applied" }), ctx);
    expect(text(line)).toContain("获得");
    expect(text(line)).toContain("frozen");
    expect(line!.segments.some((s) => s.cls === "sem-extra")).toBe(true);
  });
});
