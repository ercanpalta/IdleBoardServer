@echo off
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)
title IdleBoard Sunucu Servisini Durdur
echo IdleBoard Sunucusu durduruluyor...
schtasks /end /tn "IdleBoardServer"
if %errorlevel% equ 0 (
    echo [OK] Sunucu durduruldu.
) else (
    echo [HATA] Sunucu durdurulamadi.
)
timeout /t 3 >nul
