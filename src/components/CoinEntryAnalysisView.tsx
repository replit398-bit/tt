import React, { Fragment, useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import {
  DEFAULT_SIMULATION_COINS,
  computeCoinSimulationMetrics,
  computeSymbolSimulationMetrics,
  computeUnrealizedTradePnl,
} from '../lib/simulationEngine';
import type {
  AllowedTimeframe,
  MarketType,
  SimulatedTrade,
  SimulatedTradeStatus,
  SimulationStatePayload,
  TimeframeSimScanStatus,
} from '../types/market';
import { formatPercent, formatPrice, formatTimestamp } from '../utils/format';
import { TradeAnalysisDetailPanel } from './TradeAnalysisDetailPanel';

interface CoinEntryAnalysisViewProps {
  selectedCoin: string;
  onSelectCoin: (coinSymbol: string) => void;
  activeMarket: MarketType;
  liveStreamPrice: number | null;
  liveStreamSymbol: string;
  liveStreamUpdatedAt: number | null;
  data: SimulationStatePayload | null;
  loading: boolean;
  actionLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  onStartAuto: (symbol: string, market: MarketType) => void;
  onToggleEnabled: (enabled: boolean) => void;
  onToggleAutoReversalTp: (enabled: boolean) => void;
  onRunNow: (symbol: string, market: MarketType) => void;
  onCloseTrade: (tradeId: string) => void;
  onOpenMarketChart: (coinSymbol: string, tf?: AllowedTimeframe) => void;
}

const ALL_TF_FILTERS: ('ALL' | AllowedTimeframe)[] = [
  'ALL',
  '1m',
  '5m',
  '15m',
  '30m',
  '1h',
  '1d',
  '1w',
];

const STATUS_FILTERS: { value: 'ALL' | SimulatedTradeStatus; label: string }[] = [
  { value: 'ALL', label: 'Semua Status' },
  { value: 'OPEN', label: 'OPEN' },
  { value: 'WIN', label: 'WIN' },
  { value: 'LOSS', label: 'LOSS' },
];

function formatSignedUsd(val: number): string {
  const absStr = Math.abs(val).toFixed(2);
  if (val > 0) return `+$${absStr}`;
  if (val < 0) return `-$${absStr}`;
  return `$${absStr}`;
}

function exitMethodLabel(trade: SimulatedTrade): string {
  if (trade.status === 'OPEN') return 'Sedang Berjalan';
  const trig = trade.exitAnalysis?.triggerType;
  if (trig === 'EARLY_TP_REVERSAL') return 'Auto-TP Pembalikan Tren';
  if (trig === 'MANUAL_CLOSE') return 'Tutup / TP Manual';
  if (trade.status === 'WIN') return 'Kena Target TP (1:1)';
  return 'Kena Stop Loss (1:1)';
}

export const CoinEntryAnalysisView: React.FC<CoinEntryAnalysisViewProps> = ({
  selectedCoin,
  onSelectCoin,
  activeMarket,
  liveStreamPrice,
  liveStreamSymbol,
  liveStreamUpdatedAt,
  data,
  loading,
  actionLoading,
  error,
  onRefresh,
  onStartAuto,
  onToggleEnabled,
  onToggleAutoReversalTp,
  onRunNow,
  onCloseTrade,
  onOpenMarketChart,
}) => {
  const [tfFilter, setTfFilter] = useState<'ALL' | AllowedTimeframe>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | SimulatedTradeStatus>('ALL');
  const [expandedTradeId, setExpandedTradeId] = useState<string | null>(null);

  const simCoins = useMemo(
    () =>
      data?.symbols && data.symbols.length > 0
        ? data.symbols
        : [...DEFAULT_SIMULATION_COINS],
    [data?.symbols]
  );
  const currentCoin = simCoins.includes(selectedCoin) ? selectedCoin : simCoins[0];
  const simMarket = data?.market ?? activeMarket;
  const perTfBalance = data?.startingBalancePerTfUsd ?? 100;
  const perCoinBalance = data?.startingBalancePerCoinUsd ?? 700;
  const minGatePct = data?.minEntryScorePercent ?? 70;
  const riskPct = data?.riskPercentPerTrade ?? 5;

  const mergedLivePrices = useMemo(() => {
    const base: Record<string, number> = { ...(data?.livePrices ?? {}) };
    if (data?.symbol && data?.livePrice && data.livePrice > 0) {
      base[`${data.symbol}:${data.market}`] = data.livePrice;
    }
    if (liveStreamPrice && liveStreamPrice > 0) {
      base[`${liveStreamSymbol}:${activeMarket}`] = liveStreamPrice;
    }
    return base;
  }, [data, liveStreamPrice, liveStreamSymbol, activeMarket]);

  const allCoinSummaries = useMemo(() => {
    return computeSymbolSimulationMetrics(
      data?.trades ?? [],
      simCoins,
      mergedLivePrices,
      simMarket,
      perTfBalance
    );
  }, [data?.trades, simCoins, mergedLivePrices, simMarket, perTfBalance]);

  const coinSummary =
    allCoinSummaries.find((s) => s.symbol === currentCoin) ?? allCoinSummaries[0];

  const coinMetrics = useMemo(() => {
    return computeCoinSimulationMetrics(
      data?.trades ?? [],
      currentCoin,
      mergedLivePrices,
      perTfBalance
    );
  }, [data?.trades, currentCoin, mergedLivePrices, perTfBalance]);

  const coinLivePrice =
    mergedLivePrices[`${currentCoin}:${simMarket}`] ?? coinSummary?.livePrice ?? null;

  const scansByTf = useMemo(() => {
    const map: Partial<Record<AllowedTimeframe, TimeframeSimScanStatus>> = {};
    for (const s of data?.tfScanStatuses ?? []) {
      if (s.symbol === currentCoin) {
        map[s.timeframe] = s;
      }
    }
    return map;
  }, [data?.tfScanStatuses, currentCoin]);

  const coinTrades = useMemo(() => {
    return (data?.trades ?? []).filter((t) => t.symbol === currentCoin);
  }, [data?.trades, currentCoin]);

  const runningEntries = useMemo(() => {
    return coinTrades.filter((t) => t.status === 'OPEN');
  }, [coinTrades]);

  const filteredCoinTrades = useMemo(() => {
    return coinTrades.filter((t) => {
      if (tfFilter !== 'ALL' && t.timeframe !== tfFilter) return false;
      if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
      return true;
    });
  }, [coinTrades, tfFilter, statusFilter]);

  const latestSyncMs = Math.max(data?.liveUpdatedAt ?? 0, liveStreamUpdatedAt ?? 0);

  if (loading && !data) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-28 rounded-lg border border-slate-200 bg-white" />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-lg border border-slate-200 bg-white" />
          ))}
        </div>
        <div className="h-64 rounded-lg border border-slate-200 bg-white" />
      </div>
    );
  }

  const readySignalsCount = Object.values(scansByTf).filter(
    (s) => s && s.qualifiedSide !== null
  ).length;
  const reversalAlertCount = runningEntries.filter(
    (t) => t.reversalMonitor && t.reversalMonitor.status !== 'AMAN'
  ).length;

  return (
    <div className="space-y-4" data-testid="coin-entry-analysis-view">
      {/* Top Coin Selector & Live Auto-Reversal Controls */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold text-slate-900">
              Analisa Entry, Pembalikan Tren &amp; Winrate — {currentCoin.replace('USDT', '')} ($
              {perCoinBalance.toFixed(0)})
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>Modal per koin ${perCoinBalance.toFixed(0)} ($100 × 7 TF)</span>
              <span aria-hidden="true">·</span>
              <span>Entry &gt; {minGatePct}%</span>
              <span aria-hidden="true">·</span>
              <span>Auto-TP langsung saat tanda pembalikan tren</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono font-semibold text-slate-800 tabular-nums">
                {currentCoin}: {coinLivePrice !== null ? `$${formatPrice(coinLivePrice)}` : 'Sinkronisasi...'}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={actionLoading}
              data-testid="coin-auto-reversal-toggle"
              onClick={() => onToggleAutoReversalTp(!(data?.autoTakeProfitOnReversal ?? true))}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                data?.autoTakeProfitOnReversal ?? true
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>
                Auto-TP Pembalikan: {data?.autoTakeProfitOnReversal ?? true ? 'AKTIF' : 'NONAKTIF'}
              </span>
            </button>

            {data?.enabled ? (
              <button
                type="button"
                disabled={actionLoading}
                data-testid="coin-sim-toggle-btn"
                onClick={() => onToggleEnabled(false)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <Pause className="w-3.5 h-3.5" />
                <span>Jeda Auto-Entry</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={actionLoading}
                data-testid="coin-sim-start-btn"
                onClick={() => onStartAuto(currentCoin, simMarket)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Mulai Auto-Entry</span>
              </button>
            )}

            <button
              type="button"
              disabled={actionLoading}
              data-testid="coin-sim-scan-btn"
              onClick={() => onRunNow(currentCoin, simMarket)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <Target className="w-3.5 h-3.5" />
              <span>Scan &amp; Cek Tren</span>
            </button>

            <button
              type="button"
              onClick={() => onOpenMarketChart(currentCoin)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0"
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Buka Chart</span>
            </button>

            <button
              type="button"
              onClick={onRefresh}
              disabled={actionLoading}
              aria-label="Perbarui analisis koin"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${actionLoading ? 'animate-spin' : ''}`} />
              <span>Sync</span>
            </button>
          </div>
        </div>

        {/* 5-Coin Segmented Selector Bar */}
        <div
          className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3"
          role="tablist"
          aria-label="Pilih koin simulasi"
        >
          <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-lg bg-slate-100">
            {allCoinSummaries.map((c) => {
              const active = c.symbol === currentCoin;
              const short = c.symbol.replace('USDT', '');
              return (
                <button
                  key={c.symbol}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-testid={`coin-tab-${c.symbol}`}
                  onClick={() => {
                    onSelectCoin(c.symbol);
                    setTfFilter('ALL');
                  }}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-white text-slate-900 font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span className="font-mono">{short}</span>
                  <span className="font-mono text-[11px] tabular-nums text-slate-500">
                    ${c.realtimeBalanceUsd.toFixed(0)}
                  </span>
                  {c.openTrades > 0 && (
                    <span className="font-mono text-[10px] font-semibold text-amber-700">
                      ({c.openTrades} OPEN)
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {latestSyncMs > 0 && (
            <div className="text-[11px] font-mono text-slate-400 tabular-nums">
              Pembaruan Live: {new Date(latestSyncMs).toLocaleTimeString('id-ID')}
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </div>
        )}
      </section>

      {/* 4-Card KPI Strip for Selected Coin ($700 Initial) */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">
            Saldo Real-Time {currentCoin.replace('USDT', '')} ($100 × 7 TF)
          </div>
          <div
            data-testid="coin-realtime-balance"
            className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900"
          >
            ${(coinSummary?.realtimeBalanceUsd ?? perCoinBalance).toFixed(2)}
          </div>
          <div
            className={`mt-1 text-xs font-mono tabular-nums ${
              (coinSummary?.returnPercent ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'
            }`}
          >
            {formatPercent(coinSummary?.returnPercent ?? 0)} · Modal Awal ${perCoinBalance.toFixed(0)}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">
            Winrate {currentCoin.replace('USDT', '')}
          </div>
          <div
            data-testid="coin-winrate"
            className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900"
          >
            {coinSummary && coinSummary.closedTrades > 0
              ? `${coinSummary.winratePercent.toFixed(1)}%`
              : '0.0%'}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {coinSummary ? `${coinSummary.wins}W · ${coinSummary.losses}L` : '0W · 0L'} · Auto-TP
            Pembalikan: {coinSummary?.earlyTpWins ?? 0}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Profit / Loss Real-Time</div>
          <div
            data-testid="coin-realtime-pnl"
            className={`mt-1 text-2xl font-bold font-mono tabular-nums ${
              (coinSummary?.realtimePnlUsd ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'
            }`}
          >
            {formatSignedUsd(coinSummary?.realtimePnlUsd ?? 0)}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            Tutup: {formatSignedUsd(coinSummary?.realizedPnlUsd ?? 0)} · Floating:{' '}
            {formatSignedUsd(coinSummary?.floatingPnlUsd ?? 0)}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">
            Posisi Berjalan &amp; Pemantau Pembalikan
          </div>
          <div
            data-testid="coin-open-count"
            className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900"
          >
            {runningEntries.length} OPEN
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {reversalAlertCount > 0 ? (
              <span className="text-amber-700 font-semibold">
                {reversalAlertCount} indikasi pembalikan tren
              </span>
            ) : (
              <span>{readySignalsCount}/7 TF sinyal &gt; {minGatePct}%</span>
            )}
          </div>
        </div>
      </section>

      {/* Running Entries Live Trend-Reversal Analysis & Immediate Take Profit Panel */}
      <section
        className="rounded-lg border border-slate-200 bg-white overflow-hidden"
        data-testid="coin-running-entries"
      >
        <div className="px-4 py-3 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Analisa Entry Sedang Berjalan — Monitor Pembalikan Tren ({currentCoin.replace('USDT', '')})
            </h2>
            <p className="text-xs text-slate-500">
              Setiap posisi OPEN dianalisis real-time terhadap tanda pembalikan tren (divergensi, pola candlestick, EMA cross, MACD, &amp; orderbook). Jika muncul pembalikan tren saat profit, sistem langsung menutup Take Profit.
            </p>
          </div>
          <span className="text-xs font-mono font-semibold text-slate-600 tabular-nums whitespace-nowrap">
            {runningEntries.length} Posisi Aktif
          </span>
        </div>

        {runningEntries.length === 0 ? (
          <div className="p-6 text-center space-y-2" data-testid="coin-running-empty">
            <div className="text-sm font-medium text-slate-700">
              Belum ada posisi sedang berjalan untuk {currentCoin}
            </div>
            <p className="text-xs text-slate-500 max-w-xl mx-auto">
              Posisi hanya dibuka jika timeframe terkait memiliki skor Bullish atau Bearish{' '}
              <strong>&gt; {minGatePct}%</strong>. Saat ini ada{' '}
              <span className="font-mono font-semibold text-slate-800">
                {readySignalsCount}/7 TF
              </span>{' '}
              yang memenuhi syarat entry.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {runningEntries.map((trade) => {
              const liveEval = computeUnrealizedTradePnl(trade, coinLivePrice);
              const rev = trade.reversalMonitor;
              const reversalPct = rev?.reversalScore ?? 0;
              const isWarning = rev?.status === 'WASPADA_PEMBALIKAN';
              const isTakeProfitReady = rev?.status === 'TAKE_PROFIT_REVERSAL';

              return (
                <div
                  key={trade.id}
                  data-testid={`coin-running-entry-${trade.timeframe}`}
                  className="p-4 space-y-3"
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-mono font-bold text-sm text-slate-900">
                        {trade.symbol.replace('USDT', '')} · {trade.timeframe}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-semibold border ${
                          trade.side === 'LONG'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'
                        }`}
                      >
                        {trade.side === 'LONG' ? (
                          <TrendingUp className="w-3 h-3" />
                        ) : (
                          <TrendingDown className="w-3 h-3" />
                        )}
                        {trade.side}
                      </span>
                      <span className="text-xs font-mono text-slate-500 tabular-nums">
                        Entry {formatPrice(trade.entryPrice)} · SL {formatPrice(trade.stopLoss)} · TP{' '}
                        {formatPrice(trade.takeProfit)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <div className="text-right font-mono tabular-nums">
                        <div className="text-xs text-slate-500">
                          Live: {liveEval.livePrice ? formatPrice(liveEval.livePrice) : '—'}
                        </div>
                        <div
                          className={`text-sm font-bold ${
                            liveEval.pnlUsd > 0
                              ? 'text-emerald-600'
                              : liveEval.pnlUsd < 0
                                ? 'text-rose-600'
                                : 'text-slate-600'
                          }`}
                        >
                          {liveEval.pnlR >= 0 ? '+' : ''}
                          {liveEval.pnlR.toFixed(2)}R ({formatSignedUsd(liveEval.pnlUsd)})
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={actionLoading}
                        data-testid={`coin-close-trade-${trade.id}`}
                        onClick={() => onCloseTrade(trade.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white whitespace-nowrap shrink-0 disabled:opacity-50"
                      >
                        <span>
                          {liveEval.pnlUsd >= 0 ? 'Take Profit Sekarang' : 'Tutup Posisi Live'}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Live Reversal Diagnostics Bar */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 pt-2 border-t border-slate-100 text-xs">
                    <div className="lg:col-span-5 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-700">
                          Skor Tanda Pembalikan Tren
                        </span>
                        <span
                          className={`font-mono font-bold tabular-nums ${
                            isTakeProfitReady
                              ? 'text-rose-600'
                              : isWarning
                                ? 'text-amber-700'
                                : 'text-emerald-700'
                          }`}
                        >
                          {reversalPct}% ·{' '}
                          {isTakeProfitReady
                            ? 'EKSEKUSI TAKE PROFIT'
                            : isWarning
                              ? 'WASPADA PEMBALIKAN'
                              : 'TREN SEARAH'}
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            isTakeProfitReady
                              ? 'bg-rose-500'
                              : isWarning
                                ? 'bg-amber-500'
                                : 'bg-emerald-500'
                          }`}
                          style={{ width: `${Math.min(100, Math.max(4, reversalPct))}%` }}
                        />
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                        {rev
                          ? `Live Momentum: Bull ${rev.bullishScore}% · Bear ${rev.bearishScore}%`
                          : 'Memuat skor momentum live...'}
                      </div>
                    </div>

                    <div className="lg:col-span-7 space-y-1">
                      <div className="text-[11px] font-semibold text-slate-700">
                        Diagnosa Pembalikan Tren &amp; Alasan Entry:
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        {rev?.summary ?? trade.entryAnalysis?.predictionSummary ?? 'Memantau kondisi harga live.'}
                      </p>
                      {rev && rev.signals.length > 0 && (
                        <ul className="text-[11px] text-amber-800 list-disc pl-4 space-y-0.5">
                          {rev.signals.map((sig, i) => (
                            <li key={i}>{sig}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Per-Timeframe $100 Balance & Winrate Table for Selected Coin ($700 Total) */}
      <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Saldo Akun $100/TF ($700 Total {currentCoin.replace('USDT', '')}) &amp; Winrate 7 Timeframe
            </h2>
            <p className="text-xs text-slate-500">
              Setiap timeframe pada koin ini memiliki modal mandiri $100.00 (risiko {riskPct}% / rasio 1:1). Klik baris timeframe untuk memfilter riwayat eksekusi di bawah.
            </p>
          </div>
          {tfFilter !== 'ALL' && (
            <button
              type="button"
              onClick={() => setTfFilter('ALL')}
              className="text-xs font-medium text-slate-600 hover:text-slate-900 underline self-start sm:self-auto"
            >
              Tampilkan Semua Timeframe
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table
            className="w-full text-left border-collapse text-xs"
            data-testid="coin-tf-winrate-table"
          >
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-medium">
                <th className="py-2.5 px-4">Timeframe</th>
                <th className="py-2.5 px-3">Peran</th>
                <th className="py-2.5 px-3 min-w-[205px]">
                  Analisis Entry (&gt;{minGatePct}%)
                </th>
                <th className="py-2.5 px-3 text-right">Saldo Awal</th>
                <th className="py-2.5 px-3 text-right">Saldo Tutup</th>
                <th className="py-2.5 px-3 text-right">Floating</th>
                <th className="py-2.5 px-3 text-right">Saldo Real-Time</th>
                <th className="py-2.5 px-3 text-right">Open</th>
                <th className="py-2.5 px-3 text-right">W / L</th>
                <th className="py-2.5 px-4 min-w-[130px]">Winrate</th>
                <th className="py-2.5 px-4 text-right">Return %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {coinMetrics.byTimeframe.map((row) => {
                const isSelected = tfFilter === row.timeframe;
                const scan = scansByTf[row.timeframe];
                const barWidth = Math.min(100, Math.max(0, row.winratePercent));

                return (
                  <tr
                    key={row.timeframe}
                    data-testid={`coin-tf-row-${row.timeframe}`}
                    onClick={() =>
                      setTfFilter((prev) => (prev === row.timeframe ? 'ALL' : row.timeframe))
                    }
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'bg-slate-100' : 'hover:bg-slate-50'
                    }`}
                  >
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-900">
                      {row.timeframe}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap text-slate-600">
                      {row.role === 'ENTRY' ? 'Chart Entry' : 'TF Analisis'}
                    </td>
                    <td className="py-2.5 px-3">
                      {!scan ? (
                        <span className="text-slate-400">Menunggu scan...</span>
                      ) : (
                        <div className="space-y-0.5">
                          <div className="font-mono text-[11px] tabular-nums text-slate-700">
                            <span
                              className={
                                scan.bullishScore > minGatePct ? 'text-emerald-700 font-bold' : ''
                              }
                            >
                              Bull {scan.bullishScore}%
                            </span>{' '}
                            ·{' '}
                            <span
                              className={
                                scan.bearishScore > minGatePct ? 'text-rose-700 font-bold' : ''
                              }
                            >
                              Bear {scan.bearishScore}%
                            </span>
                          </div>
                          <div className="text-[11px] font-medium text-slate-500">
                            {scan.actionStatus === 'OPEN_POSITION'
                              ? 'OPEN AKTIF'
                              : scan.qualifiedSide
                                ? `SIAP ${scan.qualifiedSide} (>${minGatePct}%)`
                                : `Tidak Entry (≤${minGatePct}%)`}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-500">
                      ${row.startingBalanceUsd.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-800">
                      ${row.realizedBalanceUsd.toFixed(2)}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-mono tabular-nums ${
                        row.openTrades === 0
                          ? 'text-slate-400'
                          : row.floatingPnlUsd >= 0
                            ? 'text-emerald-600 font-medium'
                            : 'text-rose-600 font-medium'
                      }`}
                    >
                      {row.openTrades === 0 ? '—' : formatSignedUsd(row.floatingPnlUsd)}
                    </td>
                    <td
                      data-testid={`coin-tf-balance-${row.timeframe}`}
                      className={`py-2.5 px-3 text-right font-mono tabular-nums font-bold ${
                        row.realtimeBalanceUsd > row.startingBalanceUsd
                          ? 'text-emerald-700'
                          : row.realtimeBalanceUsd < row.startingBalanceUsd
                            ? 'text-rose-700'
                            : 'text-slate-900'
                      }`}
                    >
                      ${row.realtimeBalanceUsd.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-amber-700">
                      {row.openTrades}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                      <span className="font-semibold text-emerald-600">{row.wins}</span>
                      <span className="text-slate-300 mx-1">/</span>
                      <span className="font-semibold text-rose-600">{row.losses}</span>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              row.winratePercent >= 50
                                ? 'bg-emerald-500'
                                : row.closedTrades === 0
                                  ? 'bg-slate-300'
                                  : 'bg-amber-500'
                            }`}
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                        <span className="font-mono tabular-nums font-semibold text-slate-900 w-12 text-right">
                          {row.closedTrades > 0 ? `${row.winratePercent.toFixed(1)}%` : '—'}
                        </span>
                      </div>
                    </td>
                    <td
                      className={`py-2.5 px-4 text-right font-mono tabular-nums font-semibold ${
                        row.returnPercent > 0
                          ? 'text-emerald-600'
                          : row.returnPercent < 0
                            ? 'text-rose-600'
                            : 'text-slate-500'
                      }`}
                    >
                      {formatPercent(row.returnPercent)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Per-Coin Execution & Reversal History */}
      <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Riwayat Entry, Auto-TP Pembalikan Tren &amp; TP/SL ({currentCoin.replace('USDT', '')})
              </h2>
              <p className="text-xs text-slate-500">
                Klik tombol Analisis/Evaluasi untuk melihat prediksi teknikal awal serta alasan lengkap berhasil atau gagal saat penutupan.
              </p>
            </div>
            <div className="text-xs font-mono text-slate-500 tabular-nums">
              {filteredCoinTrades.length} dari {coinTrades.length} eksekusi
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter timeframe">
              {ALL_TF_FILTERS.map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => setTfFilter(tf)}
                  className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                    tfFilter === tf
                      ? 'bg-slate-900 text-white font-semibold'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter status">
              {STATUS_FILTERS.map((st) => (
                <button
                  key={st.value}
                  type="button"
                  onClick={() => setStatusFilter(st.value)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    statusFilter === st.value
                      ? 'bg-slate-900 text-white'
                      : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {filteredCoinTrades.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            Belum ada riwayat transaksi untuk filter yang dipilih pada {currentCoin}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs" data-testid="coin-history-table">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-medium">
                  <th className="py-2.5 pl-4 pr-2">Waktu</th>
                  <th className="py-2.5 px-2">TF</th>
                  <th className="py-2.5 px-2">Arah</th>
                  <th className="py-2.5 px-2 text-right">Entry</th>
                  <th className="py-2.5 px-2 text-right">SL / TP</th>
                  <th className="py-2.5 px-2 text-right">Live / Exit</th>
                  <th className="py-2.5 px-2">Status &amp; Pemicu</th>
                  <th className="py-2.5 px-2 text-right">PnL Real-Time</th>
                  <th className="py-2.5 pl-2 pr-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCoinTrades.slice(0, 100).map((t) => {
                  const pairLivePrice = mergedLivePrices[`${t.symbol}:${t.market}`] ?? null;
                  const liveEval = computeUnrealizedTradePnl(t, pairLivePrice);
                  const displayPrice = t.status === 'OPEN' ? liveEval.livePrice : t.exitPrice;
                  const displayPnlR = t.status === 'OPEN' ? liveEval.pnlR : t.pnlR;
                  const displayPnlUsd = t.status === 'OPEN' ? liveEval.pnlUsd : t.pnlUsd;
                  const isExpanded = expandedTradeId === t.id;

                  return (
                    <Fragment key={t.id}>
                      <tr className={isExpanded ? 'bg-slate-50' : 'hover:bg-slate-50'}>
                        <td className="py-2.5 pl-4 pr-2 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                          <div>{formatTimestamp(t.executedAt, t.timeframe)}</div>
                          {t.closedAt && (
                            <div className="text-[11px] text-slate-400">
                              Tutup: {formatTimestamp(t.closedAt, t.timeframe)}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-2 font-mono font-semibold text-slate-900">
                          {t.timeframe}
                        </td>
                        <td className="py-2.5 px-2 whitespace-nowrap">
                          <span
                            className={`font-mono font-semibold ${
                              t.side === 'LONG' ? 'text-emerald-700' : 'text-rose-700'
                            }`}
                          >
                            {t.side}
                          </span>
                          <div className="text-[11px] font-mono text-slate-400 tabular-nums">
                            ${t.riskUsd.toFixed(2)} · {t.confidencePercent}%
                          </div>
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-900">
                          {formatPrice(t.entryPrice)}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                          <div className="text-rose-600">{formatPrice(t.stopLoss)}</div>
                          <div className="text-emerald-600">{formatPrice(t.takeProfit)}</div>
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-700">
                          {displayPrice !== null ? formatPrice(displayPrice) : '—'}
                        </td>
                        <td className="py-2.5 px-2 whitespace-nowrap">
                          <div className="flex items-center gap-1 font-semibold">
                            {t.status === 'WIN' && (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            )}
                            {t.status === 'LOSS' && (
                              <XCircle className="w-3.5 h-3.5 text-rose-600" />
                            )}
                            <span
                              className={
                                t.status === 'WIN'
                                  ? 'text-emerald-700'
                                  : t.status === 'LOSS'
                                    ? 'text-rose-700'
                                    : 'text-amber-700'
                              }
                            >
                              {t.status}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500">{exitMethodLabel(t)}</div>
                        </td>
                        <td
                          className={`py-2.5 px-2 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                            displayPnlUsd > 0
                              ? 'text-emerald-600'
                              : displayPnlUsd < 0
                                ? 'text-rose-600'
                                : 'text-slate-500'
                          }`}
                        >
                          <div>
                            {displayPnlR >= 0 ? '+' : ''}
                            {displayPnlR.toFixed(2)}R
                          </div>
                          <div className="text-[11px] font-normal">
                            {formatSignedUsd(displayPnlUsd)}
                          </div>
                        </td>
                        <td className="py-2.5 pl-2 pr-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            {t.status === 'OPEN' && (
                              <button
                                type="button"
                                disabled={actionLoading}
                                onClick={() => onCloseTrade(t.id)}
                                className="px-2 py-1 rounded border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-[11px] font-medium text-emerald-800"
                              >
                                TP
                              </button>
                            )}
                            <button
                              type="button"
                              aria-expanded={isExpanded}
                              onClick={() =>
                                setExpandedTradeId((prev) => (prev === t.id ? null : t.id))
                              }
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-medium transition-colors ${
                                isExpanded
                                  ? 'bg-slate-900 text-white border-slate-900'
                                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                              }`}
                            >
                              <FileText className="w-3 h-3" />
                              <span>{t.exitAnalysis ? 'Evaluasi' : 'Analisis'}</span>
                              {isExpanded ? (
                                <ChevronUp className="w-3 h-3" />
                              ) : (
                                <ChevronDown className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-slate-50/70 border-b border-slate-200">
                          <td colSpan={9} className="p-3 whitespace-normal">
                            <TradeAnalysisDetailPanel
                              trade={t}
                              livePrice={pairLivePrice}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
