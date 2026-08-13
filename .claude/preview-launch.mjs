// 幂等预览启动器：端口上已有服务器则直接复用；否则以 SKB_TEST_MODE=1 启动 server/dist/app/main.js。
// preview_start 用它作为 command（autoPort 会把分配的端口经 PORT env 传入）。本进程即服务器进程，
// 事件循环（http + tick 定时器）保持运行，preview 可正常管理生命周期。
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PORT = Number(process.env.PORT ?? process.env.SKB_PORT ?? 8787);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function healthy() {
  try { const res = await fetch(`http://localhost:${PORT}/health`); return res.ok; }
  catch { return false; }
}

if (await healthy()) { console.log(`[preview-launch] server already on :${PORT}`); process.exit(0); }
process.env.PORT = String(PORT);
process.env.SKB_TEST_MODE = "1";
process.env.SKB_DATA_FILE = process.env.SKB_DATA_FILE ?? join(ROOT, "server/data/skb-test-state.json");
console.log(`[preview-launch] starting SKB test server on :${PORT}`);
// 顶层 await 完成即已 listen；事件循环保持，进程不退出。
await import(pathToFileURL(resolve(ROOT, "server/dist/app/main.js")));
for (let i = 0; i < 60; i += 1) {
  if (await healthy()) { console.log(`[preview-launch] ready on :${PORT}`); break; }
  await sleep(500);
}
