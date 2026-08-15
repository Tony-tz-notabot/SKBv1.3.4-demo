<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { createStage, stageReducer, DISCARD_CAP, type StageEvent, type StageState } from "../stage/stageMachine";
import { buildNarration, type NarrationCtx, type NarrationLine } from "../stage/narration";
import { cardNameById, cardCls } from "../localization/promptRenderers";
import { abilityDisplayName } from "../localization/descriptions";
import { type Point } from "../stage/arrowPath";
import StageArrow from "./StageArrow.vue";
import StageCard from "./StageCard.vue";
import StageNarration from "./StageNarration.vue";

const props = defineProps<{
  events: readonly StageEvent[];
  drawPileCount: number | null;
  characterName: (seat: number | null) => string;
  relationshipCls: (seat: number | null) => string | null;
  /** 座位→舞台坐标（GameView 传入，默认 seat1 右下、逆时针） */
  seatPosition?: (seat: number) => Point;
  center?: Point;
  /** 快照种子：弃牌堆/展示牌由快照直供（重连/快照重置后恢复），事件驱动增量 */
  discardTop?: readonly { ref?: string }[];
  centralCards?: readonly { ref?: string }[];
}>();

// 舞台逻辑坐标（SVG 覆盖层坐标空间；箭头/飞行卡用 600x500 空间，经 viewBox/百分比映射到表格）
const VIEW_W = 600;
const VIEW_H = 500;
const defaultSeatPosition = (seat: number): Point => {
  const pos: Record<number, [number, number]> = {
    1: [VIEW_W * 0.8, VIEW_H * 0.88],
    2: [VIEW_W * 0.8, VIEW_H * 0.12],
    3: [VIEW_W * 0.2, VIEW_H * 0.12],
    4: [VIEW_W * 0.2, VIEW_H * 0.88],
  };
  const [x, y] = pos[seat] ?? [VIEW_W / 2, VIEW_H / 2];
  return { x, y };
};
const seatPos = props.seatPosition ?? defaultSeatPosition;
const centerPos = computed<Point>(() => props.center ?? { x: VIEW_W / 2, y: VIEW_H / 2 });
const endpointPos = (ep: number | "center"): Point => (ep === "center" ? centerPos.value : seatPos(ep));

const stage = ref<StageState>(createStage());
// 快照种子：弃牌堆条状 + 主区展示牌（判定/展示）在快照重置后恢复
stage.value.discardRefs = (props.discardTop ?? []).map((c) => ({ ref: c.ref ?? "" })).filter((d) => d.ref).slice(-DISCARD_CAP);
stage.value.mainCards = (props.centralCards ?? []).map((c, i) => ({ ref: c.ref ?? `central:${i}`, faceUp: true, highlight: null, step: 0 }));

// 多目标扇形弯曲（R2）：同一操作的多根箭头按序弯曲分离（±30px/级）
const arrowBends = computed(() => {
  const byOp = new Map<string, StageState["arrows"]>();
  for (const arrow of stage.value.arrows) {
    const list = byOp.get(arrow.opId) ?? [];
    list.push(arrow);
    byOp.set(arrow.opId, list);
  }
  const bends = new Map<string, number>();
  for (const arrows of byOp.values()) {
    const n = arrows.length;
    arrows.forEach((arrow, i) => bends.set(arrow.id, n > 1 ? Math.round((i - (n - 1) / 2) * 30) : 0));
  }
  return bends;
});
const narration = ref<NarrationLine[]>([]);
let lastSeq = 0;
// 攻击详情缓存：ATTACK_DECLARED 写入武器/距离/伤害，ATTACK_TARGETED 拼完整句。
const attackCtx: NarrationCtx["attackCtx"] = {};
const narrationCtx = (): NarrationCtx => ({ characterName: props.characterName, relationshipCls: props.relationshipCls, cardName: cardNameById, cardCls, abilityName: abilityDisplayName, attackCtx });
// 摸牌飞行卡（R6）：牌堆→座位，正/背面按公开性，800ms 后移除
interface Flight {
  id: number;
  faceUp: boolean;
  /** 终点百分比（600x500 逻辑坐标 → 表格百分比） */
  fx: string;
  fy: string;
}
const flights = ref<Flight[]>([]);
let flightSeq = 0;
let seenDraws = 0;
const flightTimers = new Set<ReturnType<typeof setTimeout>>();
function processDraws(state: StageState): void {
  for (let i = seenDraws; i < state.draws.length; i++) {
    const draw = state.draws[i]!;
    const seat = seatPos(draw.seat);
    for (let k = 0; k < draw.count; k++) {
      const id = ++flightSeq;
      flights.value = [...flights.value, { id, faceUp: draw.faceUp, fx: `${((seat.x / VIEW_W) * 100).toFixed(1)}%`, fy: `${((seat.y / VIEW_H) * 100).toFixed(1)}%` }];
      const timer = setTimeout(() => {
        flights.value = flights.value.filter((f) => f.id !== id);
        flightTimers.delete(timer);
      }, 800);
      flightTimers.add(timer);
    }
  }
  seenDraws = state.draws.length;
}

