import React from 'react';
import type { AdvancedTechnicalAnalysis } from '../types/market';
import { formatPrice } from '../utils/format';

interface AdvancedPillarsPanelProps {
  symbol: string;
  timeframe: string;
  advanced: AdvancedTechnicalAnalysis;
  rsi14: number | null;
  atr14: number;
  volumeRatio20: number;
}

export const AdvancedPillarsPanel: React.FC<AdvancedPillarsPanelProps> = ({
  symbol,
  timeframe,
  advanced,
  rsi14,
  atr14,
  volumeRatio20,
}) => {
  const {
    supportLevels,
    resistanceLevels,
    trendlineChannel,
    candlestickPatterns,
    chartPatterns,
    maCross,
    divergences,
    ichimoku,
    adx,
    momentumOscillators,
    bollingerSqueeze,
    volumeAnalysis,
    fibonacci,
    pivotPoints,
    cycleAndPriceAction,
  } = advanced;

  return (
    <section
      data-testid="advanced-pillars-panel"
      className="rounded-lg border border-slate-200 bg-white p-4 space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Analisis 7 Pilar Teknikal Lengkap ({symbol} · {timeframe})
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Pola harga, indikator tren, osilator momentum, volatilitas, volume, Fibonacci, Pivot, Teori Dow, Elliott Wave &amp; Price Action (basis candle close).
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        {/* 1. Pola Harga & Tren */}
        <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3 space-y-2">
          <div className="font-semibold text-slate-900">1. Pola Harga, Candlestick &amp; Grafik</div>
          <div className="grid grid-cols-2 gap-2 font-mono tabular-nums text-[11px]">
            <div>
              <span className="font-sans text-slate-500 block">Support (SSL)</span>
              <span className="text-emerald-700 font-semibold">
                {supportLevels.length > 0
                  ? supportLevels.slice(0, 2).map(formatPrice).join(' · ')
                  : formatPrice(pivotPoints.s1)}
              </span>
            </div>
            <div>
              <span className="font-sans text-slate-500 block">Resistance (BSL)</span>
              <span className="text-rose-700 font-semibold">
                {resistanceLevels.length > 0
                  ? resistanceLevels.slice(0, 2).map(formatPrice).join(' · ')
                  : formatPrice(pivotPoints.r1)}
              </span>
            </div>
          </div>
          <div className="text-slate-600 leading-relaxed">
            <strong className="text-slate-800">Trendline &amp; Channel:</strong> {trendlineChannel.summary}
          </div>
          <div className="text-slate-600 leading-relaxed">
            <strong className="text-slate-800">Pola Candlestick:</strong>{' '}
            {candlestickPatterns.length > 0
              ? candlestickPatterns.map((p) => p.name).join(', ')
              : 'Belum ada Doji/Hammer/Engulfing/Star pada penutupan terakhir'}
          </div>
          <div className="text-slate-600 leading-relaxed">
            <strong className="text-slate-800">Pola Grafik:</strong>{' '}
            {chartPatterns.length > 0
              ? chartPatterns.map((p) => p.name).join(', ')
              : 'Belum terdeteksi H&S / Double Top-Bottom / Triangle / Flag / Wedge'}
          </div>
        </div>

        {/* 2. Indikator Tren */}
        <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3 space-y-2">
          <div className="font-semibold text-slate-900">2. Indikator Tren &amp; Ichimoku</div>
          <div className="text-slate-600 leading-relaxed">
            <strong className="text-slate-800">EMA 20/50/200 &amp; Cross:</strong>{' '}
            {maCross.goldenCross
              ? 'Golden Cross terdeteksi. '
              : maCross.deathCross
              ? 'Death Cross terdeteksi. '
              : ''}
            {maCross.ema2050200Status}
          </div>
          <div className="grid grid-cols-2 gap-2 font-mono tabular-nums text-[11px]">
            <div>
              <span className="font-sans text-slate-500 block">ADX (14)</span>
              <span className="text-slate-900 font-semibold">
                {adx.adx14 !== null ? `${adx.adx14.toFixed(1)} (+DI ${adx.plusDi?.toFixed(0)} / -DI ${adx.minusDi?.toFixed(0)})` : '—'}
              </span>
            </div>
            <div>
              <span className="font-sans text-slate-500 block">Ichimoku Cloud</span>
              <span
                className={`font-semibold ${
                  ichimoku.cloudStatus === 'ABOVE_CLOUD'
                    ? 'text-emerald-700'
                    : ichimoku.cloudStatus === 'BELOW_CLOUD'
                    ? 'text-rose-700'
                    : 'text-amber-700'
                }`}
              >
                {ichimoku.cloudStatus === 'ABOVE_CLOUD'
                  ? 'Di Atas Kumo'
                  : ichimoku.cloudStatus === 'BELOW_CLOUD'
                  ? 'Di Bawah Kumo'
                  : 'Di Dalam Kumo'}
              </span>
            </div>
          </div>
          <div className="text-slate-600 leading-relaxed">
            <strong className="text-slate-800">Kekuatan Tren:</strong> {adx.trendStrengthLabel}
          </div>
        </div>

        {/* 3. Indikator Momentum */}
        <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3 space-y-2">
          <div className="font-semibold text-slate-900">3. Momentum &amp; Divergensi</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono tabular-nums text-[11px]">
            <div>
              <span className="font-sans text-slate-500 block">RSI (14)</span>
              <span className="text-slate-900 font-semibold">
                {rsi14 !== null ? rsi14.toFixed(1) : '—'}
              </span>
            </div>
            <div>
              <span className="font-sans text-slate-500 block">Stoch %K/%D</span>
              <span className="text-slate-900 font-semibold">
                {momentumOscillators.stochK !== null
                  ? `${momentumOscillators.stochK.toFixed(0)}/${momentumOscillators.stochD?.toFixed(0) ?? '-'}`
                  : '—'}
              </span>
            </div>
            <div>
              <span className="font-sans text-slate-500 block">CCI (20)</span>
              <span className="text-slate-900 font-semibold">
                {momentumOscillators.cci20 !== null ? momentumOscillators.cci20.toFixed(0) : '—'}
              </span>
            </div>
            <div>
              <span className="font-sans text-slate-500 block">Williams %R</span>
              <span className="text-slate-900 font-semibold">
                {momentumOscillators.williamsR14 !== null
                  ? momentumOscillators.williamsR14.toFixed(1)
                  : '—'}
              </span>
            </div>
          </div>
          <div className="text-slate-600 leading-relaxed">
            <strong className="text-slate-800">Divergensi RSI &amp; MACD:</strong> RSI{' '}
            {divergences.rsiDivergence} · MACD {divergences.macdDivergence}
          </div>
        </div>

        {/* 4 & 5. Volatilitas & Volume */}
        <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3 space-y-2">
          <div className="font-semibold text-slate-900">4 &amp; 5. Volatilitas, OBV &amp; VWAP</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono tabular-nums text-[11px]">
            <div>
              <span className="font-sans text-slate-500 block">Bollinger Band</span>
              <span className="text-slate-900 font-semibold">
                {bollingerSqueeze.isSqueeze
                  ? `Squeeze (${bollingerSqueeze.bandwidthPct.toFixed(2)}%)`
                  : `Lebar ${bollingerSqueeze.bandwidthPct.toFixed(2)}%`}
              </span>
            </div>
            <div>
              <span className="font-sans text-slate-500 block">ATR (14) / Vol</span>
              <span className="text-slate-900 font-semibold">
                {formatPrice(atr14)} · {volumeRatio20.toFixed(2)}x
              </span>
            </div>
            <div>
              <span className="font-sans text-slate-500 block">VWAP Harian</span>
              <span className="text-slate-900 font-semibold">
                {volumeAnalysis.vwap ? formatPrice(volumeAnalysis.vwap) : '—'}
              </span>
            </div>
          </div>
          <div className="text-slate-600 leading-relaxed">
            <strong className="text-slate-800">On-Balance Volume (OBV):</strong>{' '}
            {volumeAnalysis.obvTrend === 'UP'
              ? 'Akumulasi naik (buyer konsisten)'
              : volumeAnalysis.obvTrend === 'DOWN'
              ? 'Distribusi turun (tekanan jual)'
              : 'Datar / seimbang'}
            {' · '}Deviasi VWAP {volumeAnalysis.priceVsVwapPct >= 0 ? '+' : ''}
            {volumeAnalysis.priceVsVwapPct.toFixed(2)}%
          </div>
        </div>

        {/* 6. Alat Fibonacci */}
        <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3 space-y-2">
          <div className="font-semibold text-slate-900">
            6. Fibonacci Retracement &amp; Extension ({fibonacci.direction})
          </div>
          <div className="grid grid-cols-3 gap-2 font-mono tabular-nums text-[11px]">
            <div>
              <span className="font-sans text-slate-500 block">Ret 38.2%</span>
              <span className="text-slate-900 font-semibold">{formatPrice(fibonacci.ret382)}</span>
            </div>
            <div>
              <span className="font-sans text-slate-500 block">Ret 50.0%</span>
              <span className="text-slate-900 font-semibold">{formatPrice(fibonacci.ret500)}</span>
            </div>
            <div>
              <span className="font-sans text-slate-500 block">Ret 61.8%</span>
              <span className="text-amber-700 font-semibold">{formatPrice(fibonacci.ret618)}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 font-mono tabular-nums text-[11px]">
            <div>
              <span className="font-sans text-slate-500 block">Ext Target 1.272</span>
              <span className="text-emerald-700 font-semibold">{formatPrice(fibonacci.ext1272)}</span>
            </div>
            <div>
              <span className="font-sans text-slate-500 block">Ext Target 1.618</span>
              <span className="text-emerald-700 font-semibold">{formatPrice(fibonacci.ext1618)}</span>
            </div>
          </div>
          <p className="text-slate-600 leading-relaxed">{fibonacci.activeZoneNote}</p>
        </div>

        {/* 7. Pivot Points, Elliott Wave, Teori Dow & Price Action */}
        <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3 space-y-2">
          <div className="font-semibold text-slate-900">
            7. Pivot Points, Elliott Wave, Teori Dow &amp; Price Action
          </div>
          <div className="grid grid-cols-5 gap-1.5 font-mono tabular-nums text-[11px]">
            <div>
              <span className="font-sans text-slate-500 block">S2</span>
              <span className="text-emerald-700">{formatPrice(pivotPoints.s2)}</span>
            </div>
            <div>
              <span className="font-sans text-slate-500 block">S1</span>
              <span className="text-emerald-700 font-semibold">{formatPrice(pivotPoints.s1)}</span>
            </div>
            <div>
              <span className="font-sans text-slate-500 block">PP</span>
              <span className="text-slate-900 font-bold">{formatPrice(pivotPoints.pp)}</span>
            </div>
            <div>
              <span className="font-sans text-slate-500 block">R1</span>
              <span className="text-rose-700 font-semibold">{formatPrice(pivotPoints.r1)}</span>
            </div>
            <div>
              <span className="font-sans text-slate-500 block">R2</span>
              <span className="text-rose-700">{formatPrice(pivotPoints.r2)}</span>
            </div>
          </div>
          <div className="text-slate-600 leading-relaxed">
            <strong className="text-slate-800">Teori Dow &amp; Elliott:</strong>{' '}
            {cycleAndPriceAction.dowStructure.replaceAll('_', ' ')} · {cycleAndPriceAction.elliottWavePhase}
          </div>
          <div className="text-slate-600 leading-relaxed">
            <strong className="text-slate-800">Price Action:</strong> {cycleAndPriceAction.priceActionNote}
          </div>
        </div>
      </div>
    </section>
  );
};
