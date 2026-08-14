// 中央战斗区状态机（132 §4/§10 M1）：纯函数 reducer。
// 事件流 → 操作组（启发式 / operationId 两模式）→ 箭头状态机（standby→solid/voided→flow→arrive）
// → 嵌套操作透明度降级（R4）→ 主区/临时弃牌/弃牌堆牌流（R5）。
import { effectKindFromSegment, type EffectKind } from "./effectColors";

export type Endpoint = number | "center";
export type ArrowPhase = "standby" | "solid" | "flow" | "arrive" | "voided";
export type OpState = "active" | "done" | "voided";

export interface StageEvent {
  eventSeq: number;
  eventType: string;
  payload: Record<string, unknown>;
  /** 服务端最小补齐①：事件外层可选 operationId（攻击链分组键） */
  operationId?: string;
}

export interface StageSegment {
  index: number;
  total: number;
  amount: number;
  hpLost: number;
  shieldLost: number;
  target: number;
}

export interface StageArrow {
  id: string;
  opId: string;
  from: Endpoint;
  to: Endpoint;
  selfLoop: boolean;
  phase: ArrowPhase;
  effect: EffectKind;
  depth: number;
  /** 嵌套透明度：顶层操作 1，其余 DIM_OPACITY（R4） */
  opacity: number;
  segments: StageSegment[];
  voidReason?: string;
}

export interface StageOperation {
  opId: string;
  kind: string;
  actorSeat: number | null;
  targetSeats: number[];
  state: OpState;
  depth: number;
  startedSeq: number;
  endedSeq?: number;
  arrowIds: string[];
}

export interface StageCard {
  ref: string;
  faceUp: boolean;
  printedColor?: string;
  /** 判定成功→success（边缘色光）/失败→fail（变暗），R7 */
  highlight?: "success" | "fail" | null;
  /** 判定/展示翻牌入场（rotateY） */
  flipIn?: boolean;
  step: number;
}

export interface DrawRecord {
  seq: number;
  seat: number;
  count: number;
  /** 本人见牌（cardRefs 非空）→ 正面；他人 → 背面（R6） */
  faceUp: boolean;
}

export interface StageState {
  seq: number;
  operations: StageOperation[];
  arrows: StageArrow[];
  mainCards: StageCard[];
  tempDiscard: StageCard[];
  /** 弃牌堆：条状队列，有大小上限（R5） */
  discardRefs: string[];
  draws: DrawRecord[];
  cardStep: number;
}

export const DISCARD_CAP = 12;
export const DIM_OPACITY = 0.35;

export function createStage(): StageState {
  return { seq: 0, operations: [], arrows: [], mainCards: [], tempDiscard: [], discardRefs: [], draws: [], cardStep: 0 };
}

const seatOf = (ref: unknown): number | null => {
  const m = /^public:seat_(\d)$/.exec(String(ref ?? ""));
  return m ? Number(m[1]) : null;
};
const refSeats = (refs: unknown): number[] =>
  (Array.isArray(refs) ? refs : []).map(seatOf).filter((s): s is number => s !== null);

const cloneState = (s: StageState): StageState => ({
  ...s,
  operations: s.operations.map((o) => ({ ...o })),
  arrows: s.arrows.map((a) => ({ ...a, segments: a.segments.slice() })),
  mainCards: s.mainCards.slice(),
  tempDiscard: s.tempDiscard.slice(),
  discardRefs: s.discardRefs.slice(),
  draws: s.draws.slice(),
});

function topActiveOp(state: StageState): StageOperation | null {
  const active = state.operations.filter((o) => o.state === "active");
  return active[active.length - 1] ?? null;
}

/** R4：顶层操作的箭头全透明度，其余 0.35 降级。 */
function refreshOpacities(state: StageState): void {
  const top = topActiveOp(state);
  for (const arrow of state.arrows) {
    arrow.opacity = top && arrow.opId === top.opId ? 1 : DIM_OPACITY;
  }
}

/** R5 步骤推进：主区牌按序摊入临时弃牌区。 */
function flushMainToTemp(state: StageState): void {
  if (state.mainCards.length) {
    state.tempDiscard.push(...state.mainCards);
    state.mainCards = [];
  }
  state.cardStep += 1;
}

/** R5 操作结束：临时弃牌全部进入弃牌堆（队列上限）。 */
function settleDiscard(state: StageState): void {
  if (state.tempDiscard.length) {
    state.discardRefs = [...state.discardRefs, ...state.tempDiscard.map((c) => c.ref)].slice(-DISCARD_CAP);
    state.tempDiscard = [];
  }
}

function startOp(state: StageState, ev: StageEvent, kind: string, actorSeat: number | null, targetSeats: number[]): StageOperation {
  flushMainToTemp(state);
  const depth = (topActiveOp(state)?.depth ?? -1) + 1;
  const opId = ev.operationId ?? `h-${kind}-${ev.eventSeq}`;
  const op: StageOperation = { opId, kind, actorSeat, targetSeats, state: "active", depth, startedSeq: ev.eventSeq, arrowIds: [] };
  state.operations.push(op);
  const from: Endpoint = actorSeat ?? "center";
  for (const target of targetSeats) {
    const id = `arrow-${opId}-${target}`;
    state.arrows.push({
      id,
      opId,
      from,
      to: target,
      selfLoop: target === actorSeat,
      phase: "standby",
      effect: "none",
      depth,
      opacity: 1,
      segments: [],
    });
    op.arrowIds.push(id);
  }
  refreshOpacities(state);
  return op;
}

