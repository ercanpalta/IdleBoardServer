@echo off
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)
title IdleBoard Sunucu Servisini Yeniden Baslat
echo IdleBoard Sunucusu yeniden baslatiliyor...
schtasks /end /tn "IdleBoardServer" >nul 2>&1
timeout /t 1 >nul
schtasks /run /tn "IdleBoardServer"
if %errorlevel% equ 0 (
    echo [OK] Sunucu yeniden baslatildi.
) else (
    echo [HATA] Sunucu baslatilamadi.
)
timeout /t 3 >nul
