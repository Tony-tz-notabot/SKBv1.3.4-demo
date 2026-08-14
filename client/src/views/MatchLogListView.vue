<script setup lang="ts">
import {onMounted,ref} from "vue";
import {fetchMatchLogs,type MatchLogMetaView} from "../network/matchLogs";

const props=defineProps<{token:string}>();
const emit=defineEmits<{back:[];open:[gameId:string]}>();
const games=ref<MatchLogMetaView[]>([]);
const loading=ref(false);
const error=ref<string|null>(null);
onMounted(async()=>{loading.value=true;error.value=null;try{games.value=await fetchMatchLogs(props.token);}catch{error.value="加载对局记录失败，请检查网络";}finally{loading.value=false;}});
const winnerText=(g:MatchLogMetaView)=>g.winnerTeam?`${g.winnerTeam}队胜利`:"未完成";
const playerNames=(g:MatchLogMetaView)=>g.players.map(p=>p.displayName).join("、");
</script>
<template>
 <section class="matchlog-list">
  <header><p class="eyebrow">对局记录</p><button type="button" class="button button--ghost" @click="emit('back')">返回大厅</button></header>
  <p v-if="loading">加载中…</p>
  <p v-if="error" class="notice notice--error">{{ error }}</p>
  <ol v-if="games.length" class="matchlog-list__items">
   <li v-for="g in games" :key="g.gameId">
    <button type="button" @click="emit('open',g.gameId)">
     <strong>{{ playerNames(g) }}</strong>
     <span>{{ new Date(g.endedAt).toLocaleString() }} · {{ winnerText(g) }} · 房间 {{ g.roomCode }}</span>
    </button>
   </li>
  </ol>
  <p v-else-if="!loading&&!error">暂无对局记录</p>
 </section>
</template>
