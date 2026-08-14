<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { createStage, stageReducer, DISCARD_CAP, type StageEvent, type StageState } from "../stage/stageMachine";
import { buildNarration, type NarrationCtx, type NarrationLine } from "../stage/narration";
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

// 舞台逻辑坐标（SVG 覆盖层坐标空间）
const VIEW_W = 600;
const VIEW_H = 500;
const PILE_POS: Point = { x: VIEW_W * 0.14, y: VIEW_H * 0.93 };
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
stage.value.discardRefs = (props.discardTop ?? []).map((c) => c.ref ?? "").filter(Boolean).slice(-DISCARD_CAP);
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
const narrationCtx = (): NarrationCtx => ({ characterName: props.characterName, relationshipCls: props.relationshipCls });

// 摸牌飞行卡（R6）：牌堆→座位，正/背面按公开性，800ms 后移除
interface Flight {
  id: number;
  faceUp: boolean;
  dx: number;
  dy: number;
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
      flights.value = [...flights.value, { id, faceUp: draw.faceUp, dx: seat.x - PILE_POS.x, dy: seat.y - PILE_POS.y }];
      const timer = setTimeout(() => {
        flights.value = flights.value.filter((f) => f.id !== id);
        flightTimers.delete(timer);
      }, 800);
      flightTimers.add(timer);
    }
  }
  seenDraws = state.draws.length;
}
onBeforeUnmount(() => {
  for (const timer of flightTimers) clearTimeout(timer);
});

watch(
  () => props.events,
  (list) => {
    for (const event of list) {
      if (event.eventSeq <= lastSeq) continue;
      stage.value = stageReducer(stage.value, event);
      lastSeq = event.eventSeq;
      const line = buildNarration(event, narrationCtx());
      if (line) narration.value = [...narration.value, line].slice(-6);
    }
    processDraws(stage.value);
    pruneEndedArrows();
  },
  { immediate: true },
);

// 操作结束后箭头不残留：结束事件 +1 个事件内保留（让淡出/到达动画播完），之后清理该操作箭头。
function pruneEndedArrows(): void {
  const current = stage.value;
  const keep = current.arrows.filter((arrow) => {
    const op = current.operations.find((o) => o.opId === arrow.opId);
    if (!op || op.state === "active") return true;
    if (op.endedSeq == null) return true;
    return lastSeq - op.endedSeq < 2;
  });
  if (keep.length !== current.arrows.length) stage.value = { ...current, arrows: keep };
}
</script>

<template>
  <div class="combat-stage">
    <div class="stage-main">
      <StageNarration :lines="narration" />
      <div class="stage-main__cards">
        <StageCard v-for="card in stage.mainCards" :key="card.ref" :card-ref="card.ref" :face-up="card.faceUp" :printed-color="card.printedColor" :highlight="card.highlight" :flip-in="card.flipIn" />
      </div>
    </div>
    <div class="stage-temp">
      <StageCard v-for="card in stage.tempDiscard" :key="card.ref" :card-ref="card.ref" :face-up="card.faceUp" />
    </div>
    <div class="stage-pile"><div class="pile-back"></div><span class="pile-count">{{ drawPileCount }}</span></div>
    <div class="stage-discard">
      <StageCard v-for="ref in stage.discardRefs" :key="ref" :card-ref="ref" :face-up="true" mini />
    </div>
    <div class="stage-flights">
      <div v-for="f in flights" :key="f.id" class="stage-flight" :class="f.faceUp ? 'stage-flight--face' : 'stage-flight--back'" :style="{ '--dx': `${f.dx}px`, '--dy': `${f.dy}px` }"></div>
    </div>
    <div class="stage-arrows"><StageArrow v-for="arrow in stage.arrows" :key="arrow.id" :from="endpointPos(arrow.from)" :to="endpointPos(arrow.to)" :self-loop="arrow.selfLoop" :phase="arrow.phase" :effect="arrow.effect" :opacity="arrow.opacity" :bend="arrowBends.get(arrow.id) ?? 0" /></div>
  </div>
</template>
