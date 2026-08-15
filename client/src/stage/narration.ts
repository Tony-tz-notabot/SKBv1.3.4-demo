// 主区词条构建（132 §2.3/§5 修订）：把演示事件转成"当前正在进行的操作"的完整叙述 token 段，
// 复用 128 三色系（rel-关系色 / card-卡牌印刷色 / sem-语义色）。不泄露私密信息（摸牌只报数量）。
// 攻击叙述含：主语(角色名) 使用【武器名】(卡色) 攻击 目标(关系色)：距离X · 伤害段(元素色)；
// 命中后写效果（护盾-2/血-1），响应写结果（放弃/出闪闪避/近战格挡）。

export interface NarrationCtx {
  /** 座位→角色名（如"骑士"） */
  characterName: (seat: number | null) => string;
  /** 座位→关系色类（rel-self/rel-ally/rel-enemy），观战可为 null */
  relationshipCls: (seat: number | null) => string | null;
  /** 卡牌模板 ID → 卡名 */
  cardName: (templateId: string) => string;
  /** 卡牌印刷色 → 卡色类（card-white/green/blue/orange/red） */
  cardCls: (color?: string | null) => string | null;
  /** 技能/天赋 ID → 技能名（如"狂战"） */
  abilityName: (id: string) => string;
  /** 攻击详情缓存：ATTACK_DECLARED 写入，ATTACK_TARGETED/DAMAGE 读取（嵌套攻击时取最近一次声明） */
  attackCtx: {
    weaponTemplateId?: string;
    weaponColor?: string;
    range?: number;
    attackTypes?: string[];
    damageSegments?: Array<{ amount: number; repeat: number; element: string; damageType: string; isAdditional?: boolean }>;
  };
}

export interface NarrationSegment {
  text: string;
  cls: string | null;
}

export interface NarrationLine {
  id: string;
  seq: number;
  segments: NarrationSegment[];
}

export interface NarrationEvent {
  eventSeq: number;
  eventType: string;
  payload: Record<string, unknown>;
}

const seatOf = (ref: unknown): number | null => {
  const m = /^public:seat_(\d)$/.exec(String(ref ?? ""));
  return m ? Number(m[1]) : null;
};

const seatOrNull = (value: unknown): number | null => {
  if (typeof value === "number" && value >= 1 && value <= 4) return value;
  return seatOf(value);
};

const seg = (text: string, cls: string | null = null): NarrationSegment => ({ text, cls });

const ATTACK_TYPE_TEXT: Record<string, string> = { ranged: "远程", melee: "近战", laser: "激光", field: "场地" };
const ELEMENT_TEXT: Record<string, string> = { fire: "火", poison: "毒", electric: "感电" };
const ELEMENT_CLS: Record<string, string> = { fire: "sem-fire", poison: "sem-poison", electric: "sem-electric" };

/** 伤害段文本："2" / "1×2毒" / "3火"，按元素着色。 */
function segmentText(seg_: { amount: number; repeat: number; element: string; isAdditional?: boolean }): NarrationSegment {
  const amount = Number(seg_.amount ?? 0);
  const repeat = Number(seg_.repeat ?? 1);
  const element = seg_.element && seg_.element !== "none" ? ELEMENT_TEXT[seg_.element] : undefined;
  const text = `${amount}${repeat > 1 ? `×${repeat}` : ""}${element ? element : ""}`;
  const cls = element ? (ELEMENT_CLS[seg_.element] ?? null) : "sem-normal";
  return seg(text, cls);
}

/** 攻击类型+距离："远程2"。 */
function rangeText(attackTypes: string[] | undefined, range: number | undefined): NarrationSegment | null {
  const type = attackTypes && attackTypes[0] ? (ATTACK_TYPE_TEXT[attackTypes[0]] ?? "") : "";
  if (typeof range === "number") {
    return seg(`${type}${range}`, "sem-normal");
  }
  if (type) return seg(type, "sem-normal");
  return null;
}

