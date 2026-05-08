@echo off
chcp 65001 > nul
echo ================================
echo   团队日报网站 - 启动脚本
echo ================================
echo.

REM 检查 node 是否可用
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [错误] 未找到 node，请先安装 Node.js
  echo 下载地址：https://nodejs.org/
  pause
  exit /b 1
)

REM 安装依赖
if not exist "node_modules" (
  echo [1/3] 首次运行，正在安装依赖（约1-2分钟）...
  call npm install
  if %errorlevel% neq 0 (
    echo [错误] 依赖安装失败，请检查网络或手动运行 npm install
    pause
    exit /b 1
  )
  echo 依赖安装完成！
) else (
  echo [1/3] 依赖已存在，跳过安装
)

echo.
echo [2/3] 正在启动服务...
echo.
echo 启动后访问：
echo   本机：  http://localhost:3000
echo   局域网：http://你的IP:3000
echo.
echo 按 Ctrl+C 停止服务
echo ================================
echo.

node server.js
pause
