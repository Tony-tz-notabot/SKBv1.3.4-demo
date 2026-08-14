<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";

/**
 * 血盾条（细式，docs/整理/130 §1.5-B v1）。
 * 几何：单点等效长度 = 2×条高（7px 高 / 14px 单点）；总长 = 上限×单点；
 * 参考上限 12 点 = 168px（与装备区等宽）；上限 >12 时单点按比例收缩保持总长 ≤168px。
 * 主题：hp 红 / shield 灰 / purple / blue（备用条，供临时资源如死灵灵魂使用）。
 * 变化反馈：value 减少/增加触发填充闪烁类并向上 emit change({delta,loss})，
 * 由父组件渲染浮动数字（本组件不做 DOM 级浮动，便于测试与复用）。
 */
const props = defineProps<{ theme: "hp" | "shield" | "purple" | "blue"; label: string; value: number; max: number }>();
const emit = defineEmits<{ change: [payload: { delta: number; loss: boolean }] }>();

const UNIT = 14; // 单点长度 px（= 2 × 7px 条高）
const REF_WIDTH = 168; // 12 点参考宽
const unit = computed(() => (props.max > 12 ? REF_WIDTH / props.max : UNIT));
const trackWidth = computed(() => Math.max(0, Math.round(props.max * unit.value)));
const fillWidth = computed(() => Math.max(0, Math.min(trackWidth.value, Math.round(props.value * unit.value))));

// 闪烁：一次性 animation，通过 nextTick 复位再置位以重触发
const flash = ref(false);
function triggerFlash() {
  flash.value = false;
  void nextTick(() => {
    flash.value = true;
  });
}

watch(
  () => props.value,
  (now, prev) => {
    if (prev === undefined || now === prev) return;
    const delta = now - prev;
    triggerFlash();
    emit("change", { delta, loss: delta < 0 });
  },
);
</script>

<template>
  <div class="bar" :class="`bar--${theme}`">
    <span class="bar__value">{{ label }} {{ value }}/{{ max }}</span>
    <div class="bar__track" :style="{ width: `${trackWidth}px` }">
      <div class="bar__fill" :class="{ 'bar__fill--flash': flash }" :style="{ width: `${fillWidth}px` }"></div>
    </div>
  </div>
</template>
