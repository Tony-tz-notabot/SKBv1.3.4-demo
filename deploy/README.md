# SKB v1.3.4 云服务器部署说明

## 前置条件

- Ubuntu 22.04 / 24.04（或兼容 Debian 系）；
- 公网端口：**8787**（默认）需在云控制台安全组放行。

## 一键部署（pm2 守护，服务器只跑游戏服务，不托管前端）

```bash
sudo bash deploy/deploy.sh
# 或指定安装目录：
sudo APP_DIR=/opt/skb bash deploy/deploy.sh
# 或换端口：
sudo PORT=9000 bash deploy/deploy.sh
```

脚本会依次完成：安装 Node 22 → clone 仓库 → 构建 server（tsc）与 client（vite）→ pm2 启动。

> 服务端默认 **不托管静态资源**（`SKB_SERVE_STATIC` 未设为 `1` 时 `/` 返回 404，只提供 `/health`、`/api/session`、`/ws` 与游戏快照广播，带宽只消耗游戏消息）。前端以**离线包**分发给客户（见下）。

> `server/dist` 与 `client/dist` 均被 .gitignore 忽略、不入库，**必须在服务器上构建**，因此部署脚本执行完整 `npm install`（含 devDependencies），需要几分钟。

## 给客户端的离线包（推荐分发方式）

```bash
# 在本机或服务器上执行（需要先 npm install 客户端依赖）：
cd client && npm install
node ../deploy/offline/build-offline.mjs "ws://<ECS公网IP>:8787/ws"  ../deploy/offline/out/skb-client-offline
```

产出 `deploy/offline/out/skb-client-offline/`，把**整个目录**压缩发给客户：
解压 → 双击「启动客户端.bat」→ 浏览器打开 http://localhost:8080。

- 客户机**只跑本地静态界面**（图片/页面零云流量），游戏消息走注入的云服务器地址；
- 需要 Node.js ≥ 20 的客户机；
- 若服务器端口不是默认 8787，按实际修改构建命令中的地址；
- 若服务器通过 Nginx/HTTPS 提供，使用 `wss://域名/ws` 并确保反向代理支持 WebSocket 升级头。

## 传统模式（服务器同时托管前端，可选）

需要服务器直接提供网页时：`SKB_SERVE_STATIC=1` 启动（`deploy.sh` 中可加该环境变量），浏览器直接访问 `http://<IP>:<端口>/` 即可，无需离线包。

## 验证

```bash
curl http://127.0.0.1:8787/health
# {"ok":true,"rulesetVersion":"1.3.4"}
```

浏览器访问 `http://<服务器公网IP>:8787/`，注册账号即可开局。

## 管理命令（pm2）

```bash
pm2 logs skb-server        # 日志
pm2 restart skb-server     # 重启
pm2 stop skb-server        # 停止
pm2 startup                # 生成开机自启（按提示执行输出的 sudo 命令后 pm2 save）
```

## 备选：systemd（不用 pm2）

```bash
sudo cp deploy/skb-server.service /etc/systemd/system/
# 编辑服务文件，把 /home/ubuntu/skb 改为实际路径
sudo systemctl daemon-reload
sudo systemctl enable --now skb-server
journalctl -u skb-server -f   # 看日志
```

## 更新到新版本

```bash
cd <仓库> && git pull
cd server && npm install && npm run build
cd ../client && npm install && npm run build
pm2 restart skb-server        # 或 sudo systemctl restart skb-server
```

## 生产建议（可选）

- **反向代理 + HTTPS**：Nginx 将 `/`、`/api`、`/ws` 转发到 `127.0.0.1:8787`，WebSocket 需 `proxy_set_header Upgrade $http_upgrade; Connection "upgrade";`；证书用 certbot。
- **持久化**：`server/data/skb-state.json` 建议放在持久卷（云盘/对象存储挂载），重装系统不丢数据。
- **数据备份**：定期复制 `server/data/skb-state.json`。
