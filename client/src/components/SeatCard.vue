<script setup lang="ts">
import type { RoomPlayerView, Seat } from "@skb-protocol/room-protocol";

defineProps<{ seat: Seat; player?: RoomPlayerView; compact?: boolean }>();
const teamFor = (seat: Seat) => seat === 1 || seat === 4 ? "A" : "B";
const selectionText = (state: RoomPlayerView["selectionState"]) => ({ notStarted: "等待选角", choosing: "选择中", locked: "已锁定", revealed: "已公开" })[state];
</script>

<template>
  <article class="seat-card" :class="{ 'seat-card--empty': !player, 'seat-card--compact': compact }" :data-team="teamFor(seat)">
    <div class="seat-card__number">{{ seat }}</div>
    <div v-if="player" class="seat-card__body">
      <div class="seat-card__topline">
        <strong>{{ player.username ?? player.displayName }}</strong>
        <span v-if="player.isHost" class="pill pill--host">房主</span>
      </div>
      <p>{{ teamFor(seat) }}队 · {{ player.connection === "online" ? `${player.latencyMs ?? "--"} ms` : player.connection === "reconnecting" ? "重连中" : "离线" }}</p>
      <div class="seat-card__status">
        <span class="pill" :class="player.ready ? 'pill--ready' : ''">{{ player.ready ? "已准备" : "未准备" }}</span>
        <span v-if="player.selectionState !== 'notStarted'" class="pill">{{ selectionText(player.selectionState) }}</span>
      </div>
    </div>
    <div v-else class="seat-card__body seat-card__empty-copy">
      <strong>空席</strong><span>等待玩家加入</span>
    </div>
  </article>
</template>
