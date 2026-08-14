<script setup lang="ts">
import type { NarrationLine } from "../stage/narration";

defineProps<{ lines: readonly NarrationLine[] }>();
</script>

<template>
  <div class="stage-narration">
    <span v-for="line in lines" :key="line.id" class="stage-narration__line">
      <span v-for="(s, i) in line.segments" :key="i" :class="s.cls">{{ s.text }}</span>
    </span>
  </div>
</template>
