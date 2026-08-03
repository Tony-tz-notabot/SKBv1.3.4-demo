// SKB 联机游戏运行/测试性运行 driver
//
// 用途：
//   1. 运行（agent 自动验证）：确保服务器启动，用无头 Edge 打开四个已登录标签页并截图验证。
//   2. 测试性运行（人工手动测试）：用有头 Edge 打开四个已登录标签页，窗口保持可见，
//      四个标签页分别是预留测试账号 test1–test4（密码 1234），无需手动登录。
//
// 原理：客户端把会话 token 存在 sessionStorage（每标签页独立）。本脚本先调用
// POST /api/session 用 test1–test4/1234 换取 token（不存在则自动注册），再通过
// Edge 的 Chrome DevTools Protocol 注入 sessionStorage 并刷新页面，App.vue 挂载时
// 读到 token 自动连接 WebSocket —— 四个标签页即四个已登录玩家。
//
// 用法：
//   node driver.mjs                 # 有头：打开可见窗口 + 四个已登录标签页（人工测试）
//   node driver.mjs --headless      # 无头：自动验证四个标签页登录并截图（agent 用）
//   node driver.mjs --stop          # 关闭本 skill 启动的 Edge 实例与服务器
//   node driver.mjs --server-only   # 只启动服务器，不打开浏览器
//   node driver.mjs --screenshot    # 配合有头：验证后对四个标签页截图保存
//
// 环境变量：
//   SKB_PORT        服务器端口（默认 8787）
//   SKB_EDGE        浏览器可执行文件路径（默认自动探测 Edge）
//   SKB_PROFILE     Edge 用户数据目录（默认 <server>/data/.edge-skb-profile）

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const UNIT = resolve(HERE, "../../.."); // 仓库根
const SERVER_DIR = join(UNIT, "server");
const DATA_DIR = join(SERVER_DIR, "data");
const DEFAULT_DATA_FILE = join(DATA_DIR, "skb-state.json");
const EDGE_CANDIDATES = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
];
const ACCOUNTS = [
  { username: "test1", password: "1234" },
  { username: "test2", password: "1234" },
  { username: "test3", password: "1234" },
  { username: "test4", password: "1234" },
];
const DEFAULT_PORT = 8787;
const CDP_PORT = 9222;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("[driver]", ...a);

async function findEdge() {
  if (process.env.SKB_EDGE && existsSync(process.env.SKB_EDGE)) return process.env.SKB_EDGE;
  for (const candidate of EDGE_CANDIDATES) if (existsSync(candidate)) return candidate;
  throw new Error("未找到 Edge/Chrome，请设置 SKB_EDGE 指向浏览器可执行文件");
}

async function waitForHealth(port, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await sleep(300);
  }
  throw new Error(`服务器未在 ${port} 端口就绪`);
}

async function ensureServer(port) {
  // 端口已有人监听则视为已运行
  try {
    const res = await fetch(`http://localhost:${port}/health`);
    if (res.ok) { log(`服务器已在运行 (端口 ${port})`); return null; }
  } catch { /* not running */ }
  log(`启动服务器 (端口 ${port})…`);
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const proc = spawn(npmCmd, ["start"], { cwd: SERVER_DIR, stdio: "ignore", detached: true, shell: true, env: { ...process.env, PORT: String(port) } });
  proc.unref();
  await waitForHealth(port);
  // 记录实际监听端口的进程 PID（npm wrapper 会退，真正的 server 是 node dist/app/main.js）
  let serverPid = null;
  if (process.platform === "win32") {
    const { execSync } = await import("node:child_process");
    try {
      const out = execSync(`wmic process where "name='node.exe'" get ProcessId,CommandLine /FORMAT:LIST`, { encoding: "utf8" });
      for (const block of out.split(/\r?\n\r?\n/).filter(Boolean)) {
        const pid = block.match(/ProcessId=(\d+)/)?.[1];
        const cmd = block.match(/CommandLine=(.*)/s)?.[1] ?? "";
        if (pid && cmd.includes("dist/app/main.js")) { serverPid = Number(pid); break; }
      }
    } catch { /* noop */ }
  }
  log("服务器就绪", serverPid ? `(pid ${serverPid})` : "");
  return proc;
}

