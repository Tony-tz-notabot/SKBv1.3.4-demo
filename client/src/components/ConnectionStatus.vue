<script setup lang="ts">
defineProps<{ state: "connecting" | "online" | "reconnecting" | "offline"; latencyMs?: number | null }>();
</script>

<template>
  <div class="connection" :data-state="state" role="status">
    <span class="connection__dot" aria-hidden="true" />
    <span>{{ state === "online" ? "已连接" : state === "connecting" ? "连接中" : state === "reconnecting" ? "重连中" : "已离线" }}</span>
    <span v-if="latencyMs != null" class="connection__latency">{{ latencyMs }} ms</span>
  </div>
</template>
