#!/bin/bash
# KIS 백테스팅 시스템 통합 실행 스크립트
# Frontend: http://localhost:3300 (Next.js)
# Backend:  http://localhost:8003 (FastAPI)

# 종료 시 백그라운드 프로세스들도 함께 종료하도록 설정
trap "kill 0" EXIT

# 스크립트 위치 기준 절대 경로 확인
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "================================================"
echo "   KIS 백테스팅 시스템 통합 실행 시작"
echo "================================================"

# 1. 기존 프로세스 정리 (포트 충돌 방지)
echo "[1/4] 기존 프로세스 정리 중..."
lsof -ti:3300 | xargs kill -9 2>/dev/null
lsof -ti:8003 | xargs kill -9 2>/dev/null

# 2. Lean 필수 데이터 체크
SYMBOL_PROPS="$SCRIPT_DIR/.lean-workspace/data/symbol-properties/symbol-properties-database.csv"
if [ ! -f "$SYMBOL_PROPS" ]; then
  echo "[2/4] Lean 필수 데이터 파일 없음 → 설정 스크립트 실행..."
  bash "$SCRIPT_DIR/scripts/setup_lean_data.sh" || { echo "Lean 설정 실패. scripts/setup_lean_data.sh를 확인하세요."; exit 1; }
else
  echo "[2/4] Lean 데이터 상태 확인 완료 (OK)"
fi

# 3. 백엔드 실행 (Port 8003)
echo "[3/4] 백엔드 서버(FastAPI) 시작 중..."
if [ -d "$SCRIPT_DIR/.venv" ]; then
  PYTHON_CMD="$SCRIPT_DIR/.venv/bin/python3"
  echo "   (가상환경 .venv 사용: $PYTHON_CMD)"
else
  PYTHON_CMD="python3"
fi
$PYTHON_CMD -m uvicorn backend.main:app --reload --port 8003 &
BACKEND_PID=$!

# 4. 프론트엔드 실행 (Port 3300)
cd "$SCRIPT_DIR/frontend"
if [ ! -d "node_modules" ]; then
  echo "[4/4] 프론트엔드 node_modules 없음 → npm install 실행..."
  npm install || { echo "npm install 실패."; exit 1; }
fi
echo "[4/4] 프론트엔드(Next.js) 시작 중..."
npm run dev &
FRONTEND_PID=$!

echo "------------------------------------------------"
echo "✅ 모든 서비스가 실행되었습니다!"
echo "- 프론트엔드: http://localhost:3300"
echo "- 백엔드:    http://localhost:8003"
echo "------------------------------------------------"
echo "※ 종료하려면 이 창에서 Ctrl + C를 누르세요."

# 모든 백그라운드 프로세스가 종료될 때까지 대기
wait
