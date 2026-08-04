<script setup lang="ts">
import { onBeforeUnmount, onMounted, type DeepReadonly } from "vue";
import type { CardView } from "@skb-protocol/client-protocol";
import ResourceImage from "./ResourceImage.vue";
import { cardSummary } from "../localization/descriptions";
defineProps<{ card: DeepReadonly<CardView> | null }>();
const emit=defineEmits<{close:[]}>();
function onKeydown(event:KeyboardEvent){if(event.key==="Escape")emit("close");}
onMounted(()=>window.addEventListener("keydown",onKeydown));
onBeforeUnmount(()=>window.removeEventListener("keydown",onKeydown));
</script>
<template><Teleport to="body"><div v-if="card" class="detail-backdrop" @click.self="emit('close')"><aside class="detail-drawer" role="dialog" aria-modal="true" :aria-label="`${card.displayName}详情`"><button class="detail-close" type="button" aria-label="关闭详情" @click="emit('close')">×</button><ResourceImage class="detail-portrait card-detail-image" :resource-key="card.resourceKey" :alt="card.displayName"/><p class="eyebrow">{{ card.category }} · {{ card.printedColor }}</p><h2>{{ card.displayName }}</h2><p class="card-detail-summary">{{ cardSummary(card.templateId, card.summary) }}</p><section v-if="card.coreStats.length"><h3>核心数值</h3><dl class="card-stat-list"><div v-for="stat in card.coreStats" :key="stat.key"><dt>{{ stat.label }}</dt><dd>{{ stat.value }}</dd></div></dl></section><section><h3>当前状态</h3><div class="detail-vitals"><span>{{ card.state.effective?'效果有效':'效果失效' }}</span><span v-if="card.state.charge != null">蓄力 {{ card.state.charge }}</span><span v-if="card.state.durability != null">耐久 {{ card.state.durability }}</span><span v-if="card.state.cooldown != null">冷却 {{ card.state.cooldown }}</span></div></section><p class="detail-note">显示内容来自服务器卡牌投影；客户端不解释规则DSL。</p></aside></div></Teleport></template>
