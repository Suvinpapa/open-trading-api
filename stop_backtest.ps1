# KIS 오픈 API 백테스팅 시스템 종료 스크립트 (Windows PowerShell)

# 한글 깨짐 방지: 콘솔 출력을 UTF-8로 설정
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "`n>>> 백테스팅 시스템(포트 8003, 3300)을 종료합니다..." -ForegroundColor Yellow

# 1. 백엔드 (8003) 종료
$BackendConn = Get-NetTCPConnection -LocalPort 8003 -ErrorAction SilentlyContinue
if ($BackendConn) {
    Write-Host ">>> 백엔드(8003) 프로세스 종료 중..." -ForegroundColor Gray
    $BackendConn | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}

# 2. 프론트엔드 (3300) 종료
$FrontendConn = Get-NetTCPConnection -LocalPort 3300 -ErrorAction SilentlyContinue
if ($FrontendConn) {
    Write-Host ">>> 프론트엔드(3300) 프로세스 종료 중..." -ForegroundColor Gray
    $FrontendConn | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}

Write-Host ">>> 모든 서비스가 종료되었습니다.`n" -ForegroundColor Green
