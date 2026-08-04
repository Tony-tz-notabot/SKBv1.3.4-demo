@echo off
chcp 65001 >nul
rem ============================================================
rem  SKB 客户端离线包一键打包（Windows）
rem  用法：双击运行，按提示输入云服务器地址（默认 ws://47.97.87.169/ws）
rem ============================================================
setlocal
cd /d "%~dp0..\.."

set "WS=%~1"
if "%WS%"=="" set "WS=ws://47.97.87.169/ws"

echo ==^> [1/3] 构建客户端（服务器地址：%WS%）
cd client
set "VITE_WS_URL=%WS%"
call npm run build
if errorlevel 1 ( echo 构建失败，请先确保 client\node_modules 已安装：cd client ^&^& npm install & pause & exit /b 1 )
set "VITE_WS_URL="
cd ..

echo ==^> [2/3] 组装离线包目录
node deploy/offline/assemble-offline.mjs
if errorlevel 1 ( echo 组装失败 & pause & exit /b 1 )

echo ==^> [3/3] 压缩为 zip
set "OUT=deploy\offline\out\skb-client-offline"
if exist "%OUT%.zip" del "%OUT%.zip"
powershell -NoProfile -Command "Compress-Archive -Path '%OUT%\*' -DestinationPath '%OUT%.zip' -Force"
if exist "%OUT%.zip" (
  echo.
  echo 打包完成：%OUT%.zip
  echo 将该 zip 发给客户：解压 -^> 双击「启动客户端.bat」-^> 浏览器打开 http://localhost:8080
) else (
  echo 压缩失败，可直接使用目录 %OUT%
)
pause
