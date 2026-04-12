"""Backtest API Routes.

Lean Docker 기반 백테스트 실행.
"""

import asyncio
import logging
from typing import Any, Dict, List, Optional
from datetime import date, datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.schemas.backtest import (
    BacktestRequest,
    BacktestResponse,
    BulkBacktestRequest,
    BulkBacktestResult,
    BulkBacktestResponse,
)
from kis_backtest.strategies.registry import StrategyRegistry
from kis_backtest.codegen.generator import LeanCodeGenerator, CodeGenConfig
from kis_backtest.lean.executor import LeanExecutor, LeanRun
from kis_backtest.lean.project_manager import LeanProjectManager
from kis_backtest.lean.data_converter import DataConverter
from kis_backtest.lean.result_formatter import parse_lean_value
import kis_backtest.strategies.preset  # 전략 자동 등록
from google import genai
from google.genai import types


router = APIRouter(
    prefix="/backtest",
    tags=["backtest"],
)

logger = logging.getLogger(__name__)


# 전역 변수: 최근 벤치마크 로드 실패 사유 (진단용)
_last_benchmark_error = "NONE"

def _load_benchmark_curve(
    workspace: Path,
    start_date: str,
    end_date: str,
) -> Optional[Dict[str, float]]:
    """KOSPI 벤치마크 수익률 곡선 로드 (심층 경로 탐색)"""
    # 1. 시스템 루트 및 관련 경로 집합 정의
    current_file_path = Path(__file__).resolve()
    backtester_dir = current_file_path.parent.parent.parent
    project_root = backtester_dir.parent

    # 수색할 경로 목록 (우선순위 순)
    possible_paths = [
        backtester_dir / ".lean-workspace" / "data" / "index" / "krx" / "daily" / "kospi.csv",
        backtester_dir / "data" / "index" / "krx" / "daily" / "kospi.csv",
        project_root / "backtester" / ".lean-workspace" / "data" / "index" / "krx" / "daily" / "kospi.csv",
        workspace / "data" / "index" / "krx" / "daily" / "kospi.csv",
        Path("backtester/.lean-workspace/data/index/krx/daily/kospi.csv"),
        Path(".lean-workspace/data/index/krx/daily/kospi.csv"),
    ]
    
    csv_path = None
    checked_paths = []
    for p in possible_paths:
        abs_p = p.resolve() if p.is_absolute() else p.absolute()
        checked_paths.append(str(abs_p))
        if p.exists():
            csv_path = p
            break

    if not csv_path:
        error_info = f"KOSPI_FILE_NOT_FOUND (Checked {len(checked_paths)} locations)"
        logging.getLogger(__name__).error(f"{error_info}: {checked_paths}")
        # 전역 컨텍스트에 에러 정보 저장 (응답 메시지용)
        global _last_benchmark_error
        _last_benchmark_error = error_info
        return None

    logger.info(f"[Benchmark] KOSPI 데이터 발견: {csv_path}")

    try:
        # CSV 파싱 (YYYYMMDD,open,high,low,close,volume)
        req_start = datetime.strptime(start_date, "%Y-%m-%d").date()
        req_end = datetime.strptime(end_date, "%Y-%m-%d").date()

        all_prices = {}
        with open(csv_path, "r", encoding="utf-8") as f:
            for line in f:
                parts = line.strip().split(",")
                if len(parts) < 5: continue
                try:
                    dt = datetime.strptime(parts[0], "%Y%m%d").date()
                    if dt <= req_end:
                        all_prices[dt] = float(parts[4])
                except (ValueError, IndexError): continue

        if not all_prices:
            logging.getLogger(__name__).warning("[Benchmark] CSV 파일에 유효한 데이터가 없습니다.")
            return None

        # 시작 가격 결정: 백테스트 시작일(req_start) 이후 가장 빠른 거래일의 가격 사용
        valid_dates = sorted([d for d in all_prices.keys() if d >= req_start])
        if not valid_dates:
            # 시작일 이후 데이터가 없으면 전체 데이터 중 마지막을 기준으로 시도 (폴백)
            valid_dates = sorted([d for d in all_prices.keys()])
            if not valid_dates: return None
            
        base_price = all_prices[valid_dates[0]]
        if base_price <= 0: return None

        curve = {}
        # 실제 표시할 범위는 req_start부터 req_end까지
        display_dates = sorted([d for d in all_prices.keys() if req_start <= d <= req_end])
        for dt in display_dates:
            pct = ((all_prices[dt] - base_price) / base_price) * 100
            curve[dt.strftime("%Y-%m-%d")] = round(pct, 2)

        logging.getLogger(__name__).info(f"[Benchmark] {len(curve)}개의 포인트 로드 완료 (기준가: {base_price} @ {valid_dates[0]})")
        return curve

    except Exception as e:
        logging.getLogger(__name__).warning(f"[Benchmark] 벤치마크 로드 실패: {e}")
        return None


