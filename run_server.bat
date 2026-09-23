@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   x公司知识库 - 启动服务
echo   地址: http://127.0.0.1:8688
echo ============================================
echo.
echo [1/2] 检查 8688 端口是否被占用...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8688" ^| findstr "LISTENING"') do (
  echo     端口被 PID %%a 占用，正在释放...
  taskkill /F /PID %%a >nul 2>&1
)
echo [2/2] 启动服务（改代码会自动重载）...
echo.
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8688 --reload
pause
