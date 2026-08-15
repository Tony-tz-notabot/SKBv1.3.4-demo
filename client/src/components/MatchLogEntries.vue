<script setup lang="ts">
import {computed,nextTick,onMounted,ref,watch} from "vue";
import type {PromptRenderContext} from "../localization/promptRenderers";
import {renderLogEntry,type LogEntryLike} from "../localization/logRenderers";

// 对局日志渲染核心：摘要/详细两模式切换 + token 着色 span。
// 供实时对局（MatchLogPanel，ctx 来自快照）与赛后查看（MatchLogView，ctx 来自元数据）复用。
const props=defineProps<{entries:readonly LogEntryLike[];ctx:PromptRenderContext}>();
const mode=ref<"summary"|"atomic">("summary");
const log=computed(()=>props.entries.filter(e=>e.mode===mode.value));
// 自动滚动：仅在玩家停留在列表底部附近时跟随新日志，上滑看历史期间绝不强制拉回。
const listEl=ref<HTMLElement|null>(null);
const nearBottom=()=>{const el=listEl.value;if(!el)return true;return el.scrollHeight-el.scrollTop-el.clientHeight<=80;};
watch(log,async()=>{await nextTick();const el=listEl.value;if(el&&nearBottom())el.scrollTop=el.scrollHeight;});
onMounted(()=>{void nextTick(()=>{const el=listEl.value;if(el)el.scrollTop=el.scrollHeight;});});
</script>
<template>
 <section class="game-log">
  <header>
   <p class="eyebrow">MATCH LOG</p>
   <div class="game-log__tabs">
    <button type="button" :class="{active:mode==='summary'}" @click="mode='summary'">摘要</button>
    <button type="button" :class="{active:mode==='atomic'}" @click="mode='atomic'">详细</button>
   </div>
  </header>
  <ol ref="listEl" class="game-log__list">
   <li v-for="entry in log" :key="entry.seq">
    <span v-for="(seg,i) in renderLogEntry(entry,ctx)" :key="i" :class="seg.cls">{{ seg.text }}</span>
   </li>
  </ol>
 </section>
</template>
