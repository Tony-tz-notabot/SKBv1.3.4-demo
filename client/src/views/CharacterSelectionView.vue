<script setup lang="ts">
import { computed, ref, type DeepReadonly } from "vue";
import type { CharacterCandidateView, RoomSnapshot, Seat } from "@skb-protocol/room-protocol";
import SeatCard from "../components/SeatCard.vue";
import ResourceImage from "../components/ResourceImage.vue";
import CharacterDetailDrawer from "../components/CharacterDetailDrawer.vue";
import { abilityDisplayName } from "../localization/descriptions";

const props = defineProps<{ snapshot: DeepReadonly<RoomSnapshot> }>();
const seats: Seat[] = [1, 2, 3, 4];
const playerAt = (seat: Seat) => props.snapshot.players.find((player) => player.seat === seat);
const rotatedSeats = computed(() => {
  const viewerSeat = props.snapshot.viewerSeat ?? 1;
  return seats.slice().sort((a, b) => ((a - viewerSeat + 4) % 4) - ((b - viewerSeat + 4) % 4));
});
const emit = defineEmits<{ preselect:[characterId:string]; lock:[characterId:string]; chat:[channel:"all"|"team",text:string] }>();
import ChatPanel from "../components/ChatPanel.vue";
function lockSelected() { const characterId = props.snapshot.characterSelection?.preselectedCharacterId; if (characterId) emit("lock", characterId); }
const detailCandidate = ref<DeepReadonly<CharacterCandidateView> | null>(null);
let longPressTimer: ReturnType<typeof setTimeout> | undefined;
let suppressNextActivation = false;
function openDetail(candidate: DeepReadonly<CharacterCandidateView>) { detailCandidate.value = candidate; }
function startLongPress(candidate: DeepReadonly<CharacterCandidateView>) {
  clearTimeout(longPressTimer);
  longPressTimer = setTimeout(() => { suppressNextActivation = true; openDetail(candidate); }, 480);
}
function cancelLongPress() { clearTimeout(longPressTimer); longPressTimer = undefined; }
function activateCandidate(characterId: string) {
  cancelLongPress();
  if (suppressNextActivation) { suppressNextActivation = false; return; }
  emit("preselect", characterId);
}
</script>

<template>
  <section class="selection-layout">
    <header class="selection-header"><div><p class="eyebrow">PRIVATE DRAFT</p><h2>选择你的角色</h2><p>候选仅你可见。锁定后，所有玩家完成选择才会统一公开。</p></div><div class="timer">00:10</div></header>
    <div class="candidate-grid">
      <article v-for="candidate in snapshot.characterSelection?.candidates ?? []" :key="candidate.characterId" class="candidate-card" :class="{ 'candidate-card--selected': snapshot.characterSelection?.preselectedCharacterId === candidate.characterId }" @click="activateCandidate(candidate.characterId)" @contextmenu.prevent.stop="openDetail(candidate)" @pointerdown="startLongPress(candidate)" @pointerup="cancelLongPress" @pointercancel="cancelLongPress" @pointerleave="cancelLongPress">
        <div class="candidate-art"><ResourceImage :resource-key="candidate.portraitResourceKey" :alt="candidate.displayName" /><button class="candidate-detail-button" type="button" @pointerdown.stop @click.stop="openDetail(candidate)">详情</button></div>
        <div class="candidate-body"><div><p class="eyebrow">难度 {{ candidate.difficulty }}</p><h3>{{ candidate.displayName }}</h3></div><div class="vitals"><span>HP {{ candidate.initialHp }}</span><span>SH {{ candidate.initialShield }}</span></div><p>初始天赋 · {{ abilityDisplayName(candidate.initialTalentId) }}</p><p>技能 · {{ candidate.abilityIds.map(abilityDisplayName).join(" / ") }}</p></div>
      </article>
    </div>
    <div class="selection-footer"><div class="selection-seats"><SeatCard v-for="seat in rotatedSeats" :key="seat" :seat="seat" :player="playerAt(seat)" compact /></div><button type="button" class="button button--primary" :disabled="!snapshot.characterSelection?.preselectedCharacterId || !!snapshot.characterSelection?.lockedCharacterId" @click="lockSelected">{{ snapshot.characterSelection?.lockedCharacterId ? "已锁定" : "锁定角色" }}</button></div>
    <ChatPanel :messages="snapshot.chat" @send="emit('chat',$event.channel,$event.text)" />
    <CharacterDetailDrawer :candidate="detailCandidate" @close="detailCandidate = null" />
  </section>
</template>
