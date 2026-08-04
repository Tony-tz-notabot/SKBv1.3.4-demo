<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, type DeepReadonly } from "vue";
import type { PromptView, Seat } from "@skb-protocol/client-protocol";
const props=defineProps<{prompt:DeepReadonly<PromptView>|null|undefined;viewerSeat:Seat|null;serverTime:number;activeWindow?:DeepReadonly<{kind:string;prioritySeat:Seat|null;deadlineAt:number;attackerSeat:Seat|null;abilityId:string|null}>|null;characterNameOf?:(seat:number)=>string;abilityNameOf?:(id:string)=>string}>();
const now=ref(Date.now());
let anchorLocal=Date.now();
const anchorServer=ref(props.serverTime);
const timer=window.setInterval(()=>{now.value=Date.now();},250);onBeforeUnmount(()=>window.clearInterval(timer));
// 每份新快照都携带服务器绝对时间。服务端时间只会在快照间前进，
// 本地时钟应相对“该快照到达时刻”重新锚定，否则把挂载至今的全部本地流逝
// 叠加到最新 serverTime 上，会让 estimatedServerNow 逐步虚高，剩余时间被拉回 0。
watch(()=>props.serverTime,(value)=>{if(value>anchorServer.value){anchorServer.value=value;anchorLocal=Date.now();}});
const estimatedServerNow=computed(()=>anchorServer.value+(now.value-anchorLocal));
const remaining=computed(()=>props.prompt?Math.max(0,props.prompt.deadlineAt-estimatedServerNow.value):0);
const seconds=computed(()=>Math.ceil(remaining.value/1000));
const policyText=computed(()=>({pass:"超时不操作",randomLegal:"超时随机合法操作",useDefault:"超时采用默认选择",abortRemaining:"超时终止剩余操作"} as Record<string,string>)[props.prompt?.timeoutPolicy??""]??"");
const nameOf=(seat:number|null|undefined)=>seat!=null?(props.characterNameOf?.(seat)??`${seat}号玩家`):"";
const abilityOf=(id:string|null|undefined)=>id?(props.abilityNameOf?.(id)??id):"";
// 阶段横幅文案：优先给非轮转玩家的全员可见描述（x/y 为角色名，Z 为技能名）。
// 轮到自己时仍显示“轮到你操作”；无窗口时显示“等待服务器推进”。
const headline=computed(()=>{
  const window=props.activeWindow;
  if(!window)return"等待服务器推进";
  if(window.prioritySeat===props.viewerSeat)return"轮到你操作";
  const subject=nameOf(window.prioritySeat);
  if(window.kind==="playPhaseAction"||window.kind==="discardPhaseAction")return`${subject}行动阶段`;
  if(window.kind==="attackResponse")return window.attackerSeat!=null?`${subject}响应${nameOf(window.attackerSeat)}的攻击`:`${subject}响应攻击`;
  if(window.kind==="divineBarrierDamage")return window.abilityId?`${subject}使用${abilityOf(window.abilityId)}`:window.attackerSeat!=null?`${subject}响应${nameOf(window.attackerSeat)}的攻击`:`${subject}应对伤害`;
  if(window.abilityId)return`${subject}使用${abilityOf(window.abilityId)}`;
  if(window.attackerSeat!=null)return`${subject}响应${nameOf(window.attackerSeat)}的攻击`;
  return`等待${window.prioritySeat??""}号玩家`;
});
</script>
<template>
  <div v-if="prompt" class="prompt-banner" :class="{'prompt-banner--mine':prompt.prioritySeat===viewerSeat,'prompt-banner--mandatory':prompt.mandatory}"><div><strong>{{ headline }}</strong><span>{{ prompt.kind }} · {{ policyText }}</span></div><time :datetime="`${seconds}s`">{{ seconds }}s</time></div>
  <div v-else-if="activeWindow" class="prompt-banner prompt-banner--info"><div><strong>{{ headline }}</strong></div></div>
  <div v-else class="prompt-banner-placeholder">{{ headline }}</div>
</template>