def _extract_equity_curve(
    result: Dict[str, Any],
    resolution: str = "daily",
    max_points: int = 2000
) -> Dict[str, float]:
    """Lean 결과 JSON에서 자산 곡선 데이터를 추출 및 샘플링"""
    equity_curve = {}
    charts = result.get("charts", {})
    
    # Lean 기본 차트 (Strategy Equity) 사용
    target_chart = charts.get("Strategy Equity", {})
    series = target_chart.get("series", {})
    equity_series = series.get("Equity", {})
    values = equity_series.get("values", [])
    
    if not values:
        return {}
        
    # 샘플링
    total_points = len(values)
    step = max(1, total_points // max_points)
    
    for i, point in enumerate(values):
        if i % step != 0 and i != total_points - 1:
            continue
            
        if isinstance(point, list) and len(point) >= 2:
            try:
                dt = datetime.fromtimestamp(point[0])
                val = point[4] if len(point) > 4 else point[1]
                
                if resolution == "daily":
                    equity_curve[dt.strftime("%Y-%m-%d")] = float(val)
                else:
                    if dt.hour == 0 and dt.minute == 0:
                        continue
                    equity_curve[dt.strftime("%Y-%m-%d %H:%M:00")] = float(val)
            except:
                pass
    return equity_curve


def _lean_run_to_api_response(
    lean_run: LeanRun,
    strategy_name: str,
    symbols: List[str],
    start_date: str,
    end_date: str,
    initial_capital: float,
    resolution: str = "daily",
    workspace: Optional[Path] = None,
) -> Dict[str, Any]:
    """LeanRun을 프론트엔드 API 응답 형식으로 변환"""
    if not lean_run.success:
        raise ValueError(lean_run.error or "백테스트 실패")

    result = lean_run.load_result()
    stats = lean_run.get_statistics()

    # 기본 통계
    net_profit_pct = parse_lean_value(stats.get("Net Profit", 0))
    start_equity = parse_lean_value(stats.get("Start Equity", initial_capital))
    end_equity = parse_lean_value(stats.get("End Equity", initial_capital))
    net_profit = end_equity - start_equity

    # 자산 곡선 추출 (리팩토링된 헬퍼 사용)
    equity_curve = _extract_equity_curve(result, resolution)



    # 거래 내역
    orders = result.get("orders", {})
    if isinstance(orders, dict):
        orders = list(orders.values())
    trades = []
    for order in orders:
        if order.get("status") != 3:  # Filled only
            continue
        symbol_data = order.get("symbol", {})
        symbol_code = symbol_data.get("value", "") if isinstance(symbol_data, dict) else str(symbol_data)
        direction = order.get("direction", 0)
        
        # 거래 시간 포맷 (KST 기준)
        order_time_str = order.get("time", "")
        try:
            if "T" in order_time_str:
                trade_dt = datetime.fromisoformat(order_time_str.replace("Z", "+00:00"))
                # 시스템 로컬 타임존(KST)으로 변환
                trade_dt_local = trade_dt.astimezone().replace(tzinfo=None)
                if resolution == "daily":
                    formatted_time = trade_dt_local.strftime("%Y-%m-%d")
                else:
                    formatted_time = trade_dt_local.strftime("%Y-%m-%d %H:%M:00")
            else:
                formatted_time = order_time_str
        except Exception:
            formatted_time = order_time_str


        trades.append({
            "symbol": symbol_code.upper(),
            "direction": "Buy" if direction == 0 else "Sell",
            "quantity": abs(order.get("quantity", 0)),
            "price": order.get("price", 0),
            "time": formatted_time,
        })


    # 종목별 주가 곡선 추출 (데이터 폴더에서 읽기)
    # 핵심: 날짜(YYYY-MM-DD) 키로 종가를 항상 저장하여 프론트엔드의 dateOnly 폴백이 100% 작동하게 함
    price_curves = {}
    if workspace and equity_curve:
        data_dir = workspace / "data" / "equity" / "krx" / resolution
        if data_dir.exists():
            # equity_curve에 포함된 날짜들만 필터링 (YYYYMMDD 형식)
            target_dates = set(k[:10].replace("-", "") for k in equity_curve.keys())
            
            for symbol in symbols:
                symbol_upper = symbol.upper()
                price_curves[symbol_upper] = {}
                csv_file = data_dir / f"{symbol.lower()}.csv"
                if not csv_file.exists():
                    continue
                
                try:
                    with open(csv_file, "r") as f:
                        for line in f:
                            # 날짜 프리픽스 체크 (빠른 스킵)
                            if line[:8] not in target_dates:
                                continue
                                
                            parts = line.strip().split(",")
                            if len(parts) < 5: continue
                            
                            row_date_raw = parts[0]
                            close_price = float(parts[4])
                            
                            # 항상 날짜 키(YYYY-MM-DD)로 저장 (마지막 값이 종가가 됨)
                            date_key = f"{row_date_raw[:4]}-{row_date_raw[4:6]}-{row_date_raw[6:8]}"
                            price_curves[symbol_upper][date_key] = close_price
                except Exception as e:
                    logger.warning(f"[Price_Curve] {symbol} 데이터 파싱 실패: {e}")


    # 종목 정보 (명칭) 추가
    from backend.routes.symbols import get_symbol_by_code
    symbol_names = {}
    for symbol in symbols:
        info = get_symbol_by_code(symbol)
        if info:
            symbol_names[symbol] = info["name"]
        else:
            symbol_names[symbol] = symbol

    return {
        "run_id": lean_run.project.run_id,
        "strategy_name": strategy_name,
        "start_date": start_date,
        "end_date": end_date,
        "initial_capital": initial_capital,
        "final_capital": end_equity,
        "net_profit": net_profit,
        "net_profit_percent": net_profit_pct,
        "metrics": {
            "basic": {
                "total_return": net_profit_pct,
                "annual_return": parse_lean_value(stats.get("Compounding Annual Return", 0)),
                "max_drawdown": parse_lean_value(stats.get("Drawdown", 0)),
                "start_equity": start_equity,
                "end_equity": end_equity,
            },
            "risk": {
                "sharpe_ratio": parse_lean_value(stats.get("Sharpe Ratio", 0)),
                "sortino_ratio": parse_lean_value(stats.get("Sortino Ratio", 0)),
                "probabilistic_sharpe": parse_lean_value(stats.get("Probabilistic Sharpe Ratio", 0)),
            },
            "greeks": {
                "alpha": parse_lean_value(stats.get("Alpha", 0)),
                "beta": parse_lean_value(stats.get("Beta", 0)),
            },
            "volatility": {
                "annual_std_dev": parse_lean_value(stats.get("Annual Standard Deviation", 0)),
                "annual_variance": parse_lean_value(stats.get("Annual Variance", 0)),
            },
            "benchmark": {
                "information_ratio": parse_lean_value(stats.get("Information Ratio", 0)),
                "tracking_error": parse_lean_value(stats.get("Tracking Error", 0)),
                "treynor_ratio": parse_lean_value(stats.get("Treynor Ratio", 0)),
            },
            "trading": {
                "total_orders": int(parse_lean_value(stats.get("Total Orders", 0))),
                "win_rate": parse_lean_value(stats.get("Win Rate", 0)),
                "loss_rate": parse_lean_value(stats.get("Loss Rate", 0)),
                "avg_win": parse_lean_value(stats.get("Average Win", 0)),
                "avg_loss": parse_lean_value(stats.get("Average Loss", 0)),
                "profit_loss_ratio": parse_lean_value(stats.get("Profit-Loss Ratio", 0)),
                "expectancy": parse_lean_value(stats.get("Expectancy", 0)),
            },
            "other": {
                "total_fees": parse_lean_value(stats.get("Total Fees", 0)),
                "portfolio_turnover": parse_lean_value(stats.get("Portfolio Turnover", 0)),
                "drawdown_recovery": parse_lean_value(stats.get("Drawdown Recovery", 0)),
            },
        },
        "equity_curve": equity_curve,
        "price_curves": price_curves,
        "symbol_names": symbol_names,
        "benchmark_curve": _load_benchmark_curve(workspace, start_date, end_date) if workspace else None,
        "trades_count": len(trades),
        "trades": trades,
    }

logger = logging.getLogger(__name__)
router = APIRouter()


def _classify_lean_error(error: str, output: str) -> str:
    """Lean 에러 메시지를 사용자 친화적으로 분류

    Args:
        error: stderr 내용
        output: stdout 내용

    Returns:
        사용자 친화적 에러 메시지
    """
    combined = f"{error} {output}".lower()

    # 데이터 관련
    if "no data" in combined or "data not found" in combined:
        return "종목 데이터가 없습니다. 종목 코드를 확인하거나 다른 기간을 선택해주세요."

    if "invalid symbol" in combined or "unknown symbol" in combined:
        return "잘못된 종목 코드입니다. 종목 코드를 확인해주세요."

    # 지표 관련
    if "indicator" in combined and ("not found" in combined or "undefined" in combined):
        return "지표 초기화 실패. 전략의 지표 설정을 확인해주세요."

    if "update" in combined and "tradebar" in combined:
        return "지표 업데이트 오류. 해당 지표는 TradeBar 데이터가 필요합니다."

    # Python 문법
    if "syntaxerror" in combined or "indentationerror" in combined:
        return "전략 코드 생성 오류. 전략 정의를 확인해주세요."

    if "nameerror" in combined or "attributeerror" in combined:
        return f"전략 실행 오류: 정의되지 않은 변수나 속성 참조. ({error[:100]})"

    # 메모리/타임아웃
    if "timeout" in combined or "타임아웃" in combined:
        return "백테스트 시간 초과. 기간을 줄이거나 전략을 단순화해주세요."

    if "memory" in combined or "out of memory" in combined:
        return "메모리 부족. 백테스트 기간을 줄여주세요."

    # Docker 관련
    if "docker" in combined and ("daemon" in combined or "not running" in combined):
        return "Docker가 실행되지 않습니다. Docker Desktop을 시작해주세요."

    # 일반 에러
    if len(error) > 200:
        return f"백테스트 실패: {error[:200]}..."

    return f"백테스트 실패: {error}"


async def prepare_market_data(
    symbols: List[str],
    start_date: str,
    end_date: str,
    workspace: Path,
    resolution: str = "daily",  # "daily" or "minute"
) -> dict:
    """백테스트용 시장 데이터 준비 (KIS API → Lean CSV)
    
    Returns:
        {"downloaded": [...], "skipped": [...], "errors": [...]}
    """
    from kis_backtest.providers.kis.auth import KISAuth
    from kis_backtest.providers.kis.data import KISDataProvider
    from kis_backtest.models import Resolution
    
    # 해상도에 따른 저장 경로 설정 (대소문자 구분 없이 처리)
    res_lower = resolution.lower()
    res_path = "minute" if res_lower == "minute" else "daily"
    output_dir = workspace / "data" / "equity" / "krx" / res_path
    output_dir.mkdir(parents=True, exist_ok=True)
    
    result = {"downloaded": [], "skipped": [], "errors": []}
    
    # 요청 날짜 파싱
    req_start = datetime.strptime(start_date, "%Y-%m-%d").date()
    req_end = datetime.strptime(end_date, "%Y-%m-%d").date()
    
    # 지표 웜업을 위해 30일 이전부터 데이터 수집
    download_start = req_start - timedelta(days=30)
    
    def check_date_coverage(csv_path: Path, target_start: date, target_end: date) -> bool:
        """CSV 파일이 요청 날짜 범위를 커버하는지 확인"""
        try:
            with open(csv_path, 'r', encoding="utf-8") as f:
                first_line = f.readline().strip()
                if not first_line:
                    return False
                
                # 마지막 줄을 효율적으로 읽기 (전체 파일 로드 없이)
                last_line = first_line
                for line in f:
                    if line.strip():
                        last_line = line.strip()

                # 날짜 추출 — 앞 8자리만 사용 (YYYYMMDD or "YYYYMMDD HH:MM:SS" 모두 대응)
                first_date_str = first_line.split(',')[0].strip()[:8]
                last_date_str = last_line.split(',')[0].strip()[:8]

                first_date = datetime.strptime(first_date_str, "%Y%m%d").date()
                last_date = datetime.strptime(last_date_str, "%Y%m%d").date()

                # 관대한 날짜 체크 (휴장일 고려)
                tolerance_days = 7
                
                # 1. 종료일 체크
                if target_end > last_date + timedelta(days=tolerance_days):
                    return False

                # 2. 시작일 체크 (웜업 기간까지 포함하는지)
                if target_start < first_date:
                    return False

                return True
        except Exception:
            return False

    
    # 이미 있는 파일 확인
    for symbol in symbols:
        csv_path = output_dir / f"{symbol.lower()}.csv"
        if csv_path.exists() and csv_path.stat().st_size > 100:
            # 해상도에 따른 포맷 검증 (분봉인데 시간 정보가 없는 오염된 파일 방지)
            is_valid_format = True
            if res_lower == "minute":
                try:
                    with open(csv_path, 'r') as f:
                        first_line = f.readline()
                        # 분봉 형식은 'YYYYMMDD HH:MM:SS'로 공백이 있어야 함
                        if first_line and ' ' not in first_line.split(',')[0]:
                            is_valid_format = False
                            logger.warning(f"[Data] {symbol} 분봉 파일 포맷 오류(시간 정보 없음)로 삭제")
                except Exception:
                    is_valid_format = False

            if is_valid_format and check_date_coverage(csv_path, download_start, req_end):
                result["skipped"].append(symbol)
                continue
            else:
                logger.info(f"[Data] {symbol} 유효하지 않거나 날짜 범위 불일치로 재다운로드")
                csv_path.unlink(missing_ok=True)
    
    symbols_to_download = [s for s in symbols if s not in result["skipped"]]
    if not symbols_to_download:
        logger.info("[Data] 모든 종목 데이터 캐시 사용")
        return result
    
    # KIS 인증
    try:
        auth = KISAuth.from_env()
        provider = KISDataProvider(auth)
    except Exception as e:
        logger.warning(f"[Data] KIS 인증 실패: {e}")
        for s in symbols_to_download:
            result["errors"].append({"symbol": s, "error": str(e)})
        return result
    
    # 데이터 다운로드
    for symbol in symbols_to_download:
        try:
            logger.info(f"[Data] 다운로드 중: {symbol} ({resolution}, 웜업포함)")
            
            bars = []
            if resolution.lower() == "minute":
                current_date = download_start
                import time
                while current_date <= req_end:
                    if current_date.weekday() < 5:
                        day_bars = provider.get_history(symbol, current_date, current_date, Resolution.MINUTE)
                        if day_bars:
                            bars.extend(day_bars)
                    current_date += timedelta(days=1)
                    if current_date <= req_end:
                        time.sleep(0.1)
            else:
                bars = provider.get_history(symbol, download_start, req_end, Resolution.DAILY)
            
            if bars:
                DataConverter.bars_to_lean_csv(bars, symbol, output_dir, resolution=resolution)
                result["downloaded"].append(symbol)
                logger.info(f"[Data] 완료: {symbol} ({len(bars)} bars, 웜업포함)")
            else:
                result["errors"].append({"symbol": symbol, "error": "데이터 없음"})
        except Exception as e:
            logger.error(f"[Data] {symbol} 다운로드 실패: {e}")
            result["errors"].append({"symbol": symbol, "error": str(e)})
    
    return result


async def prepare_benchmark_data(
    start_date: str,
    end_date: str,
    workspace: Path,
    index_code: str = "0001",  # KOSPI
) -> bool:
    """KOSPI 벤치마크 데이터 준비

    Args:
        start_date: 시작일 (YYYY-MM-DD)
        end_date: 종료일 (YYYY-MM-DD)
        workspace: Lean 워크스페이스 경로
        index_code: 지수코드 (0001=KOSPI, 1001=KOSDAQ)

    Returns:
        성공 여부
    """
    from kis_backtest.providers.kis.auth import KISAuth
    from kis_backtest.providers.kis.data import KISDataProvider

    # 지수 코드 → 파일명 매핑
    index_names = {"0001": "kospi", "1001": "kosdaq"}
    index_name = index_names.get(index_code, index_code)

    output_dir = workspace / "data" / "index" / "krx" / "daily"
    output_dir.mkdir(parents=True, exist_ok=True)
    csv_path = output_dir / f"{index_name}.csv"

    # 요청 날짜 파싱
    req_start = datetime.strptime(start_date, "%Y-%m-%d").date()
    req_end = datetime.strptime(end_date, "%Y-%m-%d").date()

    # 캐시 확인 (시작일 커버리지 필수)
    if csv_path.exists() and csv_path.stat().st_size > 100:
        try:
            with open(csv_path, 'r', encoding="utf-8") as f:
                lines = f.readlines()
                if len(lines) >= 2:
                    first_date_str = lines[0].split(',')[0].strip()
                    last_date_str = lines[-1].split(',')[0].strip()
                    first_date = datetime.strptime(first_date_str, "%Y%m%d").date()
                    last_date = datetime.strptime(last_date_str, "%Y%m%d").date()

                    # 시작일 근처 데이터 필수 (7일 이내)
                    start_tolerance = timedelta(days=7)
                    end_tolerance = timedelta(days=7)

                    # 시작일과 종료일 모두 커버해야 캐시 사용
                    if first_date <= req_start + start_tolerance and last_date >= req_end - end_tolerance:
                        req_days = (req_end - req_start).days
                        if req_days > 0:
                            effective_start = max(req_start, first_date)
                            effective_end = min(req_end, last_date)
                            covered_days = (effective_end - effective_start).days
                            if covered_days / req_days >= 0.85:
                                logger.info(f"[Benchmark] 캐시 사용: {csv_path} (범위: {first_date} ~ {last_date})")
                                return True
                    else:
                        logger.info(f"[Benchmark] 캐시 범위 불일치 - 요청: {req_start}~{req_end}, 캐시: {first_date}~{last_date}")
                        # 낡은 캐시 삭제 — 다운로드 실패 시 절반짜리 데이터가 남지 않도록
                        csv_path.unlink(missing_ok=True)
        except Exception as e:
            logger.warning(f"[Benchmark] 캐시 체크 실패: {e}")
            csv_path.unlink(missing_ok=True)  # 손상된 캐시 제거

    # KIS API 다운로드
    try:
        auth = KISAuth.from_env()
        provider = KISDataProvider(auth)

        logger.info(f"[Benchmark] 다운로드 중: {index_name} ({index_code})")
        bars = provider.get_index_history(index_code, req_start, req_end)

        if bars:
            with open(csv_path, "w", encoding="utf-8") as f:
                for bar in bars:
                    f.write(bar.to_lean_csv_line() + "\n")
            logger.info(f"[Benchmark] 저장 완료: {len(bars)}건")
            return True
        else:
            logger.warning(f"[Benchmark] 데이터 없음: {index_name}")
            return False

    except Exception as e:
        logger.error(f"[Benchmark] 다운로드 실패: {e}")
        return False


@router.post(
    "/run",
    response_model=BacktestResponse,
    summary="백테스트 실행",
    description="전략을 백테스트합니다 (Lean Docker). param_overrides로 파라미터 변경 가능.",
)
async def run_backtest(request: BacktestRequest) -> BacktestResponse:
    """백테스트 실행

    param_overrides 예시:
        {"period": 21, "oversold": 25}
    """

    # 전략 빌드 (param_overrides 적용)
    try:
        if request.param_overrides:
            definition = StrategyRegistry.build_with_params(
                request.strategy_id,
                **request.param_overrides,
            )
        else:
            definition = StrategyRegistry.build(request.strategy_id)
    except KeyError:
        raise HTTPException(
            status_code=404,
            detail=f"Strategy not found: {request.strategy_id}"
        )
    
    # 날짜 검증
    start_date = request.start_date
    end_date = request.end_date
    
    if isinstance(start_date, date):
        start_date = start_date.isoformat()
    if isinstance(end_date, date):
        end_date = end_date.isoformat()
    
    # 워크스페이스 경로
    manager = LeanProjectManager()
    workspace = manager.workspace
    
    # 시장 데이터 준비 (KIS API → Lean CSV)
    try:
        data_result = await prepare_market_data(
            symbols=request.symbols,
            start_date=start_date,
            end_date=end_date,
            workspace=workspace,
            resolution=request.timeframe,  # 해상도 전달
        )
        logger.info(f"[Data] 결과: {data_result}")
        
        # 데이터 없으면 에러
        if data_result["errors"] and not data_result["downloaded"] and not data_result["skipped"]:
            error_msg = data_result["errors"][0]["error"] if data_result["errors"] else "데이터 다운로드 실패"
            raise HTTPException(status_code=400, detail=f"데이터 준비 실패: {error_msg}")
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"데이터 준비 실패: {e}")

    # 벤치마크 데이터 준비 (KOSPI)
    try:
        await prepare_benchmark_data(
            start_date=start_date,
            end_date=end_date,
            workspace=workspace,
        )
    except Exception as e:
        logger.warning(f"[Benchmark] 준비 실패 (무시): {e}")

    # Lean 코드 생성
    try:
        # 거래 비용 설정
        config = CodeGenConfig(
            commission_rate=request.commission_rate or 0.00015,
            tax_rate=request.tax_rate or 0.002,
            slippage=request.slippage or 0.0,
            initial_capital=request.initial_capital,
        )
        generator = LeanCodeGenerator(definition, config=config)
        code = generator.generate(
            symbols=request.symbols,
            start_date=start_date,
            end_date=end_date,
            initial_capital=request.initial_capital,
            resolution=request.timeframe,  # 해상도 전달
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Code generation failed: {e}")

    # Docker 환경 확인
    if not LeanExecutor.check_docker():
        raise HTTPException(
            status_code=503,
            detail="Docker가 실행되지 않습니다. Docker Desktop을 시작해주세요."
        )

    if not LeanExecutor.check_image():
        raise HTTPException(
            status_code=503,
            detail="Lean 이미지가 없습니다. 'docker pull quantconnect/lean:latest' 실행 후 재시도해주세요."
        )

    # 프로젝트 생성 및 백테스트 실행
    try:
        project = LeanProjectManager.create_project(
            run_id=f"bt_{definition.id}",
            symbols=request.symbols,
            start_date=start_date,
            end_date=end_date,
            initial_capital=request.initial_capital,
            strategy_id=definition.id,
            strategy_name=definition.name,
        )
        # 코드 저장
        project.main_py.write_text(code, encoding="utf-8")

        lean_run = LeanExecutor.run(project)

        if lean_run.success:
            result_data = _lean_run_to_api_response(
                lean_run, definition.name, request.symbols,
                start_date, end_date, request.initial_capital,
                resolution=request.timeframe,
                workspace=workspace,
            )
            return BacktestResponse(
                success=True,
                data=result_data,
                message="백테스트 완료",
            )
        else:
            # 에러 메시지 분류
            error = lean_run.error or "Unknown error"
            error_detail = _classify_lean_error(error, lean_run.output)
            raise HTTPException(status_code=500, detail=error_detail)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"백테스트 실행 오류: {e}")