async function stopServer() {
  // 按命令行匹配 dist/app/main.js 的 node 进程（不依赖 PID 文件，最可靠）
  if (process.platform !== "win32") { log("--stop 服务器：请手动 Ctrl-C"); return; }
  const { execSync } = await import("node:child_process");
  try {
    const out = execSync(`wmic process where "name='node.exe'" get ProcessId,CommandLine /FORMAT:LIST`, { encoding: "utf8" });
    let killed = 0;
    for (const block of out.split(/\r?\n\r?\n/).filter(Boolean)) {
      const pid = block.match(/ProcessId=(\d+)/)?.[1];
      const cmd = block.match(/CommandLine=(.*)/s)?.[1] ?? "";
      if (pid && cmd.includes("dist/app/main.js")) {
        try { execSync(`taskkill /PID ${pid} /T /F`); killed++; } catch { /* already gone */ }
      }
    }
    log(`已停止 ${killed} 个 SKB 服务器进程`);
    if (!killed) log("没有 SKB 服务器在运行");
  } catch { log("查询服务器进程失败"); }
}

async function login(username, password, port) {
  const res = await fetch(`http://localhost:${port}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!data.ok || !data.token) throw new Error(`登录失败 ${username}: ${JSON.stringify(data)}`);
  return data;
}

class CdpClient {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const client = new CdpClient(ws);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && client.pending.has(msg.id)) {
        const { resolve, reject } = client.pending.get(msg.id);
        client.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    };
    return client;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.ws.close(); } catch { /* noop */ } }
}

async function openEdge(edge, profile, headless) {
  // 同 profile 的旧 Edge 若在运行，新实例会转发给它然后自己退出（标签页叠加的根因）。
  // 先清掉旧窗口，保证每次运行都是干净窗口 + 恰好 N 个标签页。
  await stopEdge(profile);
  const args = [
    "--no-first-run", "--no-default-browser-check", "--disable-popup-blocking",
    "--no-restore-session-state", "--disable-session-crashed-bubble",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
  ];
  if (headless) args.push("--headless=new", "--disable-gpu", "--window-size=900,700");
  args.push("about:blank");
  log(`启动 Edge (${headless ? "无头" : "有头"})…`);
  const proc = spawn(edge, args, { stdio: "ignore", detached: true });
  proc.unref();
  let version = null;
  for (let i = 0; i < 40; i++) {
    try { const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`); version = await res.json(); break; }
    catch { await sleep(500); }
  }
  if (!version) throw new Error("Edge CDP 端口未就绪");
  log("Edge CDP 就绪:", version.Browser);
  return proc;
}

async function listPages() {
  const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  return list.filter((t) => t.type === "page");
}

async function openLoggedInTabs(baseUrl, sessions) {
  // 启动 Edge 后已有的标签页 = 会话恢复的旧页（未登录），全部清掉。
  // 不能靠 /json/close/<id>：close 有时不生效；直接重建窗口里的标签页。
  let preexisting = [];
  try { preexisting = await listPages(); } catch { /* Edge 刚起 */ }
  const preIds = new Set(preexisting.map((t) => t.id));
  const targets = [];
  for (let i = 0; i < sessions.length; i++) {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(baseUrl)}`, { method: "PUT" });
    const target = await res.json();
    targets.push(target);
  }
  // 启动前就存在的标签页 = 会话恢复的旧页（未登录），全关掉，保证恰好 N 个
  const now = await listPages();
  const stale = now.filter((t) => preIds.has(t.id));
  for (const t of stale) {
    await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${t.id}`).catch(() => {});
  }
  if (stale.length) log(`关闭 ${stale.length} 个会话恢复的标签页`);
  await sleep(1500);
  for (let i = 0; i < sessions.length; i++) {
    const cdp = await CdpClient.connect(targets[i].webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    const s = sessions[i];
    const expr = `(() => {
      sessionStorage.setItem("skb.token", ${JSON.stringify(s.token)});
      sessionStorage.setItem("skb.userId", ${JSON.stringify(s.userId)});
      sessionStorage.setItem("skb.displayName", ${JSON.stringify(s.displayName || s.username)});
      return sessionStorage.getItem("skb.token") ? "SET" : "MISSING";
    })()`;
    const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true });
    log(`标签页 ${i + 1} (${s.username}) sessionStorage=${r.result.value}`);
    await cdp.send("Page.reload", { ignoreCache: true });
    cdp.close();
  }
  await sleep(3000);
  return targets;
}

