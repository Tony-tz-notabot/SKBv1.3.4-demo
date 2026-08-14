<script setup lang="ts">
import {computed,onMounted,ref} from "vue";
import type {PromptRenderContext} from "../localization/promptRenderers";
import {fetchMatchLog,type MatchLogDetail} from "../network/matchLogs";
import MatchLogEntries from "../components/MatchLogEntries.vue";

const props=defineProps<{token:string;userId:string;gameId:string}>();
const emit=defineEmits<{back:[]}>();
const detail=ref<MatchLogDetail|null>(null);
const loading=ref(false);
const error=ref<string|null>(null);
onMounted(async()=>{loading.value=true;error.value=null;try{detail.value=await fetchMatchLog(props.token,props.gameId);}catch{error.value="加载对局日志失败，请检查网络";}finally{loading.value=false;}});
const ctx=computed<PromptRenderContext>(()=>{
 const meta=detail.value?.meta;
 const viewer=meta?.players.find(p=>p.userId===props.userId);
 return{viewerSeat:viewer?.seat??null,viewerTeam:viewer?.team??null,players:meta?.players.map(p=>({seat:p.seat,team:p.team,characterId:p.characterId}))??[]};
});
const entries=computed(()=>detail.value?.entries??[]);
</script>
<template>
 <section class="matchlog-view">
  <header><p class="eyebrow">对局日志</p><button type="button" class="button button--ghost" @click="emit('back')">返回记录列表</button></header>
  <p v-if="loading">加载中…</p>
  <p v-if="error" class="notice notice--error">{{ error }}</p>
  <template v-if="detail">
   <p class="matchlog-view__meta">{{ detail.meta.players.map(p=>p.displayName).join("、") }} · {{ detail.meta.winnerTeam?`${detail.meta.winnerTeam}队胜利`:"未完成" }} · {{ new Date(detail.meta.endedAt).toLocaleString() }}</p>
   <MatchLogEntries :entries="entries" :ctx="ctx"/>
  </template>
 </section>
</template>