class CustomBacktestRequest(BaseModel):
    """커스텀 백테스트 요청"""
    yaml_content: str
    symbols: List[str]
    start_date: str
    end_date: str
    initial_capital: float = 100_000_000
    param_overrides: Optional[Dict[str, Any]] = None  # $param_name 오버라이드
    commission_rate: Optional[float] = 0.00015  # 수수료율 (기본 0.015%)
    tax_rate: Optional[float] = 0.002  # 거래세율 (기본 0.2%)
    slippage: Optional[float] = 0.0  # 슬리피지 (기본 0%)
    timeframe: str = "daily"  # 해상도 (daily 또는 minute)


@router.post(
    "/run-custom",
    response_model=BacktestResponse,
    summary="커스텀 전략 백테스트",
    description="YAML 정의로 커스텀 전략을 백테스트합니다. param_overrides로 $param_name 값 변경 가능.",
)
async def run_custom_backtest(request: CustomBacktestRequest) -> BacktestResponse:
    """커스텀 전략 백테스트 - 스키마 기반

    param_overrides로 YAML의 $param_name 값을 오버라이드할 수 있습니다.
    예: {"period": 21, "oversold": 25}
    """
    from kis_backtest.file.loader import StrategyFileLoader

    # YAML 파싱 → StrategySchema (타입 안전, param_overrides 적용)
    try:
        schema = StrategyFileLoader.load_schema_with_params(
            request.yaml_content,
            param_overrides=request.param_overrides,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid YAML: {e}")
    
    # 워크스페이스 경로
    manager = LeanProjectManager()
    workspace = manager.workspace
    
    # 시장 데이터 준비 (KIS API → Lean CSV)
    try:
        data_result = await prepare_market_data(
            symbols=request.symbols,
            start_date=request.start_date,
            end_date=request.end_date,
            workspace=workspace,
            resolution=request.timeframe,  # 해상도 전달
        )
        logger.info(f"[Data] 결과: {data_result}")
        
        # 데이터 없으면 에러
        if data_result["errors"] and not data_result["downloaded"] and not data_result["skipped"]:
            error_msg = data_result["errors"][0]["error"] if data_result["errors"] else "데이터 다운로드 실패"
            raise HTTPException(status_code=400, detail=f"데이터 준비 실패: {error_msg}")
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"데이터 준비 실패: {e}")

    # 벤치마크 데이터 준비 (KOSPI)
    try:
        await prepare_benchmark_data(
            start_date=request.start_date,
            end_date=request.end_date,
            workspace=workspace,
        )
    except Exception as e:
        logger.warning(f"[Benchmark] 준비 실패 (무시): {e}")

    # Lean 코드 생성 (스키마 기반)
    try:
        if schema is None:
            raise HTTPException(status_code=400, detail="전략 스키마 생성 실패")
        
        # 거래 비용 설정
        config = CodeGenConfig(
            commission_rate=request.commission_rate or 0.00015,
            tax_rate=request.tax_rate or 0.002,
            slippage=request.slippage or 0.0,
            initial_capital=request.initial_capital,
        )
        generator = LeanCodeGenerator(schema, config=config)
        code = generator.generate(
            symbols=request.symbols,
            start_date=request.start_date,
            end_date=request.end_date,
            initial_capital=request.initial_capital,
            resolution=request.timeframe,  # 해상도 전달
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Code generation failed: {e}")
    
    # Docker 환경 확인
    if not LeanExecutor.check_docker():
        raise HTTPException(
            status_code=503,
            detail="Docker가 실행되지 않습니다. Docker Desktop을 시작해주세요."
        )

    if not LeanExecutor.check_image():
        raise HTTPException(
            status_code=503,
            detail="Lean 이미지가 없습니다. 'docker pull quantconnect/lean:latest' 실행 후 재시도해주세요."
        )

    # 프로젝트 생성 및 백테스트 실행
    try:
        project = LeanProjectManager.create_project(
            run_id=f"bt_custom_{schema.id}",
            symbols=request.symbols,
            start_date=request.start_date,
            end_date=request.end_date,
            initial_capital=request.initial_capital,
            strategy_id=schema.id,
            strategy_name=schema.name,
        )
        # 코드 저장
        project.main_py.write_text(code, encoding="utf-8")

        lean_run = LeanExecutor.run(project)

        if lean_run.success:
            result_data = _lean_run_to_api_response(
                lean_run, schema.name, request.symbols,
                request.start_date, request.end_date, request.initial_capital,
                workspace=workspace,
            )
            return BacktestResponse(
                success=True,
                data=result_data,
                message="백테스트 완료",
            )
        else:
            # 에러 메시지 분류
            error = lean_run.error or "Unknown error"
            error_detail = _classify_lean_error(error, lean_run.output)
            raise HTTPException(status_code=500, detail=error_detail)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"백테스트 실행 오류: {e}")



