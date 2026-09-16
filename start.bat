@echo off
chcp 65001 >nul
cd /d %~dp0
echo 正在启动企业知识库服务...
start "" /b cmd /c "timeout /t 3 >nul & start "" http://127.0.0.1:8000"
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
