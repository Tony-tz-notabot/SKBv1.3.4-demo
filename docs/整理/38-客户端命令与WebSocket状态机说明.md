# 客户端命令与WebSocket状态机说明

状态：首版实现完成。

## 一、实现产物

- `client/src/protocol/commandBuilders.ts`：房间与对局命令的类型安全构造器；
- `client/src/network/WebSocketClient.ts`：连接、心跳、超时、重连和待确认队列；
- `client/src/network/realtimeService.ts`：WebSocket、协议网关、投影Store和确认队列的应用组装层；
- `client/src/stores/connection.ts`：连接状态、延迟和待确认命令数量；
- `client/src/network/WebSocketClient.test.ts`：通信状态机自动测试。

## 二、命令构造约束

- 命令名在TypeScript中映射到唯一载荷类型；
- 创建/加入房间允许没有`roomId/expectedRoomRevision`；
- 其他房间命令必须绑定当前房间与修订号；
- `EXECUTE_OFFER`必须绑定`promptId/offerId`；
- 非报价命令不得绑定报价窗口；
- `commandId`默认使用`crypto.randomUUID()`，测试可注入稳定ID生成器。

## 三、连接状态机

状态为`offline → connecting → online`，异常断开后进入`reconnecting`。重连使用带抖动的指数退避，默认基础1秒、上限30秒；所有数值集中在构造配置中。

在线期间按配置发送`PING`。在超时前未收到`PONG`则关闭当前连接并进入重连。收到`PONG`后计算往返延迟并写入连接Store。

## 四、幂等与重发

- 命令进入待确认Map后才尝试发送；离线时保留；
- 重连成功后按原对象重发，保持原`commandId`；
- 只有收到房间或对局的接受/拒绝结果后才移除；
- 客户端不得把一次未确认命令重建为新ID；
- 服务器仍必须按`commandId`返回首次处理结果，客户端队列不能替代服务端幂等。

## 五、协议入口

服务端线消息分为`room/game`频道。消息仍须通过Ajv和跨字段验证后才能进入投影Store。命令结果也先校验，再用于确认待发送命令。无效消息不会解除待确认状态。

生产环境通过`VITE_WS_URL`设置实时服务器；开发环境默认只启用模拟服务器，避免误连线上地址。

## 六、验收

自动测试覆盖：

1. 离线命令入队并在连接后发送；
2. 断线重连后使用同一命令ID重发，确认后移除；
3. 心跳发送与PONG延迟计算；
4. 主动断开后不自动重连。

当前4项测试、类型检查和生产构建均通过。

## 七、下一步

创建/加入、准备、角色预选/锁定和全部/队伍聊天已经接入，并已加入等待、拒绝原因和过期刷新提示，见`39-房间选角与聊天交互说明.md`。下一步实现角色详情与资源加载。
