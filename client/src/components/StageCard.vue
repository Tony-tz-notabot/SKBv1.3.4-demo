<script setup lang="ts">
import { computed } from "vue";
import { cardColor } from "../stage/effectColors";

const props = defineProps<{
  cardRef: string;
  faceUp?: boolean;
  printedColor?: string;
  highlight?: "success" | "fail" | null;
  /** 判定/展示翻牌入场（rotateY） */
  flipIn?: boolean;
  /** 弃牌堆迷你条状 */
  mini?: boolean;
}>();

const label = computed(() => props.cardRef.split(":").pop() ?? props.cardRef);
const glow = computed(() => (props.highlight === "success" && props.printedColor ? cardColor(props.printedColor) : null));
</script>

<template>
  <div
    class="stage-card"
    :class="[
      faceUp ? '' : 'stage-card--back',
      highlight === 'success' ? 'stage-card--success' : '',
      highlight === 'fail' ? 'stage-card--fail' : '',
      flipIn ? 'stage-card--flip-in' : '',
      mini ? 'stage-card--mini' : '',
    ]"
    :style="glow ? { '--glow': glow } : {}"
  >
    <span class="stage-card__label">{{ label }}</span>
  </div>
</template>
