import { readonly, ref } from "vue";
import { defineStore } from "pinia";
import type { ConnectionState } from "../network/WebSocketClient";

export const useConnectionStore = defineStore("connection", () => {
  const state = ref<ConnectionState>("offline");
  const latencyMs = ref<number | null>(null);
  const pendingCommands = ref(0);
  function setState(value: ConnectionState) { state.value = value; if (value === "offline") latencyMs.value = null; }
  function setLatency(value: number) { latencyMs.value = value; }
  function setPendingCommands(value: number) { pendingCommands.value = value; }
  return { state: readonly(state), latencyMs: readonly(latencyMs), pendingCommands: readonly(pendingCommands), setState, setLatency, setPendingCommands };
});
