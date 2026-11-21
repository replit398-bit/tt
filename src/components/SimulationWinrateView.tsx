import React, { Fragment, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import {
  DEFAULT_SIMULATION_COINS,
  computeCoinSimulationMetrics,
  computeRealtimeSimulationSnapshot,
  computeSymbolSimulationMetrics,
  computeUnrealizedTradePnl,
} from '../lib/simulationEngine';
import type {
  AllowedTimeframe,
  MarketType,
  SimulatedTrade,
  SimulatedTradeSource,
  SimulatedTradeStatus,
  SimulationStatePayload,
  TimeframeSimScanStatus,
} from '../types/market';
import { formatPercent, formatPrice, formatTimestamp } from '../utils/format';
import { TradeAnalysisDetailPanel } from './TradeAnalysisDetailPanel';

interface SimulationWinrateViewProps {
  activeSymbol: string;
  activeMarket: MarketType;
  liveStreamPrice: number | null;
  liveStreamUpdatedAt: number | null;
  data: SimulationStatePayload | null;
  loading: boolean;
  actionLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  onStartAuto: (symbol: string, market: MarketType) => void;
  onToggleEnabled: (enabled: boolean) => void;
  onToggleAutoReversalTp: (enabled: boolean) => void;
  onSyncSchedulerTarget: (symbol: string, market: MarketType) => void;
  onRunNow: (symbol: string, market: MarketType) => void;
  onCloseTrade: (tradeId: string) => void;
  onInspectCoinPage: (coinSymbol: string) => void;
  onReset: () => void;
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
  { value: 'WIN', label: 'WIN (+1R)' },
  { value: 'LOSS', label: 'LOSS (-1R)' },
];

const SOURCE_FILTERS: { value: 'ALL' | SimulatedTradeSource; label: string }[] = [
  { value: 'ALL', label: 'Semua Mode' },
  { value: 'AUTO_LIVE', label: 'Entry Awal' },
  { value: 'REENTRY_TP_SL', label: 'Auto Re-Entry (TP/SL)' },
  { value: 'MANUAL_RUN', label: 'Entry Manual' },
];

function sourceLabel(mode: SimulatedTradeSource): string {
  if (mode === 'REENTRY_TP_SL') return 'Auto Re-Entry (TP/SL)';
  if (mode === 'AUTO_LIVE' || mode === 'AUTO_30M') return 'Auto Live';
  if (mode === 'MANUAL_RUN') return 'Entry Manual';
  return 'Historis';
}

function formatSignedUsd(val: number): string {
  const absStr = Math.abs(val).toFixed(2);
  if (val > 0) return `+$${absStr}`;
  if (val < 0) return `-$${absStr}`;
  return `$${absStr}`;
}

export const SimulationWinrateView: React.FC<SimulationWinrateViewProps> = ({
  activeSymbol,
  activeMarket,
  liveStreamPrice,
  liveStreamUpdatedAt,
  data,
  loading,
  actionLoading,
  error,
  onRefresh,
  onStartAuto,
  onToggleEnabled,
  onToggleAutoReversalTp,
  onSyncSchedulerTarget,
  onRunNow,
  onCloseTrade,
  onInspectCoinPage,
  onReset,
}) => {
  const [symbolFilter, setSymbolFilter] = useState<string>('ALL');
  const [tfFilter, setTfFilter] = useState<'ALL' | AllowedTimeframe>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | SimulatedTradeStatus>('ALL');
  const [sourceFilter, setSourceFilter] = useState<'ALL' | SimulatedTradeSource>('ALL');
  const [confirmReset, setConfirmReset] = useState<boolean>(false);
  const [expandedTradeId, setExpandedTradeId] = useState<string | null>(null);

  const mergedLivePrices = useMemo(() => {
    const base: Record<string, number> = { ...(data?.livePrices ?? {}) };
    if (data?.symbol && data?.livePrice && data.livePrice > 0) {
      base[`${data.symbol}:${data.market}`] = data.livePrice;
    }
    if (liveStreamPrice && liveStreamPrice > 0) {
      base[`${activeSymbol}:${activeMarket}`] = liveStreamPrice;
    }
    return base;
  }, [data, liveStreamPrice, activeSymbol, activeMarket]);

  const simCoins = data?.symbols && data.symbols.length > 0 ? data.symbols : [...DEFAULT_SIMULATION_COINS];
  const simMarket = data?.market ?? activeMarket;
  const perTfBalance = data?.startingBalancePerTfUsd ?? 100;
  const perCoinBalance = data?.startingBalancePerCoinUsd ?? 700;
  const totalCapitalAllCoins = perCoinBalance * simCoins.length;

  const activeScopeTrades = useMemo(() => {
    if (!data) return [];
    return symbolFilter === 'ALL'
      ? data.trades
      : data.trades.filter((t) => t.symbol === symbolFilter);
  }, [data, symbolFilter]);

  const activeStartingCapitalUsd =
    symbolFilter === 'ALL' ? data?.stats.startingCapitalUsd ?? totalCapitalAllCoins : perCoinBalance;

  const realtimeSnapshot = useMemo(() => {
    return computeRealtimeSimulationSnapshot(
      activeScopeTrades,
      mergedLivePrices,
      activeStartingCapitalUsd
    );
  }, [activeScopeTrades, mergedLivePrices, activeStartingCapitalUsd]);

  const headerLivePrice = useMemo(() => {
    const targetKey = `${data?.symbol ?? activeSymbol}:${data?.market ?? activeMarket}`;
    return mergedLivePrices[targetKey] ?? liveStreamPrice ?? data?.livePrice ?? null;
  }, [
    mergedLivePrices,
    data?.symbol,
    data?.market,
    data?.livePrice,
    activeSymbol,
    activeMarket,
    liveStreamPrice,
  ]);

  const latestSyncMs = Math.max(data?.liveUpdatedAt ?? 0, liveStreamUpdatedAt ?? 0);

  const filteredTrades = useMemo(() => {
    if (!data) return [];
    return data.trades.filter((t) => {
      if (symbolFilter !== 'ALL' && t.symbol !== symbolFilter) return false;
      if (tfFilter !== 'ALL' && t.timeframe !== tfFilter) return false;
      if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
      if (sourceFilter !== 'ALL' && t.sourceMode !== sourceFilter) return false;
      return true;
    });
  }, [data, symbolFilter, tfFilter, statusFilter, sourceFilter]);

  const bySymbol = useMemo(() => {
    return computeSymbolSimulationMetrics(
      data?.trades ?? [],
      simCoins,
      mergedLivePrices,
      simMarket,
      perTfBalance
    );
  }, [data?.trades, simCoins, mergedLivePrices, simMarket, perTfBalance]);

  const scopedCoinMetrics = useMemo(() => {
    if (symbolFilter === 'ALL') return null;
    return computeCoinSimulationMetrics(
      data?.trades ?? [],
      symbolFilter,
      mergedLivePrices,
      perTfBalance
    );
  }, [data?.trades, symbolFilter, mergedLivePrices, perTfBalance]);

  const scansByCoinTf = useMemo(() => {
    const map: Record<string, TimeframeSimScanStatus> = {};
    for (const s of data?.tfScanStatuses ?? []) {
      map[`${s.symbol}:${s.timeframe}`] = s;
    }
    return map;
  }, [data?.tfScanStatuses]);

  if (loading && !data) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-28 rounded-lg border border-slate-200 bg-white" />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-lg border border-slate-200 bg-white" />
          ))}
        </div>
        <div className="h-72 rounded-lg border border-slate-200 bg-white" />
      </div>
    );
  }

  const stats = scopedCoinMetrics ? scopedCoinMetrics.stats : data?.stats;
  const byTimeframe = scopedCoinMetrics ? scopedCoinMetrics.byTimeframe : data?.byTimeframe ?? [];
  const riskPct = data?.riskPercentPerTrade ?? 5;
  const minGatePct = data?.minEntryScorePercent ?? 70;

  return (
    <div className="space-y-4" data-testid="simulation-winrate-view">
      {/* Header & Auto-Reentry Controls */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold text-slate-900">
                Simulasi Multi-Koin ($700/Koin · $100/TF) &amp; Auto-TP Pembalikan Tren
              </h1>
              <span
                data-testid="sim-auto-status-badge"
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${
                  data?.enabled
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-slate-100 text-slate-700 border border-slate-200'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    data?.enabled ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                  }`}
                />
                {data?.enabled
                  ? 'Auto Re-Entry Saat TP/SL AKTIF'
                  : (stats?.totalTrades ?? 0) === 0
                    ? 'Kosong · Siap Dimulai'
                    : 'Auto Re-Entry JEDA'}
              </span>
            </div>
            <div
              data-testid="sim-coins-badge"
              className="flex flex-wrap items-center gap-2 text-xs text-slate-600 font-medium"
            >
              <span className="font-mono font-semibold text-slate-800">
                5 Koin: {simCoins.map((c) => c.replace('USDT', '')).join(' · ')}
              </span>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span data-testid="sim-entry-gate-badge">Entry &gt; {minGatePct}% Bull/Bear</span>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span>Data Live Binance Real-Time</span>
            </div>
            <p className="text-xs text-slate-500 max-w-3xl">
              Setiap koin dari <strong>{simCoins.length} koin</strong> memiliki modal mandiri{' '}
              <strong>${perCoinBalance.toFixed(0)} (${perTfBalance.toFixed(0)}/TF × 7 TF)</strong> — total{' '}
              <strong>${totalCapitalAllCoins.toLocaleString('en-US')}</strong> (risiko {riskPct}%, rasio 1:1), dengan auto Take Profit saat terdeteksi pembalikan tren.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={actionLoading}
              data-testid="sim-auto-reversal-btn"
              onClick={() => onToggleAutoReversalTp(!(data?.autoTakeProfitOnReversal ?? true))}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium whitespace-nowrap shrink-0 ${
                data?.autoTakeProfitOnReversal ?? true
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>
                Auto-TP Reversal: {data?.autoTakeProfitOnReversal ?? true ? 'AKTIF' : 'OFF'}
              </span>
            </button>

            {data?.enabled ? (
              <button
                type="button"
                disabled={actionLoading}
                data-testid="sim-toggle-btn"
                onClick={() => onToggleEnabled(false)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <Pause className="w-3.5 h-3.5" />
                <span>Jeda Auto Re-Entry</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={actionLoading}
                data-testid="sim-start-btn"
                onClick={() => onStartAuto(activeSymbol, activeMarket)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5" />
                <span>
                  {actionLoading
                    ? 'Memproses...'
                    : `Mulai Auto-Entry Live (${simCoins.length} Koin)`}
                </span>
              </button>
            )}

            <button
              type="button"
              disabled={actionLoading}
              data-testid="sim-run-now-btn"
              onClick={() => onRunNow(activeSymbol, activeMarket)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <Target className="w-3.5 h-3.5" />
              <span>Scan {simCoins.length} Koin × 7 TF (&gt;{minGatePct}%)</span>
            </button>

            {confirmReset ? (
              <button
                type="button"
                disabled={actionLoading}
                data-testid="sim-confirm-reset-btn"
                onClick={() => {
                  setConfirmReset(false);
                  onReset();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 text-xs font-semibold text-white disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Konfirmasi Hapus Semua</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={actionLoading}
                data-testid="sim-reset-btn"
                onClick={() => setConfirmReset(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-rose-50 hover:border-rose-200 hover:text-rose-700 text-xs font-medium text-slate-600 disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Hapus Semua Riwayat</span>
              </button>
            )}
          </div>
        </div>

        {/* Telemetry Strip */}
        <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-4 text-slate-600">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Koin Simulasi ({simMarket.toUpperCase()}):</span>
              <span className="font-mono font-semibold text-slate-900">
                {simCoins.map((c) => c.replace('USDT', '')).join(', ')}
              </span>
              {data && data.market !== activeMarket && (
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => onSyncSchedulerTarget(activeSymbol, activeMarket)}
                  className="ml-1 px-2 py-0.5 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-[11px] font-medium text-slate-700"
                >
                  Ubah Market ke {activeMarket.toUpperCase()}
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-slate-400">{data?.symbol ?? activeSymbol} Live:</span>
              <span
                data-testid="sim-live-price"
                className="font-mono font-semibold text-emerald-700 tabular-nums"
              >
                {headerLivePrice ? `$${formatPrice(headerLivePrice)}` : 'Sinkronisasi...'}
              </span>
              {latestSyncMs > 0 && (
                <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                  ({new Date(latestSyncMs).toLocaleTimeString('id-ID')})
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Pemicu Re-Entry:</span>
              <span className="font-medium text-slate-700">
                Otomatis begitu TP atau SL tersentuh
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Entry Terakhir:</span>
              <span className="font-mono text-slate-700 tabular-nums">
                {data?.lastExecutionAt
                  ? new Date(data.lastExecutionAt).toLocaleString('id-ID', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })
                  : 'Belum ada'}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={actionLoading}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${actionLoading ? 'animate-spin' : ''}`} />
            <span>Cek Harga TP/SL Live</span>
          </button>
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </div>
        )}
      </section>

      {/* 4-Card Overall KPI Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Winrate Keseluruhan</div>
          <div
            data-testid="sim-overall-winrate"
            className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900"
          >
            {stats && stats.closedTrades > 0 ? `${stats.winratePercent.toFixed(1)}%` : '0.0%'}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {stats ? `${stats.wins} Win · ${stats.losses} Loss` : '0 Win · 0 Loss'} · PF{' '}
            {stats?.profitFactor !== null && stats?.profitFactor !== undefined
              ? stats.profitFactor.toFixed(2)
              : '—'}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Total Eksekusi Simulasi</div>
          <div
            data-testid="sim-total-trades"
            className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900"
          >
            {stats?.totalTrades ?? 0}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {stats?.openTrades ?? 0} OPEN · {stats?.closedTrades ?? 0} Selesai · Rasio 1:1
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Profit / Loss Real-Time (7 TF)</div>
          <div
            data-testid="sim-realtime-pnl"
            className={`mt-1 text-2xl font-bold font-mono tabular-nums ${
              realtimeSnapshot.totalRealtimePnlUsd >= 0 ? 'text-emerald-600' : 'text-rose-600'
            }`}
          >
            {formatSignedUsd(realtimeSnapshot.totalRealtimePnlUsd)}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            Tutup: {formatSignedUsd(realtimeSnapshot.realizedPnlUsd)} · Floating:{' '}
            <span
              className={
                realtimeSnapshot.floatingPnlUsd >= 0 ? 'text-emerald-600' : 'text-rose-600'
              }
            >
              {formatSignedUsd(realtimeSnapshot.floatingPnlUsd)}
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">
            {symbolFilter === 'ALL'
              ? `Total Saldo (${simCoins.length} Koin × $700)`
              : `Saldo ${symbolFilter.replace('USDT', '')} ($100 × 7 TF)`}
          </div>
          <div
            data-testid="sim-realtime-equity"
            className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900"
          >
            $
            {realtimeSnapshot.realtimeEquityUsd.toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
          <div
            className={`mt-1 text-xs font-mono tabular-nums ${
              realtimeSnapshot.totalRealtimePnlUsd >= 0 ? 'text-emerald-600' : 'text-rose-600'
            }`}
          >
            {formatPercent(realtimeSnapshot.realtimeReturnPercent)} (Modal Awal $
            {activeStartingCapitalUsd.toLocaleString('en-US')})
          </div>
        </div>
      </section>

      {/* 5-Coin Multi-Asset Live Cards (BTC, NEAR, RENDER, PUMP, UNI) - $700 Each */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-slate-700">
            Monitor 5 Koin Simulasi ($700/Koin · $100/TF)
          </h2>
          {symbolFilter !== 'ALL' && (
            <button
              type="button"
              onClick={() => setSymbolFilter('ALL')}
              className="text-xs font-medium text-slate-600 hover:text-slate-900 underline"
            >
              Tampilkan Semua 5 Koin
            </button>
          )}
        </div>
        <div
          data-testid="sim-coins-grid"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5"
        >
          {bySymbol.map((coinStat) => {
            const selected = symbolFilter === coinStat.symbol;
            const shortName = coinStat.symbol.replace('USDT', '');
            const tfs: AllowedTimeframe[] = ['1m', '5m', '15m', '30m', '1h', '1d', '1w'];
            const readyCount = tfs.filter((tf) => {
              const s = scansByCoinTf[`${coinStat.symbol}:${tf}`];
              return s && (s.qualifiedSide !== null || s.actionStatus === 'OPEN_POSITION');
            }).length;

            return (
              <div
                key={coinStat.symbol}
                data-testid={`sim-coin-card-${coinStat.symbol}`}
                className={`rounded-lg border p-3 transition-colors flex flex-col justify-between gap-2 ${
                  selected
                    ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setSymbolFilter((prev) =>
                          prev === coinStat.symbol ? 'ALL' : coinStat.symbol
                        )
                      }
                      className="font-mono font-bold text-sm text-slate-900 hover:underline text-left"
                    >
                      {shortName}
                    </button>
                    <span className="font-mono text-xs font-semibold text-slate-700 tabular-nums">
                      {coinStat.livePrice !== null ? `$${formatPrice(coinStat.livePrice)}` : '—'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                    <span className="font-semibold text-slate-900">
                      ${coinStat.realtimeBalanceUsd.toFixed(2)}
                    </span>
                    <span
                      className={`font-semibold ${
                        coinStat.realtimePnlUsd > 0
                          ? 'text-emerald-600'
                          : coinStat.realtimePnlUsd < 0
                            ? 'text-rose-600'
                            : 'text-slate-500'
                      }`}
                    >
                      {formatSignedUsd(coinStat.realtimePnlUsd)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-500">
                    <span>
                      {coinStat.openTrades} OPEN · {coinStat.wins}W/{coinStat.losses}L
                    </span>
                    <span>
                      {coinStat.closedTrades > 0 ? `WR ${coinStat.winratePercent}%` : 'WR —'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 pt-0.5">
                    {tfs.map((tf) => {
                      const s = scansByCoinTf[`${coinStat.symbol}:${tf}`];
                      const isOpen = s?.actionStatus === 'OPEN_POSITION';
                      const isLong = s?.qualifiedSide === 'LONG';
                      const isShort = s?.qualifiedSide === 'SHORT';
                      const pillCls = isOpen || isLong || isShort
                        ? isShort
                          ? 'bg-rose-100 text-rose-800 border-rose-200 font-bold'
                          : 'bg-emerald-100 text-emerald-800 border-emerald-200 font-bold'
                        : 'bg-slate-100 text-slate-400 border-slate-200';
                      return (
                        <span
                          key={tf}
                          title={s?.note ?? tf}
                          className={`flex-1 text-center py-0.5 rounded border text-[9px] font-mono ${pillCls}`}
                        >
                          {tf}
                        </span>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-1.5 border-t border-slate-100 flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-slate-500 truncate">
                    {coinStat.reversalAlertCount > 0
                      ? `${coinStat.reversalAlertCount} pantau pembalikan`
                      : readyCount > 0
                        ? `${readyCount}/7 TF > ${minGatePct}%`
                        : `Semua ≤ ${minGatePct}%`}
                  </span>
                  <button
                    type="button"
                    data-testid={`sim-open-coin-menu-${coinStat.symbol}`}
                    onClick={() => onInspectCoinPage(coinStat.symbol)}
                    className="font-semibold text-slate-900 hover:underline whitespace-nowrap shrink-0"
                  >
                    Analisa Koin →
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Per-Timeframe Independent Account & Winrate Table */}
      <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              {symbolFilter === 'ALL'
                ? 'Akun Timeframe Agregat (5 Koin × $100 = $500/TF) & Winrate'
                : `Saldo Akun Mandiri ${symbolFilter.replace('USDT', '')} ($100/TF = $700) & Winrate`}
            </h2>
            <p className="text-xs text-slate-500">
              {symbolFilter === 'ALL'
                ? `Setiap koin memiliki modal $700 ($100/TF). Pilih salah satu koin untuk melihat saldo $100/TF masing-masing koin, atau klik baris TF untuk filter riwayat.`
                : `Menampilkan saldo $100/TF khusus ${symbolFilter} beserta sinyal >${minGatePct}% dan winrate per timeframe.`}
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
          <table className="w-full text-left border-collapse text-xs" data-testid="sim-tf-winrate-table">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-medium">
                <th className="py-2.5 px-4">Timeframe</th>
                <th className="py-2.5 px-3">Peran</th>
                <th className="py-2.5 px-3 min-w-[205px]">
                  Analisis Live {symbolFilter === 'ALL' ? `5 Koin (>${minGatePct}%)` : `${symbolFilter.replace('USDT', '')} (>${minGatePct}%)`}
                </th>
                <th className="py-2.5 px-3 text-right">Saldo Awal</th>
                <th className="py-2.5 px-3 text-right">Saldo Tutup</th>
                <th className="py-2.5 px-3 text-right">Floating (OPEN)</th>
                <th className="py-2.5 px-3 text-right">Saldo Real-Time</th>
                <th className="py-2.5 px-3 text-right">Open</th>
                <th className="py-2.5 px-3 text-right">W / L</th>
                <th className="py-2.5 px-4 min-w-[140px]">Winrate</th>
                <th className="py-2.5 px-4 text-right">Return %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {byTimeframe.map((row) => {
                const isSelected = tfFilter === row.timeframe;
                const barWidth = Math.min(100, Math.max(0, row.winratePercent));
                const tfFloating = realtimeSnapshot.floatingByTimeframe[row.timeframe]?.floatingPnlUsd ?? row.floatingPnlUsd;
                const tfRealtimeBal = Number(
                  Math.max(0, row.realizedBalanceUsd + tfFloating).toFixed(2)
                );
                const tfReturnPct = Number(
                  (((tfRealtimeBal - row.startingBalanceUsd) / row.startingBalanceUsd) * 100).toFixed(2)
                );

                return (
                  <tr
                    key={row.timeframe}
                    data-testid={`sim-tf-row-${row.timeframe}`}
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
                    <td className="py-2.5 px-2.5 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium whitespace-nowrap ${
                          row.role === 'ENTRY'
                            ? 'bg-sky-50 text-sky-700 border border-sky-200'
                            : 'bg-slate-100 text-slate-700 border border-slate-200'
                        }`}
                      >
                        {row.role === 'ENTRY' ? 'Chart Entry' : 'TF Analisis'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3" data-testid={`sim-tf-scan-${row.timeframe}`}>
                      {(() => {
                        if (symbolFilter !== 'ALL') {
                          const scan = scansByCoinTf[`${symbolFilter}:${row.timeframe}`];
                          if (!scan) {
                            return <span className="text-[11px] text-slate-400">Menunggu scan...</span>;
                          }
                          const bullHigh = scan.bullishScore > minGatePct;
                          const bearHigh = scan.bearishScore > minGatePct;
                          const badgeClass =
                            scan.actionStatus === 'OPEN_POSITION' || scan.actionStatus === 'ENTERED'
                              ? scan.qualifiedSide === 'SHORT'
                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : scan.qualifiedSide === 'LONG'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : scan.qualifiedSide === 'SHORT'
                                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                                  : 'bg-slate-100 text-slate-600 border-slate-200';
                          const badgeText =
                            scan.actionStatus === 'OPEN_POSITION'
                              ? 'OPEN'
                              : scan.actionStatus === 'ENTERED'
                                ? `ENTRY ${scan.qualifiedSide}`
                                : scan.qualifiedSide
                                  ? `SIAP ${scan.qualifiedSide} (>${minGatePct}%)`
                                  : `TIDAK ENTRY (≤${minGatePct}%)`;
                          return (
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums">
                                <span className={bullHigh ? 'text-emerald-700 font-bold' : 'text-slate-600'}>
                                  Bull {scan.bullishScore}%
                                </span>
                                <span className="text-slate-300">·</span>
                                <span className={bearHigh ? 'text-rose-700 font-bold' : 'text-slate-600'}>
                                  Bear {scan.bearishScore}%
                                </span>
                              </div>
                              <span
                                title={scan.note}
                                className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-semibold ${badgeClass}`}
                              >
                                {badgeText}
                              </span>
                            </div>
                          );
                        }

                        const tfScans = simCoins
                          .map((c) => scansByCoinTf[`${c}:${row.timeframe}`])
                          .filter((s): s is TimeframeSimScanStatus => Boolean(s));
                        if (tfScans.length === 0) {
                          return <span className="text-[11px] text-slate-400">Menunggu scan 5 koin...</span>;
                        }
                        const readyOrOpen = tfScans.filter(
                          (s) => s.qualifiedSide !== null || s.actionStatus === 'OPEN_POSITION'
                        );
                        if (readyOrOpen.length === 0) {
                          return (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium bg-slate-100 text-slate-600 border-slate-200">
                              5/5 Koin ≤{minGatePct}% (Tidak Entry)
                            </span>
                          );
                        }
                        return (
                          <div className="flex flex-wrap items-center gap-1">
                            {readyOrOpen.map((s) => {
                              const isShort = s.qualifiedSide === 'SHORT';
                              const topPct = Math.max(s.bullishScore, s.bearishScore);
                              return (
                                <span
                                  key={s.symbol}
                                  title={s.note}
                                  className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-mono font-semibold ${
                                    isShort
                                      ? 'bg-rose-50 text-rose-700 border-rose-200'
                                      : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  }`}
                                >
                                  {s.symbol.replace('USDT', '')}{' '}
                                  {s.actionStatus === 'OPEN_POSITION'
                                    ? 'OPEN'
                                    : isShort
                                      ? `-${topPct}%`
                                      : `+${topPct}%`}
                                </span>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-500">
                      ${row.startingBalanceUsd.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-medium text-slate-800">
                      ${row.realizedBalanceUsd.toFixed(2)}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-mono tabular-nums ${
                        row.openTrades === 0
                          ? 'text-slate-400'
                          : tfFloating >= 0
                            ? 'text-emerald-600 font-medium'
                            : 'text-rose-600 font-medium'
                      }`}
                    >
                      {row.openTrades === 0 ? '—' : formatSignedUsd(tfFloating)}
                    </td>
                    <td
                      data-testid={`sim-tf-balance-${row.timeframe}`}
                      className={`py-2.5 px-3 text-right font-mono tabular-nums font-bold ${
                        tfRealtimeBal > row.startingBalanceUsd
                          ? 'text-emerald-700'
                          : tfRealtimeBal < row.startingBalanceUsd
                            ? 'text-rose-700'
                            : 'text-slate-900'
                      }`}
                    >
                      ${tfRealtimeBal.toFixed(2)}
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
                        tfReturnPct > 0
                          ? 'text-emerald-600'
                          : tfReturnPct < 0
                            ? 'text-rose-600'
                            : 'text-slate-500'
                      }`}
                    >
                      {formatPercent(tfReturnPct)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Simulation Execution History Table */}
      <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Riwayat Entry, TP, SL &amp; Profit/Loss Real-Time
              </h2>
              <p className="text-xs text-slate-500">
                Setiap posisi memakai {riskPct}% saldo akun timeframe masing-masing dengan rasio 1:1. Begitu TP atau SL tersentuh, sistem langsung re-entry otomatis.
              </p>
            </div>
            <div className="text-xs font-mono text-slate-500 tabular-nums">
              Menampilkan {filteredTrades.length} dari {data?.trades.length ?? 0} eksekusi
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Coin Filter Chips */}
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter koin riwayat">
              {['ALL', ...simCoins].map((sym) => (
                <button
                  key={sym}
                  type="button"
                  data-testid={`sim-filter-coin-${sym}`}
                  onClick={() => setSymbolFilter(sym)}
                  className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                    symbolFilter === sym
                      ? 'bg-slate-900 text-white font-semibold'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {sym === 'ALL' ? 'Semua Koin' : sym.replace('USDT', '')}
                </button>
              ))}
            </div>

            {/* Timeframe Filter Chips */}
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter timeframe riwayat">
              {ALL_TF_FILTERS.map((tf) => (
                <button
                  key={tf}
                  type="button"
                  data-testid={`sim-filter-tf-${tf}`}
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

            {/* Status Filter Chips */}
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter status riwayat">
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

            {/* Source Mode Filter */}
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter mode eksekusi">
              {SOURCE_FILTERS.map((src) => (
                <button
                  key={src.value}
                  type="button"
                  onClick={() => setSourceFilter(src.value)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    sourceFilter === src.value
                      ? 'bg-slate-900 text-white'
                      : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {src.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {filteredTrades.length === 0 ? (
          <div className="p-8 text-center space-y-3" data-testid="sim-empty-history">
            <div className="text-sm font-medium text-slate-700">
              Riwayat Simulasi Kosong (Semua 7 Akun TF Siap dengan Saldo $100.00)
            </div>
            <p className="text-xs text-slate-500 max-w-lg mx-auto">
              Klik <span className="font-semibold text-slate-800">Mulai Auto-Entry Live</span> di atas agar seluruh 5 koin ({simCoins.map((c) => c.replace('USDT', '')).join(', ')}) di 7 timeframe dianalisis real-time. Sistem hanya membuka entry saat Bullish/Bearish <strong>&gt; {minGatePct}%</strong>; skor <strong>≤ {minGatePct}%</strong> tidak entry.
            </p>
            {!data?.enabled && (
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => onStartAuto(activeSymbol, activeMarket)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Mulai Auto-Entry Live Sekarang ({simCoins.length} Koin)</span>
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs" data-testid="sim-history-table">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-medium">
                  <th className="py-2.5 pl-3 pr-2">Waktu</th>
                  <th className="py-2.5 px-2">Pair</th>
                  <th className="py-2.5 px-2">TF</th>
                  <th className="py-2.5 px-2">Arah</th>
                  <th className="py-2.5 px-2 text-right">Entry</th>
                  <th className="py-2.5 px-2 text-right">SL (1R)</th>
                  <th className="py-2.5 px-2 text-right">TP (1R)</th>
                  <th className="py-2.5 px-2 text-right">Live / Exit</th>
                  <th className="py-2.5 px-2">Status</th>
                  <th className="py-2.5 px-2 text-right">PnL Real-Time</th>
                  <th className="py-2.5 pl-2 pr-3 text-right">Analisis</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTrades.slice(0, 150).map((t) => {
                  const pairLivePrice = mergedLivePrices[`${t.symbol}:${t.market}`] ?? null;
                  const liveEval = computeUnrealizedTradePnl(t, pairLivePrice);
                  const displayPrice =
                    t.status === 'OPEN' ? liveEval.livePrice : t.exitPrice;
                  const displayPnlR = t.status === 'OPEN' ? liveEval.pnlR : t.pnlR;
                  const displayPnlUsd = t.status === 'OPEN' ? liveEval.pnlUsd : t.pnlUsd;
                  const isPositive = displayPnlUsd > 0;
                  const isNegative = displayPnlUsd < 0;
                  const isExpanded = expandedTradeId === t.id;

                  return (
                    <Fragment key={t.id}>
                      <tr
                        data-testid={`sim-trade-row-${t.id}`}
                        className={`transition-colors ${
                          isExpanded ? 'bg-slate-50' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-2.5 pl-3 pr-2 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                          <div>{formatTimestamp(t.executedAt, t.timeframe)}</div>
                          {t.closedAt && (
                            <div className="text-[11px] text-slate-400">
                              Tutup: {formatTimestamp(t.closedAt, t.timeframe)}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-2 whitespace-nowrap">
                          <div className="font-mono font-semibold text-slate-900">
                            {t.symbol}{' '}
                            <span className="text-[10px] font-normal text-slate-400">
                              {t.market.toUpperCase()}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500">{sourceLabel(t.sourceMode)}</div>
                        </td>
                        <td className="py-2.5 px-2 font-mono font-semibold text-slate-800 whitespace-nowrap">
                          {t.timeframe}
                        </td>
                        <td className="py-2.5 px-2 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono font-semibold text-[11px] ${
                              t.side === 'LONG'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-rose-50 text-rose-700 border border-rose-200'
                            }`}
                          >
                            {t.side === 'LONG' ? (
                              <TrendingUp className="w-3 h-3" />
                            ) : (
                              <TrendingDown className="w-3 h-3" />
                            )}
                            {t.side}
                          </span>
                          <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
                            ${t.riskUsd.toFixed(2)} · {t.confidencePercent}%
                          </div>
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums font-medium text-slate-900 whitespace-nowrap">
                          {formatPrice(t.entryPrice)}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums text-rose-600 whitespace-nowrap">
                          {formatPrice(t.stopLoss)}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums text-emerald-600 whitespace-nowrap">
                          {formatPrice(t.takeProfit)}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                          {t.status === 'OPEN' ? (
                            liveEval.hasLivePrice && displayPrice !== null ? (
                              <div>
                                <div className="inline-flex items-center gap-1 font-semibold text-slate-900">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                  <span>{formatPrice(displayPrice)}</span>
                                </div>
                                <div className="text-[10px] font-sans text-slate-400">
                                  Live
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-400">Menunggu...</span>
                            )
                          ) : (
                            <div>
                              <div className="text-slate-700">{formatPrice(displayPrice)}</div>
                              <div className="text-[10px] font-sans text-slate-400">Exit</div>
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-2 whitespace-nowrap">
                          {t.status === 'WIN' && (
                            <div>
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold text-[11px]">
                                <CheckCircle2 className="w-3 h-3" />
                                WIN
                              </span>
                              {t.exitAnalysis?.triggerType === 'EARLY_TP_REVERSAL' && (
                                <div className="text-[10px] text-emerald-700 font-medium mt-0.5">
                                  Auto-TP Pembalikan
                                </div>
                              )}
                            </div>
                          )}
                          {t.status === 'LOSS' && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 font-semibold text-[11px]">
                              <XCircle className="w-3 h-3" />
                              LOSS
                            </span>
                          )}
                          {t.status === 'OPEN' && (
                            <div>
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-semibold text-[11px]">
                                OPEN
                              </span>
                              {t.reversalMonitor && (
                                <div className="text-[10px] font-mono text-slate-500 mt-0.5 tabular-nums">
                                  Rev: {t.reversalMonitor.reversalScore}%
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        <td
                          className={`py-2.5 px-2 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                            isPositive
                              ? 'text-emerald-600'
                              : isNegative
                                ? 'text-rose-600'
                                : 'text-slate-500'
                          }`}
                        >
                          {t.status === 'OPEN' ? (
                            liveEval.hasLivePrice ? (
                              <>
                                <div>
                                  {displayPnlR >= 0 ? '+' : ''}
                                  {displayPnlR.toFixed(2)}R
                                </div>
                                <div className="text-[11px] font-normal">
                                  {formatSignedUsd(displayPnlUsd)}
                                </div>
                              </>
                            ) : (
                              <span className="font-normal text-slate-500">${t.riskUsd.toFixed(2)}</span>
                            )
                          ) : (
                            <>
                              <div>
                                {displayPnlR >= 0 ? '+' : ''}
                                {displayPnlR.toFixed(1)}R
                              </div>
                              <div className="text-[11px] font-normal">
                                {formatSignedUsd(displayPnlUsd)}
                              </div>
                            </>
                          )}
                        </td>
                        <td className="py-2.5 pl-2 pr-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            {t.status === 'OPEN' && (
                              <button
                                type="button"
                                disabled={actionLoading}
                                onClick={() => onCloseTrade(t.id)}
                                title="Take Profit / Tutup sekarang pada harga live"
                                className="px-2 py-1 rounded border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-[11px] font-medium text-emerald-800"
                              >
                                TP
                              </button>
                            )}
                            <button
                              type="button"
                              data-testid={`sim-inspect-btn-${t.timeframe}`}
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
                        <tr
                          data-testid={`sim-trade-detail-${t.id}`}
                          className="bg-slate-50/70 border-b border-slate-200"
                        >
                          <td colSpan={11} className="p-3 whitespace-normal">
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
