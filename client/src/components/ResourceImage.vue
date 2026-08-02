<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { resolveResourceCandidates } from "../resources/resourceResolver";

const props = defineProps<{ resourceKey: string; alt: string }>();
const failedIndex = ref(0);
const candidates = computed(() => resolveResourceCandidates(props.resourceKey));
const src = computed(() => candidates.value[Math.min(failedIndex.value, candidates.value.length - 1)]);

watch(() => props.resourceKey, () => { failedIndex.value = 0; });
function useFallback() {
  if (failedIndex.value < candidates.value.length - 1) failedIndex.value += 1;
}
</script>

<template><img :src="src" :alt="alt" draggable="false" @error="useFallback" /></template>
