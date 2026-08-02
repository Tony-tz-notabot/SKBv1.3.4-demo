# SKB 仓库协作说明

## 开始工作前

每次处理本仓库任务，先完整阅读：

1. `hot.md`
2. `docs/整理/00-规则整理索引.md`
3. 与当前任务直接相关的整理文档
4. 相关原始规则文档

如果任务涉及既有裁定，还必须阅读 `docs/整理/04-第一轮正式裁定.md`。不得仅凭原始规则覆盖已经确认的裁定。

## 规则来源

冲突优先级：

1. 最新正式补丁；
2. 当前版本通用规则；
3. 当前版本角色/卡牌正文；
4. 规则作者的正式裁定；
5. UI 与技术文档；
6. 旧规则、旧注意点和草案。

整理期间，`docs/整理/04-第一轮正式裁定.md` 是作者已确认决定的记录。若它与尚未回写的旧正文冲突，采用正式裁定，并把冲突列入后续回写任务。

## 编辑原则

- 原始规则资料作为来源保留；没有明确要求时，不直接覆盖或删除。
- 新的统一规则先写入 `docs/整理/`。
- 清楚区分：原文已有规则、作者正式裁定、整理者建议、尚未裁定问题。
- 不替作者擅自决定会改变玩法或数值平衡的事项。
- 纯术语统一、显然的笔误和已经明确的裁定可以直接回写整理稿。
- 每次修改规则后，搜索整理稿中的旧措辞，避免同一规则保留两个冲突版本。
- 规则文本应使用明确的阶段、目标、费用、响应、伤害段和到期节点，避免模糊的“一会”“一轮左右”等措辞。

## 上下文维护

当发生以下任一情况时更新根目录 `hot.md`：

- 作者作出新的规则裁定；
- 新建或重构重要文档；
- 当前工作阶段或下一步发生改变；
- 发现会影响后续工作的重大冲突、数量错误或实现约束；
- 一轮较长工作结束，后续可能发生上下文压缩。

`hot.md` 只保存恢复工作所需的高价值信息，不复制完整规则。详细内容应链接到对应文档。更新时删除已过期状态，避免无限增长。

## 当前目标

把散落的 SKB v1.3.3 规则、补丁、注意点和线上版要求整理为一致的 v1.3.4 规则集，随后转换为结构化、可验证、可由服务器执行的数据与规则规范。

## 2026-08-02 交接说明：真实可玩链路 Goal

### 用户当前授权与目标

当前仍有一个未完成的连续 Goal，不能缩减为“应用骨架完成”：

> 完整实现 SKB 真实可玩链路：服务端应用层（房间、WebSocket、身份、命令路由、超时、重连与恢复）、全量权威投影和协议、Vue 客户端全部游戏操作，以及从建房到胜负的前后端联调；自行维护上下文、实现文档、规则索引与 hot.md。武器总验收和跨规则组合验收后置。

用户要求无规则疑义时自动推进，不逐步询问。Goal 尚未达到完成条件，不能标记完成。武器 W01—W66 总验收与跨规则组合冲突审计明确后置。

### 接手后先读

除本文件顶部必读项外，继续此 Goal 前完整阅读：

1. `docs/整理/25-v1.3.4事件与效果DSL规范.md`
2. `docs/整理/32-线上版客户端约束清单.md`
3. `docs/整理/33-线上版客户端服务端协议设计.md`
4. `docs/整理/34-客户端服务端协议Schema说明.md`
5. `docs/整理/35-房间大厅与选角协议设计.md`
6. `docs/整理/36-Vue客户端工程骨架说明.md`
7. `docs/整理/38-WebSocket连接与重连状态机说明.md`
8. `docs/整理/43-对局状态与权威引擎接口.md`
9. `docs/整理/44` 至 `47` 的客户端外壳说明
10. `docs/整理/49-开局手牌与重摸正式裁定.md`
11. `docs/整理/121-真实应用层与联机链路实现说明.md`

### 当前工作树事实

- 当前目录没有 Git 元数据，无法依靠 `git diff/status`；修改前后须直接检查文件。
- 最新实际验证（2026-08-02）：
  - `server/npm run build` 通过；
  - 服务端 `97` 个测试文件、`398` 项测试通过；
  - `client/npm run build` 通过；
  - 客户端 `3` 个测试文件、`10` 项测试通过。
- PowerShell profile 会输出 `PSReadLine`/`Import-Clixml` 噪声，不是项目失败；以命令退出码为准。
- 最后一次被打断的编译已经重新执行，两端构建及全量测试均已收束通过。

