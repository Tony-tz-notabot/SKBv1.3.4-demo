import { computed, readonly, shallowRef } from "vue";
import { defineStore } from "pinia";
import type { ClientProtocolMessage, GameSnapshot, PresentationEvent, SetupSnapshot } from "@skb-protocol/client-protocol";
import type { LobbySnapshot, RoomProtocolMessage, RoomSnapshot } from "@skb-protocol/room-protocol";

export const useServerProjectionStore = defineStore("serverProjection", () => {
  const lobbySnapshot = shallowRef<LobbySnapshot | null>(null);
  const roomSnapshot = shallowRef<RoomSnapshot | null>(null);
  const gameSnapshot = shallowRef<GameSnapshot | null>(null);
  const setupSnapshot = shallowRef<SetupSnapshot | null>(null);
  const eventQueue = shallowRef<readonly PresentationEvent[]>([]);
  const protocolErrors = shallowRef<readonly string[]>([]);

  const screen = computed(() => gameSnapshot.value ? "game" : setupSnapshot.value ? "setup" : roomSnapshot.value ? "room" : "lobby");

  function acceptRoomMessage(message: RoomProtocolMessage) {
    if (message.type === "LOBBY_SNAPSHOT") lobbySnapshot.value = message;
    if (message.type === "ROOM_SNAPSHOT") roomSnapshot.value = message;
  }

  function acceptGameMessage(message: ClientProtocolMessage) {
    if (message.type === "GAME_SNAPSHOT") {
      gameSnapshot.value = message;
      setupSnapshot.value = null;
      eventQueue.value = [];
    }
    if (message.type === "SETUP_SNAPSHOT") { setupSnapshot.value = message; gameSnapshot.value = null; eventQueue.value = []; }
    if (message.type === "PRESENTATION_EVENT") eventQueue.value = [...eventQueue.value, message];
  }

  function reportProtocolError(errors: readonly string[]) {
    protocolErrors.value = [...errors];
  }

  function resetProjection() {
    lobbySnapshot.value = null;
    roomSnapshot.value = null;
    gameSnapshot.value = null;
    setupSnapshot.value = null;
    eventQueue.value = [];
    protocolErrors.value = [];
  }

  return {
    lobbySnapshot: readonly(lobbySnapshot), roomSnapshot: readonly(roomSnapshot), gameSnapshot: readonly(gameSnapshot), setupSnapshot: readonly(setupSnapshot),
    eventQueue: readonly(eventQueue), protocolErrors: readonly(protocolErrors), screen,
    acceptRoomMessage, acceptGameMessage, reportProtocolError, resetProjection
  };
});
