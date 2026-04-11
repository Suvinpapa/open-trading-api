"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Loader2,
  Play,
  Calendar,
  TrendingUp,
  Target,
  Shield,
  AlertTriangle,
  BarChart3,
  Zap,
  Repeat,
  Activity,
  DollarSign,
  Percent,
  ChevronDown,
  ClipboardCopy,
  MessageSquare,
} from "lucide-react";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";
import { listStrategies, runBacktest, runCustomBacktest, runBulkBacktest } from "@/lib/api";
import { FileDropZone } from "@/components/file";
import { StockInput } from "@/components/symbols";
import { EquityChart } from "@/components/backtest";
import type { ChartDataPoint, TradeMarker } from "@/components/backtest";
import type { Strategy, BacktestResult, ParamDefinition, BulkBacktestResult } from "@/types";

// 통계 카드 컴포넌트
function StatCard({
  label,
  value,
  subValue,
  icon: Icon,
  positive,
  iconColor,
}: {
  label: string;
  value: string;
  subValue?: string;
  icon: React.ElementType;
  positive?: boolean | null;
  iconColor?: string;
}) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={cn("w-4 h-4", iconColor || "text-slate-400")} />
        <span className="text-xs font-medium text-slate-500">{label}</span>
      </div>
      <div
        className={cn(
          "text-xl font-bold tabular-nums",
          positive === true && "text-profit",
          positive === false && "text-loss",
          positive === null && "text-slate-900 dark:text-white"
        )}
      >
        {value}
      </div>
      {subValue && <div className="text-xs text-slate-400 mt-1">{subValue}</div>}
    </div>
  );
}

// 파라미터 슬라이더 컴포넌트
function ParamSlider({
  name,
  definition,
  value,
  onChange,
}: {
  name: string;
  definition: ParamDefinition;
  value: number;
  onChange: (value: number) => void;
}) {
  const step = definition.step ?? (definition.type === "int" ? 1 : 0.1);
  const label = definition.label || name.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-600 dark:text-slate-400">{label}</span>
        <span className="text-sm font-mono font-medium tabular-nums">{value}</span>
      </div>
      <input
        type="range"
        min={definition.min}
        max={definition.max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-primary"
      />
      <div className="flex justify-between text-xs text-slate-400">
        <span>{definition.min}</span>
        <span>{definition.max}</span>
      </div>
    </div>
  );
}

