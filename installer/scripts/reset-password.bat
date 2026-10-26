@echo off
title IdleBoard Yonetici Parolasi Sifirlama
cd /d "%~dp0"
echo ========================================================
echo        IdleBoard Yonetici Parolasi Sifirlama
echo ========================================================
echo.
"%~dp0node.exe" reset-password.js
echo.
pause
