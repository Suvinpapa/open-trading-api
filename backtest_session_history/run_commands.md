# 🛠️ 백테스팅 시스템 실행 가이드 (Startup Commands)

이 문서는 KIS 오픈 API 백테스팅 시스템(프론트엔드/백엔드)을 가장 빠르고 안정적으로 실행하기 위한 명령어들을 정리한 것입니다. 전용 스크립트(`run_backtest.ps1`)와 수동 실행 방법을 모두 포함합니다.

---

## ⚡ 1. 전용 스크립트로 실행 (추천)

루트 디렉토리에 있는 **`run_backtest.ps1`** 파일을 실행하면 모든 서비스가 한 번에 백그라운드로 시작됩니다.

```powershell
.\run_backtest.ps1
```

- **백엔드 포트**: 8003
- **프론트엔드 포트**: 3300
- **종료**: `Stop-Job *` 명령으로 백그라운드 잡을 종료할 수 있습니다.

---

## 🏗️ 2. 수동 실행 (Manual Commands)

서비스별로 별도의 터미널에서 실행하고 로그를 확인하고 싶을 때 사용합니다.

### 🔹 백엔드 (FastAPI)
- **위치**: `c:\Gemini_Test\open-trading-api\backtester`
- **명령어**:
```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 0.0.0.0 --port 8003 --reload
```

### 🔹 프론트엔드 (Next.js)
- **위치**: `c:\Gemini_Test\open-trading-api\backtester\frontend`
- **명령어**:
```powershell
npx next dev -p 3300
```

---

## 🛡️ 전용 설정 요약 (포트 고정 이유)

| 항목 | 고정된 포트 | 비고 |
| :--- | :--- | :--- |
| **Backend** | `8003` | Next.js Proxy 오작동(500 에러)을 우회하기 위해 8003으로 직접 통신 |
| **Frontend** | `3300` | 외부 모바일 기기 접속 및 CORS 화이트리스트 보안 통과를 위해 3300 고정 |

---
*최종 업데이트: 2026-04-07*