// 메트릭 그룹 컴포넌트
function MetricsGroup({
  title,
  icon: Icon,
  metrics,
  badge,
}: {
  title: string;
  icon: React.ElementType;
  metrics: { label: string; value: string; highlight?: boolean; positive?: boolean | null }[];
  badge?: string;
}) {
  return (
    <div className="card">
      <h3 className="font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
        <Icon className="w-4 h-4 text-kis-blue" />
        {title}
        {badge && (
          <span className="ml-auto text-[0.625rem] font-semibold text-slate-500 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 tracking-wide">
            {badge}
          </span>
        )}
      </h3>
      <div className="space-y-2">
        {metrics.map((m, i) => (
          <div key={i} className="flex justify-between items-center">
            <span className="text-sm text-slate-500">{m.label}</span>
            <span
              className={cn(
                "text-sm font-mono",
                m.highlight && "font-bold text-kis-blue",
                m.positive === true && "text-profit",
                m.positive === false && "text-loss",
                !m.highlight && m.positive === undefined && "text-slate-900 dark:text-white"
              )}
            >
              {m.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// 일괄 백테스트 결과 테이블 (순위표)
function BulkResultsTable({
  results,
  sortConfig,
  onSort,
  benchmarkReturn,
}: {
  results: BulkBacktestResult[];
  sortConfig: { key: keyof BulkBacktestResult; desc: boolean };
  onSort: (key: keyof BulkBacktestResult) => void;
  benchmarkReturn: number | null;
}) {
  const sortedResults = [...results].sort((a, b) => {
    const aVal = a[sortConfig.key];
    const bVal = b[sortConfig.key];
    
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return sortConfig.desc ? bVal - aVal : aVal - bVal;
    }
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortConfig.desc 
        ? bVal.localeCompare(aVal, 'ko') 
        : aVal.localeCompare(bVal, 'ko');
    }
    return 0;
  });

  const headers: { key: keyof BulkBacktestResult; label: string }[] = [
    { key: "strategy_name", label: "전략명" },
    { key: "total_return", label: "누적 수익률" },
    { key: "sharpe_ratio", label: "Sharpe" },
    { key: "max_drawdown", label: "MDD" },
    { key: "win_rate", label: "승률" },
    { key: "total_trades", label: "거래수" },
  ];

  return (
    <div id="bulk-results-section" className="card border-kis-blue shadow-kis-blue/10">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Zap className="w-5 h-5 text-kis-blue" />
          전략 토너먼트 성과 순위표
          {benchmarkReturn !== null && (
            <span className="ml-2 text-xs font-normal text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">
              KOSPI: <span className={cn("font-mono font-bold", benchmarkReturn >= 0 ? "text-profit" : "text-loss")}>
                {benchmarkReturn >= 0 ? "+" : ""}{benchmarkReturn.toFixed(2)}%
              </span>
            </span>
          )}
        </h3>
        <span className="text-xs text-kis-blue font-medium bg-kis-blue/5 px-2 py-1 rounded-full border border-kis-blue/20">
          Ranked by {headers.find(h => h.key === sortConfig.key)?.label}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
              <th className="pb-3 pr-4 font-semibold text-center w-12">순위</th>
              {headers.map((h) => (
                <th
                  key={h.key}
                  className="pb-3 pr-4 font-semibold cursor-pointer hover:text-kis-blue transition-colors group"
                  onClick={() => onSort(h.key)}
                >
                  <div className="flex items-center gap-1">
                    {h.label}
                    <ChevronDown className={cn(
                      "w-3 h-3 transition-transform opacity-40 group-hover:opacity-100",
                      sortConfig.key === h.key && "opacity-100 text-kis-blue",
                      sortConfig.key === h.key && !sortConfig.desc && "rotate-180"
                    )} />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedResults.map((res, i) => (
              <tr key={res.strategy_id} className="border-b border-slate-100 dark:border-slate-800 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <td className="py-3 pr-4 text-center font-bold text-slate-400">
                  {i === 0 ? <span className="text-amber-500">🥇</span> : i === 1 ? <span className="text-slate-400">🥈</span> : i === 2 ? <span className="text-amber-700">🥉</span> : i + 1}
                </td>
                <td className="py-3 pr-4 font-medium text-slate-900 dark:text-white">
                  <div className="flex flex-col">
                    <span>{res.strategy_name}</span>
                    {!res.success && (
                      <span className="text-[10px] text-loss font-normal">
                        실패: {res.error || "알 수 없는 오류"}
                      </span>
                    )}
                  </div>
                </td>
                <td className={cn("py-3 pr-4 font-mono font-bold", res.success && res.total_return >= 0 ? "text-profit" : res.success ? "text-loss" : "text-slate-300")}>
                  {res.success ? formatPercent(res.total_return) : "-"}
                </td>
                <td className="py-3 pr-4 font-mono text-slate-500">{res.success ? res.sharpe_ratio.toFixed(2) : "-"}</td>
                <td className="py-3 pr-4 font-mono text-slate-400">{res.success ? formatPercent(-Math.abs(res.max_drawdown)) : "-"}</td>
                <td className="py-3 pr-4 font-mono text-slate-500">{res.success ? formatPercent(res.win_rate) : "-"}</td>
                <td className="py-3 pr-4 text-slate-500">{res.success ? `${res.total_trades}회` : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// 일괄 테스트 파라미터 표 컴포넌트
function BulkParamsTable({ 
  selectedIds,
  results, 
  overrides, 
  onChange,
  allStrategies
}: { 
  selectedIds: string[],
  results: BulkBacktestResult[] | null, 
  overrides: Record<string, Record<string, any>>,
  onChange: (strategyId: string, key: string, value: number) => void,
  allStrategies: any[]
}) {
  if (!selectedIds || selectedIds.length === 0) return null;

  // 프리셋 전략들만 표시 (ID에 .kis.yaml이 포함되지 않은 것)
  const displayIds = selectedIds.filter(id => !id.endsWith('.kis.yaml'));
  if (displayIds.length === 0) return null;

  return (
    <div className="card bg-slate-50/50 dark:bg-slate-900/20 border-slate-200 dark:border-slate-800 mt-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2">
          <Target className="w-4 h-4" />
          전략별 파라미터 직접 조정
        </h3>
        <span className="text-[10px] text-slate-400">수정 후 상단의 테스트 실행 버튼을 다시 누르세요</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-800">
              <th className="pb-2 pr-4 font-semibold w-1/4">전략명</th>
              <th className="pb-2 font-semibold">파라미터 설정 (Label, Min~Max)</th>
            </tr>
          </thead>
          <tbody>
            {displayIds.map((id) => {
              const strategyMeta = allStrategies.find(s => s.id === id);
              if (!strategyMeta) return null;
              
              const res = results?.find(r => r.strategy_id === id);
              const paramsMeta = strategyMeta.params || {};

              return (
                <tr key={id} className="border-b border-slate-100 dark:border-slate-800/50 last:border-0 hover:bg-white/50 dark:hover:bg-white/5 transition-colors">
                  <td className="py-4 pr-4 font-medium text-slate-700 dark:text-slate-200 align-top">
                    <div className="flex flex-col">
                      <span>{strategyMeta.name}</span>
                      {res && !res.success && (
                        <span className="text-[10px] text-loss">실패: {res.error}</span>
                      )}
                    </div>
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-4">
                      {Object.keys(paramsMeta).map((key) => {
                        const paramMeta = paramsMeta[key];
                        const val = overrides[id]?.[key] ?? res?.parameters?.[key] ?? paramMeta.default;
                        
                        return (
                          <div key={key} className="flex flex-col gap-1.5 py-1">
                            <label className="text-[10px] text-slate-500 font-medium">
                              {paramMeta?.label || key}
                            </label>
                            <input
                              type="number"
                              value={val}
                              min={paramMeta?.min}
                              max={paramMeta?.max}
                              onChange={(e) => onChange(id, key, Number(e.target.value))}
                              className="w-24 px-2 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-xs font-mono focus:border-kis-blue focus:ring-1 focus:ring-kis-blue outline-none transition-all"
                            />
                            <span className="text-[9px] text-slate-400 font-mono text-center">
                              {paramMeta.min}~{paramMeta.max}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function BacktestPage() {
  // 데이터 (templates + strategies 합쳐서 중복 제거)
  const [allStrategies, setAllStrategies] = useState<Strategy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [backendDown, setBackendDown] = useState(false);

  // 설정
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importedYaml, setImportedYaml] = useState<string | null>(null);
  const [selectedStocks, setSelectedStocks] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [initialCapital, setInitialCapital] = useState(100_000_000);
  const [timeframe, setTimeframe] = useState("daily"); // 해상도: daily 또는 minute
  
  // 거래 비용 설정
  const [commissionRate, setCommissionRate] = useState(0.015); // 0.015%
  const [taxRate, setTaxRate] = useState(0.2); // 0.2%
  const [slippage, setSlippage] = useState(0.1); // 0.1%
  
  // 파라미터 오버라이드 (전략 파라미터 조정용)
  const [paramOverrides, setParamOverrides] = useState<Record<string, number>>({});
  
  // 일괄 테스트 (토너먼트) 설정
  const [selectedBulkIds, setSelectedBulkIds] = useState<string[]>([]);
  const [isBulkTesting, setIsBulkTesting] = useState(false);
  const [bulkResults, setBulkResults] = useState<BulkBacktestResult[] | null>(null);
  const [bulkSortConfig, setBulkSortConfig] = useState<{ key: keyof BulkBacktestResult; desc: boolean }>({
    key: "total_return",
    desc: true,
  });
  const [bulkBenchmarkReturn, setBulkBenchmarkReturn] = useState<number | null>(null);
  const [bulkParamOverrides, setBulkParamOverrides] = useState<Record<string, Record<string, any>>>({});
  
  // 선택된 전략 객체
  const selectedStrategy = useMemo(() => {
    if (!selectedId) return null;
    return allStrategies.find(s => s.id === selectedId) || null;
  }, [selectedId, allStrategies]);
  
  // 전략 선택 시 기본 파라미터로 초기화
  useEffect(() => {
    if (selectedStrategy?.params) {
      const defaults: Record<string, number> = {};
      Object.entries(selectedStrategy.params).forEach(([key, def]) => {
        defaults[key] = def.default;
      });
      setParamOverrides(defaults);
    } else {
      setParamOverrides({});
    }
  }, [selectedStrategy]);
  
  // 파라미터 변경 핸들러
  const handleParamChange = useCallback((name: string, value: number) => {
    setParamOverrides(prev => ({ ...prev, [name]: value }));
  }, []);
  
  // 결과
  const [isRunning, setIsRunning] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tradesOpen, setTradesOpen] = useState(false);

  // 로딩 단계 업데이트 (시뮬레이션)
  useEffect(() => {
    if (!isRunning) {
      setLoadingStep(0);
      return;
    }
    const interval = setInterval(() => {
      setLoadingStep((prev) => (prev < 5 ? prev + 1 : prev));
    }, 2500);
    return () => clearInterval(interval);
  }, [isRunning]);

  // 로딩 단계별 메시지
  const loadingMessages = [
    "데이터 확인 중...",
    "KOSPI 벤치마크 다운로드 중...",
    "종목 데이터 준비 중...",
    "Lean 엔진 실행 중...",
    "백테스트 진행 중...",
    "결과 분석 중...",
  ];

  // 데이터 로드 (strategies API가 14개 전체 포함)
  useEffect(() => {
    const loadData = async () => {
      try {
        const res = await listStrategies();
        setAllStrategies(res.data || []);
        setBackendDown(false);
      } catch {
        setAllStrategies([]);
        setBackendDown(true);
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, []);

  // Import 핸들러
  const handleImport = useCallback((file: File, content: string) => {
    setImportedYaml(content);
    setSelectedId(null);
  }, []);

  // 전략 선택 토글 (일괄 테스트용)
  const toggleStrategySelection = useCallback((id: string) => {
    setSelectedBulkIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  }, []);

  // 전체 선택/해제
  const toggleAllStrategies = useCallback(() => {
    if (selectedBulkIds.length === allStrategies.length) {
      setSelectedBulkIds([]);
    } else {
      setSelectedBulkIds(allStrategies.map(s => s.id));
    }
  }, [selectedBulkIds, allStrategies]);

  // 일괄 테스트 파라미터 개별 수정 핸들러
  const handleBulkParamChange = useCallback((strategyId: string, key: string, value: number) => {
    setBulkParamOverrides(prev => ({
      ...prev,
      [strategyId]: {
        ...(prev[strategyId] || {}),
        [key]: value
      }
    }));
  }, []);

  // 일괄 백테스트 실행
  const handleBulkRun = useCallback(async () => {
    if (selectedBulkIds.length === 0 || selectedStocks.length === 0) return;

    setIsBulkTesting(true);
    setBulkResults(null);
    setBulkBenchmarkReturn(null);
    setError(null);

    // 프리셋 전략들만 필터링 (Template 전략은 일괄 테스트 대상에서 제외)
    const validPresetIds = selectedBulkIds.filter(id => 
      allStrategies.find(s => s.id === id && !s.id.endsWith('.kis.yaml'))
    );

    if (validPresetIds.length === 0) {
      setError("일괄 테스트는 프리셋 전략들을 대상으로만 가능합니다.");
      setIsBulkTesting(false);
      return;
    }

    try {
      const response = await runBulkBacktest({
        strategy_ids: validPresetIds,
        symbols: selectedStocks,
        start_date: startDate,
        end_date: endDate,
        initial_capital: initialCapital,
        timeframe: timeframe,
        param_overrides: bulkParamOverrides,
      });

      if (response.success) {
        setBulkResults(response.results);
        if (response.benchmark_return !== undefined) {
          setBulkBenchmarkReturn(response.benchmark_return);
        }
        // 결과 화면으로 스크롤 (순위표가 나타나므로)
        setTimeout(() => {
          document.getElementById('bulk-results-section')?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      } else {
        setError(response.message || "일괄 백테스트 실패");
      }
    } catch (e) {
      setError("일괄 백테스트 중 오류가 발생했습니다");
    } finally {
      setIsBulkTesting(false);
    }
  }, [selectedBulkIds, selectedStocks, startDate, endDate, initialCapital, timeframe]);

  const handleCopyForAI = useCallback(() => {
    if (!bulkResults) return;

    const summary = bulkResults
      .filter(r => r.success)
      .sort((a, b) => b.total_return - a.total_return)
      .map((r, i) => {
        const params = r.parameters 
          ? Object.entries(r.parameters).map(([k, v]) => `${k}=${v}`).join(', ')
          : 'N/A';
        const returnSign = r.total_return > 0 ? '+' : '';
        const winSign = r.win_rate > 0 ? '+' : '';
        return `${i + 1}. ${r.strategy_name}\n   - 누적수익률: ${returnSign}${r.total_return.toFixed(2)}%\n   - Sharpe: ${r.sharpe_ratio.toFixed(2)}\n   - MDD: -${Math.abs(r.max_drawdown).toFixed(2)}%\n   - 승률: ${winSign}${r.win_rate.toFixed(2)}%\n   - 총 거래수: ${r.total_trades}회\n   - 파라미터: ${params}`;
      })
      .join('\n\n');

    const text = `
당신은 10년 이상의 경험을 가진 전문 퀀트 투자자이자 알고리즘 트레이딩 개발자입니다.

아래 제공된 주식 자동매매 전략의 백테스트 결과를 심층적으로 분석하고, 수익성과 안정성을 높일 수 있도록 전략 파라미터를 조절해 주세요.

### [백테스트 성과 분석 요청]
- 기간: ${startDate} ~ ${endDate}
- 종목: ${selectedStocks.join(', ')}
- 기준 지수(KOSPI) 수익률: ${bulkBenchmarkReturn !== null ? bulkBenchmarkReturn.toFixed(2) + '%' : 'N/A'}

#### 전략별 성과 순위 (수익률 순)
${summary}

---
위 결과를 분석하여 어떤 전략의 파라미터 조합이 가장 효율적이었는지, 그리고 시장 지수 대비 초과 수익을 낸 핵심 요인이 무엇일지 설명해줘.
    `.trim();

    navigator.clipboard.writeText(text).then(() => {
      alert("AI 분석용 텍스트가 클립보드에 복사되었습니다!");
    });
  }, [bulkResults, bulkBenchmarkReturn, startDate, endDate, selectedStocks]);

  // 백테스트 실행
  const handleRun = useCallback(async () => {
    if (!selectedId && !importedYaml) return;
    if (selectedStocks.length === 0) return;

    setIsRunning(true);
    setError(null);
    setResult(null);

    try {
      let response;

      // 1. Import된 YAML이 있으면 커스텀 백테스트
      if (importedYaml) {
        response = await runCustomBacktest(
          importedYaml,
          selectedStocks,
          startDate,
          endDate,
          initialCapital,
          commissionRate / 100, // % → 소수점
          taxRate / 100,
          slippage / 100,
          timeframe // 해상도 전달
        );
      }
      // 2. 전략 선택 시 프리셋 백테스트
      else if (selectedId) {
        response = await runBacktest({
          strategy_id: selectedId,
          symbols: selectedStocks,
          start_date: startDate,
          end_date: endDate,
          initial_capital: initialCapital,
          commission_rate: commissionRate / 100,
          tax_rate: taxRate / 100,
          slippage: slippage / 100,
          param_overrides: Object.keys(paramOverrides).length > 0 ? paramOverrides : undefined,
          timeframe: timeframe // 해상도 전달
        });
      } else {
        throw new Error("전략을 선택하거나 파일을 Import하세요");
      }

      if (response.success) {
        setResult(response.data);
      } else {
        setError(response.message || "백테스트 실패");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "백테스트 실행 중 오류");
    } finally {
      setIsRunning(false);
    }
  }, [selectedId, importedYaml, selectedStocks, startDate, endDate, initialCapital, commissionRate, taxRate, slippage, paramOverrides, timeframe]);

  // Y축 범위 계산 (15% 패딩)
  const yAxisDomain = useMemo((): [number, number] => {
    if (!result?.equity_curve) return [0, 100_000_000];
    const values = Object.values(result.equity_curve);
    const benchmarkValues = result.benchmark_curve
      ? Object.values(result.benchmark_curve).map(pct => initialCapital * (1 + pct / 100))
      : [];
    const allValues = [...values, ...benchmarkValues, initialCapital];
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const padding = (max - min) * 0.15;
    return [Math.max(0, min - padding), max + padding];
  }, [result, initialCapital]);

  // 차트 데이터 (KOSPI는 초기자본 기준 절대값으로 변환, drawdown 포함)
  const chartData: ChartDataPoint[] = useMemo(() => {
    if (!result?.equity_curve) return [];
    const entries = Object.entries(result.equity_curve);
    const benchmarkEntries = result.benchmark_curve || {};

    let peak = -Infinity;

    return entries.map(([date, value]) => {
      // 분 단위 타임스탬프(YYYY-MM-DD HH:MM:SS)에서 날짜 부분만 추출하여 벤치마크 조회
      const dateOnly = date.split(' ')[0];
      const benchmarkPct = benchmarkEntries[date] ?? benchmarkEntries[dateOnly];
      
      const benchmarkValue = benchmarkPct != null
        ? initialCapital * (1 + benchmarkPct / 100)
        : null;

      // Track running peak for drawdown
      peak = Math.max(peak, value);
      const drawdown = peak > 0 ? ((value - peak) / peak) * 100 : 0;

      return {
        date,
        value,
        returnPct: ((value - initialCapital) / initialCapital) * 100,
        benchmarkPct: benchmarkPct ?? null,
        benchmark: benchmarkValue,
        drawdown,
      };
    });
  }, [result, initialCapital]);

  // 거래 내역 (Buy/Sell 마커용)
  const tradeMarkers: TradeMarker[] = useMemo(() => {
    if (!result?.trades || result.trades.length === 0) return [];

    return result.trades.map((trade) => ({
      date: trade.time, // 백엔드에서 통일된 형식(%Y-%m-%d %H:%M:%S)을 그대로 사용
      type: trade.direction.toLowerCase() as "buy" | "sell",
      price: trade.price,
    }));
  }, [result]);

  const canRun = (selectedId || importedYaml) && selectedStocks.length > 0;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 relative">
      {/* 로딩 오버레이 */}
      {isRunning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 shadow-2xl max-w-sm w-full mx-4">
            <div className="flex flex-col items-center">
              {/* 스피너 */}
              <div className="relative w-16 h-16 mb-6">
                <div className="absolute inset-0 border-4 border-slate-200 dark:border-slate-700 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-kis-blue border-t-transparent rounded-full animate-spin"></div>
              </div>

              {/* 현재 단계 */}
              <p className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
                {loadingMessages[loadingStep]}
              </p>

              {/* 진행률 바 */}
              <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 mb-4">
                <div
                  className="bg-kis-blue h-2 rounded-full transition-all duration-500"
                  style={{ width: `${((loadingStep + 1) / loadingMessages.length) * 100}%` }}
                ></div>
              </div>

              {/* 단계 표시 */}
              <p className="text-xs text-slate-500">
                {loadingStep + 1} / {loadingMessages.length}
              </p>

              {/* 안내 메시지 */}
              <p className="text-xs text-slate-400 mt-4 text-center">
                처음 실행 시 데이터 다운로드로 시간이 걸릴 수 있습니다
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 백엔드 미실행 경고 */}
      {backendDown && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-700 dark:text-red-400">백엔드 서버가 실행되지 않았습니다</p>
              <p className="text-sm text-red-600/80 dark:text-red-400/80 mt-1">
                백테스트를 실행하려면 먼저 백엔드 서버를 시작하세요:
              </p>
              <code className="block mt-2 px-3 py-2 bg-red-100 dark:bg-red-900/40 rounded-lg text-sm font-mono text-red-800 dark:text-red-300">
                cd backend && uv run uvicorn main:app --port 8003 --reload
              </code>
            </div>
          </div>
        </div>
      )}

      {/* 헤더 */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">백테스트</h1>
        <p className="text-slate-600 dark:text-slate-400">
          YAML 파일을 드롭하거나 전략을 선택하여 백테스트를 실행하세요
        </p>
      </div>

      {/* 2컬럼 레이아웃 */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* 왼쪽: 설정 */}
        <div className="space-y-4">
          {/* 파일 드롭존 */}
          <FileDropZone
            onFileSelect={handleImport}
            className="min-h-[120px]"
          />

          {/* 또는 전략 선택 */}
          <div className="card">
            <h3 className="font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
              <Zap className="w-4 h-4 text-kis-blue" />
              전략 선택
            </h3>
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-slate-400 mx-auto" />
            ) : (
              <select
                value={selectedId || ""}
                onChange={(e) => {
                  setSelectedId(e.target.value || null);
                  setImportedYaml(null);
                }}
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
              >
                <option value="">-- 전략 선택 ({allStrategies.length}개) --</option>
                {allStrategies.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
            {importedYaml && (
              <div className="mt-2 px-2 py-1 bg-amber-100 text-amber-700 rounded text-xs">
                Import된 파일 사용 중
              </div>
            )}
            
            {/* 전략 설명 */}
            {selectedStrategy && (
              <p className="mt-2 text-xs text-slate-500">
                {selectedStrategy.description}
              </p>
            )}
          </div>

          {/* 파라미터 설정 (전략 선택 시만 표시) */}
          {selectedStrategy?.params && Object.keys(selectedStrategy.params).length > 0 && (
            <div className="card">
              <h3 className="font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                <Activity className="w-4 h-4 text-kis-blue" />
                파라미터 설정
              </h3>
              <div className="space-y-4">
                {Object.entries(selectedStrategy.params).map(([name, def]) => (
                  <ParamSlider
                    key={name}
                    name={name}
                    definition={def}
                    value={paramOverrides[name] ?? def.default}
                    onChange={(value) => handleParamChange(name, value)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 종목 선택 */}
          <div className="card">
            <h3 className="font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
              <Target className="w-4 h-4 text-kis-blue" />
              종목 선택
            </h3>
            <StockInput stocks={selectedStocks} onChange={setSelectedStocks} />
          </div>

          {/* 기간 설정 */}
          <div className="card">
            <h3 className="font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-kis-blue" />
              기간 설정
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500 mb-1 block font-semibold flex items-center justify-between">
                  해상도 (Resolution)
                  {timeframe === "minute" && (
                    <span className="text-[10px] text-kis-blue font-normal">최근 1년 이내 데이터만 가능</span>
                  )}
                </label>
                <div className="flex p-1 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                  <button
                    onClick={() => setTimeframe("daily")}
                    className={cn(
                      "flex-1 py-1.5 text-xs font-semibold rounded-md transition-all",
                      timeframe === "daily" 
                        ? "bg-white dark:bg-slate-800 text-kis-blue shadow-sm" 
                        : "text-slate-500 hover:text-slate-700"
                    )}
                  >
                    일봉 (Daily)
                  </button>
                  <button
                    onClick={() => setTimeframe("minute")}
                    className={cn(
                      "flex-1 py-1.5 text-xs font-semibold rounded-md transition-all",
                      timeframe === "minute" 
                        ? "bg-white dark:bg-slate-800 text-kis-blue shadow-sm" 
                        : "text-slate-500 hover:text-slate-700"
                    )}
                  >
                    분봉 (Minute)
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">시작일</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">종료일</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">초기 자본 (원)</label>
                <input
                  type="number"
                  value={initialCapital}
                  onChange={(e) => setInitialCapital(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm"
                />
              </div>
            </div>
          </div>

          {/* 일괄 백테스트 (토너먼트) */}
          <div className="card border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20">
            <h3 className="font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" />
              전략 토너먼트 (10가지 전략 일괄 테스트)
            </h3>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">테스트 대상 전략 선택</span>
                <button
                  onClick={toggleAllStrategies}
                  className="text-[10px] text-kis-blue hover:underline font-medium"
                >
                  {selectedBulkIds.length === allStrategies.length ? "전체 해제" : "전체 선택"}
                </button>
              </div>

              {/* 전략 체크박스 그리드 */}
              <div className="grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto p-2 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                {allStrategies.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={selectedBulkIds.includes(s.id)}
                      onChange={() => toggleStrategySelection(s.id)}
                      className="w-3.5 h-3.5 rounded border-slate-300 text-kis-blue focus:ring-kis-blue"
                    />
                    <span className="text-xs text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">
                      {s.name}
                    </span>
                  </label>
                ))}
              </div>

              <button
                onClick={handleBulkRun}
                disabled={selectedBulkIds.length === 0 || selectedStocks.length === 0 || isBulkTesting}
                className={cn(
                  "w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold transition-all",
                  selectedBulkIds.length > 0 && !isBulkTesting
                    ? "bg-amber-500 hover:bg-amber-600 text-white shadow-sm"
                    : "bg-slate-200 text-slate-400 cursor-not-allowed"
                )}
              >
                {isBulkTesting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    토너먼트 진행 중...
                  </>
                ) : (
                  <>
                    <TrendingUp className="w-4 h-4" />
                    10가지 전략 동시 테스트 및 분석
                  </>
                )}
              </button>
              <p className="text-[10px] text-center text-slate-400">
                * 선택된 {selectedBulkIds.length}개 전략을 순차적으로 테스트합니다.
              </p>
            </div>
          </div>

          {/* 실행 버튼 */}
          <button
            onClick={handleRun}
            disabled={!canRun || isRunning}
            className={cn(
              "w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all",
              canRun && !isRunning
                ? "bg-kis-blue hover:bg-kis-blue-dark text-white shadow-lg"
                : "bg-slate-200 text-slate-400 cursor-not-allowed"
            )}
          >
            {isRunning ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                실행 중...
              </>
            ) : (
              <>
                <Play className="w-5 h-5" />
                백테스트 실행
              </>
            )}
          </button>
        </div>

        {/* 오른쪽: 결과 */}
        <div className="lg:col-span-2 space-y-4">
          {error && (
            <div className="card bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-red-600 dark:text-red-400 font-medium">{error}</p>
                  {/* 도움말 표시 */}
                  {error.includes("Docker") && (
                    <div className="mt-2 text-xs text-red-500/80 space-y-1">
                      <p>• Docker Desktop이 설치되어 있는지 확인하세요</p>
                      <p>• Docker Desktop을 실행한 후 재시도하세요</p>
                      <p className="font-mono bg-red-100 dark:bg-red-900/30 px-2 py-1 rounded">
                        docker pull quantconnect/lean:latest
                      </p>
                    </div>
                  )}
                  {error.includes("데이터") && (
                    <div className="mt-2 text-xs text-red-500/80 space-y-1">
                      <p>• 종목 코드가 올바른지 확인하세요 (예: 005930)</p>
                      <p>• 백테스트 기간에 거래일이 포함되어 있는지 확인하세요</p>
                      <p>• KIS API 환경설정(.env)을 확인하세요</p>
                    </div>
                  )}
                  {error.includes("지표") && (
                    <div className="mt-2 text-xs text-red-500/80 space-y-1">
                      <p>• 전략의 지표 설정을 확인하세요</p>
                      <p>• 지표 파라미터가 올바른 범위인지 확인하세요</p>
                    </div>
                  )}
                  {error.includes("시간 초과") && (
                    <div className="mt-2 text-xs text-red-500/80 space-y-1">
                      <p>• 백테스트 기간을 줄여보세요</p>
                      <p>• 복잡한 조건을 단순화해보세요</p>
                    </div>
                  )}
                  {(error.includes("인증") || error.includes("my_url") || error.includes("appkey")) && (
                    <div className="mt-2 text-sm text-red-600 dark:text-red-400 space-y-1">
                      <p className="font-medium">인증 설정 확인:</p>
                      <ul className="list-disc ml-4 space-y-1 text-xs">
                        <li>~/KIS/config/kis_devlp.yaml 파일의 appkey / appsecret을 확인해주세요</li>
                        <li>모의투자: paper_app, paper_sec / 실전투자: my_app, my_sec</li>
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {result ? (
            <>
              {/* 요약 카드 */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard
                  label="총 수익률"
                  value={formatPercent(result.net_profit_percent)}
                  subValue={formatCurrency(result.net_profit)}
                  icon={TrendingUp}
                  positive={result.net_profit >= 0}
                  iconColor="text-emerald-500"
                />
                <StatCard
                  label="CAGR"
                  value={formatPercent(result.metrics.basic.annual_return)}
                  icon={Target}
                  positive={result.metrics.basic.annual_return >= 0}
                  iconColor="text-blue-500"
                />
                <StatCard
                  label="최대 낙폭"
                  value={formatPercent(-Math.abs(result.metrics.basic.max_drawdown))}
                  icon={AlertTriangle}
                  positive={false}
                  iconColor="text-amber-500"
                />
                <StatCard
                  label="샤프 비율"
                  value={result.metrics.risk.sharpe_ratio.toFixed(2)}
                  icon={Shield}
                  positive={result.metrics.risk.sharpe_ratio > 1 ? true : result.metrics.risk.sharpe_ratio < 0.5 ? false : null}
                  iconColor="text-purple-500"
                />
              </div>

              {/* 차트 (Equity + Drawdown) */}
              {chartData.length > 0 && (
                <EquityChart
                  chartData={chartData}
                  tradeMarkers={tradeMarkers}
                  initialCapital={initialCapital}
                  yAxisDomain={yAxisDomain}
                />
              )}

              {/* 전체 통계 */}
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                <MetricsGroup
                  title="위험 대비 성과"
                  icon={Shield}
                  metrics={[
                    { label: "샤프 비율", value: result.metrics.risk.sharpe_ratio.toFixed(2), highlight: true },
                    { label: "소르티노 비율", value: result.metrics.risk.sortino_ratio.toFixed(2) },
                    { label: "확률적 샤프", value: formatPercent(result.metrics.risk.probabilistic_sharpe) },
                  ]}
                />
                <MetricsGroup
                  title="시장 민감도"
                  icon={Activity}
                  metrics={[
                    { label: "알파", value: result.metrics.greeks.alpha.toFixed(4) },
                    { label: "베타", value: result.metrics.greeks.beta.toFixed(4) },
                  ]}
                />
                <MetricsGroup
                  title="변동성"
                  icon={BarChart3}
                  metrics={[
                    { label: "연간 표준편차", value: formatPercent(result.metrics.volatility.annual_std_dev) },
                    { label: "연간 분산", value: result.metrics.volatility.annual_variance.toFixed(4) },
                  ]}
                />
                <MetricsGroup
                  title="시장 대비 성과"
                  icon={Target}
                  badge="KOSPI기준"
                  metrics={[
                    { label: "정보 비율", value: result.metrics.benchmark.information_ratio.toFixed(2) },
                    { label: "추적 오차", value: formatPercent(result.metrics.benchmark.tracking_error) },
                    { label: "트레이너 비율", value: result.metrics.benchmark.treynor_ratio !== 0 ? result.metrics.benchmark.treynor_ratio.toFixed(4) : "N/A" },
                  ]}
                />
                <MetricsGroup
                  title="매매 리포트"
                  icon={Repeat}
                  metrics={[
                    { label: "체결 거래", value: `${result.trades_count}회`, highlight: true },
                    { label: "승률", value: formatPercent(result.metrics.trading.win_rate), positive: result.metrics.trading.win_rate > 0.5 ? true : result.metrics.trading.win_rate < 0.5 ? false : null },
                    { label: "평균 수익", value: formatPercent(result.metrics.trading.avg_win), positive: true },
                    { label: "평균 손실", value: formatPercent(result.metrics.trading.avg_loss), positive: false },
                    { label: "손익비", value: result.metrics.trading.profit_loss_ratio.toFixed(2) },
                    { label: "기대값", value: result.metrics.trading.expectancy.toFixed(4) },
                  ]}
                />
                <MetricsGroup
                  title="운용 정보 및 비용"
                  icon={DollarSign}
                  metrics={[
                    { label: "총 수수료", value: formatCurrency(result.metrics.other.total_fees) },
                    { label: "회전율", value: formatPercent(result.metrics.other.portfolio_turnover) },
                    { label: "낙폭 회복", value: result.metrics.other.drawdown_recovery > 0 ? `${result.metrics.other.drawdown_recovery.toFixed(0)}일` : "-" },
                  ]}
                />
              </div>

              {/* 거래 내역 */}
              {result.trades && result.trades.length > 0 && (
                <div className="card">
                  <button
                    onClick={() => setTradesOpen((o) => !o)}
                    className="w-full flex items-center justify-between text-sm font-medium text-slate-700 dark:text-slate-300"
                  >
                    <span>거래 내역 ({result.trades.length}건)</span>
                    <ChevronDown className={cn("w-4 h-4 transition-transform", tradesOpen && "rotate-180")} />
                  </button>
                  {tradesOpen && (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                            <th className="pb-2 pr-4 font-medium">시간</th>
                            <th className="pb-2 pr-4 font-medium">종목</th>
                            <th className="pb-2 pr-4 font-medium">방향</th>
                            <th className="pb-2 pr-4 text-right font-medium">수량</th>
                            <th className="pb-2 text-right font-medium">체결가</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.trades.map((trade, i) => (
                            <tr key={i} className="border-b border-slate-100 dark:border-slate-800 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                              <td className="py-1.5 pr-4 text-slate-500 dark:text-slate-400 text-xs">
                                {trade.time ? new Date(trade.time).toLocaleDateString("ko-KR") : "-"}
                              </td>
                              <td className="py-1.5 pr-4 font-mono">{trade.symbol}</td>
                              <td className={cn("py-1.5 pr-4 font-medium", trade.direction === "Buy" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
                                {trade.direction === "Buy" ? "매수" : "매도"}
                              </td>
                              <td className="py-1.5 pr-4 text-right">{trade.quantity.toLocaleString()}주</td>
                              <td className="py-1.5 text-right font-mono">{Math.round(trade.price).toLocaleString()}원</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : isBulkTesting ? (
            <div className="card flex flex-col items-center justify-center py-24 text-kis-blue">
              <div className="relative mb-6">
                <Loader2 className="w-16 h-16 animate-spin opacity-20" />
                <Zap className="w-8 h-8 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse" />
              </div>
              <p className="text-xl font-bold mb-2">전략 토너먼트 진행 중</p>
              <p className="text-sm text-slate-500 text-center max-w-xs">
                선택된 전략들을 순차적으로 테스트하고 성과를 분석하고 있습니다. 잠시만 기다려 주세요...
              </p>
              <div className="mt-8 flex gap-2">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="w-2 h-2 rounded-full bg-kis-blue/30 animate-bounce" style={{ animationDelay: `${i * 0.2}s` }} />
                ))}
              </div>
            </div>
          ) : bulkResults ? (
            <>
              <BulkResultsTable
                results={bulkResults}
                sortConfig={bulkSortConfig}
                onSort={(key) => setBulkSortConfig(prev => ({ key, desc: prev.key === key ? !prev.desc : true }))}
                benchmarkReturn={bulkBenchmarkReturn}
              />
            <div className="mt-6 flex justify-center">
              <button
                onClick={handleCopyForAI}
                className="btn btn-kis-blue py-3 px-8 flex items-center gap-2 shadow-lg hover:translate-y-[-2px] transition-all"
              >
                <MessageSquare className="w-5 h-5" />
                <span>AI에게 성과 분석 요청하기 (복사)</span>
                <ClipboardCopy className="w-4 h-4 ml-2 opacity-50" />
              </button>
            </div>
          </>
        ) : (
          <div className="card flex flex-col items-center justify-center py-16 text-slate-400">
            <BarChart3 className="w-16 h-16 mb-4 opacity-30" />
            <p className="text-lg font-medium">결과 없음</p>
            <p className="text-sm mt-1">백테스트를 실행하면 결과가 표시됩니다</p>
          </div>
        )}

        {/* 파라미터 조정표 - 전략이 선택되면 결과 유무와 상관없이 항상 표시 */}
        <BulkParamsTable 
          selectedIds={selectedBulkIds}
          results={bulkResults} 
          overrides={bulkParamOverrides}
          onChange={handleBulkParamChange}
          allStrategies={allStrategies}
        />
        </div>
      </div>
    </div>
  );
}
