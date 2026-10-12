@echo off
chcp 65001 > nul
title Financial Advisor Website - Startup Script

echo.
echo ========================================================
echo    WEBSITE TU VAN TAI CHINH
echo    Financial Advisor Website with AI Integration
echo ========================================================
echo.

:: Kiem tra Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo KHONG TIM THAY NODE.JS
    echo.
    echo Vui long cai dat Node.js tu: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo Node.js: 
node --version
echo npm:
npm --version
echo.

:: Kiem tra node_modules
if not exist "node_modules\" (
    echo Dang cai dat dependencies...
    echo.
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo Cai dat that bai!
        pause
        exit /b 1
    )
    echo.
    echo Cai dat thanh cong!
    echo.
)

:: Kiem tra file .env
if not exist ".env" (
    echo.
    echo CANH BAO: Chua tim thay file .env
    echo.
    echo Ban co muon tao file .env tu template khong? (Y/N)
    choice /c YN /n
    if errorlevel 2 goto skip_env
    if errorlevel 1 (
        copy .env.example .env
        echo.
        echo Da tao file .env
        echo.
        echo VUI LONG DIEN API KEYS VAO FILE .env
        echo.
        echo Nhan Enter de mo file .env...
        pause > nul
        notepad .env
        echo.
        echo Sau khi dien API keys, nhan Enter de tiep tuc...
        pause > nul
    )
)

:skip_env

:: Chay server
echo.
echo DANG KHOI DONG SERVER...
echo.
echo --------------------------------------------------------
echo.
echo   Website se chay tai: http://localhost:3000
echo.
echo   De dung server: Nhan CTRL + C
echo.
echo --------------------------------------------------------
echo.

:: Doi 2 giay roi mo browser
timeout /t 2 /nobreak > nul
start http://localhost:3000

:: Chay server
call npm start

pause