class AnalysisRequest(BaseModel):
    results: List[BulkBacktestResult]
    benchmark_return: Optional[float] = None
    start_date: str
    end_date: str
    symbols: List[str]

@router.post("/analyze")
async def analyze_backtest(request: AnalysisRequest):
    """Gemini AI를 이용한 백테스트 결과 심층 분석"""
    from kis_backtest.providers.kis.auth import ka
    env = ka.getEnv()
    api_key = env.get("gemini_api_key")
    
    if not api_key:
        raise HTTPException(status_code=400, detail="Gemini API 키가 설정되지 않았습니다. kis_devlp.yaml을 확인하세요.")

    # 프롬프트 구성
    summary_text = ""
    valid_results = [r for r in request.results if r.success]
    sorted_results = sorted(valid_results, key=lambda x: x.total_return, reverse=True)
    
    for i, r in enumerate(sorted_results):
        params = ", ".join([f"{k}={v}" for k, v in (r.parameters or {}).items()])
        summary_text += f"{i+1}. {r.strategy_name}\n"
        summary_text += f"   - 누적수익률: {r.total_return:+.2f}%\n"
        summary_text += f"   - Sharpe: {r.sharpe_ratio:.2f}, MDD: {r.max_drawdown:.2f}%\n"
        summary_text += f"   - 승률: {r.win_rate:.2f}%, 거래수: {r.total_trades}회\n"
        summary_text += f"   - 파라미터: {params}\n\n"

    prompt = f"""
당신은 10년 이상의 경험을 가진 전문 퀀트 투자자이자 알고리즘 트레이딩 개발자입니다.
아래 제공된 주식 자동매매 전략의 백테스트 결과를 심층적으로 분석하고, 수익성과 안정성을 높일 수 있도록 전략 파라미터를 조절해 주세요.

### [백테스트 성과 분석 요청]
- 기간: {request.start_date} ~ {request.end_date}
- 종목: {', '.join(request.symbols)}
- 기준 지수(KOSPI) 수익률: {f'{request.benchmark_return:.2f}%' if request.benchmark_return is not None else 'N/A'}

#### 전략별 성과 순위 (수익률 순)
{summary_text}

---
작업 지침:
1. 위 결과를 분석하여 어떤 전략의 파라미터 조합이 가장 효율적이었는지 평가해줘.
2. 시장 지수 대비 초과 수익을 낸 핵심 요인이나, 반대로 부진했다면 그 원인을 기술적 지표 특성에 기반해 설명해줘.
3. 향후 실전 매매를 위해 파라미터를 어떻게 미세 조정(Fine-tuning)하면 좋을지 구체적인 수치와 함께 제안해줘.
4. 분석 결과는 사용자에게 신뢰감을 줄 수 있도록 마크다운 형식을 사용하여 전문적으로 작성해줘.
""".strip()

    try:
        client = genai.Client(api_key=api_key)
        # 사용자가 요청한 최상위 모델 gemini-3.1-pro-preview 사용
        response = client.models.generate_content(
            model="gemini-3.1-pro-preview",
            contents=prompt
        )
        return {"success": True, "analysis": response.text}
    except Exception as e:
        logger.error(f"Gemini API 호출 실패: {e}")
        raise HTTPException(status_code=500, detail=f"AI 분석 중 오류가 발생했습니다: {str(e)}")


