<script setup lang="ts">
import { computed, onMounted, shallowRef } from "vue";
import { storeToRefs } from "pinia";
import ConnectionStatus from "./components/ConnectionStatus.vue";
import { useServerProjectionStore } from "./stores/serverProjection";
import { useConnectionStore } from "./stores/connection";
import LobbyView from "./views/LobbyView.vue";
import RoomView from "./views/RoomView.vue";
import CharacterSelectionView from "./views/CharacterSelectionView.vue";
import type { MockScene } from "./dev/mockServer";
import { configureRoomCommandSender, roomActions } from "./services/roomActions";
import { useCommandFeedbackStore } from "./stores/commandFeedback";
import { localizeCommandRejection } from "./localization/commandRejections";
import GameView from "./views/GameView.vue";
import SetupRedrawView from "./views/SetupRedrawView.vue";
import { configureGameCommandSender, gameActions } from "./services/gameActions";
import { createRealtimeService } from "./network/realtimeService";

const store = useServerProjectionStore();
const connectionStore = useConnectionStore();
const feedbackStore = useCommandFeedbackStore();
const { screen, lobbySnapshot, roomSnapshot, gameSnapshot, setupSnapshot, eventQueue, protocolErrors } = storeToRefs(store);
const { state: connectionState, latencyMs } = storeToRefs(connectionStore);
const { pendingIds, lastRejection } = storeToRefs(feedbackStore);
const title = computed(() => screen.value === "game" ? "对局" : screen.value === "setup" ? "开局重摸" : screen.value === "room" ? "房间" : "大厅");
const isDev = import.meta.env.DEV;
const mockScene = shallowRef<MockScene>("selection");
let showMock: ((scene: MockScene) => void) | undefined;

onMounted(async () => {
  if (import.meta.env.DEV && new URLSearchParams(location.search).get("mock") === "1") {
    const mock = (await import("./dev/mockServer")).createMockServer(); showMock = mock.show;
    configureRoomCommandSender(mock.send); configureGameCommandSender(mock.sendGame); showMock(mockScene.value);
    connectionStore.setState("online"); connectionStore.setLatency(24); return;
  }
  let userId=localStorage.getItem("skb.userId"); if(!userId){userId=crypto.randomUUID();localStorage.setItem("skb.userId",userId);}
  let displayName=localStorage.getItem("skb.displayName")||`玩家${userId.slice(0,4)}`;let token=localStorage.getItem("skb.token");
  try{if(!token){const response=await fetch("/api/session",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({displayName})});if(response.ok){const session=await response.json() as {token:string;userId:string;displayName:string};token=session.token;userId=session.userId;displayName=session.displayName;localStorage.setItem("skb.token",token);localStorage.setItem("skb.userId",userId);localStorage.setItem("skb.displayName",displayName);}}}catch{/* fall back to legacy query identity */}const scheme=location.protocol==="https:"?"wss":"ws";
  const base=import.meta.env.VITE_WS_URL||`${scheme}://${location.hostname}:${import.meta.env.DEV?"8787":location.port}/ws`,url=new URL(base);
  if(token)url.searchParams.set("token",token);else{url.searchParams.set("userId",userId);url.searchParams.set("displayName",displayName);}
  const realtime=createRealtimeService(url.toString());configureRoomCommandSender(realtime.sendRoomCommand);configureGameCommandSender(realtime.sendGameCommand);realtime.connect();
});

function switchMock(scene: MockScene) {
  mockScene.value = scene;
  showMock?.(scene);
}
const localizedRejection = computed(() => lastRejection.value ? localizeCommandRejection(lastRejection.value) : null);
</script>

<template>
  <main class="shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">SOUL KNIGHT BATTLE · v1.3.4</p>
        <h1>{{ title }}</h1>
      </div>
      <div class="topbar__actions">
        <nav v-if="isDev && showMock" class="dev-switcher" aria-label="开发场景">
          <button v-for="scene in ['lobby', 'room', 'selection', 'setup', 'game'] as MockScene[]" :key="scene" type="button" :class="{ active: mockScene === scene }" @click="switchMock(scene)">{{ scene }}</button>
        </nav>
        <ConnectionStatus :state="connectionState" :latency-ms="latencyMs" />
      </div>
    </header>

    <section v-if="protocolErrors.length" class="notice notice--error" role="alert">
      <strong>服务器消息未通过协议校验</strong>
      <ul><li v-for="error in protocolErrors" :key="error">{{ error }}</li></ul>
    </section>
    <section v-if="lastRejection && localizedRejection" class="notice notice--error" role="alert"><strong>{{ localizedRejection.title }}</strong><p>{{ localizedRejection.detail }}</p><details><summary>技术信息</summary><code>{{ lastRejection.reasonCode }} · {{ lastRejection.messageKey }}</code></details><button class="button" @click="feedbackStore.clearRejection()">关闭</button></section>
    <div v-if="pendingIds.length" class="pending-banner" role="status">等待服务器确认 · {{ pendingIds.length }}</div>

    <CharacterSelectionView v-if="roomSnapshot?.phase === 'characterSelection'" :snapshot="roomSnapshot" @preselect="roomActions.preselectCharacter" @lock="roomActions.lockCharacter" @chat="roomActions.sendChat" />
    <RoomView v-else-if="roomSnapshot" :snapshot="roomSnapshot" @ready="roomActions.setReady" @chat="roomActions.sendChat" @settings="roomActions.updateSettings" @change-seat="roomActions.changeSeat" @kick="roomActions.kickPlayer" @transfer-host="roomActions.transferHost" @start="roomActions.startGame" @leave="roomActions.leave" @close="roomActions.closeRoom" />
    <SetupRedrawView v-else-if="setupSnapshot" :snapshot="setupSnapshot" @decide="(offerId,redraw)=>gameActions.execute(offerId,{confirm:[redraw]})" />
    <LobbyView v-else-if="!gameSnapshot" :snapshot="lobbySnapshot" @create="(settings,password)=>roomActions.create(settings,password||null)" @join="(code,password,asSpectator)=>roomActions.join(code,password||null,asSpectator)" />
    <GameView v-else-if="gameSnapshot" :snapshot="gameSnapshot" :events="eventQueue" @execute="gameActions.execute" @preselection="gameActions.setPreselection" @chat="gameActions.sendChat" />

    <footer class="boundary-note">Vue 不执行规则，不预测隐藏信息，不直接修改权威状态。</footer>
  </main>
</template>
