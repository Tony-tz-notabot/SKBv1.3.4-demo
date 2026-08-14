<script setup lang="ts">
import { computed } from "vue";
import { buildArrowPath, buildRingPath, type Point } from "../stage/arrowPath";
import { effectColor, type EffectKind } from "../stage/effectColors";
import type { ArrowPhase } from "../stage/stageMachine";

const props = defineProps<{
  from: Point;
  to: Point;
  selfLoop?: boolean;
  phase?: ArrowPhase;
  effect?: EffectKind;
  opacity?: number;
  /** 多目标扇形弯曲（法线方向偏移 px） */
  bend?: number;
}>();

const RING_RADIUS = 46;
const geom = computed(() =>
  props.selfLoop ? buildRingPath(props.from, RING_RADIUS) : buildArrowPath(props.from, props.to, { bend: props.bend ?? 0 }),
);
</script>

<template>
  <svg class="stage-arrow" :class="[`stage-arrow--${phase}`, { 'stage-arrow--ring': selfLoop }]" :style="{ opacity }" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path v-if="phase === 'standby'" :d="geom.path" class="stage-arrow__outline" />
    <path :d="geom.path" class="stage-arrow__body" />
    <path v-if="phase === 'flow'" :d="geom.path" class="stage-arrow__energy" :style="{ '--effect': effectColor(effect ?? 'none') }" />
  </svg>
</template>
