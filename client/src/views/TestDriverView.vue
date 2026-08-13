<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import type { GameSnapshot, Seat, SetupSnapshot } from "@skb-protocol/client-protocol";
import GameView from "./GameView.vue";
import SetupRedrawView from "./SetupRedrawView.vue";
import { SeatHarness, type Selections } from "../dev/seatHarness";
import { TestApiClient, type TestSetupOptions, type TestSetupResult, type TestStateSummary } from "../dev/testApiClient";
import { characterCandidate } from "../localization/characterCatalog";

// Agent 测试环境（?test=1）：单页面内 4 条真实 WS 连接模拟 4 玩家，可切换当前控制座位并查看隐藏信息。
// 服务端需以 SKB_TEST_MODE=1 启动；页面首次挂载自动调用 /api/test/setup 直达正文。

const api = new TestApiClient();
const seats: Seat[] = [1, 2, 3, 4];
const harnesses = shallowRef<SeatHarness[]>([]);
const activeSeat = ref<Seat>(1);
const showHidden = ref(true);
const gameId = ref("");
const authoritative = shallowRef<TestStateSummary | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);

const harness = computed(() => harnesses.value[activeSeat.value - 1] ?? null);
const snapshot = computed<GameSnapshot | SetupSnapshot | null>(() => harness.value?.state.snapshot ?? null);
const setupSnapshot = computed<SetupSnapshot | null>(() => (snapshot.value?.type === "SETUP_SNAPSHOT" ? snapshot.value : null));
const gameSnapshot = computed<GameSnapshot | null>(() => (snapshot.value?.type === "GAME_SNAPSHOT" ? snapshot.value : null));

function wsUrlBase(): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const configured = import.meta.env.VITE_WS_URL as string | undefined;
  return configured ?? `${scheme}://${location.hostname}:${import.meta.env.DEV ? "8787" : location.port}/ws`;
}

async function setup(options: TestSetupOptions = {}): Promise<TestSetupResult> {
  busy.value = true;
  error.value = null;
  try {
    const result = await api.setup(options);
    gameId.value = result.gameId;
    for (const item of harnesses.value) item.disconnect();
    const list = result.players.map(player => new SeatHarness(player.seat as Seat, player.token, player.userId, wsUrlBase()));
    harnesses.value = list;
    for (const item of list) item.connect();
    activeSeat.value = result.firstSeat as Seat;
    await refreshState();
    return result;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
    throw cause;
  } finally {
    busy.value = false;
  }
}
async function restart() { return setup({}); }
async function refreshState(): Promise<TestStateSummary | null> {
  if (!gameId.value) return null;
  authoritative.value = await api.state(gameId.value);
  return authoritative.value;
}
async function injectHand(seat: number, templates: string[], mode: "replace" | "append" = "replace"): Promise<TestStateSummary> {
  authoritative.value = await api.hand(gameId.value, seat, templates, mode);
  return authoritative.value;
}
async function injectDeck(templates: string[], mode: "top" | "bottom" = "top"): Promise<TestStateSummary> {
  authoritative.value = await api.deck(gameId.value, templates, mode);
  return authoritative.value;
}
function setSeat(seat: Seat) { activeSeat.value = seat; }

// GameView / SetupRedrawView emits → 路由到当前控制座位连接
function execute(offerId: string, selections: Selections) { harness.value?.execute(offerId, selections); }
function preselect(weaponSlot: string | null, modeId: string | null) { harness.value?.preselect(weaponSlot, modeId); }
function chat(channel: "all" | "team", text: string) { harness.value?.chat(channel, text); }
function forfeit() { harness.value?.forfeit(); }
function disband() { harness.value?.disband(); }
function decideRedraw(offerId: string, redraw: boolean) { harness.value?.execute(offerId, { confirm: [redraw] }); }

// 调试面板
function connectionLabel(seat: Seat): string { return harnesses.value[seat - 1]?.state.connectionState ?? "offline"; }
function pendingLabel(seat: Seat): number { return harnesses.value[seat - 1]?.state.pendingCount ?? 0; }
function seatName(seat: Seat): string {
  const current = harnesses.value[seat - 1]?.state.snapshot;
  if (current?.type !== "GAME_SNAPSHOT") return `${seat}号`;
  const player = (current as GameSnapshot).publicView.players.find(item => item.seat === seat);
  const candidate = player?.characterId ? characterCandidate(player.characterId) : null;
  return candidate?.displayName ?? player?.nickname ?? `${seat}号`;
}
function seatHand(seat: Seat): Array<{ templateId: string; displayName: string }> {
  const current = harnesses.value[seat - 1]?.state.snapshot;
  if (current?.type === "GAME_SNAPSHOT") return (current as GameSnapshot).privateView.hand.map(card => ({ templateId: card.templateId ?? "", displayName: card.displayName }));
  if (current?.type === "SETUP_SNAPSHOT") return (current as SetupSnapshot).hand.map(card => ({ templateId: card.templateId, displayName: card.displayName }));
  return [];
}

onMounted(() => { void setup({}); });
onBeforeUnmount(() => { for (const item of harnesses.value) item.disconnect(); });

