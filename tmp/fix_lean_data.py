import os
import json
import urllib.request
import zipfile
from io import BytesIO
from pathlib import Path

# 설정
PROJECT_DIR = Path(r"c:\Gemini_Test\open-trading-api\backtester")
WORKSPACE_DIR = PROJECT_DIR / ".lean-workspace"
DATA_DIR = WORKSPACE_DIR / "data"
LEAN_RAW_BASE = "https://raw.githubusercontent.com/QuantConnect/Lean/master/Data"
MASTER_URLS = {
    "kospi": "https://new.real.download.dws.co.kr/common/master/kospi_code.mst.zip",
    "kosdaq": "https://new.real.download.dws.co.kr/common/master/kosdaq_code.mst.zip",
}

def setup():
    print("=== Lean 데이터 환경 복구 시작 ===")
    
    # 1. 디렉토리 생성
    dirs = [
        DATA_DIR / "market-hours",
        DATA_DIR / "symbol-properties",
        DATA_DIR / "equity/krx/daily",
        WORKSPACE_DIR / "projects",
        WORKSPACE_DIR / "results"
    ]
    for d in dirs:
        d.mkdir(parents=True, exist_ok=True)
        print(f"디렉토리 준비 완료: {d}")

    # 2. 필수 파일 다운로드
    files_to_download = [
        ("market-hours/market-hours-database.json", DATA_DIR / "market-hours" / "market-hours-database.json"),
        ("symbol-properties/symbol-properties-database.csv", DATA_DIR / "symbol-properties" / "symbol-properties-database.csv")
    ]
    
    for relative_url, target_path in files_to_download:
        url = f"{LEAN_RAW_BASE}/{relative_url}"
        print(f"다운로드 중: {url}")
        urllib.request.urlretrieve(url, target_path)
        print(f"저장 완료: {target_path}")

    # 3. lean.json 생성
    lean_json = {
        "data-folder": "./data",
        "results-destination-folder": "./results",
        "engine-type": "local"
    }
    with open(WORKSPACE_DIR / "lean.json", "w") as f:
        json.dump(lean_json, f, indent=2)
    print("lean.json 생성 완료")

    # 4. KRX 마스터파일 수집 및 등록
    print("\n[KRX 종목 등록 시작]")
    symbol_props_path = DATA_DIR / "symbol-properties" / "symbol-properties-database.csv"
    
    total_added = 0
    for exchange, url in MASTER_URLS.items():
        print(f"[{exchange.upper()}] 마스터파일 다운로드 중...")
        with urllib.request.urlopen(url) as response:
            with zipfile.ZipFile(BytesIO(response.read())) as zf:
                content = zf.read(zf.namelist()[0])
        
        # 파싱 및 파일 추가
        lines = content.split(b"\n")
        new_lines = []
        for line_bytes in lines:
            if len(line_bytes) < 61: continue
            code = line_bytes[0:9].decode("euc-kr", errors="ignore").strip()
            name = line_bytes[21:61].decode("euc-kr", errors="ignore").strip()
            if len(code) > 6: code = code[-6:]
            if code.isdigit():
                # format: market,symbol,type,description,quote_currency,contract_multiplier,minimum_price_variation,lot_size,market_ticker,minimum_order_size,price_magnifier,strike_multiplier
                new_lines.append(f'krx,{code},equity,{name},KRW,1,1,1,{code},1,1,1\n')
        
        with open(symbol_props_path, "a", encoding="utf-8") as f:
            f.writelines(new_lines)
        print(f"{exchange.upper()} 완료: {len(new_lines)}개 종목 등록됨")
        total_added += len(new_lines)

    print(f"\n=== 모든 복구 작업 완료! 총 {total_added}개 종목 설정됨 ===")

if __name__ == "__main__":
    setup()
