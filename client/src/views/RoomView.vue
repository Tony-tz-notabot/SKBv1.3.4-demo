<script setup lang="ts">
import { computed, reactive, ref, watch, type DeepReadonly } from "vue";
import type { RoomPlayerView, RoomSettings, RoomSnapshot, Seat } from "@skb-protocol/room-protocol";
import SeatCard from "../components/SeatCard.vue";
import ChatPanel from "../components/ChatPanel.vue";

const props = defineProps<{ snapshot: DeepReadonly<RoomSnapshot> }>();
const emit = defineEmits<{
  ready: [value: boolean]; chat: [channel: "all" | "team", text: string];
  settings: [settings: RoomSettings]; changeSeat: [userId: string, seat: Seat];
  kick: [userId: string]; transferHost: [userId: string]; start: []; leave: []; close: [];
}>();
const seats: Seat[] = [1, 2, 3, 4];
const playerAt = (seat: Seat) => props.snapshot.players.find((player) => player.seat === seat);
const readyCount = computed(() => props.snapshot.players.filter((player) => player.ready).length);
const viewer = computed(() => props.snapshot.players.find((player) => player.userId === props.snapshot.viewerUserId));
const otherPlayers = computed(() => props.snapshot.players.filter((player) => player.userId !== props.snapshot.viewerUserId));
const emptySeats = computed(() => seats.filter((seat) => !playerAt(seat)));
const editingSettings = ref(false);
const draft = reactive<RoomSettings>({ ...props.snapshot.settings });
watch(() => props.snapshot.settings, (value) => Object.assign(draft, value));
const draftValid = computed(() => draft.roomName.trim().length > 0 && draft.roomName.trim().length <= 40
  && Number.isInteger(draft.turnTimeSeconds) && draft.turnTimeSeconds >= 1
  && Number.isInteger(draft.responseTimeSeconds) && draft.responseTimeSeconds >= 1
  && Number.isInteger(draft.reserveTimeSeconds) && draft.reserveTimeSeconds >= 0);
function saveSettings() { if (!draftValid.value) return; emit("settings", { ...draft, roomName: draft.roomName.trim() }); editingSettings.value = false; }
function positionFor(seat: Seat) { const viewerSeat = props.snapshot.viewerSeat ?? 1; return (["bottom", "right", "top", "left"] as const)[(seat - viewerSeat + 4) % 4]; }
function confirmKick(player: DeepReadonly<RoomPlayerView>) { if (window.confirm(`确定将“${player.displayName}”移出房间？`)) emit("kick", player.userId); }
function confirmTransfer(player: DeepReadonly<RoomPlayerView>) { if (window.confirm(`确定将房主转让给“${player.displayName}”？`)) emit("transferHost", player.userId); }
function confirmLeave() { if (window.confirm("确定离开当前房间？")) emit("leave"); }
function confirmClose() { if (window.confirm("关闭房间会移出所有玩家，确定继续？")) emit("close"); }
</script>

<template>
  <section class="room-layout">
    <header class="room-summary"><div><p class="eyebrow">ROOM {{ snapshot.roomCode }}</p><h2>{{ snapshot.settings.roomName }}</h2></div><div class="summary-pills"><span>{{ snapshot.players.length }} / 4</span><span>{{ readyCount }} 已准备</span><span>v{{ snapshot.settings.rulesetVersion }}</span></div></header>
    <div class="seat-ring" aria-label="固定四人座位">
      <div v-for="seat in seats" :key="seat" class="seat-position" :data-position="positionFor(seat)"><SeatCard :seat="seat" :player="playerAt(seat)" /></div>
      <div class="ring-center"><span class="direction-arrow">↺</span><strong>逆时针</strong><small>本地座位始终在下方</small></div>
    </div>
    <aside class="room-settings">
      <div class="room-settings__heading"><p class="eyebrow">ROOM SETTINGS</p><button v-if="snapshot.permissions.canUpdateSettings" type="button" class="text-button" @click="editingSettings = !editingSettings">{{ editingSettings ? "取消" : "编辑" }}</button></div>
      <form v-if="editingSettings" class="settings-editor" @submit.prevent="saveSettings">
        <label><span>房间名</span><input v-model="draft.roomName" maxlength="40" required></label>
        <div class="settings-editor__times"><label><span>回合</span><input v-model.number="draft.turnTimeSeconds" type="number" min="1" step="1"></label><label><span>响应</span><input v-model.number="draft.responseTimeSeconds" type="number" min="1" step="1"></label><label><span>预留</span><input v-model.number="draft.reserveTimeSeconds" type="number" min="0" step="1"></label></div>
        <label class="check-row"><input v-model="draft.allowGuests" type="checkbox">允许游客</label><label class="check-row"><input v-model="draft.allowSpectators" type="checkbox">允许观战</label><label class="check-row"><input v-model="draft.dismantleBossEnabled" type="checkbox">允许拆除 BOSS</label>
        <button class="button button--primary" :disabled="!draftValid">保存设置</button>
      </form>
      <template v-else><dl><div><dt>回合时间</dt><dd>{{ snapshot.settings.turnTimeSeconds }}秒</dd></div><div><dt>响应时间</dt><dd>{{ snapshot.settings.responseTimeSeconds }}秒</dd></div><div><dt>备用时间</dt><dd>{{ snapshot.settings.reserveTimeSeconds }}秒</dd></div><div><dt>游客 / 观战</dt><dd>{{ snapshot.settings.allowGuests ? "开" : "关" }} / {{ snapshot.settings.allowSpectators ? "开" : "关" }}</dd></div><div><dt>BOSS拆除</dt><dd>{{ snapshot.settings.dismantleBossEnabled ? "允许" : "禁止" }}</dd></div></dl></template>
      <div v-if="snapshot.permissions.canChangeSeat && viewer && emptySeats.length" class="seat-change"><span>更换到空座</span><button v-for="seat in emptySeats" :key="seat" type="button" class="mini-button" @click="emit('changeSeat', viewer.userId, seat)">{{ seat }}号</button></div>
      <button type="button" class="button button--primary" :disabled="!snapshot.permissions.canStartGame" @click="emit('start')">开始游戏</button>
      <button v-if="viewer" type="button" class="button" @click="emit('ready', !viewer.ready)">{{ viewer.ready ? "取消准备" : "准备" }}</button>
      <details v-if="snapshot.permissions.canKick || snapshot.permissions.canTransferHost" class="player-management"><summary>玩家管理</summary><div v-for="player in otherPlayers" :key="player.userId"><span>{{ player.displayName }}</span><button v-if="snapshot.permissions.canTransferHost" type="button" class="mini-button" @click="confirmTransfer(player)">转让</button><button v-if="snapshot.permissions.canKick" type="button" class="mini-button mini-button--danger" @click="confirmKick(player)">踢出</button></div></details>
      <button type="button" class="button" @click="confirmLeave">离开房间</button>
      <button v-if="snapshot.permissions.canCloseRoom" type="button" class="button button--danger" @click="confirmClose">关闭房间</button>
    </aside>
    <ChatPanel class="room-chat" :messages="snapshot.chat" @send="emit('chat',$event.channel,$event.text)" />
  </section>
</template>
