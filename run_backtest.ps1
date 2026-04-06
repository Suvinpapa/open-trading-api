# KIS 오픈 API 백테스팅 시스템 통합 실행 스크립트 (Windows PowerShell)

# ---------------------------------------------------------
# 설정 (안정화된 포트 및 환경)
# ---------------------------------------------------------
$PORT_BACKEND = 8003
$PORT_FRONTEND = 3300
$ROOT_DIR = Get-Location
$BACKTESTER_DIR = Join-Path $ROOT_DIR "backtester"
$FRONTEND_DIR = Join-Path $ROOT_DIR "backtester/frontend"
$PYTHON_PATH = Join-Path $ROOT_DIR "backtester/.venv/Scripts/python.exe"

Write-Host "`n>>> KIS 오픈 API 백테스팅 시스템을 시작합니다..." -ForegroundColor Green
Write-Host ">>> 백엔드 포트: $PORT_BACKEND"
Write-Host ">>> 프론트엔드 포트: $PORT_FRONTEND" -ForegroundColor Cyan

# ---------------------------------------------------------
# 1. 백엔드(FastAPI) 실행
# ---------------------------------------------------------
Write-Host "`n[1/2] 백엔드 서버를 시작합니다..." -ForegroundColor Yellow
$BackendArgs = "-m uvicorn backend.main:app --host 0.0.0.0 --port $PORT_BACKEND --reload"

# Start-Process로 실행 (로그 파일로 출력 유도 가능)
Start-Process -FilePath $PYTHON_PATH -ArgumentList $BackendArgs -WorkingDirectory $BACKTESTER_DIR -NoNewWindow

Start-Sleep -Seconds 3

# ---------------------------------------------------------
# 2. 프론트엔드(Next.js) 실행
# ---------------------------------------------------------
Write-Host "[2/2] 프론트엔드를 시작합니다..." -ForegroundColor Yellow
# npx는 shell 명령어이므로 powershell을 통해 실행
$FrontendArgs = "/c npx next dev -p $PORT_FRONTEND"
Start-Process -FilePath "cmd.exe" -ArgumentList $FrontendArgs -WorkingDirectory $FRONTEND_DIR -NoNewWindow

Start-Sleep -Seconds 5

# ---------------------------------------------------------
# 3. 상태 확인
# ---------------------------------------------------------
Write-Host "`n>>> 모든 서비스 시작 명령이 전달되었습니다." -ForegroundColor Green
Write-Host ">>> [프론트엔드]: http://localhost:$PORT_FRONTEND" -ForegroundColor White
Write-Host ">>> [백엔드]:     http://localhost:$PORT_BACKEND" -ForegroundColor White
Write-Host ">>> [API 문서]:  http://localhost:$PORT_BACKEND/api/docs" -ForegroundColor Gray

Write-Host "`n팁: 별도의 창이 뜨지 않으며 현재 터미널을 공유하거나 백그라운드에서 동작합니다.`n" -ForegroundColor DarkGray
