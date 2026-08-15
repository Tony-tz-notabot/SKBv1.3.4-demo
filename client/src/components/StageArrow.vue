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

// 命中填充揭示（132 §4.3 修订）：SMIL 把 clipPath 多边形从"尾部小三角"加速动画到"头部大三角"，
// 效果色在尾部→头部逐渐填满并冲击；结束后 CSS 淡出。standby 仅荧光轮廓。
const active = computed(() => props.phase !== "standby" && props.phase !== "voided");
const impactColor = computed(() => effectColor(props.effect ?? "none"));
let uidSeq = 0;
const uid = `fx-${++uidSeq}`;
</script>

<template>
  <svg
    class="stage-arrow"
    :class="[`stage-arrow--${phase}`, { 'stage-arrow--ring': selfLoop }]"
    :style="{ opacity, '--impact': impactColor }"
    viewBox="0 0 600 500"
    preserveAspectRatio="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <clipPath :id="uid">
      <polygon :points="active ? geom.fillClip.to : geom.fillClip.from">
        <animate
          v-if="active"
          attributeName="points"
          :from="geom.fillClip.from"
          :to="geom.fillClip.to"
          dur="0.5s"
          calcMode="spline"
          keySplines="0.6 0 1 1"
          fill="freeze"
        />
      </polygon>
    </clipPath>
    <!-- standby：白色荧光轮廓（效果未命中未知）；命中后 fill 按效果色冲击 -->
    <path v-if="phase === 'standby'" :d="geom.path" class="stage-arrow__outline" />
    <path :d="geom.path" class="stage-arrow__body" />
    <path v-if="active" :d="geom.path" class="stage-arrow__fill" :fill="impactColor" :clip-path="`url(#${uid})`" />
  </svg>
</template>
