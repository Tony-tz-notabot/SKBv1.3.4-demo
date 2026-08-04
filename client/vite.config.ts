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
    fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] },
    // 开发模式下把登录 API 与 WebSocket 转发到权威服务器（8787），客户端与
    // 服务器保持同源，浏览器无需单独配置跨域。生产由服务器直接托管静态资源。
    proxy: {
      "/api": "http://localhost:8787",
      "/ws": { target: "ws://localhost:8787", ws: true }
    }
  }
});
