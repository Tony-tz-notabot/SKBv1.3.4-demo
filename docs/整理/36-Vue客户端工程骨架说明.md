# Vue 3客户端工程骨架说明

状态：首个可构建骨架已完成。

## 一、工程位置与技术栈

客户端位于`client/`，使用：

- Vue 3.5；
- TypeScript 5.9；
- Vite 8；
- Pinia 4；
- Ajv 8 Draft 2020-12。

TypeScript暂固定为5.9.3，因为当前`vue-tsc 3.3.9`与TypeScript 7的编译器导出结构不兼容。升级前必须重新执行类型检查和生产构建。

## 二、已建立的边界

- `src/protocol/validation.ts`：网络消息进入应用前执行标准JSON Schema及跨字段语义校验；
- `src/protocol/gateway.ts`：唯一协议收发边界，组件不得直接处理原始WebSocket消息；
- `src/stores/serverProjection.ts`：保存大厅、房间、对局快照及表现事件队列；
- `shared/src/generated/`：房间和对局共享类型的唯一来源，客户端不复制协议类型；
- `src/App.vue`：只读应用壳层，按大厅、房间、对局投影选择当前屏幕；
- `src/components/ConnectionStatus.vue`：连接状态基础组件。

## 三、权威状态原则

- 只有通过Schema和跨字段校验的消息可以写入Store；
- Vue组件只能读取服务器投影，不直接修改快照；
- 客户端命令必须经协议网关发送；
- 合法操作、目标、响应和禁用原因必须来自服务器报价；
- 规则DSL不得导入客户端并作为合法性裁定器；
- 动画队列不得阻塞或反向修改权威状态。

当前Store暴露的写方法只供协议适配层调用；进入真实功能开发时应进一步把网关组装放在应用服务层，避免页面组件获得`acceptGameMessage`等内部入口。

## 四、构建

```powershell
cd client
npm install
npm run typecheck
npm run build
```

当前类型检查与生产构建均通过。

## 五、下一步

开发期协议模拟器以及大厅、旋转四座房间和私密选角只读页面已经完成，见`37-大厅房间与选角页面实现说明.md`。

下一步建立命令构造器与WebSocket连接状态机，再连接准备、选角和聊天操作。
