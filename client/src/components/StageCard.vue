<script setup lang="ts">
import { computed } from "vue";
import { cardColor } from "../stage/effectColors";
import ResourceImage from "./ResourceImage.vue";

const props = defineProps<{
  cardRef: string;
  faceUp?: boolean;
  /** 卡牌模板 ID → 显示牌面图片（资源 card.<templateId>） */
  templateId?: string;
  printedColor?: string;
  highlight?: "success" | "fail" | null;
  /** 判定/展示翻牌入场（rotateY） */
  flipIn?: boolean;
  /** 弃牌堆迷你条状 */
  mini?: boolean;
}>();
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
    :style="highlight === 'success' && printedColor ? { '--glow': cardColor(printedColor) } : {}"
  >
    <!-- 正面：与手牌同源——有图显示卡图，无图走 ResourceImage 默认占位图；背面统一 SKB 卡背（不显示编号） -->
    <ResourceImage v-if="faceUp" :resource-key="templateId ? `card.${templateId}` : 'card.unknown'" :alt="cardRef" />
    <span v-else class="stage-card__back-mark">SKB</span>
  </div>
</template>