### 本 Goal 已新增/修改的关键文件

服务端应用层：

- `server/src/app/types.ts`
  - 应用用户、房间、玩家、聊天、设置和持久化结构。
- `server/src/app/persistence.ts`
  - JSON 原子落盘，默认 `server/data/skb-state.json`。
- `server/src/app/roomService.ts`
  - 建房、加入、离开、准备、换座、设置、踢人、转房主、关闭、选角、聊天、开局、连接状态及选角超时。
- `server/src/app/projection.ts`
  - 大厅、房间、重摸、正式对局的按受众投影；含卡牌公开/私密引用、出牌报价和通用窗口报价。
- `server/src/app/protocol.ts`
  - 服务端 Ajv 协议验证，读取 `protocol/v1.3.4` 两个 schema。
- `server/src/app/gameService.ts`
  - 游戏命令幂等缓存、开局重摸、预选、阶段命令、核心响应窗口、出牌注册表、特殊窗口注册表、自动调度及超时入口。
- `server/src/app/playRegistry.ts`
  - 出牌阶段首批统一报价/执行注册表。
- `server/src/app/windowRegistry.ts`
  - 大量非出牌专属窗口的统一执行与超时适配表。
- `server/src/app/server.ts`
  - HTTP `/health`、WebSocket `/ws`、PING/PONG、命令协议校验、广播快照、持久化和 250ms 超时扫描。
- `server/src/app/main.ts`
  - 加载冻结规则、恢复持久化状态并监听；`server/package.json` 新增 `npm start`。
- `server/src/app/projection.test.ts`
  - 大厅、等候房、私密选角、重摸、正式对局投影的实际 schema 校验；增加 2 项测试。
- `server/src/engine/statueDoubleTrigger.ts`
  - `StatuePlaySession.handle` 的 `deadlineAt` 增加 `Date.now()` 默认值，以兼容统一适配入口；规则逻辑未改变。

客户端：

- `client/src/App.vue`
  - 默认连接真实 WebSocket；身份暂用 `localStorage` 中的 `skb.userId`/`skb.displayName`；只有 URL `?mock=1` 才使用开发模拟。
- `client/src/views/GameView.vue`
  - 支持同一报价多个卡牌选择规格，手牌及装备区卡牌均可按服务器 `legalRefs` 高亮/选择。
- `client/src/components/GamePlayerPanel.vue`
  - 装备区、天赋区、判定区增加服务器合法卡牌选择入口；仍保留武器预选。
- 既有 `client/src/network/realtimeService.ts` 与 `WebSocketClient.ts` 未重写，继续负责待确认命令重放、心跳和指数重连。

文档：

- `docs/整理/121-真实应用层与联机链路实现说明.md`
- `docs/整理/00-规则整理索引.md` 已登记 121。
- `hot.md` 应保持与本交接同步。

依赖变化：服务端已加入 `ws` 与 `@types/ws`，对应 `package.json`/lock 已更新。

### 已经真正接通的链路

- 房间：创建、加入、离开、准备、换座、设置、踢人、转房主、关闭。
- 选角：每人四候选、预选、锁定、超时锁定；四人锁定后建立统一权威状态。
- 开局：每人初始 4 张，一次整手弃 4 摸 4机会；超时保留；四人结束后进入正式时间轴。
- 聊天：房间与游戏内全体/队伍消息，服务端按队伍过滤。
- 连接：真实 `/ws`、心跳、自动重连、同 userId 后重投影、房间/游戏 JSON 状态恢复。
- 游戏核心命令：武器预选、阶段结束/弃牌、攻击响应、濒死、判定指定/干预、判定前、可选触发和触发排序。
- 出牌阶段注册表已登记：普通攻击、药水/号角、武器/坐骑/天赋装备与主动丢弃、武器合成、主要角色主动能力、熔炉、死亡笔记/号角小队、雕像、超级大宝贝儿等。以 `playRegistry.ts` 实际 `entries` 为准。
- 专属窗口注册表已登记多种 BOSS/角色/武器/特殊牌后续窗口。以 `windowRegistry.ts` 的 `factories` 为准。
- 所有服务端入站游戏/房间命令先做整体 schema 校验；非法命令返回 `PROTOCOL_INVALID`。

### 重要：不能误报为已完成的部分

1. `playRegistry.ts` 与 `windowRegistry.ts` 是第一版统一适配，不等于所有处理器已逐项端到端验收。
   - 当前大量适配利用“统一构造完整命令对象、会话自行重验”的方式。
   - 必须逐注册项增加报价→协议投影→客户端选择→执行→新投影测试。
   - 某些 Session 构造参数、命令字段或多阶段方法虽能编译，但可能在真实路径不吻合。