async function snapshotTabs(targets, shotDir) {
  const results = [];
  mkdirSync(shotDir, { recursive: true });
  for (let i = 0; i < targets.length; i++) {
    const cdp = await CdpClient.connect(targets[i].webSocketDebuggerUrl);
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    const path = join(shotDir, `tab${i + 1}.png`);
    writeFileSync(path, Buffer.from(shot.data, "base64"));
    const info = await cdp.send("Runtime.evaluate", {
      expression: `({ title: document.title, text: document.body.innerText.slice(0, 150) })`,
      returnByValue: true,
    });
    results.push({ path, title: info.result.value.title, text: info.result.value.text });
    cdp.close();
  }
  return results;
}

async function stopEdge(profile) {
  // 优先用 CDP 优雅关闭本 profile 的浏览器
  try {
    const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
    const browserTarget = list.find((t) => t.type === "browser");
    if (browserTarget?.webSocketDebuggerUrl) {
      const cdp = await CdpClient.connect(browserTarget.webSocketDebuggerUrl);
      await cdp.send("Browser.close");
      cdp.close();
      log("已关闭 Edge (CDP)");
      return;
    }
  } catch { /* CDP 端口未开，走进程匹配 */ }
  if (process.platform !== "win32") return;
  // Windows：只杀命令行里带本 skill profile 的 msedge 进程，绝不动用户自己的浏览器
  const { execSync } = await import("node:child_process");
  try {
    const out = execSync(`wmic process where "name='msedge.exe'" get ProcessId,CommandLine /FORMAT:LIST`, { encoding: "utf8" });
    const blocks = out.split(/\r?\n\r?\n/).filter((b) => b.trim());
    // 匹配 profile 目录名（纯 ASCII 的唯一标识）。不能匹配完整路径：
    // wmic 输出会把中文路径 `smx的skb` 破坏成乱码，正反斜杠也不一致。
    const profileDir = profile.split(/[\\/]/).filter(Boolean).pop();
    let killed = 0;
    for (const block of blocks) {
      const pid = block.match(/ProcessId=(\d+)/)?.[1];
      const cmd = block.match(/CommandLine=(.*)/s)?.[1] ?? "";
      if (pid && cmd.includes(profileDir)) {
        try { execSync(`taskkill /PID ${pid} /T /F`); killed++; } catch { /* already gone */ }
      }
    }
    log(`已关闭 ${killed} 个本 skill 的 Edge 进程`);
    if (!killed) log("没有本 skill 的 Edge 在运行");
  } catch { log("查询 Edge 进程失败"); }
}

async function main() {
  const args = process.argv.slice(2);
  const headless = args.includes("--headless");
  const stop = args.includes("--stop");
  const serverOnly = args.includes("--server-only");
  const screenshot = args.includes("--screenshot");
  const port = Number(process.env.SKB_PORT ?? DEFAULT_PORT);
  const baseUrl = `http://localhost:${port}/`;
  const profile = process.env.SKB_PROFILE ?? join(DATA_DIR, ".edge-skb-profile");

  if (stop) {
    await stopEdge(profile);
    await stopServer();
    process.exit(0);
  }

  if (!existsSync(DEFAULT_DATA_FILE)) {
    // 首次运行：确保真实数据文件存在（由服务器创建），登录会注册 test1–test4
    log("首次运行，将自动注册测试账号 test1–test4（密码 1234）");
  }

  const serverProc = await ensureServer(port);
  const sessions = [];
  for (const acc of ACCOUNTS) {
    const s = await login(acc.username, acc.password, port);
    sessions.push({ ...s, username: acc.username });
    log(`登录 ${acc.username} -> userId ${s.userId.slice(0, 8)}…`);
  }

  if (serverOnly) { log("服务器运行中，浏览器未打开。停止：Ctrl-C 或 --stop"); process.exit(0); }

  const edge = await findEdge();
  const edgeProc = await openEdge(edge, profile, headless);
  const targets = await openLoggedInTabs(baseUrl, sessions);
  const shotDir = join(DATA_DIR, "shots");

  if (screenshot || headless) {
    const shots = await snapshotTabs(targets, shotDir);
    for (const s of shots) log(`截图 -> ${s.path} | ${s.title}`);
  } else {
    log("四个已登录标签页已打开，窗口保持可见。手动操作即可测试。");
    log("完成后可用 node driver.mjs --stop 关闭 Edge。");
  }

  // 无头模式：截图验证后关闭
  if (headless) {
    await sleep(1500);
    await stopEdge(profile);
    log("无头验证完成");
    process.exit(0);
  }
}

main().catch((e) => { console.error("[driver] FATAL:", e.message); process.exit(1); });
