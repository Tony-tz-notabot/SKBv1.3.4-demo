#!/usr/bin/env bash
# SKB v1.3.4 联机版服务器一键部署脚本（Ubuntu 22.04/24.04）
# 用法：sudo bash deploy.sh [APP_DIR]
# 可选环境变量：PORT（默认 8787）
set -euo pipefail

PORT="${PORT:-8787}"
APP_DIR="${1:-$HOME/skb}"
REPO_URL="https://github.com/Tony-tz-notabot/SKBv1.3.4-demo.git"

echo "==> [1/5] 安装 Node.js 22 (LTS)"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v; npm -v

echo "==> [2/5] 拉取代码到 ${APP_DIR}"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" pull --ff-only
fi
cd "$APP_DIR"

echo "==> [3/5] 安装并构建服务端（dist/ 不入库，需云上编译）"
cd server
npm install
npm run build
echo "server/dist 构建完成"

echo "==> [4/5] 安装并构建客户端"
cd ../client
npm install
npm run build
echo "client/dist 构建完成"
cd ..

echo "==> [5/5] 启动服务（pm2）"
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi
pm2 delete skb-server 2>/dev/null || true
PORT="$PORT" pm2 start server/dist/app/main.js --name skb-server
pm2 save

echo
echo "部署完成："
echo "  健康检查  : curl http://127.0.0.1:${PORT}/health"
echo "  对外地址  : http://<服务器公网IP>:${PORT}/   （需在云控制台安全组放行 TCP ${PORT}）"
echo "  日志      : pm2 logs skb-server"
echo "  重启      : pm2 restart skb-server"
echo "  开机自启  : pm2 startup   （按提示执行输出的 sudo 命令后）pm2 save"
