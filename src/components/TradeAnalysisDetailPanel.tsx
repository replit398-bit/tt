import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { formatDurationId } from '../lib/tradeAnalysisSnapshot';
import type { SimulatedTrade, TradeTechnicalSnapshot } from '../types/market';
import { formatPrice, formatTimestamp } from '../utils/format';

function renderTechGrid(snap: TradeTechnicalSnapshot) {
  const items: { label: string; value: string }[] = [
    { label: 'RSI(14)', value: snap.rsi14 !== null ? snap.rsi14.toFixed(1) : '—' },
    {
      label: 'EMA 20 / 50',
      value: `${snap.ema20 ? formatPrice(snap.ema20) : '—'} / ${snap.ema50 ? formatPrice(snap.ema50) : '—'}`,
    },
    { label: 'MACD Hist', value: snap.macdHist !== null ? snap.macdHist.toFixed(4) : '—' },
    { label: 'ADX(14)', value: snap.adx14 !== null ? snap.adx14.toFixed(1) : '—' },
    { label: 'Ichimoku', value: snap.ichimokuCloud.replace('_', ' ') },
    {
      label: 'Stoch / CCI',
      value: `${snap.stochK !== null ? snap.stochK.toFixed(1) : '—'} / ${snap.cci20 !== null ? snap.cci20.toFixed(0) : '—'}`,
    },
    {
      label: 'BB Width',
      value: `${snap.bbBandwidthPct.toFixed(2)}%${snap.bbSqueeze ? ' (Squeeze)' : ''}`,
    },
    {
      label: 'OBV / VWAP',
      value: `${snap.obvTrend} (${snap.priceVsVwapPct >= 0 ? '+' : ''}${snap.priceVsVwapPct.toFixed(2)}%)`,
    },
    {
      label: 'Orderbook',
      value: `${snap.orderbookBias} (Bid ${(snap.imbalanceRatio * 100).toFixed(1)}%)`,
    },
    { label: 'Struktur Dow', value: snap.dowStructure },
    {
      label: 'Pivot PP / S1 / R1',
      value: `${formatPrice(snap.pivotPp)} / ${formatPrice(snap.pivotS1)} / ${formatPrice(snap.pivotR1)}`,
    },
    { label: 'Volume Ratio', value: `${snap.volumeRatio20.toFixed(2)}x` },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded border border-slate-200 bg-white px-2.5 py-1.5"
        >
          <div className="text-[11px] text-slate-500">{item.label}</div>
          <div
            className="text-[11px] font-mono font-medium text-slate-800 truncate tabular-nums"
            title={item.value}
          >
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

export const TradeAnalysisDetailPanel: React.FC<{
  trade: SimulatedTrade;
  livePrice: number | null;
}> = ({ trade, livePrice }) => {
  const entry = trade.entryAnalysis;
  const exit = trade.exitAnalysis;
  const rev = trade.reversalMonitor;

  const distToTpPct =
    livePrice && trade.entryPrice > 0
      ? Math.abs(((trade.takeProfit - livePrice) / livePrice) * 100)
      : null;
  const distToSlPct =
    livePrice && trade.entryPrice > 0
      ? Math.abs(((livePrice - trade.stopLoss) / livePrice) * 100)
      : null;

  return (
    <div
      className="grid grid-cols-1 lg:grid-cols-2 gap-4"
      data-testid="trade-analysis-detail-panel"
    >
      {/* Left: Saved Entry Technical Prediction */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
          <div>
            <div className="text-xs font-semibold text-slate-900">
              1. Prediksi &amp; Analisis Teknikal Saat Entry ({trade.symbol} · {trade.timeframe})
            </div>
            <div className="text-[11px] text-slate-500 font-mono tabular-nums">
              Dicatat saat buka posisi: {formatTimestamp(trade.executedAt, trade.timeframe)}
            </div>
          </div>
          {entry && (
            <span className="font-mono text-[11px] font-semibold text-slate-700 tabular-nums">
              Bull {entry.snapshot.bullishScore}% / Bear {entry.snapshot.bearishScore}% · Conf{' '}
              {entry.snapshot.confidencePercent}%
            </span>
          )}
        </div>

        {entry ? (
          <>
            <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 rounded border border-slate-200 px-3 py-2">
              {entry.predictionSummary}
            </p>

            {renderTechGrid(entry.snapshot)}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
              <div className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2">
                <div className="font-semibold text-slate-700 mb-1">
                  Pola, Elliott &amp; Fibonacci
                </div>
                <div className="text-slate-600 space-y-0.5">
                  <div>Elliott: {entry.snapshot.elliottWavePhase}</div>
                  <div>Fib: {entry.snapshot.fibonacciZone}</div>
                  <div>
                    Pola:{' '}
                    {[...entry.snapshot.candlestickPatterns, ...entry.snapshot.chartPatterns]
                      .length > 0
                      ? [
                          ...entry.snapshot.candlestickPatterns,
                          ...entry.snapshot.chartPatterns,
                        ].join(', ')
                      : 'Tidak ada pola pembalikan khusus'}
                  </div>
                </div>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2">
                <div className="font-semibold text-slate-700 mb-1">Support &amp; Resistance</div>
                <div className="text-slate-600 font-mono tabular-nums space-y-0.5">
                  <div>
                    S:{' '}
                    {entry.snapshot.supportLevels.length > 0
                      ? entry.snapshot.supportLevels.map((v) => formatPrice(v)).join(' · ')
                      : '—'}
                  </div>
                  <div>
                    R:{' '}
                    {entry.snapshot.resistanceLevels.length > 0
                      ? entry.snapshot.resistanceLevels.map((v) => formatPrice(v)).join(' · ')
                      : '—'}
                  </div>
                  <div>ATR(14): {formatPrice(entry.snapshot.atr14)}</div>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-emerald-700">
                Alasan Pendukung Prediksi Entry:
              </div>
              <ul className="space-y-1 text-xs text-slate-700 list-disc pl-4">
                {entry.supportingReasons.map((reason, idx) => (
                  <li key={idx}>{reason}</li>
                ))}
              </ul>
            </div>

            {entry.cautionRisks.length > 0 && (
              <div className="space-y-1 pt-1 border-t border-slate-100">
                <div className="text-[11px] font-semibold text-amber-700 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  <span>Catatan Risiko Saat Entry:</span>
                </div>
                <ul className="space-y-0.5 text-[11px] text-slate-600 list-disc pl-4">
                  {entry.cautionRisks.map((risk, idx) => (
                    <li key={idx}>{risk}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <div className="text-xs text-slate-500">
            Snapshot analisis entry detail tidak tersedia untuk posisi lama ini.
          </div>
        )}
      </div>

      {/* Right: Saved Exit Analysis OR Running Reversal Analysis */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
          <div>
            <div className="text-xs font-semibold text-slate-900">
              {exit
                ? '2. Respon & Evaluasi Saat Penutupan / TP / SL'
                : '2. Analisis Posisi Berjalan & Pemantau Pembalikan Tren'}
            </div>
            <div className="text-[11px] text-slate-500 font-mono tabular-nums">
              {exit
                ? `Dievaluasi saat tutup: ${formatTimestamp(exit.evaluatedAt, trade.timeframe)} (${formatDurationId(exit.durationMs)})`
                : rev
                  ? `Cek pembalikan tren terakhir: ${new Date(rev.checkedAt).toLocaleTimeString('id-ID')}`
                  : 'Menunggu sinkronisasi analisis posisi berjalan'}
            </div>
          </div>
          {exit ? (
            <span
              className={`px-2 py-0.5 rounded font-mono text-[11px] font-semibold border ${
                exit.outcome === 'WIN'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-rose-50 text-rose-700 border-rose-200'
              }`}
            >
              {exit.triggerType === 'EARLY_TP_REVERSAL'
                ? 'AUTO-TP PEMBALIKAN TREN'
                : exit.triggerType === 'MANUAL_CLOSE'
                  ? exit.outcome === 'WIN'
                    ? 'TAKE PROFIT MANUAL'
                    : 'TUTUP MANUAL'
                  : exit.outcome === 'WIN'
                    ? 'BERHASIL (TP)'
                    : 'GAGAL (SL)'}
            </span>
          ) : (
            <span className="font-mono text-[11px] font-semibold text-amber-700">
              {rev?.status === 'WASPADA_PEMBALIKAN'
                ? 'WASPADA PEMBALIKAN TREN'
                : 'SEDANG BERJALAN'}
            </span>
          )}
        </div>

        {exit ? (
          <>
            <div
              className={`rounded-md border px-3 py-2.5 space-y-1 ${
                exit.outcome === 'WIN'
                  ? 'border-emerald-200 bg-emerald-50/60'
                  : 'border-rose-200 bg-rose-50/60'
              }`}
            >
              <div
                className={`text-xs font-bold ${
                  exit.outcome === 'WIN' ? 'text-emerald-800' : 'text-rose-800'
                }`}
              >
                {exit.responseTitle}
              </div>
              <p className="text-xs text-slate-700 leading-relaxed">{exit.responseSummary}</p>
            </div>

            {exit.exitTechnical && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold text-slate-700">
                  Snapshot Teknikal Saat Penutupan:
                </div>
                {renderTechGrid(exit.exitTechnical)}
              </div>
            )}

            <div className="space-y-1.5">
              <div
                className={`text-[11px] font-semibold ${
                  exit.outcome === 'WIN' ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                Alasan Lengkap ({exit.outcome === 'WIN' ? 'Berhasil' : 'Gagal'}):
              </div>
              <ul className="space-y-1 text-xs text-slate-700 list-disc pl-4">
                {exit.reasons.map((r, idx) => (
                  <li key={idx}>{r}</li>
                ))}
              </ul>
            </div>

            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-700">
              <span className="font-semibold text-slate-900">Evaluasi &amp; Pembelajaran: </span>
              {exit.lessonLearned}
            </div>
          </>
        ) : (
          <div className="space-y-3">
            {rev && (
              <div
                className={`rounded-md border px-3 py-2.5 space-y-2 ${
                  rev.status === 'WASPADA_PEMBALIKAN'
                    ? 'border-amber-200 bg-amber-50/70'
                    : 'border-emerald-200 bg-emerald-50/50'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-slate-900">
                    Skor Tanda Pembalikan Tren: {rev.reversalScore}%
                  </span>
                  <span className="font-mono text-[11px] text-slate-700 tabular-nums">
                    Live Bull {rev.bullishScore}% · Bear {rev.bearishScore}%
                  </span>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">{rev.summary}</p>
                {rev.signals.length > 0 && (
                  <ul className="space-y-0.5 text-[11px] text-slate-700 list-disc pl-4">
                    {rev.signals.map((s, idx) => (
                      <li key={idx}>{s}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-700 space-y-1">
              <div className="font-semibold text-slate-900">
                Aturan Proteksi Auto-TP Pembalikan Tren &amp; TP/SL 1:1
              </div>
              <p>
                Jika terdeteksi pembalikan tren kuat saat posisi sedang profit, sistem langsung menutup Take Profit di harga pasar. Jika tren tetap searah, posisi ditunggu hingga{' '}
                <span className="font-mono font-semibold text-emerald-700">
                  TP {formatPrice(trade.takeProfit)}
                </span>{' '}
                atau{' '}
                <span className="font-mono font-semibold text-rose-700">
                  SL {formatPrice(trade.stopLoss)}
                </span>
                .
              </p>
            </div>

            {livePrice !== null && distToTpPct !== null && distToSlPct !== null && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[11px] text-slate-500">Jarak ke Take Profit</div>
                  <div className="font-mono font-semibold text-emerald-700 tabular-nums">
                    {distToTpPct.toFixed(2)}% ({formatPrice(trade.takeProfit)})
                  </div>
                </div>
                <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[11px] text-slate-500">Jarak ke Stop Loss</div>
                  <div className="font-mono font-semibold text-rose-700 tabular-nums">
                    {distToSlPct.toFixed(2)}% ({formatPrice(trade.stopLoss)})
                  </div>
                </div>
              </div>
            )}

            {entry?.invalidationNote && (
              <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                <span className="font-semibold text-slate-800">
                  Skenario Gagal (Invalidation):{' '}
                </span>
                {entry.invalidationNote}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
