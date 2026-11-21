import React, { useMemo, useState } from 'react';
import { ArrowUpDown, ChevronLeft, ChevronRight, RefreshCw, Search } from 'lucide-react';
import type { MarketType, ScannerRow } from '../types/market';
import { formatPercent, formatPrice, formatUsdCompact } from '../utils/format';

interface MarketScannerViewProps {
  rows: ScannerRow[];
  interval: string;
  market: MarketType;
  quote: string;
  searchQuery: string;
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  updatedAt: number | null;
  loading: boolean;
  error: string | null;
  onQuoteChange: (nextQuote: string) => void;
  onSearchChange: (nextSearch: string) => void;
  onPageChange: (nextPage: number) => void;
  onRefresh: () => void;
  onSelectSymbol: (symbol: string) => void;
}

type SignalFilter = 'ALL' | 'BUY' | 'WAIT' | 'SELL';
type SortField = 'confidencePercent' | 'priceChangePercent' | 'rsi14' | 'quoteVolume24h';

export const MarketScannerView: React.FC<MarketScannerViewProps> = ({
  rows,
  interval,
  market,
  quote,
  searchQuery,
  page,
  pageSize,
  totalCount,
  totalPages,
  updatedAt,
  loading,
  error,
  onQuoteChange,
  onSearchChange,
  onPageChange,
  onRefresh,
  onSelectSymbol,
}) => {
  const [signalFilter, setSignalFilter] = useState<SignalFilter>('ALL');
  const [sortField, setSortField] = useState<SortField>('quoteVolume24h');
  const [sortAsc, setSortAsc] = useState(false);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const filteredRows = useMemo(() => {
    return rows
      .filter((row) => {
        if (signalFilter === 'BUY') {
          return row.verdict === 'BUY' || row.verdict === 'STRONG_BUY';
        }
        if (signalFilter === 'SELL') {
          return row.verdict === 'SELL' || row.verdict === 'STRONG_SELL';
        }
        if (signalFilter === 'WAIT') {
          return row.verdict === 'WAIT';
        }
        return true;
      })
      .sort((a, b) => {
        const va = a[sortField] ?? 0;
        const vb = b[sortField] ?? 0;
        return sortAsc ? va - vb : vb - va;
      });
  }, [rows, signalFilter, sortField, sortAsc]);

  const startIdx = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIdx = Math.min(totalCount, page * pageSize);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              Market Scanner Semua Koin ({market === 'futures' ? 'USD-M Futures' : 'Spot'} · {interval})
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Memindai seluruh {totalCount.toLocaleString('en-US')} pasangan aktif Binance berdasarkan candle yang sudah close (non-repainting; sync 12 detik) dengan konfluensi SMA 20, EMA 21, RSI(14), dan likuiditas orderbook.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {updatedAt && (
              <span className="text-xs font-mono text-emerald-700 whitespace-nowrap">
                Auto-sync · {new Date(updatedAt).toLocaleTimeString('id-ID')}
              </span>
            )}
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Pindai Sekarang</span>
            </button>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <label htmlFor="scanner-search" className="sr-only">
                Cari semua simbol koin Binance
              </label>
              <input
                id="scanner-search"
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Cari di semua koin (mis. NEAR, PEPE)..."
                className="w-full pl-9 pr-3 py-2 text-xs rounded-md border border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-900"
              />
            </div>

            <div className="flex items-center gap-1 p-1 rounded-md bg-slate-100 border border-slate-200">
              {(
                [
                  { id: 'ALL', label: 'Semua Pair' },
                  { id: 'USDT', label: 'USDT' },
                  { id: 'USDC', label: 'USDC' },
                ] as const
              ).map((q) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => onQuoteChange(q.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    quote === q.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1 p-1 rounded-md bg-slate-100 border border-slate-200">
            {(
              [
                { id: 'ALL', label: 'Semua' },
                { id: 'BUY', label: 'Bias Naik' },
                { id: 'WAIT', label: 'Konsolidasi' },
                { id: 'SELL', label: 'Bias Turun' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSignalFilter(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  signalFilter === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 flex items-center justify-between gap-4">
          <p className="text-xs text-rose-700">{error}</p>
          <button
            type="button"
            onClick={onRefresh}
            className="px-3 py-1.5 text-xs font-medium rounded bg-rose-100 text-rose-800 hover:bg-rose-200"
          >
            Coba Lagi
          </button>
        </div>
      )}

      {/* High-Density Data Table */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500 bg-slate-50">
                <th className="py-3 px-4 font-medium">Koin</th>
                <th className="py-3 px-4 font-medium text-right">Harga</th>
                <th className="py-3 px-4 font-medium text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('priceChangePercent')}
                    className="inline-flex items-center gap-1 hover:text-slate-900"
                  >
                    <span>24j %</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-3 px-4 font-medium text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('quoteVolume24h')}
                    className="inline-flex items-center gap-1 hover:text-slate-900"
                  >
                    <span>Vol 24j</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-3 px-4 font-medium text-right">EMA 21</th>
                <th className="py-3 px-4 font-medium text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('rsi14')}
                    className="inline-flex items-center gap-1 hover:text-slate-900"
                  >
                    <span>RSI(14)</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-3 px-4 font-medium text-right">Bid/Ask</th>
                <th className="py-3 px-4 font-medium">Analisis Pergerakan</th>
                <th className="py-3 px-4 font-medium text-right">Saran Entry</th>
                <th className="py-3 px-4 font-medium text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('confidencePercent')}
                    className="inline-flex items-center gap-1 hover:text-slate-900"
                  >
                    <span>Konfluensi</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-3 px-4 font-medium text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {loading && rows.length === 0 ? (
                Array.from({ length: 8 }).map((_, idx) => (
                  <tr key={idx} className="animate-pulse">
                    <td colSpan={11} className="py-4 px-4">
                      <div className="h-4 bg-slate-100 rounded w-full" />
                    </td>
                  </tr>
                ))
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-10 px-4 text-center text-slate-500">
                    Tidak ada koin yang sesuai dengan filter pada halaman ini.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const isBuy = row.verdict === 'BUY' || row.verdict === 'STRONG_BUY';
                  const isSell = row.verdict === 'SELL' || row.verdict === 'STRONG_SELL';
                  const verdictClass = isBuy
                    ? 'text-emerald-700'
                    : isSell
                    ? 'text-rose-700'
                    : 'text-amber-700';
                  const bidPct = Math.round(row.imbalanceRatio * 100);

                  return (
                    <tr
                      key={row.symbol}
                      className="hover:bg-slate-50 transition-colors"
                    >
                      <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap">
                        {row.baseAsset}
                        <span className="text-slate-400 font-normal">/{row.quoteAsset}</span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900 font-medium">
                        ${formatPrice(row.lastPrice)}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-mono tabular-nums font-medium ${
                          row.priceChangePercent >= 0 ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {formatPercent(row.priceChangePercent)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600">
                        {formatUsdCompact(row.quoteVolume24h)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600">
                        ${formatPrice(row.ema21)}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-mono tabular-nums font-medium ${
                          (row.rsi14 ?? 50) > 70
                            ? 'text-rose-700'
                            : (row.rsi14 ?? 50) < 32
                            ? 'text-emerald-700'
                            : 'text-slate-800'
                        }`}
                      >
                        {row.rsi14 !== null ? row.rsi14.toFixed(1) : '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600">
                        {bidPct}% / {100 - bidPct}%
                      </td>
                      <td className={`py-3 px-4 font-semibold whitespace-nowrap ${verdictClass}`}>
                        {row.verdictLabel}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-amber-700 font-medium">
                        ${formatPrice(row.optimalEntry)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-800 font-medium">
                        {row.confidencePercent}%
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => onSelectSymbol(row.symbol)}
                          aria-label={`Analisis ${row.symbol}`}
                          className="px-3 py-1.5 rounded border border-slate-200 bg-white hover:bg-slate-900 hover:text-white hover:border-slate-900 text-slate-800 font-medium transition-colors whitespace-nowrap"
                        >
                          Analisis
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
          <span className="font-mono tabular-nums">
            Menampilkan {startIdx}–{endIdx} dari {totalCount.toLocaleString('en-US')} koin aktif
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => onPageChange(page - 1)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 font-medium text-slate-700"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Sebelumnya</span>
            </button>
            <span className="font-mono tabular-nums px-2">
              Hal {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => onPageChange(page + 1)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 font-medium text-slate-700"
            >
              <span>Berikutnya</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
