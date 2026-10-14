@echo off
chcp 65001 > nul
echo ===================================================
echo     DANG KHOI DONG PYTHON REALTIME DASHBOARD
echo ===================================================
echo.
echo Server dang chay tai: http://localhost:8000
echo Nhan Ctrl+C de dung server.
echo.
python -m uvicorn market_overview:app --host 0.0.0.0 --port 8000 --reload
pause
