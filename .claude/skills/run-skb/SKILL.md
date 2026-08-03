---
name: run-skb
description: Build, run, and test SKB 联机游戏. Use when asked to start the SKB server, open the game in a browser, test it, or take a screenshot of the game UI.
---

SKB 是四人 2v2 联机游戏（服务端权威 + Vue 3 客户端）。一切通过
`.claude/skills/run-skb/driver.mjs` 驱动：它负责启动服务器、登录预留的四个测试账号
（test1–test4 / 密码 1234）、用 Edge 打开四个已登录标签页并截图验证。

路径均相对于仓库根 `<repo>/`。

## 前置条件

- Windows + Node ≥ 20（`fetch`/内置 `WebSocket` 需要）
- Microsoft Edge 或 Chrome（driver 自动探测，可用 `SKB_EDGE` 覆盖）
- 依赖已安装：`cd server && npm install`（首次）；`npm run build` 已在仓库内跑过，`dist/` 存在

## 运行（agent 路径：自动验证）

```bash
node .claude/skills/run-skb/driver.mjs --headless
```

无头 Edge 打开四个已登录标签页（test1–test4/1234，不存在则自动注册），逐个注入
sessionStorage token、刷新、截图。四张截图落到
`server/data/shots/tab1–4.png`，日志出现 `sessionStorage=SET` 且各标签页标题为
`SKB Online` 即验证通过。完成后自动关闭 Edge，服务器保持运行供复用。

| 命令 | 作用 |
|---|---|
| `node .claude/skills/run-skb/driver.mjs --headless` | 无头验证：4 标签页登录 + 截图后自动清理 |
| `node .claude/skills/run-skb/driver.mjs --server-only` | 只启动服务器（不打开浏览器） |
| `node .claude/skills/run-skb/driver.mjs --screenshot` | 有头窗口 + 对四个标签页截图保存 |
| `node .claude/skills/run-skb/driver.mjs --stop` | 关闭本 skill 启动的 Edge 与服务器 |

## 测试性运行（人工手动测试）

用户要自己点着测时，直接开有头窗口：

```bash
node .claude/skills/run-skb/driver.mjs
```

启动服务器并打开一个可见的 Edge 窗口，四个标签页分别已是 test1–test4
已登录状态（无需手动登录）。`--screenshot` 变体额外对四个标签页截图到
`server/data/shots/`。测完关闭窗口或执行：

```bash
node .claude/skills/run-skb/driver.mjs --stop
```

## 测试（自动化测试套件）

```bash
cd server && npm run build && npm test
```

## 注意

- **多账号一次性测试**：四个标签页就是四个玩家。想模拟四个玩家进同一局，各自在标签页里建房/输码加入即可。
- **端口**：服务器默认 8787（`SKB_PORT` 可覆盖）；Edge CDP 固定 9222。
- **重复运行**：再次执行会在开新标签页前自动关掉上次遗留的标签页，始终正好四个。
- **不会误杀**：`--stop` 只关本 skill 自己启动的 Edge（按专属 profile 匹配命令行）与
  `dist/app/main.js` 服务器进程，绝不关你的日常浏览器。

## 故障排查

- **`EADDRINUSE: address already in use 0.0.0.0:8787`**：服务器已在跑（或残留）。先
  `node .claude/skills/run-skb/driver.mjs --stop` 再重试；driver 检测到端口已监听时也会复用。
- **`未找到 Edge/Chrome`**：设置 `SKB_EDGE=C:/.../msedge.exe`（或 chrome.exe）后重跑。
- **`服务器未在 8787 端口就绪`**：多半是 `server/dist/` 缺失或构建过期，`cd server && npm run build` 后重跑。
- **标签页数超过四个**：旧标签页未清理，重跑一次即可（driver 会自动关遗留页）。