// 暴露给 preview_eval 程序化驱动
declare global { interface Window { __skbHarness?: Record<string, unknown> } }
function expose() {
  window.__skbHarness = {
    ready: () => harnesses.value.length > 0 && harnesses.value.every(item => item.state.snapshot !== null),
    activeSeat: () => activeSeat.value,
    setSeat,
    setup,
    restart,
    execute: (seat: number, offerId: string, selections: Selections) => { harnesses.value[seat - 1]?.execute(offerId, selections); },
    preselect: (seat: number, weaponSlot: string | null, modeId: string | null) => { harnesses.value[seat - 1]?.preselect(weaponSlot, modeId); },
    forfeit: (seat: number) => { harnesses.value[seat - 1]?.forfeit(); },
    chat: (seat: number, channel: "all" | "team", text: string) => { harnesses.value[seat - 1]?.chat(channel, text); },
    getSnapshots: () => harnesses.value.map(item => ({ seat: item.seat, snapshot: item.state.snapshot, room: item.state.room, events: item.state.events, connectionState: item.state.connectionState, pendingCount: item.state.pendingCount, rejected: item.state.rejected })),
    refreshState,
    getAuthoritative: () => authoritative.value,
    injectHand,
    injectDeck,
  };
}
expose();
</script>

<template>
  <section class="test-driver">
    <header class="test-toolbar">
      <strong>TEST HARNESS</strong>
      <button
        v-for="seat in seats" :key="seat" type="button"
        :class="{ active: activeSeat === seat }"
        @click="setSeat(seat)"
      >座位{{ seat }}<small>{{ connectionLabel(seat) }}·{{ pendingLabel(seat) }}</small></button>
      <label class="test-toggle"><input v-model="showHidden" type="checkbox" />显示隐藏信息</label>
      <button type="button" @click="refreshState">刷新权威状态</button>
      <button type="button" @click="restart">重新开局</button>
      <span v-if="error" class="test-error">{{ error }}</span>
    </header>

    <p v-if="busy" class="test-waiting">正在建立测试对局…</p>
    <template v-else-if="setupSnapshot">
      <SetupRedrawView :snapshot="setupSnapshot" @decide="decideRedraw" />
    </template>
    <template v-else-if="gameSnapshot">
      <GameView
        :snapshot="gameSnapshot"
        :events="harness?.state.events ?? []"
        :can-disband-room="harness?.state.room?.permissions.canDisbandRoom === true"
        @execute="execute" @preselection="preselect" @chat="chat" @forfeit="forfeit" @disband="disband"
      />
    </template>
    <p v-else class="test-waiting">等待服务器投影…（连接 {{ harnesses.map(item => item.state.connectionState).join(" / ") }}）</p>

    <section v-if="showHidden && authoritative" class="test-hidden">
      <div class="test-auth">
        <h3>权威状态 <small>#{{ authoritative.stateRevision }} · round {{ authoritative.round }} · {{ authoritative.phase }} · active {{ authoritative.activeSeat }} · {{ authoritative.lifecycle }}</small></h3>
        <p>牌堆 {{ authoritative.drawPileCount }} 张 · 顶部 {{ authoritative.drawPileTopTemplates.join(", ") || "—" }}</p>
        <p>窗口 {{ authoritative.pendingWindows.map(window => `${window.kind}@${window.prioritySeat}`).join(", ") || "无" }}</p>
        <ul>
          <li v-for="player in authoritative.players" :key="player.seat">
            <strong>座{{ player.seat }}·{{ player.characterId }}</strong> 血{{ player.hp }} 盾{{ player.shield }} 铁{{ player.ironShield }} · {{ player.lifeState }} · 手牌[{{ player.handTemplates.join(", ") }}]
          </li>
        </ul>
      </div>
      <div class="test-hands">
        <div v-for="seat in seats" :key="`hand-${seat}`" class="test-hand">
          <h4>座{{ seat }}·{{ seatName(seat) }}</h4>
          <span v-for="card in seatHand(seat)" :key="card.templateId">{{ card.displayName }}<small>{{ card.templateId }}</small></span>
          <p v-if="!seatHand(seat).length" class="test-empty">无手牌数据</p>
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped>
.test-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 12px; background: #1b1e26; border-bottom: 1px solid #333; position: sticky; top: 0; z-index: 20; }
.test-toolbar strong { color: #ffd54f; margin-right: 4px; }
.test-toolbar button { background: #2a2f3a; color: #ddd; border: 1px solid #444; border-radius: 4px; padding: 4px 8px; cursor: pointer; }
.test-toolbar button.active { background: #3d5afe; border-color: #5c6bc0; color: #fff; }
.test-toolbar small { display: block; font-size: 10px; opacity: 0.7; }
.test-toggle { color: #ccc; font-size: 12px; }
.test-error { color: #ef5350; }
.test-waiting { padding: 24px; color: #888; }
.test-hidden { margin: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.test-auth, .test-hand { background: #14161c; border: 1px solid #333; border-radius: 6px; padding: 10px; font-size: 12px; overflow: auto; }
.test-auth h3, .test-hand h4 { margin: 0 0 6px; color: #ffd54f; }
.test-auth p { margin: 4px 0; color: #bbb; }
.test-auth ul { margin: 0; padding-left: 16px; color: #ccc; }
.test-hands { display: grid; gap: 8px; }
.test-hand span { display: inline-flex; align-items: baseline; gap: 6px; margin: 2px 4px 2px 0; background: #20242d; padding: 2px 6px; border-radius: 4px; color: #ddd; }
.test-hand small { opacity: 0.6; font-size: 10px; }
.test-empty { color: #666; }
</style>