@router.post(
    "/bulk",
    response_model=BulkBacktestResponse,
    summary="일괄 백테스트 실행",
    description="선택된 여러 전략을 한 번에 백테스트하여 성과를 요약합니다.",
)
async def run_bulk_backtest(request: BulkBacktestRequest) -> BulkBacktestResponse:
    """여러 전략을 일괄적으로 테스트하고 요약 결과를 반환합니다."""
    # 1. 대상 전략 결정
    target_ids = request.strategy_ids
    if not target_ids:
        target_ids = [s["id"] for s in StrategyRegistry.list_all()]

    # 2. 공통 설정 준비
    manager = LeanProjectManager()
    workspace = manager.workspace
    start_date = request.start_date.isoformat() if isinstance(request.start_date, date) else request.start_date
    end_date = request.end_date.isoformat() if isinstance(request.end_date, date) else request.end_date

    # 3. 데이터 일괄 준비 (한 번만 실행)
    try:
        await prepare_market_data(
            symbols=request.symbols,
            start_date=start_date,
            end_date=end_date,
            workspace=workspace,
            resolution=request.timeframe,
        )
        await prepare_benchmark_data(
            start_date=start_date,
            end_date=end_date,
            workspace=workspace,
        )
    except Exception as e:
        logger.error(f"[Bulk] 데이터 준비 실패: {e}")
        # 데이터 실패 시 전체 중단
        raise HTTPException(status_code=500, detail=f"데이터 준비 실패: {e}")

    # 4. 개별 전략 실행 헬퍼 함수 (병렬 처리용)
    semaphore = asyncio.Semaphore(2)  # 동시 실행 2개 제한

    async def _run_single_bulk_strategy(strategy_id: str) -> BulkBacktestResult:
        async with semaphore:
            display_name = strategy_id
            try:
                # 전략 메타데이터 조회
                meta = StrategyRegistry.get_metadata(strategy_id)
                if meta and meta.get("name"):
                    display_name = meta.get("name")
                
                # 전략 존재 여부 확인
                if not StrategyRegistry.get(strategy_id):
                    return BulkBacktestResult(
                        strategy_id=strategy_id, strategy_name=display_name,
                        total_return=0.0, sharpe_ratio=0.0, max_drawdown=0.0, win_rate=0.0,
                        total_trades=0, success=False, error="등록되지 않은 프리셋 전략입니다."
                    )
                
                # 오버라이드 적용
                overrides = request.param_overrides.get(strategy_id) if request.param_overrides else None
                definition = StrategyRegistry.build(strategy_id, **(overrides or {}))

                # 코드 생성
                config = CodeGenConfig(
                    initial_capital=request.initial_capital,
                    commission_rate=0.00015,
                    tax_rate=0.002,
                    slippage=0.0,
                )
                generator = LeanCodeGenerator(definition, config=config)
                code = generator.generate(
                    symbols=request.symbols,
                    start_date=start_date,
                    end_date=end_date,
                    initial_capital=request.initial_capital,
                    resolution=request.timeframe,
                )

                # Lean 프로젝트 생성
                run_id = f"bulk_{strategy_id}_{datetime.now().strftime('%H%M%S')}"
                project = manager.create_project(
                    run_id=run_id,
                    symbols=request.symbols,
                    start_date=start_date,
                    end_date=end_date,
                    initial_capital=request.initial_capital,
                    strategy_id=strategy_id,
                    strategy_name=display_name,
                )
                project.main_py.write_text(code, encoding="utf-8")
                
                # Lean 실행 (병렬 실행을 위해 thread에서 실행)
                logger.info(f"[Bulk] 전략 실행 시작: {display_name} ({strategy_id})")
                lean_run = await asyncio.to_thread(LeanExecutor.run, project, timeout=600)
                logger.info(f"[Bulk] 전략 실행 완료: {display_name} - {'성공' if lean_run.success else '실패'}")
                
                if lean_run.success:
                    stats = lean_run.get_statistics()
                    
                    # 핵심 지표 추출
                    total_return = parse_lean_value(stats.get("Net Profit", "0%"))
                    sharpe = parse_lean_value(stats.get("Sharpe Ratio", "0"))
                    mdd = parse_lean_value(stats.get("Drawdown", "0%"))
                    win_rate = parse_lean_value(stats.get("Win Rate", "0%"))
                    total_trades = int(parse_lean_value(stats.get("Total Orders", "0")))

                    return BulkBacktestResult(
                        strategy_id=strategy_id, strategy_name=display_name,
                        total_return=total_return, sharpe_ratio=sharpe,
                        max_drawdown=mdd, win_rate=win_rate,
                        total_trades=total_trades, success=True,
                        parameters=definition.get_default_params(),
                        equity_curve=_extract_equity_curve(lean_run.load_result(), request.timeframe, max_points=500) # 일괄 테스트는 데이터 경량화를 위해 500포인트 샘플링
                    )
                else:
                    return BulkBacktestResult(
                        strategy_id=strategy_id, strategy_name=display_name,
                        total_return=0.0, sharpe_ratio=0.0, max_drawdown=0.0, win_rate=0.0,
                        total_trades=0, success=False, error="백테스트 실행 실패"
                    )

            except Exception as e:
                logger.error(f"[Bulk] 전략 {strategy_id} 처리 중 오류: {e}")
                return BulkBacktestResult(
                    strategy_id=strategy_id, strategy_name=display_name,
                    total_return=0.0, sharpe_ratio=0.0, max_drawdown=0.0, win_rate=0.0,
                    total_trades=0, success=False, error=str(e)
                )

    # 모든 전략 병렬 실행 요청
    tasks = [_run_single_bulk_strategy(s_id) for s_id in target_ids]
    results = await asyncio.gather(*tasks)

    if not results:
        raise HTTPException(status_code=400, detail="테스트 가능한 유효한 전략이 선택되지 않았습니다.")

    # 5. 벤치마크 수익률 계산 및 곡선 추출
    benchmark_val = None
    benchmark_curve = None
    try:
        curve = _load_benchmark_curve(workspace, start_date, end_date)
        if curve:
            # 마지막 날짜의 수익률이 전체 수익률
            sorted_keys = sorted(curve.keys())
            last_date = sorted_keys[-1]
            benchmark_val = curve[last_date]
            
            # 개별 백테스트와 동일하게 샘플링 없이 전체 데이터 전달 (정합성 우선)
            benchmark_curve = curve
            
            # [DEBUG] 데이터 상태 출력
            logger.info(f"[Benchmark_Bulk] {len(curve)} pts loaded. First: {sorted_keys[0]}={curve[sorted_keys[0]]}, Last: {last_date}={benchmark_val}")
    except Exception as e:
        logger.warning(f"[Bulk] 벤치마크 수익률 계산 실패: {e}")

    # 최종 응답 전 benchmark_curve 데이터 객체 여부 확인 로깅
    status = "PRESENT" if benchmark_curve else f"MISSING ({_last_benchmark_error})"
    logger.info(f"[Bulk_Response] results={len(results)}, benchmark_curve={status}")

    msg = f"{len(results)}개 전략 테스트 완료"
    if not benchmark_curve:
        msg += f" (KOSPI 데이터 로드 실패: {_last_benchmark_error})"

    # [v7] 모든 Pydantic 모델을 원시 딕셔너리로 강제 변환하여 직렬화 오류 방지
    serialized_results = []
    for r in results:
        if isinstance(r, BulkBacktestResult):
            serialized_results.append(r.model_dump())
        else:
            serialized_results.append(r)

    return BulkBacktestResponse(
        success=True,
        data={
            "results": serialized_results,
            "benchmark_return": benchmark_val,
            "benchmark_curve": benchmark_curve
        },
        message=msg
    )
