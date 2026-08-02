# SKB Vue客户端

## 命令

```powershell
npm install
npm run typecheck
npm run dev
```

客户端直接引用`../shared/src/generated/`中的协议类型。服务器消息必须先经过`src/protocol/validation.ts`，再由协议网关写入只读投影Store。Vue组件不得直接修改服务器快照，也不得解析规则DSL裁定合法操作。

生产环境通过`VITE_WS_URL=wss://...`配置实时服务器。开发环境默认使用协议模拟器，不会误连线上服务。
