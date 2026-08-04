<script setup lang="ts">
import {computed,onMounted,ref,shallowRef} from "vue";
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

const savedToken=sessionStorage.getItem("skb.token");
const savedDisplayName=sessionStorage.getItem("skb.displayName");
const account=ref<{userId:string;displayName:string;token:string}|null>(savedToken&&savedDisplayName?{userId:sessionStorage.getItem("skb.userId")??"",displayName:savedDisplayName,token:savedToken}:null);
const loginUsername=ref("");const loginPassword=ref("");const loginError=ref<string|null>(null);const loginBusy=ref(false);
function connectAs(session:{userId:string;displayName:string;token:string}){account.value=session;sessionStorage.setItem("skb.token",session.token);sessionStorage.setItem("skb.userId",session.userId);sessionStorage.setItem("skb.displayName",session.displayName);const scheme=location.protocol==="https:"?"wss":"ws";const base=import.meta.env.VITE_WS_URL||`${scheme}://${location.hostname}:${import.meta.env.DEV?"8787":location.port}/ws`,url=new URL(base);url.searchParams.set("token",session.token);const realtime=createRealtimeService(url.toString());configureRoomCommandSender(realtime.sendRoomCommand);configureGameCommandSender(realtime.sendGameCommand);realtime.connect();}
async function login(){const username=loginUsername.value.trim(),password=loginPassword.value;if(!username||!password){loginError.value="请输入账号和密码";return;}loginBusy.value=true;loginError.value=null;try{const response=await fetch("/api/session",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username,password})});const result=await response.json() as {ok?:boolean;reason?:string;userId?:string;displayName?:string;token?:string};if(!response.ok||!result.ok||!result.userId||!result.token){loginError.value=result.reason==="ACCOUNT_PASSWORD_INVALID"?"账号或密码错误":result.reason==="USERNAME_INVALID"?"账号格式不合法（2-20位字母/数字/下划线/中文）":"登录失败，请重试";return;}connectAs({userId:result.userId,displayName:result.displayName??username,token:result.token});}catch{loginError.value="无法连接服务器";}finally{loginBusy.value=false;}}
function logout(){sessionStorage.removeItem("skb.token");sessionStorage.removeItem("skb.userId");sessionStorage.removeItem("skb.displayName");account.value=null;location.reload();}

onMounted(async () => {
  if (import.meta.env.DEV && new URLSearchParams(location.search).get("mock") === "1") {
    const mock = (await import("./dev/mockServer")).createMockServer(); showMock = mock.show;
    configureRoomCommandSender(mock.send); configureGameCommandSender(mock.sendGame); showMock(mockScene.value);
    connectionStore.setState("online"); connectionStore.setLatency(24); return;
  }
  if(account.value)connectAs(account.value);
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
        <span v-if="account && !(isDev && showMock)" class="topbar__account">{{ account.displayName }}<button type="button" class="button button--ghost" @click="logout">退出</button></span>
      </div>
    </header>

    <section v-if="!account && !(isDev && showMock)" class="login-panel">
      <form class="login-card" @submit.prevent="login">
        <h2>登录 / 注册</h2>
        <p class="eyebrow">输入账号密码，不存在则自动注册。每个标签页可登录不同账号，便于一机多开。</p>
        <label>账号<input v-model="loginUsername" maxlength="20" placeholder="2-20位字母/数字/下划线/中文" autocomplete="username" /></label>
        <label>密码<input v-model="loginPassword" type="password" placeholder="密码" autocomplete="current-password" /></label>
        <p v-if="loginError" class="login-card__error" role="alert">{{ loginError }}</p>
        <button type="submit" class="button button--primary" :disabled="loginBusy">{{ loginBusy ? "登录中…" : "登录 / 注册" }}</button>
      </form>
    </section>

    <section v-if="protocolErrors.length" class="notice notice--error" role="alert">
      <strong>服务器消息未通过协议校验</strong>
      <ul><li v-for="error in protocolErrors" :key="error">{{ error }}</li></ul>
    </section>
    <section v-if="lastRejection && localizedRejection" class="notice notice--error" role="alert"><strong>{{ localizedRejection.title }}</strong><p>{{ localizedRejection.detail }}</p><details><summary>技术信息</summary><code>{{ lastRejection.reasonCode }} · {{ lastRejection.messageKey }}</code></details><button class="button" @click="feedbackStore.clearRejection()">关闭</button></section>
    <div v-if="pendingIds.length" class="pending-banner" role="status">等待服务器确认 · {{ pendingIds.length }}</div>

    <GameView v-if="gameSnapshot" :snapshot="gameSnapshot" :events="eventQueue" :can-disband-room="roomSnapshot?.permissions.canDisbandRoom === true" @execute="gameActions.execute" @preselection="gameActions.setPreselection" @chat="gameActions.sendChat" @forfeit="gameActions.forfeit" @disband="roomActions.disband" />
    <SetupRedrawView v-else-if="setupSnapshot" :snapshot="setupSnapshot" @decide="(offerId,redraw)=>gameActions.execute(offerId,{confirm:[redraw]})" />
    <CharacterSelectionView v-else-if="roomSnapshot?.phase === 'characterSelection'" :snapshot="roomSnapshot" @preselect="roomActions.preselectCharacter" @lock="roomActions.lockCharacter" @chat="roomActions.sendChat" />
    <RoomView v-else-if="roomSnapshot && roomSnapshot.phase !== 'inGame'" :snapshot="roomSnapshot" @ready="roomActions.setReady" @chat="roomActions.sendChat" @settings="roomActions.updateSettings" @change-seat="roomActions.changeSeat" @kick="roomActions.kickPlayer" @transfer-host="roomActions.transferHost" @start="roomActions.startGame" @leave="roomActions.leave" @close="roomActions.closeRoom" />
    <LobbyView v-else :snapshot="lobbySnapshot" @create="(settings,password)=>roomActions.create(settings,password||null)" @join="(code,password,asSpectator)=>roomActions.join(code,password||null,asSpectator)" />

    <footer class="boundary-note">Vue 不执行规则，不预测隐藏信息，不直接修改权威状态。</footer>
  </main>
</template>