export function buildNarration(ev: NarrationEvent, ctx: NarrationCtx): NarrationLine | null {
  const p = ev.payload;
  let segments: NarrationSegment[] | null = null;

  switch (ev.eventType) {
    case "ATTACK_DECLARED": {
      // 缓存武器/距离/伤害段，供 ATTACK_TARGETED 拼完整句
      const atk = ctx.attackCtx;
      if (typeof p.weaponTemplateId === "string") atk.weaponTemplateId = p.weaponTemplateId;
      if (typeof p.weaponColor === "string") atk.weaponColor = p.weaponColor;
      if (typeof p.range === "number") atk.range = p.range;
      if (Array.isArray(p.attackTypes)) atk.attackTypes = p.attackTypes.map(String);
      if (Array.isArray(p.damageSegments)) atk.damageSegments = p.damageSegments as typeof atk.damageSegments;
      break; // 不单独出词条（目标在 ATTACK_TARGETED 才有）
    }
    case "ATTACK_TARGETED": {
      const actor = seatOrNull(p.attackerSeat);
      const targets = (Array.isArray(p.targetRefs) ? p.targetRefs : []).map(seatOf).filter((s): s is number => s !== null);
      // 服务端 ATTACK_TARGETED 已带完整攻击详情；回退 ATTACK_DECLARED 缓存的 attackCtx
      const atk = ctx.attackCtx;
      const weaponTemplateId = typeof p.weaponTemplateId === "string" ? p.weaponTemplateId : atk.weaponTemplateId;
      const weaponColor = typeof p.weaponColor === "string" ? p.weaponColor : atk.weaponColor;
      const range = typeof p.range === "number" ? p.range : atk.range;
      const attackTypes = Array.isArray(p.attackTypes) ? p.attackTypes.map(String) : atk.attackTypes;
      const damageSegments = Array.isArray(p.damageSegments) ? p.damageSegments : atk.damageSegments;
      const actorName = actor != null ? ctx.characterName(actor) : "？";
      const actorCls = actor != null ? ctx.relationshipCls(actor) : null;
      const weapon = weaponTemplateId
        ? [seg("使用【", null), seg(ctx.cardName(weaponTemplateId), ctx.cardCls(weaponColor)), seg("】", null)]
        : [seg("攻击", null)];
      const action = weaponTemplateId ? [seg("攻击", null)] : [];
      const targetText = targets.map((t) => seg(ctx.characterName(t), ctx.relationshipCls(t)));
      const joined = targets.map((t) => ctx.characterName(t)).join("、");
      const detail: NarrationSegment[] = [];
      const rangeSeg = rangeText(attackTypes, range);
      if (rangeSeg) detail.push(rangeSeg);
      if (damageSegments && damageSegments.length) {
        detail.push(seg("伤害", null));
        damageSegments.forEach((d, i) => {
          if (i > 0) detail.push(seg("+", null));
          detail.push(segmentText(d));
        });
      }
      segments = [seg(actorName, actorCls), ...weapon, ...action, ...targetText];
      if (targets.length > 1) {
        segments = [seg(actorName, actorCls), ...weapon, ...action, seg(joined, null)];
      }
      if (detail.length) segments.push(seg("：", null), ...detail);
      break;
    }
    case "DAMAGE_SEGMENT_APPLIED": {
      const target = seatOf(p.targetRef);
      const hpLost = Number(p.hpLost ?? 0);
      const shieldLost = Number(p.shieldLost ?? 0);
      if (target !== null) {
        segments = [seg("命中", "sem-normal"), seg("：", null), seg(ctx.characterName(target), ctx.relationshipCls(target))];
        if (shieldLost > 0) segments.push(seg(`护盾-${shieldLost}`, "sem-shield"));
        if (hpLost > 0) segments.push(seg(`血-${hpLost}`, "sem-hp"));
        if (!hpLost && !shieldLost) segments.push(seg("受到伤害", "sem-normal"));
      }
      break;
    }
    case "JUDGMENT_REVEALED": {
      const card = (p.card ?? {}) as { displayName?: string; printedColor?: string };
      const color = String(p.printedColor ?? card.printedColor ?? "");
      const colorCls = color ? `card-${color}` : null;
      segments = [seg("判定：翻出", null), seg(String(card.displayName ?? "判定牌"), colorCls)];
      break;
    }
    case "CARD_DRAWN": {
      const seat = seatOrNull(p.seat);
      const count = Number(p.count ?? 0);
      if (seat !== null) segments = [seg(ctx.characterName(seat), ctx.relationshipCls(seat)), seg(`摸${count}张`, null)];
      break;
    }
    case "CARD_PLAYED": {
      const seat = seatOrNull(p.seat);
      const tpl = typeof p.templateId === "string" ? p.templateId : null;
      const purpose = String(p.purpose ?? "");
      const verb = purpose === "equip" ? "装备" : purpose === "synthesize" ? "合成" : purpose === "transform" ? "变为" : purpose.startsWith("attack.") ? "打出" : "使用";
      if (seat !== null) {
        segments = [seg(ctx.characterName(seat), ctx.relationshipCls(seat)), seg(verb, null)];
        if (tpl) segments.push(seg(`【${ctx.cardName(tpl)}】`, ctx.cardCls(typeof p.weaponColor === "string" ? p.weaponColor : undefined)));
        else segments.push(seg("1张牌", null));
      }
      break;
    }
    case "TRIGGER_RESOLVED": {
      const seat = seatOrNull(p.seat);
      const action = String(p.action ?? "ability");
      const abilityId = typeof p.abilityId === "string" ? p.abilityId : null;
      if (seat !== null) {
        segments = [seg(ctx.characterName(seat), ctx.relationshipCls(seat))];
        if (action === "statue" && abilityId) {
          segments.push(seg("的雕像【", null), seg(ctx.cardName(abilityId), ctx.cardCls()), seg("】结算", "sem-extra"));
        } else if (abilityId) {
          segments.push(seg("发动技能【", null), seg(ctx.abilityName(abilityId), "sem-extra"), seg("】", null));
        } else {
          segments.push(seg(action === "trigger" ? "触发效果" : "发动技能", "sem-extra"));
        }
      }
      break;
    }
    case "RESPONSE_RESOLVED": {
      const seat = seatOrNull(p.responderSeat);
      const result = String(p.result ?? "");
      if (seat !== null) {
        const who = [seg(ctx.characterName(seat), ctx.relationshipCls(seat))];
        if (/pass/.test(result)) segments = [...who, seg("放弃响应", null)];
        else if (/dodge/.test(result)) segments = [...who, seg("出【闪】闪避，不受伤害", "sem-extra")];
        else if (/meleeBlock/.test(result)) segments = [...who, seg("近战格挡，不受伤害", "sem-extra")];
        else if (/armor/.test(result)) segments = [...who, seg("防具抵挡，不受伤害", "sem-extra")];
        else segments = [...who, seg("响应", "sem-normal")];
      }
      break;
    }
    case "ATTACK_RESOLVED": {
      const outcome = String(p.outcome ?? "").toLowerCase();
      const result = String(p.result ?? "");
      if (outcome === "hit" || result === "resolved") segments = [seg("命中", "sem-normal")];
      else if (outcome === "miss" || /meleeBlock|armorJudgment|dodge/.test(result)) segments = [seg("未命中，不受伤害", "sem-normal")];
      else if (outcome === "invalidated" || outcome === "cancelled" || /invalidated|cancelled/.test(result)) segments = [seg("攻击被全部无效", "sem-normal")];
      break;
    }
    case "HEALTH_CHANGED": {
      const seat = seatOrNull(p.seat);
      const change = String(p.change ?? "");
      const amount = Number(p.amount ?? 0);
      if (seat !== null) {
        segments = [seg(ctx.characterName(seat), ctx.relationshipCls(seat))];
        if (change === "recovered") {
          segments.push(seg("回复", "sem-heal"));
          if (amount) segments.push(seg(`+${amount}`, "sem-heal"));
        } else if (change === "lost" || change === "broken") {
          segments.push(seg("失去", "sem-hp"));
          if (amount) segments.push(seg(`${amount}`, "sem-hp"));
        } else segments.push(seg("生命变化", "sem-normal"));
      }
      break;
    }
    case "STATUS_CHANGED": {
      const target = seatOf(p.targetRef);
      const statusId = String(p.statusId ?? "");
      const statusTail = statusId.split(".").pop() ?? statusId;
      const change = String(p.change ?? "");
      if (target !== null) {
        segments = [seg(ctx.characterName(target), ctx.relationshipCls(target))];
        if (change === "applied" || change === "refreshed") {
          segments.push(seg("获得", null), seg(statusTail, "sem-extra"));
        } else if (change === "removed" || change === "expired") {
          segments.push(seg("失去", null), seg(statusTail, "sem-extra"));
        } else segments.push(seg("状态变化", "sem-extra"));
      }
      break;
    }
  }

  if (!segments) return null;
  return { id: `n:${ev.eventSeq}`, seq: ev.eventSeq, segments };
}
