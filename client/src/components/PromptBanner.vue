<script setup lang="ts">
import { computed, onBeforeUnmount, ref, type DeepReadonly } from "vue";
import type { PromptView, Seat } from "@skb-protocol/client-protocol";
const props=defineProps<{prompt:DeepReadonly<PromptView>|null|undefined;viewerSeat:Seat|null;serverTime:number}>();
const now=ref(Date.now());const receivedAt=Date.now();
const timer=window.setInterval(()=>{now.value=Date.now();},250);onBeforeUnmount(()=>window.clearInterval(timer));
const estimatedServerNow=computed(()=>props.serverTime+(now.value-receivedAt));
const remaining=computed(()=>props.prompt?Math.max(0,props.prompt.deadlineAt-estimatedServerNow.value):0);
const seconds=computed(()=>Math.ceil(remaining.value/1000));
const policyText=computed(()=>({pass:"超时不操作",randomLegal:"超时随机合法操作",useDefault:"超时采用默认选择",abortRemaining:"超时终止剩余操作"} as Record<string,string>)[props.prompt?.timeoutPolicy??""]??"");
</script>
<template><div v-if="prompt" class="prompt-banner" :class="{'prompt-banner--mine':prompt.prioritySeat===viewerSeat,'prompt-banner--mandatory':prompt.mandatory}"><div><strong>{{ prompt.prioritySeat===viewerSeat?'轮到你操作':prompt.prioritySeat?`等待${prompt.prioritySeat}号玩家`:'系统处理中' }}</strong><span>{{ prompt.kind }} · {{ policyText }}</span></div><time :datetime="`${seconds}s`">{{ seconds }}s</time></div></template>
