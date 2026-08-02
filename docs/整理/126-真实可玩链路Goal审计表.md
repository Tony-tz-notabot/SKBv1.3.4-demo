# 真实可玩链路 Goal 审计表（按文档 122）

依据 `docs/整理/122-真实可玩链路接手与完成审计清单.md` 的"Goal 完成的必要证据"逐条核对（2026-08-02，阶段 3.2—3.6 完成后）。

## 一、服务端应用层

| 证据项 | 状态 | 依据 |
| --- | --- | --- |
| 四人房间完整生命周期、房主权限、座位与队伍固定映射 | ✅ | `roomService.ts`；E2E/stage2 测试 |
| 受认证身份 | ✅ | 会话 token 盐化（3.5）；`/api/session` + WS token |
| 断线宽限、重连恢复、服务重启恢复 | ✅ | `setDisconnected/resolveDisconnectTimeouts/restore`；`reconnect.test.ts` |
| 所有命令幂等（含重启后） | ✅ | room/game commandResults 持久化恢复；stage2/hardening 测试 |
| 所有可达手动窗口有明确超时行为 | ⚠️ 部分 | 核心窗口与注册表窗口均有 timeout 适配（`GameService.timeout` + `timeoutWindow`）；逐 kind 断言仅抽查（playPhaseAction/statueCardSelection 等），复合窗口依赖引擎自动调度 |

## 二、全量命令路由

| 证据项 | 状态 | 依据 |
| --- | --- | --- |
| 每个服务器报价存在唯一执行适配 | ✅ | `playRegistry.ts` 42 entries、`windowRegistry.ts` factories；`windowCoverage.test.ts` 分类断言 |
| 每个适配验证权限/修订/prompt/offer/费用/目标/当前合法性 | ✅ | 各 Session 服务端重验；3.3 验收 29 项 |
| 拒绝不污染权威状态 | ✅ | `playRegistryFull.test.ts` stale/非法选择零污染断言 |

## 三、全量受众投影

| 证据项 | 状态 | 依据 |
| --- | --- | --- |
| 玩家本人/队友/对手/观战公开私密字段分别验证 | ✅ | `projection.test.ts`/`stage2.test.ts`（观战快照、受众过滤） |
| 手牌/隐藏展示/随机手牌选择/选角候选不泄漏 | ✅ | 隐私断言（`presentationEvents.test.ts`、`stage2`、`windowSpec.test.ts` 雕像隐藏） |
| 所有 `InteractionOffer` 精确选择类型/上下限/合法引用 | ✅ | 3.2 窗口规格审计（按 offer 细分合法卡集、minimum/maximum）；`windowSpec.test.ts` |

## 四、协议与事件

| 证据项 | 状态 | 依据 |
| --- | --- | --- |
| 每条入站命令/快照/命令结果/演示事件通过 v1.3.4 schema | ✅ | E2E 每消息 Ajv；`validate-client-protocol/room-protocol/examples` 工具 |
| 每种领域事件映射为准确演示事件 | ⚠️ 部分 | 3.1 新增 10 类达 28 类覆盖关键动作；剩余低频/过程性事件回退 `ACTION_COMMITTED`（不掩盖关键信息，记录为可接受边界） |
| 断线重连按 revision/eventSeq 去重、不重播旧动画 | ✅ | 客户端 `serverProjection.ts` 去重 + E2E 广播单调断言 |

## 五、Vue 全部游戏操作

| 证据项 | 状态 | 依据 |
| --- | --- | --- |
| 服务器报价中手牌/装备/判定区/目标/颜色/模式/数值/确认均可操作 | ⚠️ 部分 | 组件测试覆盖卡牌/装备/目标/确认（GameCard/GamePlayerPanel/offer confirm spec）；颜色/模式/数值选择器已有 schema 支持，组件层未逐类组件测试 |
| 不进入详情仍显示卡牌/角色基础信息；详情可打开；合法操作高亮 | ✅ | GameCard（详情按钮/合法类）、GamePlayerPanel（合法装备/目标）测试 |
| 本人视角座位旋转正确；武器常亮预选和空槽/手刀边界 | ✅ | `GameView.playerPosition` 公式 + E2E viewer.seat 校验 |
| 全体/队伍聊天、图片映射和默认占位图 | ✅ | GameChatPanel 测试、ResourceImage fallback 测试 |

## 六、部署链路

| 证据项 | 状态 | 依据 |
| --- | --- | --- |
| 一个命令启动服务器并提供 Vue SPA、静态素材、健康检查、WebSocket | ✅ | `server npm start`（`main.ts`）；`README.md`；`reconnect.test.ts` 静态托管断言 |

## 七、端到端

| 证据项 | 状态 | 依据 |
| --- | --- | --- |
| 四个真实连接建房/准备/选角/重摸进入游戏 | ✅ | `e2e.test.ts` |
| 覆盖普通攻击/响应/多段/濒死/阶段超时/断线恢复 | ⚠️ 部分 | E2E 覆盖攻击/响应/濒死/胜负；断线恢复由 `reconnect.test.ts`；阶段超时由引擎 timeout 测试覆盖，未在 E2E 中演练 |
| 对局实际到达合法胜负状态 | ✅ | E2E 到 `winnerTeam="A"`，连续通过 |
| 过程中每条消息通过协议校验、无隐藏信息泄漏 | ✅ | E2E Ajv + 隐私断言 |

## 八、结论

- **完全满足**：应用层主体、命令路由零污染、受众投影与隐私、协议 schema、Vue 主要操作、部署链路、E2E 到胜负。
- **记录为边界（不影响"可玩"判定）**：
  1. 逐 kind 窗口超时的全量断言未穷举（核心与注册表窗口均有适配）；
  2. 低频领域事件回退 `ACTION_COMMITTED`（关键动作已独立映射）；
  3. 颜色/模式/数值类选择器组件测试未逐类（schema 与报价已支持）；
  4. 阶段超时/断线恢复未纳入同一条 E2E 剧本。
- 武器 W01—W66 总验收与跨规则组合冲突审计按作者决定继续后置，不属于本 Goal 前置。
