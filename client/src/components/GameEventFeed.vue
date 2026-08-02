<script setup lang="ts">
import { computed, type DeepReadonly } from "vue";
import type { PresentationEvent } from "@skb-protocol/client-protocol";
const props=defineProps<{events:readonly DeepReadonly<PresentationEvent>[]}>();
const latest=computed(()=>props.events.at(-1));
function payload(event:DeepReadonly<PresentationEvent>){return event.payload as Record<string,unknown>;}
function label(event:DeepReadonly<PresentationEvent>){const p=payload(event);const names:Record<string,string>={PHASE_CHANGED:`阶段变更：${p.phase??''}`,CARD_MOVED:"卡牌移动",CARD_REVEALED:"卡牌公开",ACTION_COMMITTED:`行动提交：${p.actionKind??''}`,ATTACK_TARGETED:`攻击指定 ${Array.isArray(p.targetRefs)?p.targetRefs.length:0} 个目标`,RESPONSE_WINDOW_OPENED:`响应窗口：${p.responderSeat??''}号`,RESPONSE_RESOLVED:`响应：${p.result??''}`,JUDGMENT_REVEALED:`判定牌：${p.printedColor??''}`,JUDGMENT_RESULT_CHANGED:`判定结果 ${p.from??''} → ${p.to??''}`,DAMAGE_SEGMENT_APPLIED:`伤害第${p.segmentIndex??''}/${p.totalSegments??''}段：${p.amount??0}`,STATUS_CHANGED:`状态${p.change??''}：${p.statusId??''}`,DYING_STARTED:"角色进入濒死",CHARACTER_RESCUED:"角色解除濒死",CHARACTER_DIED:"角色死亡",CHARACTER_ELIMINATED:"角色淘汰",GAME_ENDED:`游戏结束：${p.winnerTeam??''}队胜利`,SETUP_REDRAW_RESOLVED:`${p.seat??''}号已确认初始手牌`,GAME_STARTED:`对局开始：${p.firstSeat??''}号先行`};return names[event.eventType]??event.eventType;}
const spotlight=computed(()=>latest.value&&["JUDGMENT_REVEALED","JUDGMENT_RESULT_CHANGED","DAMAGE_SEGMENT_APPLIED","DYING_STARTED","CHARACTER_RESCUED","CHARACTER_DIED","CHARACTER_ELIMINATED","GAME_ENDED"].includes(latest.value.eventType)?label(latest.value):null);
</script>
<template><section class="event-feed"><div v-if="spotlight" class="event-spotlight" :data-event="latest?.eventType">{{ spotlight }}</div><header><p class="eyebrow">ACTION LOG</p><span>{{ events.length }} 条待播事件</span></header><ol><li v-for="event in events.slice(-8).reverse()" :key="event.eventSeq"><small>#{{ event.eventSeq }}</small><span>{{ label(event) }}</span></li></ol></section></template>
