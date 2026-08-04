<script setup lang="ts">
import { onBeforeUnmount, onMounted, type DeepReadonly } from "vue";
import type { CharacterCandidateView } from "@skb-protocol/room-protocol";
import ResourceImage from "./ResourceImage.vue";
import { abilityDisplayName, describeAbility, describeCharacter } from "../localization/descriptions";

defineProps<{ candidate: DeepReadonly<CharacterCandidateView> | null }>();
const emit = defineEmits<{ close: [] }>();
function onKeydown(event: KeyboardEvent) { if (event.key === "Escape") emit("close"); }
onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="candidate" class="detail-backdrop" role="presentation" @click.self="emit('close')">
      <aside class="detail-drawer" role="dialog" aria-modal="true" :aria-label="`${candidate.displayName}详情`">
        <button class="detail-close" type="button" aria-label="关闭详情" @click="emit('close')">×</button>
        <ResourceImage class="detail-portrait" :resource-key="candidate.portraitResourceKey" :alt="candidate.displayName" />
        <p class="eyebrow">角色详情 · 难度 {{ candidate.difficulty }}</p>
        <h2>{{ candidate.displayName }}</h2>
        <p class="character-detail-summary">{{ describeCharacter(candidate.characterId) }}</p>
        <div class="detail-vitals"><span>生命上限 {{ candidate.initialHp }}</span><span>护盾上限 {{ candidate.initialShield }}</span></div>
        <section><h3>初始天赋</h3><p class="ability-name">{{ abilityDisplayName(candidate.initialTalentId) }}</p><p class="ability-desc">{{ describeAbility(candidate.initialTalentId) }}</p></section>
        <section><h3>角色技能</h3><ul><li v-for="abilityId in candidate.abilityIds" :key="abilityId"><p class="ability-name">{{ abilityDisplayName(abilityId) }}</p><p class="ability-desc">{{ describeAbility(abilityId) }}</p></li></ul></section>
        <p class="detail-note">规则说明以服务器下发的结构化详情为准；当前协议仅公开以上基础字段。</p>
      </aside>
    </div>
  </Teleport>
</template>