// 事件处理：同步逐条应用（快照 activityEvents 全量携带，组件随 :key=gameId 跨快照存活）。
// 结束箭头按时间保留（ARROW_KEEP_MS）而非事件窗口——批量投递下 seq 窗口会立即裁剪，时间保留
// 让命中后 solid/arrive 阶段渲染并播放其 CSS 动画（132 §4.3）。
const ARROW_KEEP_MS = 1600;
const opEndedAt = new Map<string, number>();
/** 多目标攻击：单目标已结算（arrow.completed）的独立淡出计时——不等整个操作结束 */
const arrowEndedAt = new Map<string, number>();

function pruneEndedArrows(): void {
  const current = stage.value;
  const now = Date.now();
  const keep = current.arrows.filter((arrow) => {
    const endedAt = arrowEndedAt.get(arrow.id);
    if (endedAt !== undefined) return now - endedAt < ARROW_KEEP_MS; // 该目标已结算完，独立淡出中
    const op = current.operations.find((o) => o.opId === arrow.opId);
    if (!op || op.state === "active") return true;
    return now - (opEndedAt.get(op.opId) ?? now) < ARROW_KEEP_MS;
  });
  if (keep.length !== current.arrows.length) stage.value = { ...current, arrows: keep };
}

watch(
  () => props.events,
  (list) => {
    for (const event of list) {
      if (event.eventSeq <= lastSeq) continue;
      stage.value = stageReducer(stage.value, event);
      lastSeq = event.eventSeq;
      for (const op of stage.value.operations) {
        if (op.state !== "active" && !opEndedAt.has(op.opId)) opEndedAt.set(op.opId, Date.now());
      }
      for (const arrow of stage.value.arrows) {
        if (arrow.completed && !arrowEndedAt.has(arrow.id)) arrowEndedAt.set(arrow.id, Date.now());
      }
      const line = buildNarration(event, narrationCtx());
      // 主区非日志区：只显示当前正在进行的操作（单条词条），新步骤/新操作替换而非累积。
      if (line) narration.value = [line];
    }
    processDraws(stage.value);
    pruneEndedArrows();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  for (const timer of flightTimers) clearTimeout(timer);
});
</script>

<template>
  <div class="combat-stage">
    <div class="combat-stage__center">
      <div class="stage-main">
        <StageNarration :lines="narration" />
        <div class="stage-main__cards">
          <StageCard v-for="card in stage.mainCards" :key="card.ref" :card-ref="card.ref" :face-up="card.faceUp" :printed-color="card.printedColor" :template-id="card.templateId" :highlight="card.highlight" :flip-in="card.flipIn" />
        </div>
      </div>
      <div class="stage-pile"><div class="pile-back"></div><span class="pile-count">{{ drawPileCount }}</span></div>
      <div class="stage-discard">
        <StageCard v-for="d in stage.discardRefs" :key="d.ref" :card-ref="d.ref" :template-id="d.templateId" :face-up="true" mini />
      </div>
    </div>
    <div class="stage-flights">
      <div v-for="f in flights" :key="f.id" class="stage-flight" :class="f.faceUp ? 'stage-flight--face' : 'stage-flight--back'" :style="{ '--fx': f.fx, '--fy': f.fy }"></div>
    </div>
    <div class="stage-arrows"><StageArrow v-for="arrow in stage.arrows" :key="arrow.id" :from="endpointPos(arrow.from)" :to="endpointPos(arrow.to)" :self-loop="arrow.selfLoop" :phase="arrow.phase" :effect="arrow.effect" :opacity="arrow.opacity" :bend="arrowBends.get(arrow.id) ?? 0" /></div>
  </div>
</template>
