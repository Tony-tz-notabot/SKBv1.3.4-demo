<script setup lang="ts">
import type { CardView, PlayerView } from "@skb-protocol/client-protocol";
import { computed, type DeepReadonly } from "vue";
import GameCard from "./GameCard.vue";
import ResourceImage from "./ResourceImage.vue";
const props=defineProps<{ player: DeepReadonly<PlayerView>; active: boolean; local: boolean; legalTarget?: boolean; selectedTarget?: boolean; selectedOrder?: number; preselectedWeaponSlot?: string | null; preselectableWeaponSlots?: readonly string[]; legalCardRefs?:ReadonlySet<string>; selectedCardRefs?:ReadonlySet<string> }>();
const emit=defineEmits<{ select: [playerRef: string]; slotSelect:[slotId:string,card:DeepReadonly<CardView>|null]; cardSelect:[cardRef:string]; detail:[card:DeepReadonly<CardView>] }>();
function chooseSlot(slotId:string,card:DeepReadonly<CardView>|null){if(props.preselectableWeaponSlots?.includes(slotId)){emit("slotSelect",slotId,card);return;}if(card&&props.legalCardRefs?.has(card.ref))emit("cardSelect",card.ref);}
const slotEntries=computed(()=>{const seat=props.player.seat;return[
  [`weapon:1:${seat}`,"武1",props.player.equipmentSlots.weapon1],[`weapon:2:${seat}`,"武2",props.player.equipmentSlots.weapon2],[`thirdWeapon:${seat}`,"武3",props.player.equipmentSlots.thirdWeapon],
  ["armor","甲",props.player.equipmentSlots.armor],["mountOffense","攻骑",props.player.equipmentSlots.mountOffense],["mountDefense","防骑",props.player.equipmentSlots.mountDefense],["boss","BOSS",props.player.equipmentSlots.boss]
] as const;});
</script>
<template>
  <article class="game-player" :class="{ 'game-player--active': active, 'game-player--local': local, 'game-player--out': player.lifeState !== 'inPlay', 'game-player--legal': legalTarget, 'game-player--selected': selectedTarget }" :data-team="player.team" @click="legalTarget && $emit('select', `public:seat_${player.seat}`)">
    <span v-if="selectedOrder" class="selection-order">{{ selectedOrder }}</span>
    <ResourceImage v-if="player.characterId" class="game-player__portrait" :resource-key="`character.${player.characterId}`" :alt="player.nickname" />
    <div class="game-player__head"><span class="seat-token">{{ player.seat }}</span><strong>{{ player.nickname }}</strong><span>{{ player.connected ? '在线' : '离线' }}</span></div>
    <div class="game-player__vitals"><span class="hp">HP {{ player.hp ?? '—' }} / {{ player.maxHp ?? '—' }}</span><span class="shield">SH {{ player.shield ?? '—' }} / {{ player.maxShield ?? '—' }}</span><span v-if="player.ironShield">铁盾 {{ player.ironShield }}</span></div>
    <div class="game-player__meta"><span>手牌 {{ player.handCount }}</span><span>{{ player.lifeState }}</span><span v-for="status in player.statuses" :key="status">{{ status }}</span></div>
    <div class="equipment-slots"><button v-for="[slotId,label,card] in slotEntries" :key="slotId" type="button" class="equipment-slot" :class="{ 'equipment-slot--selected':slotId===preselectedWeaponSlot, 'equipment-slot--preselectable':preselectableWeaponSlots?.includes(slotId) }" :disabled="!card && !preselectableWeaponSlots?.includes(slotId)" @click.stop="chooseSlot(slotId,card)"><GameCard v-if="card" :card="card" compact :legal="legalCardRefs?.has(card.ref)" :selected="selectedCardRefs?.has(card.ref)" @select="chooseSlot(slotId,card)" @detail="$emit('detail',$event)"/><span v-else>{{ label }}</span></button><GameCard v-for="card in player.equipmentSlots.talents" :key="card.ref" :card="card" compact :legal="legalCardRefs?.has(card.ref)" :selected="selectedCardRefs?.has(card.ref)" @select="$emit('cardSelect',$event)" @detail="$emit('detail',$event)"/></div>
    <div v-if="player.judgmentZone.length" class="judgment-zone"><span>判定区</span><GameCard v-for="card in player.judgmentZone" :key="card.ref" :card="card" compact :legal="legalCardRefs?.has(card.ref)" :selected="selectedCardRefs?.has(card.ref)" @select="$emit('cardSelect',$event)" @detail="$emit('detail',$event)"/></div>
  </article>
</template>
