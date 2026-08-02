# SKB v1.3.4 联机版

四人 2v2、服务器权威、Vue 3 客户端网页联机游戏。规则包与实现状态见 `docs/整理/`（先读 `hot.md` 与 `00-规则整理索引.md`）。

## 生产启动

```powershell
# 1. 构建两端
cd server; npm ci; npm run build
cd ..\client; npm ci; npm run build

# 2. 启动服务器（托管 Vue 产物 + /health + /ws）
cd ..\server; npm start
```

- 默认端口 `8787`（`http://localhost:8787/` 打开游戏）。
- 环境变量：`PORT`（端口）、`SKB_DATA_FILE`（持久化路径，默认 `server/data/skb-state.json`）。
- 健康检查：`GET /health`；WebSocket：`ws://<host>:8787/ws`；会话：`POST /api/session`。
- 浏览器连接后经 `/api/session` 获取 token 并以 `?token=` 连接 WebSocket；断线后同 token 重连可恢复房间/对局。

## 开发

```powershell
cd server; npm test        # 服务端全量测试（vitest）
cd client; npm run dev     # Vite 开发服务器，默认连真实 ws://<host>:8787/ws
# 在 Vite 地址后加 ?mock=1 使用本地开发模拟
```

## 目录

- `server/`：权威引擎（`src/engine`）与应用层（`src/app`：房间/会话/投影/注册表/服务器）。
- `client/`：Vue 3 客户端（`src/views` 页面、`src/components` 组件、`src/stores/serverProjection` 投影与事件去重）。
- `protocol/v1.3.4/`：房间与客户端协议 schema（含演示事件 28 类）。
- `shared/src/generated/`：由 schema 生成的 TypeScript 类型。
- `rulesets/v1.3.4/`：冻结规则包（`frozen_baseline`）。
- `tools/`：规则构建与协议验证脚本（改动 schema 后运行 `validate-client-protocol.mjs` 等）。
