import React, { useMemo, useState } from 'react';
import { estimateOrderSlippage } from '../lib/indicators';
import type { MarketAnalysisResult, OrderbookData } from '../types/market';
import { formatPrice, formatTimestamp, formatUsdCompact } from '../utils/format';

interface LiquidityAnalysisViewProps {
  symbol: string;
  timeframe: string;
  orderbook: OrderbookData;
  analysis: MarketAnalysisResult;
}

export const LiquidityAnalysisView: React.FC<LiquidityAnalysisViewProps> = ({
  symbol,
  timeframe,
  orderbook,
  analysis,
}) => {
  const [simOrderSide, setSimOrderSide] = useState<'BUY' | 'SELL'>('BUY');
  const [simOrderUsd, setSimOrderUsd] = useState<string>('25000');

  const { liquidityMetrics, swingLevels, recentSweep } = analysis;

  const parsedOrderUsd = Math.max(0, Number(simOrderUsd) || 0);
  const slippageEstimate = useMemo(
    () =>
      estimateOrderSlippage(
        simOrderSide,
        parsedOrderUsd,
        orderbook.bids,
        orderbook.asks
      ),
    [simOrderSide, parsedOrderUsd, orderbook.bids, orderbook.asks]
  );

  const depthSvg = useMemo(() => {
    const bids = liquidityMetrics.cumulativeBids.slice(0, 45);
    const asks = liquidityMetrics.cumulativeAsks.slice(0, 45);
    if (bids.length === 0 || asks.length === 0) return null;

    const minP = bids[bids.length - 1].price;
    const maxP = asks[asks.length - 1].price;
    const spanP = maxP - minP || 1;
    const maxCum = Math.max(
      bids[bids.length - 1].cumulativeUsd,
      asks[asks.length - 1].cumulativeUsd,
      1
    );

    const w = 720;
    const h = 220;
    const padTop = 30;
    const padB = 24;
    const plotH = h - padTop - padB;

    const xFor = (p: number) => ((p - minP) / spanP) * w;
    const yFor = (cum: number) => padTop + plotH - (cum / maxCum) * plotH;

    const bidPoints = [...bids]
      .reverse()
      .map((b) => `${xFor(b.price).toFixed(1)},${yFor(b.cumulativeUsd).toFixed(1)}`);
    const bidArea = `M ${xFor(bids[bids.length - 1].price).toFixed(1)},${padTop + plotH} L ${bidPoints.join(' L ')} L ${xFor(bids[0].price).toFixed(1)},${padTop + plotH} Z`;
    const bidStroke = `M ${bidPoints.join(' L ')}`;

    const askPoints = asks.map(
      (a) => `${xFor(a.price).toFixed(1)},${yFor(a.cumulativeUsd).toFixed(1)}`
    );
    const askArea = `M ${xFor(asks[0].price).toFixed(1)},${padTop + plotH} L ${askPoints.join(' L ')} L ${xFor(asks[asks.length - 1].price).toFixed(1)},${padTop + plotH} Z`;
    const askStroke = `M ${askPoints.join(' L ')}`;

    return {
      w,
      h,
      plotH,
      minP,
      midP: liquidityMetrics.midPrice,
      maxP,
      maxCum,
      bidArea,
      bidStroke,
      askArea,
      askStroke,
    };
  }, [liquidityMetrics]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              Analisis Likuiditas & Kedalaman Orderbook ({symbol})
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Inspeksi dinding order (Bid/Ask Walls), zona Stop-Hunt (BSL/SSL), dan simulasi dampak slippage sebelum eksekusi manual.
            </p>
          </div>
          <div className="text-right font-mono tabular-nums">
            <div className="text-xs text-slate-500 font-sans">Mid Price · Spread</div>
            <div className="text-sm font-semibold text-slate-900">
              ${formatPrice(liquidityMetrics.midPrice)} · {liquidityMetrics.spreadPercent.toFixed(3)}%
            </div>
          </div>
        </div>
      </div>

      {/* Depth Chart & Slippage Estimator */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <section className="xl:col-span-8 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Kurva Kedalaman Kumulatif (Orderbook Depth)
            </h2>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              Bid ±2%: {formatUsdCompact(liquidityMetrics.bidLiquidity2PctUsd)} · Ask ±2%: {formatUsdCompact(liquidityMetrics.askLiquidity2PctUsd)}
            </span>
          </div>

          {depthSvg ? (
            <div className="w-full overflow-hidden">
              <svg
                viewBox={`0 0 ${depthSvg.w} ${depthSvg.h}`}
                className="w-full h-56 bg-slate-50 rounded border border-slate-200"
                role="img"
                aria-label={`Kurva kedalaman orderbook ${symbol}`}
              >
                <path d={depthSvg.bidArea} fill="rgba(5, 150, 105, 0.14)" />
                <path d={depthSvg.bidStroke} fill="none" stroke="#059669" strokeWidth="2" />
                <path d={depthSvg.askArea} fill="rgba(220, 38, 38, 0.14)" />
                <path d={depthSvg.askStroke} fill="none" stroke="#DC2626" strokeWidth="2" />

                <text x="12" y="19" fill="#047857" fontSize="11" fontFamily="Plus Jakarta Sans, sans-serif" fontWeight="600">
                  Kumulatif Bid (Dukungan Beli)
                </text>
                <text x={depthSvg.w - 12} y="19" textAnchor="end" fill="#BE123C" fontSize="11" fontFamily="Plus Jakarta Sans, sans-serif" fontWeight="600">
                  Kumulatif Ask (Tembok Jual)
                </text>

                <text x="10" y={depthSvg.h - 6} fill="#64748B" fontSize="11" fontFamily="JetBrains Mono, monospace">
                  ${formatPrice(depthSvg.minP)}
                </text>
                <text x={depthSvg.w / 2} y={depthSvg.h - 6} textAnchor="middle" fill="#0F172A" fontSize="11" fontWeight="600" fontFamily="JetBrains Mono, monospace">
                  Mid ${formatPrice(depthSvg.midP)}
                </text>
                <text x={depthSvg.w - 10} y={depthSvg.h - 6} textAnchor="end" fill="#64748B" fontSize="11" fontFamily="JetBrains Mono, monospace">
                  ${formatPrice(depthSvg.maxP)}
                </text>
              </svg>
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-slate-500">
              Data kedalaman orderbook belum tersedia.
            </div>
          )}
        </section>

        {/* Order Slippage Estimator */}
        <section className="xl:col-span-4 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900 mb-1">
            Estimator Slippage Order Manual
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            Simulasikan dampak eksekusi market order terhadap likuiditas orderbook saat ini.
          </p>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSimOrderSide('BUY')}
                className={`py-2 text-xs font-semibold rounded border transition-colors ${
                  simOrderSide === 'BUY'
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                Simulasi BUY
              </button>
              <button
                type="button"
                onClick={() => setSimOrderSide('SELL')}
                className={`py-2 text-xs font-semibold rounded border transition-colors ${
                  simOrderSide === 'SELL'
                    ? 'bg-rose-50 border-rose-300 text-rose-800'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                Simulasi SELL
              </button>
            </div>

            <div>
              <label
                htmlFor="slippage-usd-input"
                className="block text-xs text-slate-600 mb-1"
              >
                Ukuran Order (USDT)
              </label>
              <input
                id="slippage-usd-input"
                type="number"
                min={10}
                step={100}
                value={simOrderUsd}
                onChange={(e) => setSimOrderUsd(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded border border-slate-200 bg-slate-50 text-slate-900 focus:outline-none focus:bg-white focus:border-slate-900"
              />
            </div>

            <div className="pt-2 border-t border-slate-200 space-y-2 text-xs font-mono tabular-nums">
              <div className="flex justify-between">
                <span className="font-sans text-slate-600">Estimasi Harga Fill Rata-rata</span>
                <span className="text-slate-900 font-semibold">
                  ${formatPrice(slippageEstimate.avgFillPrice)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-sans text-slate-600">Estimasi Slippage</span>
                <span
                  className={
                    slippageEstimate.slippagePercent > 0.25
                      ? 'text-rose-700 font-semibold'
                      : 'text-emerald-700 font-semibold'
                  }
                >
                  {slippageEstimate.slippagePercent.toFixed(4)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-sans text-slate-600">Level Orderbook Terserap</span>
                <span className="text-slate-800">{slippageEstimate.levelsConsumed} level</span>
              </div>
              {slippageEstimate.unfilledUsd > 0 && (
                <p className="font-sans text-xs text-amber-700 pt-1">
                  Sisa {formatUsdCompact(slippageEstimate.unfilledUsd)} melampaui 100 level orderbook teratas — pertimbangkan limit order bertahap.
                </p>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Swing Liquidity Pools (BSL / SSL) & Sweep Alert */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">
            Zona Likuiditas Swing ({timeframe}) — BSL & SSL
          </h2>
          {swingLevels.length === 0 ? (
            <p className="text-xs text-slate-500">Belum ada level swing dominan terdeteksi.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {swingLevels.map((lvl, idx) => (
                <div
                  key={`${lvl.type}-${idx}`}
                  className="py-2.5 flex items-center justify-between text-xs"
                >
                  <div>
                    <span
                      className={`font-semibold ${
                        lvl.type === 'BSL' ? 'text-rose-700' : 'text-emerald-700'
                      }`}
                    >
                      {lvl.type === 'BSL'
                        ? 'Buy-Side Liquidity (Resistance / Stop Cluster)'
                        : 'Sell-Side Liquidity (Support / Stop Cluster)'}
                    </span>
                    <div className="text-slate-500 mt-0.5">
                      {formatTimestamp(lvl.time, timeframe)} · Kekuatan {lvl.strength}x sentuhan
                    </div>
                  </div>
                  <span className="font-mono tabular-nums font-semibold text-slate-900">
                    ${formatPrice(lvl.price)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">
            Deteksi Sapuan Likuiditas (Stop-Hunt Sweep)
          </h2>
          {recentSweep ? (
            <div className="space-y-2">
              <div
                className={`text-sm font-semibold ${
                  recentSweep.type === 'SSL_SWEEP' ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {recentSweep.type === 'SSL_SWEEP'
                  ? 'Terdeteksi SSL Sweep (Potensi Reversal Naik)'
                  : 'Terdeteksi BSL Sweep (Potensi Penolakan Turun)'}
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                {recentSweep.description}
              </p>
              <div className="text-xs font-mono tabular-nums text-slate-500">
                Level tersapu: ${formatPrice(recentSweep.levelPrice)} · {formatTimestamp(recentSweep.sweepTime, timeframe)}
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500 leading-relaxed">
              Tidak ada sapuan likuiditas ekstrem pada 5 candle terakhir di {symbol} ({timeframe}). Harga bergerak di dalam struktur range normal.
            </p>
          )}
        </section>
      </div>
    </div>
  );
};
