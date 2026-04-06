import os
import csv
import glob
import re

# 설정
source_dir = r"c:\Gemini_Test\open-trading-api\data"
target_dir = r"c:\Gemini_Test\open-trading-api\backtester\.lean-workspace\data\equity\krx\daily"

# 대상 디렉토리 생성
os.makedirs(target_dir, exist_ok=True)

# 파일 패턴: [종목번호]_D_...csv
files = glob.glob(os.path.join(source_dir, "*_D_*.csv"))

print(f"총 {len(files)}개의 파일을 찾았습니다.")

for file_path in files:
    filename = os.path.basename(file_path)
    # 종목번호 추출 (첫 6자리)
    match = re.match(r"^(\d{6})", filename)
    if not match:
        print(f"파일 이름 형식 오류: {filename}")
        continue
    
    symbol = match.group(1)
    target_file = os.path.join(target_dir, f"{symbol}.csv")
    
    with open(file_path, mode='r', encoding='utf-8') as f_in:
        reader = csv.DictReader(f_in)
        
        with open(target_file, mode='w', encoding='utf-8', newline='') as f_out:
            writer = csv.writer(f_out)
            
            for row in reader:
                # 날짜 변환: YYYY-MM-DD -> YYYYMMDD 00:00
                raw_date = row['date'].replace('-', '')
                formatted_date = f"{raw_date} 00:00"
                
                # 컬럼 재배치: Date, Open, High, Low, Close, Volume
                # 소스 컬럼명: date,close,open,high,low,volume
                try:
                    writer.writerow([
                        formatted_date,
                        row['open'],
                        row['high'],
                        row['low'],
                        row['close'],
                        row['volume']
                    ])
                except KeyError as e:
                    print(f"컬럼 누락 ({filename}): {e}")
                    break
                    
    print(f"변환 완료: {filename} -> {symbol}.csv")

print("모든 데이터 변환 및 복사가 완료되었습니다.")
