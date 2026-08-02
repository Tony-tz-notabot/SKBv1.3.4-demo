import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  publicDir: fileURLToPath(new URL("../assets", import.meta.url)),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@skb-protocol": fileURLToPath(new URL("../shared/src/generated", import.meta.url))
    }
  },
  server: {
    fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] }
  }
});