2. 尚未实现完整、安全的身份认证。
   - 当前浏览器把随机 userId 放在 URL 查询参数，能恢复但可被伪造。
   - 下一代理应设计服务端签发的 session/resume token（建议 `/api/session` + 持久化 token 哈希或签名），并保持协议/客户端软编码。
3. 持久化幂等不完整。
   - `RoomService.commandResults` 与 `GameService.results` 只在进程内，重启后同 commandId 可能重放。
   - 需持久化有限命令结果或在权威状态中保存去重记录，并设置容量上限。
4. 正式对局投影仍是通用推断第一版。
   - `projection.ts::playOffer/windowOffer` 从原始报价和窗口 context 推断选择规格。
   - 需验证所有 `SelectionSpec` 的 min/max、卡牌公开级别、目标、确认/模式/颜色/数值选项。
   - 隐藏展示牌不能因通用 `context.cardRefs` 意外泄漏；必须逐窗口做隐私测试。
5. 演示事件映射不完整。
   - `projection.ts::presentation/mapEvent/eventPayload` 对许多领域事件退化为 `ACTION_COMMITTED`，部分已映射事件的 payload 仍需逐项 schema 校验。
   - 当前 `server.ts` 主要广播快照，尚未可靠地广播增量 `PRESENTATION_EVENT`。
6. 观战链路不完整。
   - 房间允许 spectator，但正式游戏 `sync` 只向玩家发游戏投影；需定义并实现观战游戏公开投影，不能调用要求 viewer player 的 `GameProjector.game`。
7. 超时覆盖不完整。
   - 核心和注册表中实现了多种 timeout，但没有 `handleTimeout` 的窗口当前不会自动处理。
   - 应建立窗口种类覆盖测试，确保任何可达 pending window 都有明确超时策略。
8. Web 服务只提供 `/health`，未托管 `client/dist` 与图片资源；生产部署仍需静态文件、缓存头、SPA fallback 和素材路径。
9. 房间密码目前只是 SHA-256，无盐；需改为适合密码的 KDF 或至少每房间随机盐。
10. 房间设置校验、客户端默认值与 schema 范围需要逐字段对照；当前 `RoomService.settings` 统一限制 5—600 秒，未证明与 schema/机器设置完全一致。
11. 四客户端从建房到胜负尚无自动端到端测试；当前只有投影 schema 单元测试，不能以 398 项引擎测试替代联机验收。
12. 尚未证明游戏能通过所有实际报价一路走到 `winnerTeam`；Goal 绝不能在此之前完成。

### 下一步推荐顺序（不要先做后置验收）

1. 为 `playRegistry.ts` 建表驱动测试：至少普通手刀/武器攻击、药水、装备、丢弃、合成、一个角色技能；验证报价 schema、合法引用、执行成功及拒绝零污染。
2. 为 `windowRegistry.ts` 建可达窗口覆盖矩阵：从代码/测试收集所有 `PendingWindowState.kind`，分类为核心、注册表、系统自动；缺失项逐个补 adapter/timeout。
3. 修复适配测试发现的真实命令字段问题。不要为了通过测试绕过 Session 的服务端重验。
4. 把所有成功命令产生的领域事件按受众转为并广播合法 `PRESENTATION_EVENT`，为每个事件种类跑 Ajv。
5. 补观战公开游戏投影和隐藏信息回归测试。
6. 实现服务端签发身份/恢复 token、持久化幂等结果、断线宽限状态及房间清理策略。
7. 静态托管 Vue 产物与素材，增加生产启动方式。
8. 使用真实 `ws` 客户端写四人 E2E：建房→加入→准备→选角→重摸→若干实际回合/攻击/响应→断线恢复→超时→胜负。客户端收到的每条消息均通过 schema。
9. 再做浏览器层 Vue 操作联调，确认服务器合法项高亮、旋转座位、详情、队伍/全部聊天、图片 fallback。
10. 最后按目标逐条完成审计；武器总验收与跨规则组合审计仍后置。

### 快速命令

```powershell
# 服务端
cd server
npm run build
npm test
npm start

# 客户端
cd client
npm run build
npm test
npm run dev

# 真实开发连接：普通打开 Vite 地址（默认 ws://<host>:8787/ws）
# 模拟场景：在 Vite URL 后加 ?mock=1
```

服务端默认端口 `8787`，健康检查 `/health`，WebSocket 路径 `/ws`。可用 `PORT`、`SKB_DATA_FILE` 环境变量覆盖。
