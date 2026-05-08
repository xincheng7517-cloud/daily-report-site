@echo off
chcp 65001 > nul
echo ================================
echo   日报网站 + cpolar 一键启动
echo ================================
echo.

REM 检查 node
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [错误] 未找到 node，请先安装 Node.js
  pause & exit /b 1
)

REM 检查 cpolar
where cpolar >nul 2>nul
if %errorlevel% neq 0 (
  echo [提示] 未找到 cpolar，请先安装：https://www.cpolar.com/download
  echo 安装后重新运行此脚本，或先运行 start.bat 仅启动本地服务
  pause & exit /b 1
)

REM 安装依赖
if not exist "node_modules" (
  echo [1/3] 正在安装依赖...
  call npm install
)

REM 启动 node 服务（后台）
echo [2/3] 启动日报网站服务...
start "DailyReport-Server" cmd /k "node server.js"

REM 等待服务启动
timeout /t 3 > nul

REM 启动 cpolar 隧道
echo [3/3] 启动 cpolar 内网穿透...
echo.
echo 提示：首次使用请先执行 cpolar authtoken 命令进行认证
echo       固定域名需在 C:\Users\%USERNAME%\.cpolar\cpolar.yml 中配置
echo.
start "cpolar-Tunnel" cmd /k "cpolar http 3000"

echo.
echo ================================
echo  服务已启动！
echo  网站地址将在 cpolar 窗口中显示
echo  按任意键关闭所有窗口...
echo ================================
pause > nul

taskkill /f /fi "WINDOWTITLE eq DailyReport-Server*" > nul
taskkill /f /fi "WINDOWTITLE eq cpolar-Tunnel*" > nul
