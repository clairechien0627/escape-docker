# ═══════════════════════════════════════════
#   Escape Docker — Windows PowerShell 啟動腳本
# ═══════════════════════════════════════════

Write-Host ""
Write-Host "  ╔═══════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║      🐳  Escape Docker  🐳             ║" -ForegroundColor Green
Write-Host "  ║  Linux 與 Docker 互動式密室逃脫系統    ║" -ForegroundColor Green
Write-Host "  ╚═══════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

# ── 建立 .env（如果不存在）
if (-not (Test-Path ".env")) {
    Write-Host "[!] .env 不存在，從 .env.example 複製..." -ForegroundColor Yellow
    Copy-Item ".env.example" ".env"
    Write-Host "[✓] 已建立 .env" -ForegroundColor Green
}

# ── 先確認 Docker 是否在跑 ──
Write-Host "Checking Docker..." -ForegroundColor Cyan
$dockerCheck = docker info 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "❌ Docker Desktop 沒有在執行！" -ForegroundColor Red
    Write-Host ""
    Write-Host "請先：" -ForegroundColor Yellow
    Write-Host "  1. 開啟 Docker Desktop（在開始選單搜尋）" -ForegroundColor Yellow
    Write-Host "  2. 等右下角鯨魚圖示變綠色" -ForegroundColor Yellow
    Write-Host "  3. 再執行 .\start.ps1" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}
Write-Host "[✓] Docker is running" -ForegroundColor Green

Write-Host "[1/3] Building images (limited to 4 parallel, this may take 10-15 min first run)..." -ForegroundColor Cyan
$env:BUILDKIT_MAX_PARALLELISM = "4"
docker compose build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build 失敗，請查看上方錯誤訊息" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[2/3] Starting services..." -ForegroundColor Cyan
docker compose up -d

Write-Host ""
Write-Host "[3/3] Waiting for services..." -ForegroundColor Cyan
Start-Sleep -Seconds 3

Write-Host ""
Write-Host "=== Service Status ===" -ForegroundColor White
docker compose ps

# ── 讀取 ADMIN_TOKEN
$adminToken = "admin_secret_change_me"
if (Test-Path ".env") {
    $line = Get-Content ".env" | Where-Object { $_ -match "^ADMIN_TOKEN=" }
    if ($line) { $adminToken = $line -replace "^ADMIN_TOKEN=", "" }
}

Write-Host ""
Write-Host "✅ Escape Docker 已啟動！" -ForegroundColor Green
Write-Host ""
Write-Host "  🌐 遊戲首頁：    http://localhost" -ForegroundColor Cyan
Write-Host "  📊 排行榜：      http://localhost/scoreboard.html" -ForegroundColor Cyan
Write-Host "  🗺️  房間地圖：    http://localhost/map.html" -ForegroundColor Cyan
Write-Host "  🔴 Admin Panel：  http://localhost/admin.html" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Admin Token: $adminToken" -ForegroundColor Yellow
Write-Host ""
Write-Host "  停止系統：docker compose down" -ForegroundColor DarkGray
Write-Host ""
