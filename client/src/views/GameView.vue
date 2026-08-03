<script setup lang="ts">
import { computed, reactive, ref, watch, type DeepReadonly } from "vue";
import type { GameSnapshot, InteractionOffer, PlayerView, Seat, SelectionSpec } from "@skb-protocol/client-protocol";
import GamePlayerPanel from "../components/GamePlayerPanel.vue";
import GameCard from "../components/GameCard.vue";
import CardDetailDrawer from "../components/CardDetailDrawer.vue";
import type { CardView } from "@skb-protocol/client-protocol";
import PromptBanner from "../components/PromptBanner.vue";
import GameEventFeed from "../components/GameEventFeed.vue";
import GameChatPanel from "../components/GameChatPanel.vue";
import type { PresentationEvent } from "@skb-protocol/client-protocol";
import { selectionsComplete, toggleSelection } from "../interaction/selectionState";

const props = defineProps<{ snapshot: DeepReadonly<GameSnapshot>; events:readonly DeepReadonly<PresentationEvent>[] }>();
const emit = defineEmits<{ execute: [offerId: string, selections: Record<string, Array<string | number | boolean>>]; preselection: [weaponSlot: string | null, modeId: string | null]; chat:[channel:"all"|"team",text:string]; forfeit: [] }>();
const positions = ["bottom", "right", "top", "left"] as const;
const viewerSeat = computed(() => props.snapshot.viewer.seat ?? 1);
const activeOfferId = ref<string | null>(props.snapshot.interaction.offers[0]?.offerId ?? null);
const selected = reactive<Record<string, Array<string | number | boolean>>>({});
const detailCard=ref<DeepReadonly<CardView>|null>(null);
const activeOffer = computed(() => props.snapshot.interaction.offers.find((offer) => offer.offerId === activeOfferId.value) ?? null);
watch(() => props.snapshot.stateRevision, () => { activeOfferId.value=props.snapshot.interaction.offers[0]?.offerId ?? null; clearSelections(); });
watch(activeOfferId, clearSelections);
function clearSelections() { for(const key of Object.keys(selected)) delete selected[key]; }
const playerPosition = (seat: Seat) => positions[(seat - viewerSeat.value + 4) % 4];
const playerAt = (position: typeof positions[number]) => props.snapshot.publicView.players.find((p) => playerPosition(p.seat) === position) as DeepReadonly<PlayerView> | undefined;
const cardSpecs = computed(() => activeOffer.value?.selectionSpecs.filter((spec) => spec.kind === "cards") ?? []);
const targetSpecs = computed(() => activeOffer.value?.selectionSpecs.filter((spec) => spec.kind === "targets") ?? []);
const legalCardRefs = computed(() => new Set(cardSpecs.value.flatMap(spec=>spec.legalRefs??[]).concat(cardSpecs.value.length?[]:[...(activeOffer.value?.sourceRefs??[])])));
const legalTargetRefs = computed(() => new Set(targetSpecs.value.flatMap((spec)=>spec.legalRefs??[]).concat(activeOffer.value?.legalTargetRefs??[])));
const selectedRefs = computed(() => new Set(Object.values(selected).flat().filter((value):value is string=>typeof value==="string")));
const selectionOrder = (key:string|undefined, value:string) => key ? (selected[key]?.indexOf(value) ?? -1) + 1 : 0;
const cardSpecFor=(ref:string)=>cardSpecs.value.find(spec=>spec.legalRefs?.includes(ref));
const cardSelectionOrder=(ref:string)=>selectionOrder(cardSpecFor(ref)?.key,ref);
const targetSpecFor=(ref:string)=>targetSpecs.value.find((spec)=>spec.legalRefs?.includes(ref));
const targetSpecForClick=(ref:string)=>{const specs=targetSpecs.value.filter((spec)=>spec.legalRefs?.includes(ref));return specs.find((spec)=>(selected[spec.key]?.length??0)<spec.max)??specs[0];};
const chooseCard=(ref:string)=>{const spec=cardSpecFor(ref);if(spec){choose(spec,ref);return;}const offer=props.snapshot.interaction.offers.find((item)=>item.sourceRefs?.includes(ref)&&item.selectionSpecs.length===0);if(offer)activeOfferId.value=offer.offerId;};
const chooseTarget=(ref:string)=>choose(targetSpecForClick(ref),ref);
const disabledByRef=computed(()=>new Map(props.snapshot.interaction.disabledHints.map((hint)=>[hint.subjectRef,hint.messageKey])));
const choiceSpecs=computed(()=>activeOffer.value?.selectionSpecs.filter((spec)=>spec.kind!=="cards"&&spec.kind!=="targets")??[]);
const selectionsValid = computed(() => !!activeOffer.value && selectionsComplete(activeOffer.value.selectionSpecs as SelectionSpec[],selected));
function offerLabel(offer: DeepReadonly<InteractionOffer>) { return ({ declareAttack:"发动攻击",useCard:"使用卡牌",activateAbility:"发动技能",respond:"响应",equip:"装备",discardEquipment:"丢弃装备",dismantle:"拆除",synthesize:"合成",interveneJudgment:"干预判定",rescueDying:"救援",resolveChoice:"确认选择",pass:"放弃",endPhase:"结束阶段" } as Record<string,string>)[offer.kind] ?? offer.kind; }
function slotLabel(slot:string|undefined){if(!slot)return null;const weapon=/^weapon:([1-3]):/.exec(slot),third=/^thirdWeapon:/.test(slot);return weapon?`武${weapon[1]}`:third?"武3":null;}
const promptHints:Record<string,string>={"playPhaseAction":"你的出牌阶段：可发动攻击、装备武器、使用手牌，或结束阶段","discardPhaseAction":"你的弃牌阶段：手牌超限需弃置，否则直接结束","attackResponse":"你正被攻击：可出【闪】、防具或技能响应，否则放弃","dyingRescue":"你处于濒死：可用药水、号角或技能救援，否则将被淘汰","judgmentDesignation":"指定判定：可指定颜色，或放弃交给随机判定","judgmentIntervention":"判定干预：当前玩家可替换判定牌，或放弃","preJudgment":"判定确认：确认开始判定","optionalTrigger":"可选触发：可发动效果（放弃则不发动）","triggerOrdering":"触发排序：选择效果的结算顺序","berserkerRage":"狂战宣告：选择少摸牌数（1/2 使下个攻击必暴击）","c6LaserSweepRequest":"C6H8O6：选择要求其他玩家打出的牌色","c6FocusedBombardmentRequest":"C6H8O6：选择要求目标打出的牌色","criticalPenetration":"暴击穿透：选择追击目标与【杀】","crystalCrabActivePincer":"水晶巨蟹主动钳：可选攻击一个目标","darkKnightFinalStrike":"暗黑大骑士最后一击：逐次选择攻击目标","divineBarrierDamage":"神圣屏障：可支付两张蓝牌免疫本次伤害","engineerMechChoice":"工程师机甲：选择要进入的机甲","extraGemDeathTransfer":"额外宝石：濒死结算，选择交付的手牌","extraGemDyingResult":"额外宝石：选择交付的手牌","foresightDrawChoice":"未卜先知：从展示牌中选择要摸的牌（其余弃置）","goldenMaskTarget":"金面猴王：选择攻击目标","internetAddictionDodgeRequest":"网瘾：选择是否出【闪】响应","minerDigAtPlayEnd":"矿工遁地：选择拆牌目标","minerNaturalExitTarget":"矿工遁地：选择自然退出攻击目标","minerSourceDismantle":"矿工：选择要拆的伤害来源牌","owlCounterattack":"枭首者猫头鹰：可选发起反击","purpleLordHeroBlade":"魂刀·英刃：可选攻击一个目标","qiBallDismantle":"气功波：选择要拆除的卡牌","reforgeFurnaceSelection":"重铸熔炉：从展示的武器中选择一把","sheepPhaseOneDodgeRequest":"羊叫兽：选择是否出【闪】响应","superBabyDodgeRequest":"超级大宝贝儿：选择是否出【闪】响应","temporaryCoinImmediateUse":"临时金币：立即使用或放弃","trapBombDetonation":"引爆炸弹：选择引爆或放弃","triggerCardSelection":"触发选牌：选择目标卡牌","valkyrieBossResponse":"瓦尔基里：可响应复制对方 BOSS","weaponParticleEagleFollowUp":"粒子之鹰追击：选择追击目标或放弃","weaponW61Choice":"扳手：选择拆除目标或改为伤害","wizardSpellStrike":"法师法术打击：弃一张手牌触发效果","redLordSealingHammer":"封灵战锤：选择近战/激光目标","statueResolutionChoice":"雕像效果：选择目标执行雕像效果","statueCardSelection":"雕像：从目标处选择一张卡牌","statuePaladinResponse":"圣骑士雕像：可阻止其他雕像效果","statuePriestTake":"牧师雕像：选择是否拿取展示牌","statueKnightDuel":"骑士雕像：交替出【杀】决斗","statueKnightWeapon":"骑士雕像：选择决斗胜利后的武器","demolitionOptionalDiscard":"拆迁大队：可选择弃置一把武器","demolitionWeaponOverflow":"拆迁大队：武器超限需选择弃置","initialRedraw":"开局重摸：选择是否整手弃 4 摸 4"};
const promptHint=computed(()=>{const kind=props.snapshot.interaction.prompt?.kind;return kind?promptHints[kind]??"请完成下方操作窗口":"等待服务器推进";});
function choose(spec: DeepReadonly<SelectionSpec> | undefined,value:string|number|boolean) { if(!spec) return;const next=toggleSelection(selected,spec as SelectionSpec,value);selected[spec.key]=next[spec.key]??[]; }
function chooseOffer(offer: DeepReadonly<InteractionOffer>) { activeOfferId.value=offer.offerId; if(!offer.selectionSpecs.length) submit(offer); }
function validFor(offer: DeepReadonly<InteractionOffer>) { return selectionsComplete(offer.selectionSpecs as SelectionSpec[],selected); }
function submit(offer=activeOffer.value) {
  if(!offer||!validFor(offer)) return;
  const selection = Object.fromEntries(Object.entries(selected).map(([key, values]) => [key, [...values]]));
  emit("execute",offer.offerId,selection);
}
function specInstruction(spec: DeepReadonly<SelectionSpec>) { const names={cards:"卡牌",targets:"目标",option:"选项",number:"数字",color:"颜色",mode:"模式",confirm:"确认"}; return `选择${names[spec.kind]} ${spec.min}${spec.max!==spec.min?`–${spec.max}`:""}项`; }
function selectEquipmentSlot(slotId:string,card:DeepReadonly<CardView>|null){if(!props.snapshot.privateView.preselectableWeaponSlots.includes(slotId))return;emit("preselection",slotId,card?.state.modeId??null);}
function valuesFor(spec:DeepReadonly<SelectionSpec>){if(spec.options?.length)return spec.options;if(spec.kind==="confirm")return [true,false];return [];}
function choiceLabel(value:string|number|boolean){if(value===true)return "确认";if(value===false)return "取消";const colors:Record<string,string>={white:"白",red:"红",orange:"橙",blue:"蓝",green:"绿",none:"无色"};return typeof value==="string"?(colors[value]??value):String(value);}
function forwardChat(channel:"all"|"team",text:string){emit("chat",channel,text);}
</script>
<template>
  <section class="game-layout">
    <PromptBanner :prompt="snapshot.interaction.prompt" :viewer-seat="snapshot.viewer.seat" :server-time="snapshot.serverTime" />
    <header class="game-hud"><div><p class="eyebrow">ROUND {{ snapshot.publicView.round }}</p><h2>{{ snapshot.publicView.headline ?? `${snapshot.publicView.activeSeat}号玩家行动` }}</h2></div><div class="phase-track"><span v-for="phase in ['prepare','judgment','draw','play','discard','end']" :key="phase" :class="{ active: snapshot.publicView.phase === phase }">{{ phase }}</span></div><button v-if="!snapshot.publicView.headline" type="button" class="forfeit-button" @click="emit('forfeit')">退出本局</button></header>
    <div class="game-table">
      <div v-for="position in positions" :key="position" class="game-player-position" :data-position="position"><GamePlayerPanel v-if="playerAt(position)" :player="playerAt(position)!" :active="playerAt(position)!.seat === snapshot.publicView.activeSeat" :local="playerAt(position)!.seat === viewerSeat" :legal-target="legalTargetRefs.has(`public:seat_${playerAt(position)!.seat}`)" :selected-target="selectedRefs.has(`public:seat_${playerAt(position)!.seat}`)" :selected-order="selectionOrder(targetSpecFor(`public:seat_${playerAt(position)!.seat}`)?.key,`public:seat_${playerAt(position)!.seat}`)" :preselected-weapon-slot="playerAt(position)!.seat===viewerSeat?snapshot.privateView.preselectedWeaponSlot:null" :preselectable-weapon-slots="playerAt(position)!.seat===viewerSeat?snapshot.privateView.preselectableWeaponSlots:[]" :legal-card-refs="legalCardRefs" :selected-card-refs="selectedRefs" @select="chooseTarget" @card-select="chooseCard" @slot-select="selectEquipmentSlot" @detail="detailCard=$event" /></div>
      <div class="game-center"><div class="pile"><strong>{{ snapshot.publicView.drawPileCount }}</strong><span>牌库</span></div><div class="discard-stack"><GameCard v-for="card in snapshot.publicView.discardTop" :key="card.ref" :card="card" compact @detail="detailCard=$event" /><span v-if="!snapshot.publicView.discardTop.length">弃牌堆</span></div><div v-if="snapshot.publicView.centralCards.length" class="central-cards"><GameCard v-for="card in snapshot.publicView.centralCards" :key="card.ref" :card="card" compact @detail="detailCard=$event" /></div></div>
    </div>
    <section class="hand-zone"><header><div><p class="eyebrow">YOUR HAND</p><strong>{{ snapshot.privateView.hand.length }} 张</strong></div><span>右键查看详情</span></header><div class="hand-cards"><GameCard v-for="card in snapshot.privateView.hand" :key="card.ref" :card="card" :legal="legalCardRefs.has(card.ref)" :selected="selectedRefs.has(card.ref)" :selected-order="cardSelectionOrder(card.ref)" :disabled-reason="disabledByRef.get(card.ref)" @select="chooseCard" @detail="detailCard=$event" /></div><div v-if="snapshot.privateView.concealedChoices.length" class="concealed-choices"><button v-for="ref in snapshot.privateView.concealedChoices" :key="ref" type="button" class="concealed-choice" :class="{ 'concealed-choice--legal': legalCardRefs.has(ref), 'concealed-choice--selected': selectedRefs.has(ref) }" @click="chooseCard(ref)">隐藏牌{{ cardSelectionOrder(ref) ? ` · ${cardSelectionOrder(ref)}` : '' }}</button></div></section>
    <aside class="interaction-panel"><header><p class="eyebrow">SERVER OFFERS</p><strong>{{ snapshot.interaction.prompt?.mandatory ? '必须操作' : snapshot.interaction.prompt ? '可选操作窗口' : '等待推进' }}</strong></header><p class="prompt-hint">{{ promptHint }}</p><p v-if="snapshot.interaction.prompt" class="prompt-kind">{{ snapshot.interaction.prompt.kind }}</p><div class="offer-list"><button v-for="offer in snapshot.interaction.offers" :key="offer.offerId" type="button" class="button" :class="{ 'button--primary': offer.offerId === activeOfferId }" @click="chooseOffer(offer)">{{ offerLabel(offer) }}<small v-if="slotLabel((offer.preview as any)?.slot)">{{ slotLabel((offer.preview as any)?.slot) }}</small><small v-if="offer.preview.costSummary">{{ offer.preview.costSummary }}</small></button></div><div v-if="activeOffer?.selectionSpecs.length" class="selection-checklist"><span v-for="spec in activeOffer.selectionSpecs" :key="spec.key" :class="{ done:(selected[spec.key]?.length??0)>=spec.min }">{{ specInstruction(spec) }} · 已选 {{ selected[spec.key]?.length ?? 0 }}</span><div v-for="spec in targetSpecs" :key="`target-${spec.key}`" class="choice-buttons"><strong>{{ spec.key }}</strong><button v-for="ref in spec.legalRefs" :key="String(ref)" type="button" class="mini-button" :class="{active:selected[spec.key]?.includes(ref)}" @click="choose(spec,ref)">{{ ref }}</button></div><div v-for="spec in choiceSpecs" :key="`choice-${spec.key}`" class="choice-buttons"><button v-for="value in valuesFor(spec)" :key="String(value)" type="button" class="mini-button" :class="{active:selected[spec.key]?.includes(value)}" @click="choose(spec,value)">{{ choiceLabel(value) }}</button></div><button type="button" class="button button--primary" :disabled="!selectionsValid" @click="submit()">确认提交</button></div><div v-if="snapshot.interaction.disabledHints.length" class="disabled-hints"><p v-for="hint in snapshot.interaction.disabledHints" :key="hint.subjectRef"><strong>{{ hint.subjectRef }}</strong>{{ hint.messageKey }}</p></div><p v-if="!snapshot.interaction.offers.length">等待服务器推进状态</p></aside>
    <CardDetailDrawer :card="detailCard" @close="detailCard=null" />
    <div class="game-activity"><GameEventFeed :events="events"/><GameChatPanel :messages="snapshot.chat" @send="forwardChat"/></div>
  </section>
</template>
