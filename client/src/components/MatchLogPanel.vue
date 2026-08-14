<script setup lang="ts">
import {computed,type DeepReadonly} from "vue";
import type {GameSnapshot} from "@skb-protocol/client-protocol";
import {logContextFromSnapshot} from "../localization/logRenderers";
import MatchLogEntries from "./MatchLogEntries.vue";

// 实时对局日志面板：显示 GAME_SNAPSHOT.log（服务端已按观众过滤），包一层 MatchLogEntries。
const props=defineProps<{snapshot:DeepReadonly<GameSnapshot>}>();
const ctx=computed(()=>logContextFromSnapshot(props.snapshot));
const entries=computed(()=>props.snapshot.log??[]);
</script>
<template>
 <MatchLogEntries :entries="entries" :ctx="ctx"/>
</template>
