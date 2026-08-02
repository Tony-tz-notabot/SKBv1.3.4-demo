import { readonly, ref } from "vue";
import { defineStore } from "pinia";

export type CommandRejection = { commandId: string; reasonCode: string; messageKey: string; refreshRequired: boolean };
export const useCommandFeedbackStore = defineStore("commandFeedback", () => {
  const pendingIds = ref<readonly string[]>([]);
  const lastRejection = ref<CommandRejection | null>(null);
  const begin = (id: string) => { pendingIds.value = [...pendingIds.value, id]; lastRejection.value = null; };
  const accepted = (id: string) => { pendingIds.value = pendingIds.value.filter((item) => item !== id); };
  const rejected = (value: CommandRejection) => { accepted(value.commandId); lastRejection.value = value; };
  const clearRejection = () => { lastRejection.value = null; };
  return { pendingIds: readonly(pendingIds), lastRejection: readonly(lastRejection), begin, accepted, rejected, clearRejection };
});
