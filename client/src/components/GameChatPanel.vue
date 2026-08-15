<script setup lang="ts">
import { nextTick, onMounted, ref, watch, type DeepReadonly } from "vue";
import type { ChatMessage } from "@skb-protocol/client-protocol";
const props=defineProps<{messages:readonly DeepReadonly<ChatMessage>[]}>();
const emit=defineEmits<{send:[channel:"all"|"team",text:string]}>();const channel=ref<"all"|"team">("all");const text=ref("");
function send(){const value=text.value.trim();if(!value)return;emit("send",channel.value,value);text.value="";}
// 自动滚动：仅在玩家停留在列表底部附近时跟随新消息，上滑看历史期间不强制拉回。
const listEl=ref<HTMLElement|null>(null);
const nearBottom=()=>{const el=listEl.value;if(!el)return true;return el.scrollHeight-el.scrollTop-el.clientHeight<=80;};
watch([()=>props.messages.length,channel],async()=>{await nextTick();const el=listEl.value;if(el&&nearBottom())el.scrollTop=el.scrollHeight;});
onMounted(()=>{void nextTick(()=>{const el=listEl.value;if(el)el.scrollTop=el.scrollHeight;});});
</script>
<template><section class="game-chat"><header><p class="eyebrow">CHAT</p><div><button type="button" :class="{active:channel==='all'}" @click="channel='all'">全部</button><button type="button" :class="{active:channel==='team'}" @click="channel='team'">队伍</button></div></header><div ref="listEl" class="game-chat__list"><p v-for="message in messages.filter(item=>item.channel===channel)" :key="message.messageId"><strong>{{ message.senderSeat }}号</strong>{{ message.text }}</p></div><form @submit.prevent="send"><input v-model="text" maxlength="500" placeholder="发送消息"><button class="button">发送</button></form></section></template>
