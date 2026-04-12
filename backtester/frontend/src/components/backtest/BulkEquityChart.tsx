"use client";

import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";
import type { BulkBacktestResult } from "@/types";

interface BulkEquityChartProps {
  results: BulkBacktestResult[];
  selectedIds: string[];
  initialCapital: number;
  benchmarkCurve?: Record<string, number>;
  errorMessage?: string; // 상세 에러 원인 추가
}

const COLORS = [
  "#245bee", // Blue
  "#ef4444", // Red
  "#22c55e", // Green
  "#f59e0b", // Amber
  "#8b5cf6", // Violet
  "#ec4899", // Pink
  "#06b6d4", // Cyan
  "#10b981", // Emerald
];

export function BulkEquityChart({ results, selectedIds, initialCapital = 100_000_000, benchmarkCurve, errorMessage }: BulkEquityChartProps) {
  // [DIAGNOSTIC] 데이터 유입 체킹
  const benchmarkPtsCount = benchmarkCurve ? Object.keys(benchmarkCurve).length : 0;
  
  // 1. 선택된 결과 필터링 및 데이터 가공
  const chartData = useMemo(() => {
    const compareResults = results.filter(r => r.success && selectedIds.includes(r.strategy_id));
    if (compareResults.length === 0 && !benchmarkCurve) return [];

    // 합집합 날짜 추출
    const allDates = new Set<string>();
    compareResults.forEach(r => {
      if (r.equity_curve) {
        Object.keys(r.equity_curve).forEach(d => allDates.add(d));
      }
    });

    if (benchmarkCurve) {
      Object.keys(benchmarkCurve).forEach(d => allDates.add(d));
    }

    const sortedDates = Array.from(allDates).sort();
    
    // 데이터 포인트 생성
    let prevBenchmarkPct = 0; // 직전 KOSPI 수익률 캐리 오버

    return sortedDates.map(date => {
      const point: any = { date };
      const dateOnly = date.split(' ')[0];
      
      // 개별 전략 데이터
      compareResults.forEach(r => {
        if (r.equity_curve && r.equity_curve[date] !== undefined) {
          point[r.strategy_id] = r.equity_curve[date];
        } else {
          point[r.strategy_id] = undefined; 
        }
      });

      // 벤치마크 데이터 (개별 백테스트 로직 이식: 캐리 오버 적용)
      if (benchmarkCurve) {
        let bVal = benchmarkCurve[date] ?? benchmarkCurve[dateOnly] ?? null;
        
        // 데이터가 없는 구간(주말/공휴일 등)은 직전 거래일 데이터 사용
        if (bVal === null) {
          bVal = prevBenchmarkPct;
        } else {
          prevBenchmarkPct = bVal;
        }

        // NaN 방지 및 초기자본금 기반 절대값 변환
        const cap = Number(initialCapital) || 100_000_000;
        point.benchmark = cap * (1 + bVal / 100);
      }

      return point;
    });
  }, [results, selectedIds, benchmarkCurve, initialCapital]);

  const compareStrategies = useMemo(() => {
    return results.filter(r => r.success && selectedIds.includes(r.strategy_id));
  }, [results, selectedIds]);

  if (compareStrategies.length === 0 && !benchmarkCurve) {
    return (
      <div className="card h-[400px] flex items-center justify-center border-dashed border-2 border-slate-200 dark:border-slate-800">
        <p className="text-slate-400 text-sm">순위표에서 비교할 전략을 선택하세요 (최대 8개)</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-6">
        <div className="flex flex-col gap-1">
          <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
            선택 핵심 전략 성과 비교
            <div className="flex items-center gap-1">
              {compareStrategies.length > 0 && (
                <span className="text-[10px] font-normal text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                  {compareStrategies.length}개 전략 선택됨
                </span>
              )}
              {benchmarkCurve && (
                <span className="text-[10px] font-bold text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                  KOSPI 포함
                </span>
              )}
            </div>
          </h3>
          {/* 진단 데이터 바 (진단용 - 완료 후 제거 가능) */}
          <div className="flex items-center gap-3 mt-1">
            <div className={cn(
              "text-[9px] px-1.5 py-0.5 rounded-full font-bold",
              benchmarkCurve ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
            )}>
              DIAG: KOSPI {benchmarkCurve ? `OK (${benchmarkPtsCount} pts)` : `NULL (${errorMessage || "UNKNOWN"})`}
            </div>
            {initialCapital && (
              <div className="text-[9px] text-slate-400">
                CAP: {initialCapital.toLocaleString()}
              </div>
            )}
          </div>
        </div>
      </div>
      
      <div className="h-[400px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis 
              dataKey="date" 
              tick={{ fontSize: 10 }} 
              tickFormatter={(v) => v.slice(5)}
              minTickGap={30}
            />
            <YAxis 
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => v >= 100_000_000 ? `${(v/100_000_000).toFixed(1)}억` : `${(v/10000).toFixed(0)}만`}
              domain={['auto', 'auto']}
              width={60}
            />
            <Tooltip 
              contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)', padding: '12px' }}
              itemStyle={{ fontSize: '12px', fontWeight: 600, padding: '2px 0' }}
              labelStyle={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px', borderBottom: '1px solid #f1f5f9', paddingBottom: '4px' }}
              itemSorter={(item) => (item.name === "benchmark" ? -1 : 1)}
              formatter={(value: number, name: string) => {
                if (name === "benchmark") return [formatCurrency(value), "📊 KOSPI(지수)"];
                const strategy = results.find(r => r.strategy_id === name);
                return [formatCurrency(value), strategy?.strategy_name || name];
              }}
            />
            <Legend 
              verticalAlign="top" 
              align="right"
              iconType="circle"
              wrapperStyle={{ fontSize: '11px', paddingBottom: '20px' }}
              formatter={(value, entry: any) => {
                if (value === "benchmark") return <span className="text-slate-500 font-bold italic">KOSPI</span>;
                const strategy = results.find(r => r.strategy_id === value);
                return <span className="text-slate-600 dark:text-slate-400 font-medium">{strategy?.strategy_name || value}</span>;
              }}
            />
            
            {/* 벤치마크 라인 (항상 배경에 표시) */}
            {benchmarkCurve && (
              <Line
                type="monotone"
                dataKey="benchmark"
                stroke="#f59e0b"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
                name="benchmark"
                activeDot={{ r: 4 }}
                connectNulls
              />
            )}

            {/* 개별 전략 라인 */}
            {compareStrategies.map((s, idx) => (
              <Line
                key={s.strategy_id}
                type="monotone"
                dataKey={s.strategy_id}
                stroke={COLORS[idx % COLORS.length]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
                name={s.strategy_id}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