function endOp(state: StageState, op: StageOperation, endState: OpState, seq: number): void {
  op.state = endState;
  op.endedSeq = seq;
  if (endState === "voided") {
    for (const arrow of state.arrows) {
      if (arrow.opId === op.opId) arrow.phase = "voided";
    }
  }
  settleDiscard(state);
  refreshOpacities(state);
}

/** 定位事件所属操作：operationId 优先；否则取最近活跃的同 kind 操作（启发式）。 */
function findOpForEvent(state: StageState, ev: StageEvent, kind?: string): StageOperation | null {
  if (ev.operationId) {
    return state.operations.find((o) => o.opId === ev.operationId && o.state === "active") ?? state.operations.find((o) => o.opId === ev.operationId) ?? null;
  }
  const active = state.operations.filter((o) => o.state === "active" && (kind ? o.kind === kind : true));
  return active[active.length - 1] ?? null;
}

export function stageReducer(state: StageState, ev: StageEvent): StageState {
  const s = cloneState(state);
  s.seq = Math.max(s.seq, ev.eventSeq);
  const p = ev.payload;

  switch (ev.eventType) {
    case "ATTACK_DECLARED": {
      const actor = Number(p.attackerSeat ?? 0) || null;
      startOp(s, ev, "attack", actor, refSeats(p.targetRefs));
      break;
    }

    case "ATTACK_RESOLVED": {
      const outcome = String(p.outcome ?? "").toLowerCase();
      const result = String(p.result ?? "");
      const op = findOpForEvent(s, ev, "attack");
      if (!op) break;
      const miss = outcome === "miss" || (outcome === "" && /meleeBlock|armorJudgment|dodge/.test(result));
      const invalidated = outcome === "invalidated" || outcome === "cancelled" || (outcome === "" && /invalidated|cancelled|^armor|^status|invincible/.test(result));
      const hit = !miss && !invalidated;
      if (hit) {
        for (const arrow of s.arrows) {
          if (arrow.opId === op.opId && arrow.phase === "standby") arrow.phase = "solid";
        }
        endOp(s, op, "done", ev.eventSeq);
      } else {
        for (const arrow of s.arrows) {
          if (arrow.opId === op.opId) {
            arrow.phase = "voided";
            arrow.voidReason = outcome || result || "invalidated";
          }
        }
        endOp(s, op, "voided", ev.eventSeq);
      }
      break;
    }

    case "DAMAGE_SEGMENT_APPLIED": {
      const target = seatOf(p.targetRef);
      const op = findOpForEvent(s, ev, "attack");
      if (!op || target === null) break;
      const arrow =
        s.arrows.find((a) => a.opId === op.opId && a.to === target && a.phase !== "voided") ??
        s.arrows.find((a) => a.opId === op.opId && a.phase !== "voided");
      if (!arrow) break;
      const segment: StageSegment = {
        index: Number(p.segmentIndex ?? 0),
        total: Number(p.totalSegments ?? 1),
        amount: Number(p.amount ?? 0),
        hpLost: Number(p.hpLost ?? 0),
        shieldLost: Number(p.shieldLost ?? 0),
        target,
      };
      arrow.segments.push(segment);
      if (arrow.phase === "standby") arrow.phase = "solid"; // 命中→实体化
      arrow.phase = "flow";
      arrow.effect = effectKindFromSegment(segment);
      if (segment.index + 1 >= segment.total) arrow.phase = "arrive"; // 末段到达目标
      break;
    }

    case "CARD_PLAYED": {
      s.mainCards.push({
        ref: String(p.cardRef ?? `played:${ev.eventSeq}`),
        faceUp: p.cardRef != null,
        step: s.cardStep,
      });
      break;
    }

    case "JUDGMENT_REVEALED": {
      const card = (p.card ?? {}) as { ref?: string; printedColor?: string };
      s.mainCards.push({
        ref: String(card.ref ?? `judgment:${ev.eventSeq}`),
        faceUp: true,
        printedColor: String(p.printedColor ?? card.printedColor ?? ""),
        highlight: null,
        flipIn: true,
        step: s.cardStep,
      });
      break;
    }

    case "JUDGMENT_RESULT_CHANGED": {
      const judgmentCard = [...s.mainCards].reverse().find((c) => c.highlight === null && c.printedColor);
      if (judgmentCard) {
        judgmentCard.highlight = "success"; // 判定结算（成败精确语义待 ⑤，先按成功高亮）
        if (p.to) judgmentCard.printedColor = String(p.to);
      }
      break;
    }

    case "CARD_DRAWN": {
      const seat = Number(p.seat ?? 0);
      const faceUp = Array.isArray(p.cardRefs) && (p.cardRefs as unknown[]).length > 0;
      s.draws.push({ seq: ev.eventSeq, seat, count: Number(p.count ?? 0), faceUp });
      break;
    }
  }

  return s;
}
