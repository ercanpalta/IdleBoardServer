@echo off
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)
title IdleBoard Sunucu Servisini Baslat
echo IdleBoard Sunucusu arka planda baslatiliyor...
schtasks /run /tn "IdleBoardServer"
if %errorlevel% equ 0 (
    echo [OK] Sunucu basariyla baslatildi.
) else (
    echo [HATA] Sunucu baslatilamadi. Yonetici olarak calistirmayi deneyin.
)
timeout /t 3 >nul
