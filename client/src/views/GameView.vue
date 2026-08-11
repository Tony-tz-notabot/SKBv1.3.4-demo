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
import CharacterDetailDrawer from "../components/CharacterDetailDrawer.vue";
import type { PresentationEvent } from "@skb-protocol/client-protocol";
import type { CharacterCandidateView } from "@skb-protocol/room-protocol";
import { selectionsComplete, toggleSelection } from "../interaction/selectionState";
import { abilityDisplayName } from "../localization/descriptions";
import { characterCandidate } from "../localization/characterCatalog";

const props = defineProps<{ snapshot: DeepReadonly<GameSnapshot>; events:readonly DeepReadonly<PresentationEvent>[]; canDisbandRoom?: boolean }>();
const emit = defineEmits<{ execute: [offerId: string, selections: Record<string, Array<string | number | boolean>>]; preselection: [weaponSlot: string | null, modeId: string | null]; chat:[channel:"all"|"team",text:string]; forfeit: []; disband: [] }>();
const positions = ["bottomLeft", "bottomRight", "topRight", "topLeft"] as const;
const viewerSeat = computed(() => props.snapshot.viewer.seat ?? 1);
// activeOfferId 表示“玩家当前选择的操作”；null = 空闲（此时点击武器槽才是预选）。
const activeOfferId = ref<string | null>(null);
const selected = reactive<Record<string, Array<string | number | boolean>>>({});
const detailCard=ref<DeepReadonly<CardView>|null>(null);
const detailCharacter=ref<DeepReadonly<CharacterCandidateView>|null>(null);
function openCharacterDetail(characterId:string|null|undefined){detailCharacter.value=characterCandidate(characterId);}
const characterNameOfSeat=(seat:number):string=>{const p=props.snapshot.publicView.players.find((item)=>item.seat===seat);const candidate=p?.characterId?characterCandidate(p.characterId):null;return candidate?.displayName??p?.nickname??`${seat}号玩家`;};
const activeOffer = computed(() => props.snapshot.interaction.offers.find((offer) => offer.offerId === activeOfferId.value) ?? null);
watch(() => props.snapshot.stateRevision, () => { activeOfferId.value=null; clearSelections(); });
watch(activeOfferId, clearSelections);
function clearSelections() { for(const key of Object.keys(selected)) delete selected[key]; }
// 4 角站位：己方在下、敌方在上。viewer 1/4：左下4 右下1 右上2 左上3；
// viewer 2/3：左下2 右下3 右上4 左上1。逆时针围绕牌桌。
const playerPosition = (seat: Seat): typeof positions[number] => {
  const layout = (viewerSeat.value === 1 || viewerSeat.value === 4)
    ? { 1: "bottomRight", 2: "topRight", 3: "topLeft", 4: "bottomLeft" } as const
    : { 1: "topLeft", 2: "bottomLeft", 3: "bottomRight", 4: "topRight" } as const;
  return layout[seat];
};
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
const chooseCard=(ref:string)=>{const spec=cardSpecFor(ref);if(spec){choose(spec,ref);return;}const offer=props.snapshot.interaction.offers.find((item)=>item.sourceRefs?.includes(ref)&&item.selectionSpecs.length===0);if(offer){activeOfferId.value=offer.offerId;submit(offer);}};
const chooseTarget=(ref:string)=>choose(targetSpecForClick(ref),ref);
const disabledByRef=computed(()=>new Map(props.snapshot.interaction.disabledHints.map((hint)=>[hint.subjectRef,hint.messageKey])));
const choiceSpecs=computed(()=>activeOffer.value?.selectionSpecs.filter((spec)=>spec.kind!=="cards"&&spec.kind!=="targets")??[]);
const selectionsValid = computed(() => !!activeOffer.value && selectionsComplete(activeOffer.value.selectionSpecs as SelectionSpec[],selected));
function offerLabel(offer: DeepReadonly<InteractionOffer>) {
  const generic={ declareAttack:"发动攻击",useCard:"使用卡牌",activateAbility:"发动技能",respond:"响应",equip:"装备",discardEquipment:"丢弃装备",dismantle:"拆除",synthesize:"合成",interveneJudgment:"干预判定",rescueDying:"救援",resolveChoice:"确认选择",pass:"放弃",endPhase:"结束阶段",chargeWeapon:"蓄力",activateWeapon:"使用武器能力" } as Record<string,string>;
  const skillAbilityId=/^offer:skill\.[^:]+(?=$|:)/.exec(offer.offerId)?.[0]?.slice(6);
  if(skillAbilityId)return abilityDisplayName(skillAbilityId);
  const cardName=offer.sourceRefs[0]?cardDisplayName(offer.sourceRefs[0]):undefined;
  if(cardName){if(offer.kind==="equip")return`装备${cardName}`;if(offer.kind==="discardEquipment")return`弃置${cardName}`;if(offer.kind==="dismantle")return`拆除${cardName}`;if(offer.kind==="synthesize")return`合成${cardName}`;if(offer.kind==="useCard")return`使用${cardName}`;if(offer.kind==="chargeWeapon")return`蓄力${cardName}`;if(offer.kind==="activateWeapon")return`使用${cardName}`;}
  return generic[offer.kind] ?? offer.kind;
}
function cardDisplayName(ref: string): string | undefined {
  const name=(card:DeepReadonly<CardView>|undefined)=>card?.displayName;
  const find=(refs:readonly DeepReadonly<CardView>[]|undefined)=>refs?.find((item)=>item.ref===ref);
  return name(find(props.snapshot.privateView.hand))??name(find(props.snapshot.publicView.players.flatMap((p)=>p.equipment)))??name(find(props.snapshot.publicView.discardTop))??undefined;
}
function slotLabel(slot:string|undefined){if(!slot)return null;const weapon=/^weapon:([1-3]):/.exec(slot),talent=/^talent:(\d):/.exec(slot);if(weapon)return`武${weapon[1]}`;if(/^thirdWeapon:/.test(slot))return"武3";if(/^armor(\:\d+)?$/.test(slot))return"甲";if(talent)return`赋${Number(talent[1])+1}`;return null;}
const equipSlotOf=(offer:DeepReadonly<InteractionOffer>)=>{const slot=(offer.preview as any)?.slot;if(typeof slot!=="string")return null;return /^armor(\:\d+)?$/.test(slot)?"armor":slot;};
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
function selectEquipmentSlot(slotId:string,card:DeepReadonly<CardView>|null){
  // 1) 当前已选择的操作需要选中该装备区牌 → 作为该操作的选择，不打断为预选
  if(card){const spec=cardSpecFor(card.ref);if(spec){choose(spec,card.ref);return;}}
  // 2) 已选择了其他操作时不再预选/装备，避免打断原操作
  if(activeOfferId.value!==null)return;
  const offers=props.snapshot.interaction.offers,equipFor=()=>offers.find((o)=>o.kind==="equip"&&equipSlotOf(o)===slotId);
  if((slotId==="armor"||/^talent:\d:/.test(slotId))&&equipFor()){chooseOffer(equipFor()!);return;}
  if(!props.snapshot.privateView.preselectableWeaponSlots.includes(slotId))return;
  emit("preselection",slotId,card?.state.modeId??null);
}
function valuesFor(spec:DeepReadonly<SelectionSpec>){if(spec.options?.length)return spec.options;if(spec.kind==="confirm")return [true,false];return [];}
function choiceLabel(value:string|number|boolean){if(value===true)return "确认";if(value===false)return "取消";const colors:Record<string,string>={white:"白",red:"红",orange:"橙",blue:"蓝",green:"绿",none:"无色"};return typeof value==="string"?(colors[value]??value):String(value);}
function selectWeaponMode(slotId:string,modeId:string){if(activeOfferId.value!==null)return;emit("preselection",slotId,modeId);}
function cancelOffer(){activeOfferId.value=null;clearSelections();}
function forwardChat(channel:"all"|"team",text:string){emit("chat",channel,text);}
const leaveDialog=ref<"forfeit"|"disband"|null>(null);
function confirmLeaveGame(){leaveDialog.value="forfeit";}
function confirmDisband(){leaveDialog.value="disband";}
function closeDialog(){leaveDialog.value=null;}
function proceedLeave(){if(leaveDialog.value==="forfeit")emit("forfeit");else emit("disband");leaveDialog.value=null;}
</script>
<template>
  <section class="game-layout">
    <PromptBanner :prompt="snapshot.interaction.prompt" :viewer-seat="snapshot.viewer.seat" :server-time="snapshot.serverTime" :active-window="(snapshot as any).activeWindow" :character-name-of="characterNameOfSeat" :ability-name-of="abilityDisplayName" />
    <header class="game-hud"><div><p class="eyebrow">ROUND {{ snapshot.publicView.round }}</p><h2>{{ snapshot.publicView.headline ?? `${snapshot.publicView.activeSeat}号玩家行动` }}</h2></div><div class="phase-track"><span v-for="phase in ['prepare','judgment','draw','play','discard','end']" :key="phase" :class="{ active: snapshot.publicView.phase === phase }">{{ phase }}</span></div><div class="game-hud__actions"><button v-if="canDisbandRoom" type="button" class="button button--danger" @click="confirmDisband">解散房间</button><button v-if="!snapshot.publicView.headline" type="button" class="forfeit-button" @click="confirmLeaveGame">退出本局</button></div></header>
    <div class="game-table">
      <div v-for="position in positions" :key="position" class="game-player-position" :data-position="position"><GamePlayerPanel v-if="playerAt(position)" :player="playerAt(position)!" :active="playerAt(position)!.seat === snapshot.publicView.activeSeat" :local="playerAt(position)!.seat === viewerSeat" :legal-target="legalTargetRefs.has(`public:seat_${playerAt(position)!.seat}`)" :selected-target="selectedRefs.has(`public:seat_${playerAt(position)!.seat}`)" :selected-order="selectionOrder(targetSpecFor(`public:seat_${playerAt(position)!.seat}`)?.key,`public:seat_${playerAt(position)!.seat}`)" :preselected-weapon-slot="playerAt(position)!.seat===viewerSeat?snapshot.privateView.preselectedWeaponSlot:null" :preselected-mode-id="playerAt(position)!.seat===viewerSeat?snapshot.privateView.preselectedModeId:null" :preselectable-weapon-slots="playerAt(position)!.seat===viewerSeat?snapshot.privateView.preselectableWeaponSlots:[]" :legal-card-refs="legalCardRefs" :selected-card-refs="selectedRefs" @select="chooseTarget" @card-select="chooseCard" @slot-select="selectEquipmentSlot" @mode-select="selectWeaponMode" @detail="detailCard=$event" @character-detail="openCharacterDetail" /></div>
      <div class="game-center"><div class="pile"><strong>{{ snapshot.publicView.drawPileCount }}</strong><span>牌库</span></div><div class="discard-stack"><GameCard v-for="card in snapshot.publicView.discardTop" :key="card.ref" :card="card" compact @detail="detailCard=$event" /><span v-if="!snapshot.publicView.discardTop.length">弃牌堆</span></div><div v-if="snapshot.publicView.centralCards.length" class="central-cards"><GameCard v-for="card in snapshot.publicView.centralCards" :key="card.ref" :card="card" compact @detail="detailCard=$event" /></div></div>
    </div>
    <section class="hand-zone"><header><div><p class="eyebrow">YOUR HAND</p><strong>{{ snapshot.privateView.hand.length }} 张</strong></div><span>右键查看详情</span></header><div class="hand-cards"><GameCard v-for="card in snapshot.privateView.hand" :key="card.ref" :card="card" :legal="legalCardRefs.has(card.ref)" :selected="selectedRefs.has(card.ref)" :selected-order="cardSelectionOrder(card.ref)" :disabled-reason="disabledByRef.get(card.ref)" @select="chooseCard" @detail="detailCard=$event" /></div><div v-if="snapshot.privateView.concealedChoices.length" class="concealed-choices"><button v-for="ref in snapshot.privateView.concealedChoices" :key="ref" type="button" class="concealed-choice" :class="{ 'concealed-choice--legal': legalCardRefs.has(ref), 'concealed-choice--selected': selectedRefs.has(ref) }" @click="chooseCard(ref)">隐藏牌{{ cardSelectionOrder(ref) ? ` · ${cardSelectionOrder(ref)}` : '' }}</button></div></section>
    <aside class="interaction-panel"><header><p class="eyebrow">SERVER OFFERS</p><strong>{{ snapshot.interaction.prompt?.mandatory ? '必须操作' : snapshot.interaction.prompt ? '可选操作窗口' : '等待推进' }}</strong></header><p class="prompt-hint">{{ promptHint }}</p><p v-if="snapshot.interaction.prompt" class="prompt-kind">{{ snapshot.interaction.prompt.kind }}</p><div class="offer-list"><button v-for="offer in snapshot.interaction.offers" :key="offer.offerId" type="button" class="button" :class="{ 'button--primary': offer.offerId === activeOfferId }" @click="chooseOffer(offer)">{{ offerLabel(offer) }}<small v-if="slotLabel((offer.preview as any)?.slot)">{{ slotLabel((offer.preview as any)?.slot) }}</small><small v-if="offer.preview.costSummary">{{ offer.preview.costSummary }}</small></button></div><div v-if="activeOffer?.selectionSpecs.length" class="selection-checklist"><span v-for="spec in activeOffer.selectionSpecs" :key="spec.key" :class="{ done:(selected[spec.key]?.length??0)>=spec.min }">{{ specInstruction(spec) }} · 已选 {{ selected[spec.key]?.length ?? 0 }}</span><div v-for="spec in targetSpecs" :key="`target-${spec.key}`" class="choice-buttons"><strong>{{ spec.key }}</strong><button v-for="ref in spec.legalRefs" :key="String(ref)" type="button" class="mini-button" :class="{active:selected[spec.key]?.includes(ref)}" @click="choose(spec,ref)">{{ ref }}</button></div><div v-for="spec in choiceSpecs" :key="`choice-${spec.key}`" class="choice-buttons"><button v-for="value in valuesFor(spec)" :key="String(value)" type="button" class="mini-button" :class="{active:selected[spec.key]?.includes(value)}" @click="choose(spec,value)">{{ choiceLabel(value) }}</button></div><button type="button" class="button button--primary" :disabled="!selectionsValid" @click="submit()">确认提交</button></div><div v-if="activeOffer" class="offer-cancel"><button type="button" class="button" @click="cancelOffer">取消选择</button></div><div v-if="snapshot.interaction.disabledHints.length" class="disabled-hints"><p v-for="hint in snapshot.interaction.disabledHints" :key="hint.subjectRef"><strong>{{ hint.subjectRef }}</strong>{{ hint.messageKey }}</p></div><p v-if="!snapshot.interaction.offers.length">等待服务器推进状态</p></aside>
    <CardDetailDrawer :card="detailCard" @close="detailCard=null" />
    <CharacterDetailDrawer :candidate="detailCharacter" @close="detailCharacter=null" />
    <div class="game-activity"><GameEventFeed :events="events"/><GameChatPanel :messages="snapshot.chat" @send="forwardChat"/></div>
    <div v-if="leaveDialog" class="confirm-dialog" role="dialog" aria-modal="true">
      <div class="confirm-dialog__card">
        <h3>{{ leaveDialog === "disband" ? "解散房间" : "退出本局" }}</h3>
        <p v-if="leaveDialog === 'forfeit'">退出本局将立即淘汰你的角色，本队仍由队友继续作战（若本队全灭则对方获胜）。确定退出？</p>
        <p v-else>解散房间会立即结束本局并将所有人移出房间，本局按未完成处理。确定解散？</p>
        <div class="confirm-dialog__actions"><button type="button" class="button" @click="closeDialog">取消</button><button type="button" class="button button--danger" @click="proceedLeave">确定</button></div>
      </div>
    </div>
  </section>
</template>
