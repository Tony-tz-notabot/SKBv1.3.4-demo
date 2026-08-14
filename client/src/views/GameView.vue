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
import { renderPromptSegments, offerPreviewSegments, cardNameById, type PromptSegment } from "../localization/promptRenderers";

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
// 4 角站位：本地玩家始终在右下角，其余按逆时针（座位递增）从右下→右上→左上→左下排布。
// 逆时针 = 座位+1：viewer 的逆时针下家在他右上，再下一家在左上，再下一家在左下。
const playerPosition = (seat: Seat): typeof positions[number] => {
  const offset = (seat - viewerSeat.value + 4) % 4;
  return ["bottomRight", "topRight", "topLeft", "bottomLeft"][offset] as typeof positions[number];
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
const windowActionLabels:Record<string,string>={optionalTrigger:"发动效果",triggerOrdering:"确认排序",elementSatchelFlameDismantle:"拆除烈焰锦囊",berserkerRage:"少摸牌",c6LaserSweepRequest:"打出牌",c6FocusedBombardmentRequest:"打出牌",criticalPenetration:"暴击追击",crystalCrabActivePincer:"钳击",darkKnightFinalStrike:"最后一击",divineBarrierDamage:"神圣屏障",engineerMechChoice:"进入机甲",extraGemDeathTransfer:"交付手牌",foresightDrawChoice:"选择摸牌",goldenMaskTarget:"混乱打击",minerDigAtPlayEnd:"遁地",minerNaturalExitTarget:"自然退出攻击",minerSourceDismantle:"拆除来源",owlCounterattack:"吹箭反击",purpleLordHeroBlade:"魂刀攻击",qiBallDismantle:"拆除",reforgeFurnaceSelection:"选择武器",redLordSealingHammer:"封灵战锤",temporaryCoinImmediateUse:"使用金币",trapBombDetonation:"引爆",triggerCardSelection:"选择",valkyrieBossResponse:"复制BOSS",weaponParticleEagleFollowUp:"追击",weaponW61Choice:"扳手",wizardSpellStrike:"法术打击",demolitionOptionalDiscard:"弃置武器",demolitionWeaponOverflow:"确认弃置"};
function windowOfferAction(offer:DeepReadonly<InteractionOffer>):string|undefined{
  const windowKind=props.snapshot.interaction.prompt?.kind??"";
  if(windowKind==="statueResolutionChoice"){const fam=(props.snapshot.interaction.prompt?.promptData as any)?.statueFamily;return fam?`雕像·${cardNameById(fam)}`:"执行雕像效果";}
  const id=offer.offerId;
  if(/^offer:w61:damage$/.test(id))return"扳手·造成伤害";
  if(/^offer:w61:dismantle$/.test(id))return"扳手·拆除";
  const rage=/^offer:berserker-rage:(\d+)$/.exec(id);if(rage)return`少摸${rage[1]}`;
  const mech=/^offer:engineer-mech:(.+)$/.exec(id);if(mech)return`进入机甲·${mech[1]}`;
  const gem=/^offer:extra-gem-death:character:([1-4])$/.exec(id);if(gem)return`交付给${gem[1]}号`;
  const bomb=/^offer:trap-detonation:character:([1-4])$/.exec(id);if(bomb)return`引爆${bomb[1]}号`;
  const miner=/^offer:miner-natural-exit:character:([1-4])$/.exec(id);if(miner)return`攻击${miner[1]}号`;
  return windowActionLabels[windowKind];
}
function offerLabel(offer: DeepReadonly<InteractionOffer>) {
  const generic={ declareAttack:"发动攻击",useCard:"使用卡牌",activateAbility:"发动技能",respond:"响应",equip:"装备",discardEquipment:"丢弃装备",dismantle:"拆除",synthesize:"合成",interveneJudgment:"干预判定",rescueDying:"救援",resolveChoice:"确认选择",pass:"放弃",endPhase:"结束阶段",chargeWeapon:"蓄力",activateWeapon:"使用武器能力",createBlackSword:"制造黑剑",blackSwordAttack:"黑剑攻击" } as Record<string,string>;
  const satchelMode=/(^|:)skill\.ancient_elementalist\.element_satchel:(frozen|electrified|flame)($|:)/.exec(offer.offerId)?.[2];
  if(satchelMode)return{frozen:"冰冻锦囊",electrified:"雷电锦囊",flame:"烈焰锦囊"}[satchelMode];
  const c6Mode=/^offer:boss-use:c6-(sweep|bomb):/.exec(offer.offerId)?.[1];
  if(c6Mode)return c6Mode==="sweep"?"使用C6·激光扫射":"使用C6·定点轰击";
  const skillAbilityId=/^offer:skill\.[^:]+(?=$|:)/.exec(offer.offerId)?.[0]?.slice(6);
  if(skillAbilityId)return abilityDisplayName(skillAbilityId);
  const perCard=/^offer:(statue-card|trigger-card|statue-priest|statue-paladin|statue-knight)(?::[^:]*)?:\d+$/.test(offer.offerId);
  const concealedMatch=perCard?/^concealed:[^:]+:(\d+)$/.exec(offer.sourceRefs[0]??""):null;
  if(concealedMatch)return`手牌${Number(concealedMatch[1])+1}`;
  const cardName=offer.sourceRefs[0]?cardDisplayName(offer.sourceRefs[0]):undefined;
  if(cardName){if(offer.kind==="equip")return`装备${cardName}`;if(offer.kind==="discardEquipment")return`弃置${cardName}`;if(offer.kind==="dismantle")return`拆除${cardName}`;if(offer.kind==="synthesize")return`合成${cardName}`;if(offer.kind==="useCard")return`使用${cardName}`;if(offer.kind==="chargeWeapon")return`蓄力${cardName}`;if(offer.kind==="activateWeapon")return`使用${cardName}`;if(perCard)return cardName;}
  if(offer.kind==="respond"){
    const dodgeWindow=props.snapshot.interaction.prompt?.kind;
    if(dodgeWindow==="internetAddictionDodgeRequest"||dodgeWindow==="sheepPhaseOneDodgeRequest"||dodgeWindow==="superBabyDodgeRequest")return"出【闪】";
    if(offer.offerId.includes(":meleeBlock:"))return cardName?`近战格挡·${cardName}`:"近战格挡";
    if(offer.offerId.includes(":dodge:"))return"出【闪】";
    if(offer.offerId.includes(":armorKillBlock:"))return cardName?`防具无效杀·${cardName}`:"防具无效杀";
    if(offer.offerId.includes(":armorJudgment:"))return cardName?`判定防具·${cardName}`:"判定防具";
    if(offer.offerId.includes(":prayer:"))return"祈祷救援";
    if(offer.offerId.includes(":resurrectionCross:"))return"重生十字章";
    if(offer.offerId.includes(":rescue:"))return"救援";
    return"响应";
  }
  if(offer.kind==="resolveChoice"){const action=windowOfferAction(offer);if(action)return action;}
  return generic[offer.kind] ?? offer.kind;
}
function cardDisplayName(ref: string): string | undefined {
  const name=(card:DeepReadonly<CardView>|undefined)=>card?.displayName;
  const find=(refs:readonly DeepReadonly<CardView>[]|undefined)=>refs?.find((item)=>item.ref===ref);
  return name(find(props.snapshot.privateView.hand))??name(find(props.snapshot.publicView.players.flatMap((p)=>p.equipment)))??name(find(props.snapshot.publicView.discardTop))??name(find(props.snapshot.publicView.centralCards))??undefined;
}
function cardSummaryOf(ref: string): string | undefined {
  const find=(refs:readonly DeepReadonly<CardView>[]|undefined)=>refs?.find((item)=>item.ref===ref);
  return find(props.snapshot.privateView.hand)?.summary??find(props.snapshot.publicView.players.flatMap((p)=>p.equipment))?.summary??find(props.snapshot.publicView.discardTop)?.summary??find(props.snapshot.publicView.centralCards)?.summary??undefined;
}
function slotLabel(slot:string|undefined){if(!slot)return null;const weapon=/^weapon:([1-3]):/.exec(slot),talent=/^talent:(\d):/.exec(slot);if(weapon)return`武${weapon[1]}`;if(/^thirdWeapon:/.test(slot))return"武3";if(/^armor(\:\d+)?$/.test(slot))return"甲";if(talent)return`赋${Number(talent[1])+1}`;return null;}
const equipSlotOf=(offer:DeepReadonly<InteractionOffer>)=>{const slot=(offer.preview as any)?.slot;if(typeof slot!=="string")return null;return /^armor(\:\d+)?$/.test(slot)?"armor":slot;};
const promptSegments=computed<readonly PromptSegment[]>(()=>renderPromptSegments(props.snapshot.interaction.prompt??null,{viewerSeat:props.snapshot.viewer.seat??null,viewerTeam:props.snapshot.viewer.team??null,players:props.snapshot.publicView.players.map((p)=>({seat:p.seat,team:p.team,characterId:p.characterId}))}));
const shouldShowCardSummary=(offer:DeepReadonly<InteractionOffer>):boolean=>{const k=offer.kind;if(k==="useCard"||k==="equip"||k==="chargeWeapon"||k==="activateWeapon")return true;if(k==="respond"){const id=offer.offerId;return id.includes(":dodge:")||id.includes(":meleeBlock:")||id.includes(":armorKillBlock:")||id.includes(":armorJudgment:")||id.includes(":prayer:")||id.includes(":resurrectionCross:")||id.includes(":rescue:");}return false;};
const offerPreviewSegs=(offer:DeepReadonly<InteractionOffer>)=>offerPreviewSegments(offer.preview as any,shouldShowCardSummary(offer)&&offer.sourceRefs?.[0]?cardSummaryOf(offer.sourceRefs[0]):undefined);
function choose(spec: DeepReadonly<SelectionSpec> | undefined,value:string|number|boolean) { if(!spec) return;const next=toggleSelection(selected,spec as SelectionSpec,value);selected[spec.key]=next[spec.key]??[]; }
function chooseOffer(offer: DeepReadonly<InteractionOffer>) { activeOfferId.value=offer.offerId; if(!offer.selectionSpecs.length) submit(offer); }
function validFor(offer: DeepReadonly<InteractionOffer>) { return selectionsComplete(offer.selectionSpecs as SelectionSpec[],selected); }
function submit(offer=activeOffer.value) {
  if(!offer||!validFor(offer)) return;
  const selection = Object.fromEntries(Object.entries(selected).map(([key, values]) => [key, [...values]]));
  emit("execute",offer.offerId,selection);
}
const promptPurpose=computed(()=>{const d=(props.snapshot.interaction.prompt?.promptData as any)??null;return typeof d?.purpose==="string"?d.purpose:null;});
function specInstruction(spec: DeepReadonly<SelectionSpec>) { const names={cards:"卡牌",targets:"目标",option:"选项",number:"数字",color:"颜色",mode:"模式",confirm:"确认"}; const base=`选择${names[spec.kind]} ${spec.min}${spec.max!==spec.min?`–${spec.max}`:""}项`; return promptPurpose.value?`为${promptPurpose.value}${base}`:base; }
const targetLabel=(ref:string)=>{const m=/^public:seat_(\d)$/.exec(ref);if(!m)return ref;const seat=Number(m[1]);const dist=(activeOffer.value?.preview as any)?.distanceByTarget?.[ref];const name=characterNameOfSeat(seat);return dist!==undefined?`${name}·距离${dist}`:name;};
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
function choiceLabel(value:string|number|boolean){if(value===true)return "确认";if(value===false)return "取消";const colors:Record<string,string>={white:"白",red:"红",orange:"橙",blue:"蓝",green:"绿",none:"无色"};const options:Record<string,string>={drain_shield:"护盾伤害2",drain_hp:"血量伤害1",prototype:"原型机甲",vitaminC:"维C机甲",wifi:"无线机甲",kill:"杀",dodge:"闪",shieldDamage:"护盾伤害",hpDamage:"血量伤害",standard:"标准",no_kill:"不耗杀",mode_1:"方式一",mode_2:"方式二",field_fire:"场地火",laser:"激光",coin:"金币"};return typeof value==="string"?(colors[value]??options[value]??value):String(value);}
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
    <aside class="interaction-panel"><header><p class="eyebrow">SERVER OFFERS</p><strong>{{ snapshot.interaction.prompt?.mandatory ? '必须操作' : snapshot.interaction.prompt ? '可选操作窗口' : '等待推进' }}</strong></header><p class="prompt-hint"><span v-for="(s,i) in promptSegments" :key="i" :class="s.cls">{{ s.text }}</span></p><p v-if="snapshot.interaction.prompt" class="prompt-kind">{{ snapshot.interaction.prompt.kind }}</p><div class="offer-list"><button v-for="offer in snapshot.interaction.offers" :key="offer.offerId" type="button" class="button" :class="{ 'button--primary': offer.offerId === activeOfferId }" @click="chooseOffer(offer)">{{ offerLabel(offer) }}<small v-if="slotLabel((offer.preview as any)?.slot)">{{ slotLabel((offer.preview as any)?.slot) }}</small><small class="offer-preview"><span v-for="(s,i) in offerPreviewSegs(offer)" :key="i" :class="s.cls">{{ s.text }}</span></small></button></div><div v-if="activeOffer?.selectionSpecs.length" class="selection-checklist"><span v-for="spec in activeOffer.selectionSpecs" :key="spec.key" :class="{ done:(selected[spec.key]?.length??0)>=spec.min }">{{ specInstruction(spec) }} · 已选 {{ selected[spec.key]?.length ?? 0 }}</span><div v-for="spec in targetSpecs" :key="`target-${spec.key}`" class="choice-buttons"><strong>{{ spec.key }}</strong><button v-for="ref in spec.legalRefs" :key="String(ref)" type="button" class="mini-button" :class="{active:selected[spec.key]?.includes(ref)}" @click="choose(spec,ref)">{{ targetLabel(ref) }}</button></div><div v-for="spec in choiceSpecs" :key="`choice-${spec.key}`" class="choice-buttons"><button v-for="value in valuesFor(spec)" :key="String(value)" type="button" class="mini-button" :class="{active:selected[spec.key]?.includes(value)}" @click="choose(spec,value)">{{ choiceLabel(value) }}</button></div><button type="button" class="button button--primary" :disabled="!selectionsValid" @click="submit()">确认提交</button></div><div v-if="activeOffer" class="offer-cancel"><button type="button" class="button" @click="cancelOffer">取消选择</button></div><div v-if="snapshot.interaction.disabledHints.length" class="disabled-hints"><p v-for="hint in snapshot.interaction.disabledHints" :key="hint.subjectRef"><strong>{{ hint.subjectRef }}</strong>{{ hint.messageKey }}</p></div><p v-if="!snapshot.interaction.offers.length">等待服务器推进状态</p></aside>
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
