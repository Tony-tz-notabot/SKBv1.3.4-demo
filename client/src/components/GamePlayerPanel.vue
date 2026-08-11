<script setup lang="ts">
import type { CardView, PlayerView } from "@skb-protocol/client-protocol";
import { computed, type DeepReadonly } from "vue";
import GameCard from "./GameCard.vue";
import ResourceImage from "./ResourceImage.vue";
const props=defineProps<{ player: DeepReadonly<PlayerView>; active: boolean; local: boolean; legalTarget?: boolean; selectedTarget?: boolean; selectedOrder?: number; preselectedWeaponSlot?: string | null; preselectedModeId?: string | null; preselectableWeaponSlots?: readonly string[]; legalCardRefs?:ReadonlySet<string>; selectedCardRefs?:ReadonlySet<string> }>();
const emit=defineEmits<{ select: [playerRef: string]; slotSelect:[slotId:string,card:DeepReadonly<CardView>|null]; cardSelect:[cardRef:string]; modeSelect:[slotId:string,modeId:string]; detail:[card:DeepReadonly<CardView>]; characterDetail:[characterId:string|null] }>();
// 多主动方式武器的模式中文名（modeId 来自冻结武器配置，非规则引擎硬编码）。
const MODE_LABELS:Record<string,string>={standard:"标准",no_kill:"不耗杀",mode_1:"方式一",mode_2:"方式二",field_fire:"场地火",laser:"激光",coin:"金币"};
// 点击装备槽：若当前操作（activeOffer）需要选中该装备区牌，则作为选择处理，绝不打断为预选；
// 仅当该牌不属于当前操作的选择范围时，才在空闲状态下执行预选/装备路由。
function chooseSlot(slotId:string,card:DeepReadonly<CardView>|null){if(card&&props.legalCardRefs?.has(card.ref)){emit("cardSelect",card.ref);return;}if(props.preselectableWeaponSlots?.includes(slotId)){emit("slotSelect",slotId,card);return;}}const eq=computed(()=>props.player.equipmentSlots);
// 占双槽坐骑（mountDual 或 攻/防指向同一张）合并为单个"坐骑"槽；否则攻骑/防骑分开显示（仅显示已装备的）。
const mountSlots=computed(()=>{const s=eq.value,off=s.mountOffense,def=s.mountDefense,merged=s.mountDual===true||(off&&def&&off.ref===def.ref);if(merged&&(off||def))return[{slotId:"mountDual",label:"坐骑",card:off??def}];return[{slotId:"mountOffense",label:"攻骑",card:off},{slotId:"mountDefense",label:"防骑",card:def}].filter((item)=>item.card!==null);});
// 第一行：武1 武2 [武3常规槽（仅三持）] [三武（仅装备了第三武器）] 坐骑（攻骑/防骑）。
const row1=computed(()=>{const s=eq.value,items=[
  {slotId:`weapon:1:${props.player.seat}`,label:"武1",card:s.weapon1},
  {slotId:`weapon:2:${props.player.seat}`,label:"武2",card:s.weapon2},
];if(s.tripleWield)items.push({slotId:`weapon:3:${props.player.seat}`,label:"武3",card:s.weapon3});if(s.thirdWeapon)items.push({slotId:`thirdWeapon:${props.player.seat}`,label:"三武",card:s.thirdWeapon});return items.concat(mountSlots.value);});
// 第二行：防具 赋1 赋2 赋3（天赋槽固定 3 个，未装也占位可选）boss。
const row2=computed(()=>{const s=eq.value,items=[{slotId:"armor",label:"甲",card:s.armor}];for(let index=0;index<3;index++)items.push({slotId:`talent:${index}:${props.player.seat}`,label:`赋${index+1}`,card:s.talents?.[index]??null});items.push({slotId:"boss",label:"BOSS",card:s.boss});return items;});

</script>
<template>
  <article class="game-player" :class="{ 'game-player--active': active, 'game-player--local': local, 'game-player--out': player.lifeState !== 'inPlay', 'game-player--legal': legalTarget, 'game-player--selected': selectedTarget }" :data-team="player.team" @click="legalTarget && $emit('select', `public:seat_${player.seat}`)" @contextmenu.prevent="$emit('characterDetail',player.characterId??null)">
    <span v-if="selectedOrder" class="selection-order">{{ selectedOrder }}</span>
    <ResourceImage v-if="player.characterId" class="game-player__portrait" :resource-key="`character.${player.characterId}`" :alt="player.nickname" />
    <div class="game-player__head"><span class="seat-token">{{ player.seat }}</span><strong>{{ player.nickname }}</strong></div>
    <div class="game-player__vitals"><span class="hp">HP {{ player.hp ?? '—' }} / {{ player.maxHp ?? '—' }}</span><span class="shield">SH {{ player.shield ?? '—' }} / {{ player.maxShield ?? '—' }}</span><span v-if="player.ironShield">铁盾 {{ player.ironShield }}</span><span class="cards">cards {{ player.handCount }}/{{ player.handLimit ?? player.handCount }}</span><span class="conn" :class="player.connected ? 'conn--online' : 'conn--offline'">{{ player.connected ? 'online' : 'offline' }}</span></div>
    <div v-if="player.statuses.length" class="game-player__meta"><span v-for="status in player.statuses" :key="status">{{ status }}</span></div>
    <div class="equipment-slots"><div v-for="(items,rowIndex) in [row1,row2]" :key="rowIndex" class="equipment-row"><div v-for="slot in items" :key="slot.slotId" class="equipment-cell"><button type="button" class="equipment-slot" :data-slot="slot.slotId" :class="{ 'equipment-slot--selected':slot.slotId===preselectedWeaponSlot, 'equipment-slot--preselectable':preselectableWeaponSlots?.includes(slot.slotId) }" :disabled="!slot.card && !preselectableWeaponSlots?.includes(slot.slotId)" @click.stop="chooseSlot(slot.slotId,slot.card)" @contextmenu.prevent.stop="slot.card && $emit('detail',slot.card)"><GameCard v-if="slot.card" :card="slot.card" compact :legal="legalCardRefs?.has(slot.card.ref)" :selected="selectedCardRefs?.has(slot.card.ref)" @select="chooseSlot(slot.slotId,slot.card)" @detail="$emit('detail',$event)"/><span v-else>{{ slot.label }}</span></button><div v-if="slot.card?.state.modeIds?.length && slot.slotId===preselectedWeaponSlot" class="weapon-modes"><button v-for="mode in slot.card.state.modeIds" :key="mode" type="button" class="weapon-mode" :class="{active:mode===(preselectedModeId??'')}" @click.stop="$emit('modeSelect',slot.slotId,mode)">{{ MODE_LABELS[mode] ?? mode }}</button></div></div></div></div>
    <div v-if="player.judgmentZone.length" class="judgment-zone"><span>判定区</span><GameCard v-for="card in player.judgmentZone" :key="card.ref" :card="card" compact :legal="legalCardRefs?.has(card.ref)" :selected="selectedCardRefs?.has(card.ref)" @select="$emit('cardSelect',$event)" @detail="$emit('detail',$event)"/></div>
  </article>
</template>
