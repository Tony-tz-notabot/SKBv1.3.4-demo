import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./styles/base.css";

const app = createApp(App);
app.use(createPinia());
app.mount("#app");

const socketUrl = import.meta.env.VITE_WS_URL;
if (socketUrl && !import.meta.env.DEV) {
  const { createRealtimeService } = await import("./network/realtimeService");
  const realtime = createRealtimeService(socketUrl);
  const { configureRoomCommandSender } = await import("./services/roomActions");
  configureRoomCommandSender(realtime.sendRoomCommand);
  realtime.connect();
}
