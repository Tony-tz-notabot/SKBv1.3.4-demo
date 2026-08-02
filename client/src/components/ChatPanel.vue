<script setup lang="ts">
import { ref, type DeepReadonly } from "vue";
import type { RoomChatMessage } from "@skb-protocol/room-protocol";
const props = defineProps<{ messages: readonly DeepReadonly<RoomChatMessage>[]; disabled?: boolean }>();
const emit = defineEmits<{ send: [payload: { channel: "all" | "team"; text: string }] }>();
const channel = ref<"all" | "team">("all"); const text = ref("");
function submit() { const value = text.value.trim(); if (!value || props.disabled) return; emit("send", { channel: channel.value, text: value }); text.value = ""; }
</script>
<template><aside class="chat-panel"><header><strong>房间聊天</strong><div><button type="button" :class="{active:channel==='all'}" @click="channel='all'">全部</button><button type="button" :class="{active:channel==='team'}" @click="channel='team'">队伍</button></div></header><div class="chat-list"><p v-if="!messages.length">暂无消息</p><p v-for="message in messages" :key="message.messageId"><strong>{{ message.senderDisplayName }}</strong><span>{{ message.text }}</span></p></div><form @submit.prevent="submit"><input v-model="text" maxlength="500" placeholder="发送消息…" :disabled="disabled"><button class="button" :disabled="disabled || !text.trim()">发送</button></form></aside></template>
