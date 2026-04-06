import os
from pathlib import Path

# 설정
FILE_PATH = Path(r"c:\Gemini_Test\open-trading-api\backtester\.lean-workspace\data\symbol-properties\symbol-properties-database.csv")
TEMP_PATH = FILE_PATH.with_suffix(".tmp")

def clean_duplicates():
    if not FILE_PATH.exists():
        print(f"파일이 없습니다: {FILE_PATH}")
        return

    print(f"데이터 정제 시작: {FILE_PATH}")
    
    unique_keys = set()
    cleaned_count = 0
    total_count = 0
    
    with open(FILE_PATH, "r", encoding="utf-8") as fin:
        with open(TEMP_PATH, "w", encoding="utf-8", newline="") as fout:
            # 헤더는 항상 유지
            header = fin.readline()
            fout.write(header)
            
            for line in fin:
                total_count += 1
                stripped = line.strip()
                if not stripped or stripped.startswith("#"):
                    fout.write(line)
                    continue
                
                # 키 추출 (market,symbol)
                parts = stripped.split(",")
                if len(parts) < 2:
                    fout.write(line)
                    continue
                    
                key = f"{parts[0]}-{parts[1]}" # e.g. krx-100030
                
                if key not in unique_keys:
                    unique_keys.add(key)
                    fout.write(line)
                else:
                    cleaned_count += 1
    
    # 교체
    if cleaned_count > 0:
        os.replace(TEMP_PATH, FILE_PATH)
        print(f"정제 완료! 총 {total_count}줄 중 {cleaned_count}개의 중복 항목을 제거했습니다.")
    else:
        if TEMP_PATH.exists():
            os.remove(TEMP_PATH)
        print("중복 항목이 발견되지 않았습니다.")

if __name__ == "__main__":
    clean_duplicates()
