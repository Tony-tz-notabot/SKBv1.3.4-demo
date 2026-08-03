<script setup lang="ts">
import { computed, reactive, ref, type DeepReadonly } from "vue";
import type { LobbySnapshot, RoomSettings } from "@skb-protocol/room-protocol";

const props = defineProps<{ snapshot: DeepReadonly<LobbySnapshot> | null }>();
const emit = defineEmits<{
  create: [settings: RoomSettings, password: string];
  join: [code: string, password: string, asSpectator: boolean];
}>();
const mode = ref<"create" | "join" | null>(null);
const password = ref("");
const roomCode = ref("");
const asSpectator = ref(false);
const settings = reactive<RoomSettings>({
  roomName: "SKB测试局",
  allowGuests: true,
  allowSpectators: false,
  turnTimeSeconds: 120,
  responseTimeSeconds: 120,
  reserveTimeSeconds: 30,
  rulesetVersion: "1.3.4",
  dismantleBossEnabled: true,
});
const availableVersions = computed(() => props.snapshot?.rulesetVersions.filter((version): version is "1.3.4" => version === "1.3.4") ?? ["1.3.4"]);
const normalizedCode = computed(() => roomCode.value.trim().toUpperCase());
const createValid = computed(() => settings.roomName.trim().length > 0
  && Number.isInteger(settings.turnTimeSeconds) && settings.turnTimeSeconds >= 1
  && Number.isInteger(settings.responseTimeSeconds) && settings.responseTimeSeconds >= 1
  && Number.isInteger(settings.reserveTimeSeconds) && settings.reserveTimeSeconds >= 0);
const joinValid = computed(() => /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/.test(normalizedCode.value));

function submitCreate() {
  if (!createValid.value) return;
  emit("create", { ...settings, roomName: settings.roomName.trim() }, password.value);
}
function submitJoin() {
  if (!joinValid.value) return;
  emit("join", normalizedCode.value, password.value, asSpectator.value);
}
</script>

<template>
  <section class="lobby-grid">
    <article class="hero-panel" :class="{ 'hero-panel--form': mode }">
      <p class="eyebrow">PRIVATE 2V2 TABLE</p>
      <h2>建立你的<br><span>四人牌局</span></h2>
      <p>固定座位、逆时针结算、服务器权威。规则版本 {{ snapshot?.rulesetVersions[0] ?? "1.3.4" }}。</p>
      <div class="hero-actions">
        <button type="button" class="button" :class="{ 'button--primary': mode === 'create' }" @click="mode='create'">创建房间</button>
        <button type="button" class="button" :class="{ 'button--primary': mode === 'join' }" @click="mode='join'">输入房间号</button>
      </div>

      <form v-if="mode === 'create'" class="room-create-form" @submit.prevent="submitCreate">
        <label class="form-field form-field--wide"><span>房间名称</span><input v-model="settings.roomName" maxlength="40" required></label>
        <label class="form-field"><span>规则版本</span><select v-model="settings.rulesetVersion"><option v-for="version in availableVersions" :key="version" :value="version">{{ version }}</option></select></label>
        <label class="form-field"><span>房间密码</span><input v-model="password" maxlength="100" type="password" placeholder="不填写则无密码"></label>
        <fieldset class="time-settings"><legend>计时设置（秒）</legend>
          <label class="form-field"><span>回合时限</span><input v-model.number="settings.turnTimeSeconds" type="number" min="1" step="1" required></label>
          <label class="form-field"><span>响应时限</span><input v-model.number="settings.responseTimeSeconds" type="number" min="1" step="1" required></label>
          <label class="form-field"><span>预留时间</span><input v-model.number="settings.reserveTimeSeconds" type="number" min="0" step="1" required></label>
        </fieldset>
        <div class="toggle-grid">
          <label><input v-model="settings.allowGuests" type="checkbox"><span><strong>允许游客</strong><small>未登录玩家可加入</small></span></label>
          <label><input v-model="settings.allowSpectators" type="checkbox"><span><strong>允许观战</strong><small>无座位观看者可进入</small></span></label>
          <label><input v-model="settings.dismantleBossEnabled" type="checkbox"><span><strong>允许拆除 BOSS</strong><small>当前规则默认启用</small></span></label>
        </div>
        <button class="button button--primary form-submit" :disabled="!createValid">确认创建</button>
      </form>

      <form v-else-if="mode === 'join'" class="room-join-form" @submit.prevent="submitJoin">
        <label class="form-field"><span>六位房间号</span><input v-model="roomCode" maxlength="6" autocomplete="off" placeholder="例如 7KQ9MT" required></label>
        <label class="form-field"><span>房间密码</span><input v-model="password" maxlength="100" type="password" placeholder="如房间未设置可留空"></label>
        <label class="spectator-option"><input v-model="asSpectator" type="checkbox"><span>以观战者身份加入</span></label>
        <p v-if="roomCode && !joinValid" class="form-error">房间号应为六位，且不使用易混淆字符 0、1、I、L、O。</p>
        <button class="button button--primary form-submit" :disabled="!joinValid">确认加入</button>
      </form>
    </article>
    <aside class="lobby-side">
      <div class="account-card"><span class="avatar">K</span><div><strong>{{ snapshot?.user.displayName ?? "等待账号" }}</strong><p>{{ snapshot?.user.latencyMs ?? "--" }} ms · 在线</p></div></div>
      <article class="resume-card"><p class="eyebrow">CONTINUE</p><template v-if="snapshot?.resumableGames[0]"><h3>继续未完成对局</h3><strong class="room-code">{{ snapshot.resumableGames[0].roomCode }}</strong><p>第 {{ snapshot.resumableGames[0].round }} 轮 · {{ snapshot.resumableGames[0].statusText }}</p></template><p v-else>没有可恢复的对局</p></article>
      <nav class="quick-links" aria-label="大厅功能"><span>角色图鉴</span><span>卡牌图鉴</span><span>设置</span></nav>
    </aside>
  </section>
</template>
