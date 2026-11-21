import React from 'react';
import type { OrderbookLiquidityMetrics } from '../types/market';
import { formatPrice, formatUsdCompact } from '../utils/format';

interface OrderbookWallsPanelProps {
  symbol: string;
  metrics: OrderbookLiquidityMetrics;
  onOpenLiquidityPage: () => void;
}

export const OrderbookWallsPanel: React.FC<OrderbookWallsPanelProps> = ({
  symbol,
  metrics,
  onOpenLiquidityPage,
}) => {
  const bidPct = Math.round(metrics.imbalanceRatio * 100);
  const askPct = 100 - bidPct;
  const maxWallUsd = Math.max(
    1,
    ...metrics.topBidWalls.map((w) => w.usdValue),
    ...metrics.topAskWalls.map((w) => w.usdValue)
  );

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Dinding Likuiditas Orderbook ({symbol})
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
            Kedalaman ±2% · Spread {formatPrice(metrics.spreadUsd)} ({metrics.spreadPercent.toFixed(3)}%)
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenLiquidityPage}
          className="px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-md hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
        >
          Analisis Kedalaman
        </button>
      </div>

      {/* Imbalance Bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs font-mono tabular-nums mb-1.5">
          <span className="text-emerald-700 font-semibold">
            BID {bidPct}% ({formatUsdCompact(metrics.bidLiquidity2PctUsd)})
          </span>
          <span className="text-slate-500 font-sans">
            {metrics.bias === 'BID_DOMINANT'
              ? 'Dominasi Beli'
              : metrics.bias === 'ASK_DOMINANT'
              ? 'Dominasi Jual'
              : 'Seimbang'}
          </span>
          <span className="text-rose-700 font-semibold">
            ASK {askPct}% ({formatUsdCompact(metrics.askLiquidity2PctUsd)})
          </span>
        </div>
        <div className="h-2 w-full rounded bg-rose-100 overflow-hidden flex">
          <div
            className="h-full bg-emerald-600 transition-all duration-300"
            style={{ width: `${bidPct}%` }}
          />
        </div>
      </div>

      {/* Top Bid & Ask Liquidity Walls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div className="flex items-center justify-between text-xs text-slate-500 pb-2 border-b border-slate-200">
            <span>Top Bid Walls (Support)</span>
            <span>Nilai Likuiditas</span>
          </div>
          <div className="divide-y divide-slate-100">
            {metrics.topBidWalls.map((wall, idx) => {
              const barW = Math.min(100, (wall.usdValue / maxWallUsd) * 100);
              return (
                <div
                  key={`bid-${wall.price}-${idx}`}
                  className="relative flex items-center justify-between py-2 px-1 text-xs font-mono tabular-nums"
                >
                  <div
                    className="absolute inset-y-0.5 left-0 bg-emerald-50 rounded-xs pointer-events-none"
                    style={{ width: `${barW}%` }}
                  />
                  <span className="relative text-emerald-700 font-semibold">
                    {formatPrice(wall.price)}
                    <span className="text-slate-400 font-normal ml-1.5">
                      (-{wall.distancePercent.toFixed(2)}%)
                    </span>
                  </span>
                  <span className="relative text-slate-800 font-medium">
                    {formatUsdCompact(wall.usdValue)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between text-xs text-slate-500 pb-2 border-b border-slate-200">
            <span>Top Ask Walls (Resistance)</span>
            <span>Nilai Likuiditas</span>
          </div>
          <div className="divide-y divide-slate-100">
            {metrics.topAskWalls.map((wall, idx) => {
              const barW = Math.min(100, (wall.usdValue / maxWallUsd) * 100);
              return (
                <div
                  key={`ask-${wall.price}-${idx}`}
                  className="relative flex items-center justify-between py-2 px-1 text-xs font-mono tabular-nums"
                >
                  <div
                    className="absolute inset-y-0.5 right-0 bg-rose-50 rounded-xs pointer-events-none"
                    style={{ width: `${barW}%` }}
                  />
                  <span className="relative text-rose-700 font-semibold">
                    {formatPrice(wall.price)}
                    <span className="text-slate-400 font-normal ml-1.5">
                      (+{wall.distancePercent.toFixed(2)}%)
                    </span>
                  </span>
                  <span className="relative text-slate-800 font-medium">
                    {formatUsdCompact(wall.usdValue)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};
