@echo off
rem ============================================================
rem  SKB offline client pack builder (Windows)
rem  Usage: double-click, then enter the server address
rem  (default: ws://47.97.87.169/ws), or pass it as arg 1.
rem ============================================================
setlocal
cd /d "%~dp0..\.."

set "WS=%~1"
if "%WS%"=="" set "WS=ws://47.97.87.169/ws"

echo ==^> [1/3] Building client (server: %WS%)
cd client
set "VITE_WS_URL=%WS%"
call npm run build
if errorlevel 1 (
  echo Build failed. Run: cd client ^&^& npm install
  pause
  exit /b 1
)
set "VITE_WS_URL="
cd ..

echo ==^> [2/3] Assembling offline package directory
node deploy/offline/assemble-offline.mjs
if errorlevel 1 (
  echo Assemble failed.
  pause
  exit /b 1
)

echo ==^> [3/3] Compressing to zip
set "OUT=deploy\offline\out\skb-client-offline"
if exist "%OUT%.zip" del "%OUT%.zip"
powershell -NoProfile -Command "Compress-Archive -Path '%OUT%\*' -DestinationPath '%OUT%.zip' -Force"
if exist "%OUT%.zip" (
  echo.
  echo Done: %OUT%.zip
  echo Ship this zip to players: unzip -^> run start-client.bat -^> open http://localhost:8080
) else (
  echo Zip failed, use the directory %OUT% instead.
)
pause
