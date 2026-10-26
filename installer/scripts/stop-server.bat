@echo off
title IdleBoard Sunucu Servisini Durdur
echo IdleBoard Sunucusu durduruluyor...
schtasks /end /tn "IdleBoardServer"
if %errorlevel% equ 0 (
    echo [OK] Sunucu durduruldu.
) else (
    echo [HATA] Sunucu durdurulamadi.
)
timeout /t 3 >nul
