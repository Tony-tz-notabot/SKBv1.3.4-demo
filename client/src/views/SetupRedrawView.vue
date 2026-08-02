<script setup lang="ts">
import type { SetupSnapshot } from "@skb-protocol/client-protocol";
import type { DeepReadonly } from "vue";
import ResourceImage from "../components/ResourceImage.vue";
const props=defineProps<{snapshot:DeepReadonly<SetupSnapshot>}>();
const emit=defineEmits<{decide:[offerId:string,redraw:boolean]}>();
function decide(redraw:boolean){const offer=props.snapshot.interaction.offers[0];if(offer)emit("decide",offer.offerId,redraw);}
</script>
<template><section class="setup-redraw"><header><p class="eyebrow">OPENING HAND</p><h2>确认初始手牌</h2><p>你可以保留这4张牌，或弃置全部并从牌堆顶重新获得4张。每局只有一次机会。</p></header><div class="setup-hand"><article v-for="card in snapshot.hand" :key="card.ref" class="setup-card"><ResourceImage :resource-key="card.resourceKey" :alt="card.displayName"/><strong>{{card.displayName}}</strong><span>{{card.category}} · {{card.printedColor}}</span></article></div><div v-if="snapshot.interaction.offers.length" class="setup-actions"><button type="button" class="button" @click="decide(false)">保留手牌</button><button type="button" class="button button--primary" @click="decide(true)">弃置全部并重摸4张</button></div><p v-else class="setup-waiting">已完成选择，等待其他玩家 · {{snapshot.seats.filter(x=>x.redrawDecided).length}} / 4</p></section></template>
