# 모의투자 환경 안정화 작업 (Task List)

- [x] `kis_auth.py` URL 조립부 `NoneType` 방어 코드 추가
- [x] `kis_backtest/providers/kis/data.py` API 호출 재시도(Retry) 로직 추가
- [x] 모의투자(`vps`)용 `_smartSleep` 시간 상향 조정 (0.5 -> 1.0)
- [x] 백엔드 서버 8003 포트로 우회 및 재기동 완료
- [ ] 브라우저에서 백테스트 완주 최종 검증 (User Action Pending)
