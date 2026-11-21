import React, { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Calculator, Clock, Compass, Minus } from 'lucide-react';
import type {
  AllowedTimeframe,
  FactorCategory,
  MarketAnalysisResult,
  MultiTimeframeRecommendation,
} from '../types/market';
import { formatPrice } from '../utils/format';

interface DecisionPanelProps {
  analysis: MarketAnalysisResult;
  mtfRecommendation?: MultiTimeframeRecommendation | null;
  onSelectTimeframe?: (tf: AllowedTimeframe) => void;
  onUseExecutionPlan: () => void;
}

function formatCloseClock(ms?: number | null, tf?: string): string {
  if (!ms) return '--:--';
  const d = new Date(ms);
  if (tf === '1d' || tf === '1w') {
    return d.toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
    });
  }
  return d.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatCountdown(targetMs: number | null | undefined, nowMs: number): string {
  if (!targetMs) return '--:--';
  const diffSec = Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
  if (diffSec === 0) return 'Sync...';
  if (diffSec >= 86_400) {
    const days = Math.floor(diffSec / 86_400);
    const hours = Math.floor((diffSec % 86_400) / 3600);
    return `${days}hr ${hours}j`;
  }
  if (diffSec >= 3600) {
    const hours = Math.floor(diffSec / 3600);
    const mins = Math.floor((diffSec % 3600) / 60);
    return `${hours}j ${String(mins).padStart(2, '0')}m`;
  }
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const DecisionPanel: React.FC<DecisionPanelProps> = ({
  analysis,
  mtfRecommendation,
  onSelectTimeframe,
  onUseExecutionPlan,
}) => {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [factorFilter, setFactorFilter] = useState<'ALL' | FactorCategory>('ALL');

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const { verdict, verdictLabel, confidencePercent, summary, executionPlan, factors } =
    analysis;

  const visibleFactors =
    factorFilter === 'ALL' ? factors : factors.filter((f) => f.category === factorFilter);

  const isUp = verdict === 'STRONG_BUY' || verdict === 'BUY';
  const isDown = verdict === 'STRONG_SELL' || verdict === 'SELL';

  const movementColor = isUp
    ? 'text-emerald-700 border-emerald-200 bg-emerald-50'
    : isDown
    ? 'text-rose-700 border-rose-200 bg-rose-50'
    : 'text-amber-700 border-amber-200 bg-amber-50';

  const mtfBiasUp = mtfRecommendation?.recommendedBias === 'LONG';
  const mtfBiasDown = mtfRecommendation?.recommendedBias === 'SHORT';
  const analysisTfs = mtfRecommendation
    ? mtfRecommendation.timeframes.filter(
        (t) =>
          t.timeframe === '30m' ||
          t.timeframe === '1h' ||
          t.timeframe === '1d' ||
          t.timeframe === '1w'
      )
    : [];
  const entryTfs = mtfRecommendation
    ? mtfRecommendation.timeframes.filter(
        (t) => t.timeframe === '1m' || t.timeframe === '5m' || t.timeframe === '15m'
      )
    : [];
  const isCurrentEntryTf =
    analysis.timeframe === '1m' || analysis.timeframe === '5m' || analysis.timeframe === '15m';

  return (
    <div className="space-y-4">
      {/* Top-Down Multi-Timeframe: Analisis (30m, 1h, 1d, 1w) -> Entry (1m, 5m & 15m) · R:R 1:1 */}
      {mtfRecommendation && (
        <section
          data-testid="mtf-recommendation-card"
          className="rounded-lg border border-slate-200 bg-white p-4 space-y-3"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="w-full">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <Compass className="w-3.5 h-3.5 text-slate-700" />
                  <span>Analisis (30m · 1h · 1d · 1w) → Entry (1m · 5m · 15m)</span>
                </div>
                <span
                  data-testid="closed-candle-basis-badge"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded"
                >
                  <Clock className="w-3 h-3 text-slate-500" />
                  <span>Tunggu Candle Close</span>
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  data-testid="recommended-tf-badge"
                  className={`inline-flex items-center px-2.5 py-1 rounded border text-xs font-bold font-mono ${
                    mtfBiasUp
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : mtfBiasDown
                      ? 'bg-rose-50 border-rose-200 text-rose-800'
                      : 'bg-amber-50 border-amber-200 text-amber-800'
                  }`}
                >
                  Entry TF {mtfRecommendation.recommendedTimeframe} ·{' '}
                  {mtfRecommendation.recommendedBias === 'NEUTRAL'
                    ? 'OBSERVASI · TIDAK PERLU ENTRY (≤70%)'
                    : `Setup ${mtfRecommendation.recommendedBias} (>70%)`}{' '}
                  · R:R {mtfRecommendation.recommendedRiskReward || '1:1'}
                </span>
                {onSelectTimeframe &&
                  analysis.timeframe !== mtfRecommendation.recommendedTimeframe && (
                    <button
                      type="button"
                      onClick={() =>
                        onSelectTimeframe(mtfRecommendation.recommendedTimeframe)
                      }
                      className="text-xs font-medium text-sky-700 hover:text-sky-900 underline underline-offset-2"
                    >
                      Buka Chart Entry TF {mtfRecommendation.recommendedTimeframe}
                    </button>
                  )}
              </div>
            </div>
          </div>

          {/* Recommended Entry & Risk Strip (1:1 R:R) */}
          <div className="grid grid-cols-2 gap-2 text-xs font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-md p-2.5">
            <div>
              <div className="font-sans text-[11px] text-slate-500">
                Area Entry Chart ({mtfRecommendation.recommendedTimeframe})
              </div>
              <div className="font-bold text-slate-900 mt-0.5">
                {formatPrice(mtfRecommendation.recommendedEntryLow)} –{' '}
                {formatPrice(mtfRecommendation.recommendedEntryHigh)}
              </div>
              <div className="font-sans text-[11px] text-amber-700 mt-0.5">
                Optimal: {formatPrice(mtfRecommendation.recommendedOptimalEntry)}
              </div>
            </div>
            <div>
              <div className="font-sans text-[11px] text-slate-500">
                SL &amp; Target TP1 (R:R {mtfRecommendation.recommendedRiskReward || '1:1'})
              </div>
              <div className="text-rose-700 font-semibold mt-0.5">
                SL: {formatPrice(mtfRecommendation.recommendedStopLoss)}
              </div>
              <div className="text-emerald-700 font-semibold mt-0.5">
                TP1: {formatPrice(mtfRecommendation.recommendedTakeProfit1)}
              </div>
            </div>
          </div>

          <p className="text-xs text-slate-600 leading-relaxed">
            <strong className="text-slate-800">{mtfRecommendation.alignmentSummary}</strong>{' '}
            {mtfRecommendation.recommendationReason}
          </p>

          {/* Group 1: TF Analisis (30m, 1h, 1d, 1w) */}
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
              <span>1. TF Analisis Arah (30m · 1h · 1d · 1w)</span>
              <span className="font-mono text-slate-700">
                Bias: {mtfRecommendation.analysisTimeframesBias?.combinedBias ?? mtfRecommendation.recommendedBias}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {analysisTfs.map((tfItem) => {
                const isViewing = tfItem.timeframe === analysis.timeframe;
                const tone =
                  tfItem.bias === 'LONG'
                    ? 'text-emerald-700'
                    : tfItem.bias === 'SHORT'
                    ? 'text-rose-700'
                    : 'text-amber-700';
                return (
                  <button
                    key={tfItem.timeframe}
                    type="button"
                    data-testid={`tf-card-${tfItem.timeframe}`}
                    onClick={() => onSelectTimeframe?.(tfItem.timeframe)}
                    className={`p-2 rounded border text-left transition-colors ${
                      isViewing
                        ? 'border-slate-900 bg-slate-50'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="font-bold text-slate-900">{tfItem.timeframe}</span>
                      <span className="text-[10px] font-sans font-medium text-slate-500">
                        Analisis · {tfItem.confidencePercent}%
                      </span>
                    </div>
                    <div className={`text-[11px] font-semibold mt-0.5 truncate ${tone}`}>
                      {tfItem.bias === 'NEUTRAL' ? 'Konsolidasi' : `Arah ${tfItem.bias}`}
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-slate-400 mt-1 pt-1 border-t border-slate-100">
                      <span>Cls {formatCloseClock(tfItem.closedCandleCloseTime, tfItem.timeframe)}</span>
                      <span>Next {formatCountdown(tfItem.nextCandleCloseTime, nowMs)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Group 2: Chart Area Entry (1m, 5m & 15m) */}
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
              <span>2. Chart Area Entry (1m · 5m · 15m)</span>
              <span className="font-mono text-emerald-700">R:R 1:1</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {entryTfs.map((tfItem) => {
                const isRec = tfItem.timeframe === mtfRecommendation.recommendedTimeframe;
                const isViewing = tfItem.timeframe === analysis.timeframe;
                const tone =
                  tfItem.bias === 'LONG'
                    ? 'text-emerald-700'
                    : tfItem.bias === 'SHORT'
                    ? 'text-rose-700'
                    : 'text-amber-700';
                return (
                  <button
                    key={tfItem.timeframe}
                    type="button"
                    data-testid={`tf-card-${tfItem.timeframe}`}
                    onClick={() => onSelectTimeframe?.(tfItem.timeframe)}
                    className={`p-2 rounded border text-left transition-colors ${
                      isViewing
                        ? 'border-slate-900 bg-slate-50'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 text-xs font-mono">
                      <span className="font-bold text-slate-900">{tfItem.timeframe}</span>
                      {isRec ? (
                        <span className="text-[10px] font-sans font-semibold text-sky-700">
                          Saran
                        </span>
                      ) : (
                        <span className="text-[10px] font-sans text-slate-400">
                          {tfItem.confidencePercent}%
                        </span>
                      )}
                    </div>
                    <div className={`text-[11px] font-semibold mt-0.5 truncate ${tone}`}>
                      {tfItem.bias === 'NEUTRAL' ? 'Netral' : tfItem.bias}
                    </div>
                    <div className="text-[10px] font-mono tabular-nums text-slate-600 mt-0.5 truncate">
                      {formatPrice(
                        isRec ? mtfRecommendation.recommendedOptimalEntry : tfItem.optimalEntry
                      )}
                    </div>
                    <div className="text-[10px] font-mono tabular-nums text-slate-400 mt-1 pt-1 border-t border-slate-100 leading-tight">
                      <div>Cls {formatCloseClock(tfItem.closedCandleCloseTime, tfItem.timeframe)}</div>
                      <div>Next {formatCountdown(tfItem.nextCandleCloseTime, nowMs)}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Active Timeframe Chart Movement Analysis & Entry Plan */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="w-full">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium text-slate-500">
                {isCurrentEntryTf ? 'Chart Area Entry' : 'Chart Analisis Utama'} ({analysis.symbol} ·{' '}
                {analysis.timeframe})
              </p>
              <span
                data-testid="active-tf-close-countdown"
                className="text-[11px] font-mono tabular-nums text-slate-500"
              >
                Close {formatCloseClock(analysis.analyzedCandleCloseTime, analysis.timeframe)} · Next{' '}
                {formatCountdown(analysis.nextCandleCloseTime, nowMs)}
              </span>
            </div>
            <div className="flex items-center gap-2.5 mt-1.5">
              <span
                data-testid="decision-verdict"
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md border text-xs font-bold tracking-normal ${movementColor}`}
              >
                {isUp && <ArrowUpRight className="w-4 h-4" />}
                {isDown && <ArrowDownRight className="w-4 h-4" />}
                {!isUp && !isDown && <Minus className="w-4 h-4" />}
                {verdictLabel}
              </span>
              <span className="text-xs font-mono tabular-nums text-slate-600 font-medium">
                Konfluensi {confidencePercent}%
              </span>
            </div>
          </div>
        </div>

        {/* Bullish vs Bearish Score Meter (Strict >70% Entry Gate) */}
        <div className="mb-3" data-testid="entry-gate-meter">
          <div className="flex items-center justify-between gap-2 text-xs font-mono tabular-nums text-slate-500 mb-1">
            <span
              className={
                analysis.bullishScore > 70
                  ? 'text-emerald-700 font-bold'
                  : 'text-emerald-700 font-medium'
              }
            >
              Tekanan Naik {analysis.bullishScore}%{analysis.bullishScore > 70 ? ' ✓' : ''}
            </span>
            <span
              className={
                analysis.bearishScore > 70
                  ? 'text-rose-700 font-bold'
                  : 'text-rose-700 font-medium'
              }
            >
              Tekanan Turun {analysis.bearishScore}%{analysis.bearishScore > 70 ? ' ✓' : ''}
            </span>
          </div>
          <div className="h-1.5 w-full rounded bg-slate-100 overflow-hidden flex">
            <div
              className="bg-emerald-600 h-full"
              style={{ width: `${analysis.bullishScore}%` }}
            />
            <div
              className="bg-rose-600 h-full ml-auto"
              style={{ width: `${analysis.bearishScore}%` }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
            <span>Syarat Entry: Bullish atau Bearish &gt; 70%</span>
            <span className="font-mono">Gate &gt;70%</span>
          </div>
        </div>

        <p className="text-xs leading-relaxed text-slate-600 mb-4">{summary}</p>

        {/* Manual Execution Plan Table */}
        <div className="border-t border-slate-200 pt-3">
          {executionPlan.bias === 'NEUTRAL' && (
            <div
              data-testid="no-entry-notice"
              className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
            >
              <span className="font-semibold">Tidak Perlu Entry:</span> Momentum Bullish (
              {analysis.bullishScore}%) maupun Bearish ({analysis.bearishScore}%) masih ≤ 70%.
              Tunggu salah satu tekanan menembus di atas 70%.
            </div>
          )}
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-xs font-semibold text-slate-900">
              {executionPlan.bias === 'NEUTRAL'
                ? 'Referensi Area Observasi (Belum Layak Entry)'
                : `Saran Parameter Entry Manual (${executionPlan.bias})`}
            </h3>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              ATR(14): {formatPrice(executionPlan.atr14)}
            </span>
          </div>

          <div className="space-y-2 text-xs font-mono tabular-nums">
            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <span className="font-sans text-slate-600">Area Entry Disarankan</span>
              <span className="text-amber-700 font-semibold">
                {formatPrice(executionPlan.entryLow)} – {formatPrice(executionPlan.entryHigh)}
              </span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <span className="font-sans text-slate-600">Stop Loss (Batas Risiko)</span>
              <span className="text-rose-700 font-semibold">
                {formatPrice(executionPlan.stopLoss)} (Risiko {executionPlan.riskPercentToSl.toFixed(2)}%)
              </span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <span className="font-sans text-slate-600">Take Profit 1 (R:R 1:{executionPlan.rewardToRiskTp1.toFixed(1)})</span>
              <span className="text-emerald-700 font-semibold">
                {formatPrice(executionPlan.takeProfit1)}
              </span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <span className="font-sans text-slate-600">Take Profit 2 (R:R 1:{executionPlan.rewardToRiskTp2.toFixed(1)})</span>
              <span className="text-emerald-700">
                {formatPrice(executionPlan.takeProfit2)}
              </span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="font-sans text-slate-600">Take Profit 3 (Target Ekstensi)</span>
              <span className="text-emerald-600">
                {formatPrice(executionPlan.takeProfit3)}
              </span>
            </div>
          </div>

          <p className="mt-3 text-xs text-slate-500 leading-relaxed">
            {executionPlan.invalidationNote}
          </p>

          <button
            type="button"
            onClick={onUseExecutionPlan}
            className="mt-3 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs transition-colors whitespace-nowrap"
          >
            <Calculator className="w-4 h-4" />
            <span>Hitung Ukuran Posisi & Catat Manual</span>
          </button>
        </div>
      </section>

      {/* Multi-Factor Breakdown */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold text-slate-900">
            Rincian Semua Metode Indikator ({factors.length} Faktor)
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-1 mb-3 pb-2 border-b border-slate-100">
          {(
            [
              { id: 'ALL', label: 'Semua' },
              { id: 'Pola & Price Action', label: 'Pola & PA' },
              { id: 'Trend', label: 'Tren' },
              { id: 'Momentum', label: 'Momentum' },
              { id: 'Volume', label: 'Volume' },
              { id: 'Fibonacci & Pivot', label: 'Fibo & Pivot' },
              { id: 'Likuiditas', label: 'Likuiditas' },
            ] as const
          ).map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setFactorFilter(cat.id)}
              className={`px-2 py-1 text-[11px] rounded border transition-colors ${
                factorFilter === cat.id
                  ? 'bg-slate-900 text-white border-slate-900 font-semibold'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
        <div className="divide-y divide-slate-100">
          {visibleFactors.map((factor) => {
            const stateLabel =
              factor.bias === 'bullish'
                ? 'Bullish'
                : factor.bias === 'bearish'
                ? 'Bearish'
                : 'Netral';
            const stateColor =
              factor.bias === 'bullish'
                ? 'text-emerald-700'
                : factor.bias === 'bearish'
                ? 'text-rose-700'
                : 'text-slate-500';

            return (
              <div key={factor.id} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-800">
                    {factor.name}
                  </span>
                  <div className="flex items-center gap-2 text-xs font-mono tabular-nums shrink-0">
                    <span className="text-slate-500">{factor.valueText}</span>
                    <span className={`font-semibold ${stateColor}`}>
                      {stateLabel}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  {factor.explanation}
                </p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
