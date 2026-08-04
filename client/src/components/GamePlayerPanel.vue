<script setup lang="ts">
import type { CardView, PlayerView } from "@skb-protocol/client-protocol";
import { computed, type DeepReadonly } from "vue";
import GameCard from "./GameCard.vue";
import ResourceImage from "./ResourceImage.vue";
const props=defineProps<{ player: DeepReadonly<PlayerView>; active: boolean; local: boolean; legalTarget?: boolean; selectedTarget?: boolean; selectedOrder?: number; preselectedWeaponSlot?: string | null; preselectableWeaponSlots?: readonly string[]; legalCardRefs?:ReadonlySet<string>; selectedCardRefs?:ReadonlySet<string> }>();
const emit=defineEmits<{ select: [playerRef: string]; slotSelect:[slotId:string,card:DeepReadonly<CardView>|null]; cardSelect:[cardRef:string]; detail:[card:DeepReadonly<CardView>]; characterDetail:[characterId:string|null] }>();
function chooseSlot(slotId:string,card:DeepReadonly<CardView>|null){if(props.preselectableWeaponSlots?.includes(slotId)){emit("slotSelect",slotId,card);return;}if(card&&props.legalCardRefs?.has(card.ref))emit("cardSelect",card.ref);}
const eq=computed(()=>props.player.equipmentSlots);
// 占双槽坐骑（mountDual 或 攻/防指向同一张）合并为单个"坐骑"槽；否则攻骑/防骑分开显示（仅显示已装备的）。
const mountSlots=computed(()=>{const s=eq.value,off=s.mountOffense,def=s.mountDefense,merged=s.mountDual===true||(off&&def&&off.ref===def.ref);if(merged&&(off||def))return[{slotId:"mountDual",label:"坐骑",card:off??def}];return[{slotId:"mountOffense",label:"攻骑",card:off},{slotId:"mountDefense",label:"防骑",card:def}].filter((item)=>item.card!==null);});
// 第一行：武1 武2 [武3常规槽（仅三持）] [三武（仅装备了第三武器）] 坐骑（攻骑/防骑）。
const row1=computed(()=>{const s=eq.value,items=[
  {slotId:`weapon:1:${props.player.seat}`,label:"武1",card:s.weapon1},
  {slotId:`weapon:2:${props.player.seat}`,label:"武2",card:s.weapon2},
];if(s.tripleWield)items.push({slotId:`weapon:3:${props.player.seat}`,label:"武3",card:s.weapon3});if(s.thirdWeapon)items.push({slotId:`thirdWeapon:${props.player.seat}`,label:"三武",card:s.thirdWeapon});return items.concat(mountSlots.value);});
// 第二行：防具 赋1 赋2 赋3（天赋槽 3 个）boss。
const row2=computed(()=>{const s=eq.value,items=[{slotId:"armor",label:"甲",card:s.armor}];(s.talents??[]).forEach((card,index)=>items.push({slotId:`talent:${index}:${props.player.seat}`,label:`赋${index+1}`,card}));items.push({slotId:"boss",label:"BOSS",card:s.boss});return items;});

</script>
<template>
  <article class="game-player" :class="{ 'game-player--active': active, 'game-player--local': local, 'game-player--out': player.lifeState !== 'inPlay', 'game-player--legal': legalTarget, 'game-player--selected': selectedTarget }" :data-team="player.team" @click="legalTarget && $emit('select', `public:seat_${player.seat}`)" @contextmenu.prevent="$emit('characterDetail',player.characterId??null)">
    <span v-if="selectedOrder" class="selection-order">{{ selectedOrder }}</span>
    <ResourceImage v-if="player.characterId" class="game-player__portrait" :resource-key="`character.${player.characterId}`" :alt="player.nickname" />
    <div class="game-player__head"><span class="seat-token">{{ player.seat }}</span><strong>{{ player.nickname }}</strong></div>
    <div class="game-player__vitals"><span class="hp">HP {{ player.hp ?? '—' }} / {{ player.maxHp ?? '—' }}</span><span class="shield">SH {{ player.shield ?? '—' }} / {{ player.maxShield ?? '—' }}</span><span v-if="player.ironShield">铁盾 {{ player.ironShield }}</span><span class="cards">cards {{ player.handCount }}/{{ player.handLimit ?? player.handCount }}</span><span class="conn" :class="player.connected ? 'conn--online' : 'conn--offline'">{{ player.connected ? 'online' : 'offline' }}</span></div>
    <div v-if="player.statuses.length" class="game-player__meta"><span v-for="status in player.statuses" :key="status">{{ status }}</span></div>
    <div class="equipment-slots"><div v-for="(items,rowIndex) in [row1,row2]" :key="rowIndex" class="equipment-row"><button v-for="slot in items" :key="slot.slotId" type="button" class="equipment-slot" :data-slot="slot.slotId" :class="{ 'equipment-slot--selected':slot.slotId===preselectedWeaponSlot, 'equipment-slot--preselectable':preselectableWeaponSlots?.includes(slot.slotId) }" :disabled="!slot.card && !preselectableWeaponSlots?.includes(slot.slotId)" @click.stop="chooseSlot(slot.slotId,slot.card)" @contextmenu.prevent.stop="slot.card && $emit('detail',slot.card)"><GameCard v-if="slot.card" :card="slot.card" compact :legal="legalCardRefs?.has(slot.card.ref)" :selected="selectedCardRefs?.has(slot.card.ref)" @select="chooseSlot(slot.slotId,slot.card)" @detail="$emit('detail',$event)"/><span v-else>{{ slot.label }}</span></button></div></div>
    <div v-if="player.judgmentZone.length" class="judgment-zone"><span>判定区</span><GameCard v-for="card in player.judgmentZone" :key="card.ref" :card="card" compact :legal="legalCardRefs?.has(card.ref)" :selected="selectedCardRefs?.has(card.ref)" @select="$emit('cardSelect',$event)" @detail="$emit('detail',$event)"/></div>
  </article>
</template>
