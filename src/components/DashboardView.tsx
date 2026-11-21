import React from 'react';
import type {
  AllowedTimeframe,
  Candle,
  FuturesMarketMeta,
  MarketAnalysisResult,
  MarketType,
  MultiTimeframeRecommendation,
  Ticker24h,
} from '../types/market';
import { formatPercent, formatPrice, formatUsdCompact } from '../utils/format';
import { AdvancedPillarsPanel } from './AdvancedPillarsPanel';
import { CandlestickChart } from './CandlestickChart';
import { DecisionPanel } from './DecisionPanel';
import { OrderbookWallsPanel } from './OrderbookWallsPanel';

interface DashboardViewProps {
  symbol: string;
  timeframe: string;
  market: MarketType;
  ticker: Ticker24h;
  candles: Candle[];
  analysis: MarketAnalysisResult;
  mtfRecommendation?: MultiTimeframeRecommendation | null;
  futuresMeta: FuturesMarketMeta | null;
  onSelectTimeframe?: (tf: AllowedTimeframe) => void;
  onOpenLiquidityPage: () => void;
  onUseExecutionPlan: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  symbol,
  timeframe,
  market,
  ticker,
  candles,
  analysis,
  mtfRecommendation,
  futuresMeta,
  onSelectTimeframe,
  onOpenLiquidityPage,
  onUseExecutionPlan,
}) => {
  const seriesIdx = analysis.series.rsi14.length - 1;
  const rsi14 = seriesIdx >= 0 ? (analysis.series.rsi14[seriesIdx] ?? null) : null;
  const ema21 = seriesIdx >= 0 ? (analysis.series.ema21[seriesIdx] ?? null) : null;
  const sma50 = seriesIdx >= 0 ? (analysis.series.sma50[seriesIdx] ?? null) : null;
  const isUp24h = ticker.priceChangePercent >= 0;
  const bidPct = Math.round(analysis.liquidityMetrics.imbalanceRatio * 100);

  return (
    <div className="space-y-4">
      {/* Top 4-Column KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div className="text-xs text-slate-500">
            Harga Terakhir ({symbol} · {market === 'futures' ? 'USD-M Futures' : 'Spot'})
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span
              data-testid="current-price"
              className="text-xl font-bold font-mono tabular-nums text-slate-900"
            >
              ${formatPrice(ticker.lastPrice || analysis.currentPrice)}
            </span>
            <span
              className={`text-xs font-mono tabular-nums font-semibold ${
                isUp24h ? 'text-emerald-700' : 'text-rose-700'
              }`}
            >
              {formatPercent(ticker.priceChangePercent)}
            </span>
          </div>
          <div className="mt-1 text-xs font-mono tabular-nums text-slate-500">
            H: {formatPrice(ticker.highPrice)} · L: {formatPrice(ticker.lowPrice)}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div className="text-xs text-slate-500">
            {market === 'futures' && futuresMeta
              ? 'Mark Price / Funding Rate'
              : 'Posisi Tren (EMA 21 / SMA 50)'}
          </div>
          {market === 'futures' && futuresMeta ? (
            <>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="text-base font-semibold font-mono tabular-nums text-slate-900">
                  ${formatPrice(futuresMeta.markPrice)}
                </span>
                <span
                  className={`text-xs font-mono tabular-nums font-semibold ${
                    futuresMeta.lastFundingRate >= 0 ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  FR {(futuresMeta.lastFundingRate * 100).toFixed(4)}%
                </span>
              </div>
              <div className="mt-1 text-xs font-mono tabular-nums text-slate-500">
                Open Interest: {formatUsdCompact(futuresMeta.openInterestUsd)}
              </div>
            </>
          ) : (
            <>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="text-base font-semibold font-mono tabular-nums text-slate-900">
                  {formatPrice(ema21)} / {formatPrice(sma50)}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {ema21 && analysis.currentPrice > ema21
                  ? 'Harga bertahan di atas EMA 21'
                  : 'Harga di bawah EMA 21'}
              </div>
            </>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div className="text-xs text-slate-500">Momentum RSI(14) & Volume</div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="text-xl font-bold font-mono tabular-nums text-slate-900">
              {rsi14 !== null ? rsi14.toFixed(1) : '—'}
            </span>
            <span className="text-xs font-mono tabular-nums text-slate-700">
              Vol {analysis.volumeRatio20.toFixed(2)}x Avg20
            </span>
          </div>
          <div className="mt-1 text-xs font-mono tabular-nums text-slate-500">
            Vol 24j: {formatUsdCompact(ticker.quoteVolume)}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div className="text-xs text-slate-500">Imbalance Likuiditas (±2%)</div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span
              className={`text-xl font-bold font-mono tabular-nums ${
                bidPct >= 55
                  ? 'text-emerald-700'
                  : bidPct <= 45
                  ? 'text-rose-700'
                  : 'text-slate-900'
              }`}
            >
              {bidPct}% Bid
            </span>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {100 - bidPct}% Ask
            </span>
          </div>
          <div className="mt-1 text-xs font-mono tabular-nums text-slate-500">
            Bid: {formatUsdCompact(analysis.liquidityMetrics.bidLiquidity2PctUsd)}
          </div>
        </div>
      </div>

      {/* Main 12-Column Analytical Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <div className="xl:col-span-8 space-y-4">
          <CandlestickChart
            symbol={symbol}
            timeframe={timeframe}
            candles={candles}
            series={analysis.series}
            executionPlan={analysis.executionPlan}
            swingLevels={analysis.swingLevels}
            advanced={analysis.advanced}
          />

          <OrderbookWallsPanel
            symbol={symbol}
            metrics={analysis.liquidityMetrics}
            onOpenLiquidityPage={onOpenLiquidityPage}
          />

          <AdvancedPillarsPanel
            symbol={symbol}
            timeframe={timeframe}
            advanced={analysis.advanced}
            rsi14={rsi14}
            atr14={analysis.executionPlan.atr14}
            volumeRatio20={analysis.volumeRatio20}
          />
        </div>

        <div className="xl:col-span-4">
          <DecisionPanel
            analysis={analysis}
            mtfRecommendation={mtfRecommendation}
            onSelectTimeframe={onSelectTimeframe}
            onUseExecutionPlan={onUseExecutionPlan}
          />
        </div>
      </div>
    </div>
  );
};
