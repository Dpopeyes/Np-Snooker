@echo off
chcp 65001 >nul
title Np-Snooker Real-time System
echo ======================================================
echo    🎱 Np-Snooker Server (ระบบซิงก์ข้อมูลทุกอุปกรณ์)
echo ======================================================
echo กำลังเปิดระบบและเชื่อมต่อเบราว์เซอร์...
echo.

start "" "http://localhost:3000"
node server.js

pause
