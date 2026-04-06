# 모의투자 환경 TypeError 및 500 에러 해결 계획

모의투자 계좌의 엄격한 제약 사항(TPS)으로 인해 발생하는 API 호출 실패와 그로 인한 `NoneType` 연산 오류를 해결하기 위한 계획입니다.

## User Review Required

> [!IMPORTANT]
> **모의투자 대기 시간(Sleep) 최적화**: 모의투자 환경에서의 안정성을 위해 API 호출 간격을 조정합니다. 또한, 설정값이 누락되었을 때 발생하는 불친절한 Python 에러 메시지를 명확한 안내 메시지로 변경합니다.

## Proposed Changes

### 1. 인증 및 통신 계층 (`kis_auth.py`)
- **[MODIFY] `_url_fetch` 함수**: `my_url`이 `None`인 경우 TypeError를 내지 않고 "인증 정보를 불러올 수 없습니다"라는 명확한 예외를 발생시키도록 방어 코드를 추가합니다.
- **[MODIFY] `changeTREnv` 함수**: 모의투자(`vps`) 환경 진입 시 URL 설정이 누락되지 않도록 체크 로직을 강화합니다.

### 2. 데이터 수집 계층 (`data.py`)
- **[MODIFY] `KISDataProvider`**: 500 에러 발생 시 즉시 종료하지 않고, 약간의 대기 후 최대 3회까지 재시도(Retry)하는 로직을 추가하여 모의투자 제한을 회피합니다.

### 3. 환경 설정 점검
- `kis_devlp.yaml`의 모의투자 서버 주소 설정을 다시 한번 확인하고, 누락된 경우 기본값을 수동으로 매핑합니다.

---

## Verification Plan

### Automated Tests
1. 백엔드에서 `bt_momentum` 전략 재실행 시 500 에러 발생 여부 모니터링.
2. 재시도 로직이 작동하여 데이터를 끝까지 받아오는지 로그 확인.

### Manual Verification
1. `TypeError`가 사라지고, 대신 인증 오류 혹은 데이터 부족에 대한 명확한 메시지가 웹 UI에 표시되는지 확인.
