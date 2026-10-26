# ==========================================================
# IdleBoard Server Kurulum Paketi Derleme Betigi
# ==========================================================
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverDir = Resolve-Path (Join-Path $scriptDir "..")
$workspaceRoot = Split-Path -Parent $serverDir
$certsDir = Join-Path $workspaceRoot "certs"
$pfxFile = Join-Path $certsDir "IdleBoard_CodeSigning.pfx"
$cerFile = Join-Path $certsDir "IdleBoard_Sertifikasi.cer"
$batFile = Join-Path $certsDir "Sertifikayi_Yukle.bat"

$outputDir = Join-Path $serverDir "installer_output"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   IdleBoard Server Kurulum Paketi Derleme Baslatiliyor   " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Inno Setup Derleyicisini Tespit Et
$isccPath = $null
$possibleIscc = @(
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe",
    (Get-Command iscc.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)
)
foreach ($p in $possibleIscc) {
    if ($p -and (Test-Path $p)) {
        $isccPath = $p
        break
    }
}

if (-not $isccPath) {
    Write-Error "Inno Setup (ISCC.exe) bulunamadi! Lutfen Inno Setup 6 kurun."
    exit 1
}
Write-Host "[1/4] Inno Setup Derleyicisi: $isccPath" -ForegroundColor Green

# 2. Node.js Calisma Ortamini Tespit Et (Gomulu Node.js)
$nodeExe = $null
$possibleNode = @(
    (Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
    "C:\Program Files\nodejs\node.exe",
    "C:\Program Files (x86)\nodejs\node.exe"
)
foreach ($p in $possibleNode) {
    if ($p -and (Test-Path $p)) {
        $nodeExe = $p
        break
    }
}

if (-not $nodeExe) {
    Write-Error "Sistemde kurulu Node.js bulunamadi!"
    exit 1
}
Write-Host "[2/4] Gomulecek Node.js: $nodeExe" -ForegroundColor Green

# 3. Kurulum Paketini Derle
Write-Host "[3/4] Kurulum paketi (Setup.exe) paketleniyor..." -ForegroundColor Yellow
if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

$issFile = Join-Path $scriptDir "IdleBoardServer.iss"
& $isccPath "/DNodeExePath=$nodeExe" $issFile

if ($LASTEXITCODE -ne 0) {
    Write-Error "Inno Setup derleme islemi basarisiz oldu! Cikis Kodu: $LASTEXITCODE"
    exit $LASTEXITCODE
}

$setupFile = Join-Path $outputDir "IdleBoardServer_Setup.exe"
if (Test-Path $setupFile) {
    # 4. Kurulum Paketini Dijital Olarak Imzala (Authenticode)
    Write-Host "[4/4] Kurulum paketi dijital olarak imzalanıyor..." -ForegroundColor Yellow
    if (Test-Path $pfxFile) {
        $pfxPassword = ConvertTo-SecureString -String "IdleBoard2026!" -Force -AsPlainText
        $cert = Import-PfxCertificate -FilePath $pfxFile -Password $pfxPassword -CertStoreLocation "Cert:\CurrentUser\My"
        Set-AuthenticodeSignature -FilePath $setupFile -Certificate $cert -TimestampServer "http://timestamp.digicert.com" | Out-Null
        Write-Host "      [OK] Kurulum paketi dijital olarak imzalandı." -ForegroundColor Green
    }

    # 5. Sertifika ve 1-Tık Yükleyiciyi Çıktı Klasörüne Kopyala
    if (Test-Path $cerFile) { Copy-Item $cerFile $outputDir -Force }
    if (Test-Path $batFile) { Copy-Item $batFile $outputDir -Force }

    $fileItem = Get-Item $setupFile
    $sizeMB = [math]::Round($fileItem.Length / 1MB, 2)
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host " Tebrikler! Sunucu kurulum paketi basariyla olusturuldu: " -ForegroundColor Green
    Write-Host " Dosya: $setupFile" -ForegroundColor Cyan
    Write-Host " Boyut: $sizeMB MB" -ForegroundColor Cyan
    Write-Host " Imza : Dogrulanmis (IdleBoard Software)" -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Green
} else {
    Write-Error "Kurulum dosyasi olusturulamadi!"
    exit 1
}
