// 主区词条构建（132 §2.3/§5）：把演示事件转成"全员可见叙述"token 段，
// 复用 128 三色系（rel-关系色 / card-卡牌印刷色 / sem-语义色）。不泄露私密信息（摸牌只报数量）。

export interface NarrationCtx {
  /** 座位→角色名（如"骑士"） */
  characterName: (seat: number | null) => string;
  /** 座位→关系色类（rel-self/rel-ally/rel-enemy），观战可为 null */
  relationshipCls: (seat: number | null) => string | null;
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

/** 座位字段可能是数字（attackerSeat/seat）或 public:seat_N 引用（targetRef），统一解析。 */
const seatOrNull = (value: unknown): number | null => {
  if (typeof value === "number" && value >= 1 && value <= 4) return value;
  return seatOf(value);
};

const seg = (text: string, cls: string | null = null): NarrationSegment => ({ text, cls });

export function buildNarration(ev: NarrationEvent, ctx: NarrationCtx): NarrationLine | null {
  const p = ev.payload;
  let segments: NarrationSegment[] | null = null;

  switch (ev.eventType) {
    case "ATTACK_DECLARED": {
      const actor = seatOrNull(p.attackerSeat);
      const targets = (Array.isArray(p.targetRefs) ? p.targetRefs : [])
        .map(seatOf)
        .filter((s): s is number => s !== null);
      segments = [seg(ctx.characterName(actor), ctx.relationshipCls(actor)), seg("攻击", null)];
      if (targets.length) {
        segments.push(
          seg(
            targets.map((t) => ctx.characterName(t)).join("、"),
            targets.length === 1 ? ctx.relationshipCls(targets[0]!) : null,
          ),
        );
      }
      break;
    }
    case "DAMAGE_SEGMENT_APPLIED": {
      const target = seatOf(p.targetRef);
      const hpLost = Number(p.hpLost ?? 0);
      const shieldLost = Number(p.shieldLost ?? 0);
      if (target !== null) {
        segments = [seg(ctx.characterName(target), ctx.relationshipCls(target))];
        if (hpLost > 0) segments.push(seg(`血量-${hpLost}`, "sem-hp"));
        if (shieldLost > 0) segments.push(seg(`护盾-${shieldLost}`, "sem-shield"));
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
      if (seat !== null) segments = [seg(`${ctx.characterName(seat)}摸${count}张`, null)];
      break;
    }
    case "CARD_PLAYED": {
      const seat = seatOrNull(p.seat);
      if (seat !== null) segments = [seg(ctx.characterName(seat), ctx.relationshipCls(seat)), seg("打出1张牌", null)];
      break;
    }
    case "RESPONSE_RESOLVED": {
      const seat = seatOrNull(p.responderSeat);
      if (seat !== null) segments = [seg(ctx.characterName(seat), ctx.relationshipCls(seat)), seg("响应", "sem-normal")];
      break;
    }
    case "ATTACK_RESOLVED": {
      const outcome = String(p.outcome ?? "").toLowerCase();
      const result = String(p.result ?? "");
      if (outcome === "hit" || result === "resolved") segments = [seg("命中", "sem-normal")];
      else if (outcome === "miss" || /meleeBlock|armorJudgment|dodge/.test(result)) segments = [seg("未命中", "sem-normal")];
      else if (outcome === "invalidated" || outcome === "cancelled" || /invalidated|cancelled/.test(result)) segments = [seg("被全部无效", "sem-normal")];
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
