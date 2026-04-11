/**
 * 백테스트 API
 */

import { apiPost } from "./client";
import type {
  BacktestRequest,
  CustomBacktestRequest,
  BacktestResponse,
  BulkBacktestRequest,
  BulkBacktestResponse,
} from "@/types";

/**
 * 백테스트 실행 (Preset 전략)
 */
export async function runBacktest(request: BacktestRequest): Promise<BacktestResponse> {
  return apiPost("/api/backtest/run", request);
}

/**
 * 일괄 백테스트 실행 (전략 토너먼트)
 */
export async function runBulkBacktest(request: BulkBacktestRequest): Promise<BulkBacktestResponse> {
  return apiPost("/api/backtest/bulk", request);
}

/**
 * 커스텀 전략 백테스트 실행 (YAML)
 */
export async function runCustomBacktest(
  yamlContent: string,
  symbols: string[],
  startDate: string,
  endDate: string,
  initialCapital: number,
  commissionRate?: number,
  taxRate?: number,
  slippage?: number,
  timeframe: string = "daily"
): Promise<BacktestResponse> {
  const request: CustomBacktestRequest = {
    yaml_content: yamlContent,
    symbols,
    start_date: startDate,
    end_date: endDate,
    initial_capital: initialCapital,
    commission_rate: commissionRate,
    tax_rate: taxRate,
    slippage,
    timeframe,
  };
  return apiPost("/api/backtest/run-custom", request);
}
