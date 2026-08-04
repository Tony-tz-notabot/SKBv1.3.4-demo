<script setup lang="ts">
import type { CardView } from "@skb-protocol/client-protocol";
import type { DeepReadonly } from "vue";
import ResourceImage from "./ResourceImage.vue";
const props=defineProps<{ card: DeepReadonly<CardView>; legal?: boolean; compact?: boolean; selected?: boolean; selectedOrder?: number; disabledReason?: string | null }>();
defineEmits<{ select: [cardRef: string]; detail: [card: DeepReadonly<CardView>] }>();
const colorClass = (props.card.printedColor && props.card.printedColor !== "none") ? `game-card--${props.card.printedColor}` : "";
const nameColorClass = (props.card.printedColor && props.card.printedColor !== "none") ? `game-card__name--${props.card.printedColor}` : "";
</script>
<template>
  <article class="game-card" :class="{ 'game-card--legal': legal, 'game-card--selected': selected || card.state.selected, 'game-card--disabled': !card.state.effective || disabledReason, 'game-card--compact': compact, [colorClass]: !!colorClass }" :title="disabledReason ?? undefined" @click="$emit('select',card.ref)" @contextmenu.prevent="$emit('detail',card)">
    <span v-if="selectedOrder" class="selection-order">{{ selectedOrder }}</span>
    <ResourceImage :resource-key="card.resourceKey" :alt="card.displayName" />
    <div class="game-card__copy"><strong :class="nameColorClass || undefined">{{ card.displayName }}</strong><small>{{ card.summary }}</small></div>
    <div v-if="card.badges.length" class="game-card__badges"><span v-for="badge in card.badges" :key="badge">{{ badge }}</span></div>
    <span v-if="disabledReason" class="game-card__disabled-hint">!</span>
    <button v-if="card.detailAvailable && !compact" type="button" class="game-card__detail" @click.stop="$emit('detail',card)">详情</button>
  </article>
</template>
