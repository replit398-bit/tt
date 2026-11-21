import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  BookOpen,
  Calculator,
  Crosshair,
  Layers,
  Menu,
  RefreshCw,
  Target,
  Wallet,
  X,
} from 'lucide-react';
import { CoinEntryAnalysisView } from './components/CoinEntryAnalysisView';
import { DashboardView } from './components/DashboardView';
import { FuturesAccountView } from './components/FuturesAccountView';
import { JournalCalculatorView } from './components/JournalCalculatorView';
import { LiquidityAnalysisView } from './components/LiquidityAnalysisView';
import { MarketScannerView } from './components/MarketScannerView';
import { MethodologyView } from './components/MethodologyView';
import { SimulationWinrateView } from './components/SimulationWinrateView';
import { SymbolSearchSelect, type SymbolOption } from './components/SymbolSearchSelect';
import type {
  AllowedTimeframe,
  Candle,
  FuturesMarketMeta,
  ManualJournalEntry,
  MarketAnalysisResult,
  MarketType,
  MultiTimeframeRecommendation,
  OrderbookData,
  ScannerApiResponse,
  ScannerRow,
  SimulationStatePayload,
  Ticker24h,
} from './types/market';

type PageId =
  | 'dashboard'
  | 'simulation'
  | 'coin_entry_analysis'
  | 'scanner'
  | 'liquidity'
  | 'futures_account'
  | 'journal'
  | 'methodology';

interface MarketApiResponse {
  symbol: string;
  interval: string;
  market: MarketType;
  source: 'binance-live' | 'fallback-sim';
  updatedAt?: number;
  ticker: Ticker24h;
  candles: Candle[];
  orderbook: OrderbookData;
  futuresMeta: FuturesMarketMeta | null;
  analysis: MarketAnalysisResult;
  mtfRecommendation?: MultiTimeframeRecommendation | null;
}

const QUICK_WATCHLIST = [
  'BTCUSDT',
  'NEARUSDT',
  'RENDERUSDT',
  'PUMPUSDT',
  'UNIUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'BNBUSDT',
];

const TIMEFRAME_OPTIONS: { value: AllowedTimeframe; label: string }[] = [
  { value: '1m', label: 'Chart Entry 1 Menit (1m)' },
  { value: '5m', label: 'Chart Entry 5 Menit (5m)' },
  { value: '15m', label: 'Chart Entry 15 Menit (15m)' },
  { value: '30m', label: 'TF Analisis 30 Menit (30m)' },
  { value: '1h', label: 'TF Analisis 1 Jam (1h)' },
  { value: '1d', label: 'TF Analisis 1 Hari (1d)' },
  { value: '1w', label: 'TF Analisis 1 Minggu (1w)' },
];

const NAV_ITEMS: {
  id: PageId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'dashboard', label: 'Dashboard Analisis', icon: BarChart3 },
  { id: 'simulation', label: 'Simulasi & Winrate', icon: Target },
  { id: 'coin_entry_analysis', label: 'Analisa Entry Koin', icon: Crosshair },
  { id: 'scanner', label: 'Market Scanner', icon: Activity },
  { id: 'liquidity', label: 'Analisis Likuiditas', icon: Layers },
  { id: 'futures_account', label: 'Futures & Akun API', icon: Wallet },
  { id: 'journal', label: 'Kalkulator & Jurnal', icon: Calculator },
  { id: 'methodology', label: 'Metodologi & API', icon: BookOpen },
];

const JOURNAL_STORAGE_KEY = 'arthaquant_manual_journal_v1';

function loadJournal(): ManualJournalEntry[] {
  try {
    const raw = localStorage.getItem(JOURNAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ManualJournalEntry[]) : [];
  } catch {
    return [];
  }
}

export default function App() {
  const [activePage, setActivePage] = useState<PageId>('dashboard');
  const [market, setMarket] = useState<MarketType>('spot');
  const [symbol, setSymbol] = useState<string>('BTCUSDT');
  const [timeframe, setTimeframe] = useState<AllowedTimeframe>('1h');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [marketData, setMarketData] = useState<MarketApiResponse | null>(null);
  const [loadingMarket, setLoadingMarket] = useState<boolean>(true);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [streamConnected, setStreamConnected] = useState<boolean>(false);
  const streamConnectedRef = React.useRef<boolean>(false);
  const [lastLiveTickAt, setLastLiveTickAt] = useState<number | null>(null);

  const [scannerRows, setScannerRows] = useState<ScannerRow[]>([]);
  const [scannerQuote, setScannerQuote] = useState<string>('USDT');
  const [scannerSearch, setScannerSearch] = useState<string>('');
  const [debouncedScannerSearch, setDebouncedScannerSearch] = useState<string>('');
  const [scannerPage, setScannerPage] = useState<number>(1);
  const [scannerTotalCount, setScannerTotalCount] = useState<number>(0);
  const [scannerTotalPages, setScannerTotalPages] = useState<number>(1);
  const [scannerUpdatedAt, setScannerUpdatedAt] = useState<number | null>(null);
  const [loadingScanner, setLoadingScanner] = useState<boolean>(false);
  const [scannerError, setScannerError] = useState<string | null>(null);

  const [simData, setSimData] = useState<SimulationStatePayload | null>(null);
  const [loadingSim, setLoadingSim] = useState<boolean>(false);
  const [simActionLoading, setSimActionLoading] = useState<boolean>(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [analysisCoinSymbol, setAnalysisCoinSymbol] = useState<string>('BTCUSDT');

  const [availableSymbols, setAvailableSymbols] = useState<SymbolOption[]>(
    QUICK_WATCHLIST.map((s) => ({
      symbol: s,
      baseAsset: s.replace('USDT', ''),
      quoteAsset: 'USDT',
    }))
  );

  const [journalEntries, setJournalEntries] = useState<ManualJournalEntry[]>(() =>
    loadJournal()
  );

  useEffect(() => {
    try {
      localStorage.setItem(JOURNAL_STORAGE_KEY, JSON.stringify(journalEntries));
    } catch {
      // Ignore storage quota errors
    }
  }, [journalEntries]);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedScannerSearch(scannerSearch.trim());
      setScannerPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [scannerSearch]);

  const fetchMarket = useCallback(
    async (
      targetSymbol: string,
      targetTf: string,
      targetMarket: MarketType,
      silent = false
    ) => {
      if (!silent) setLoadingMarket(true);
      setMarketError(null);
      try {
        const res = await fetch(
          `/api/binance/market?symbol=${encodeURIComponent(targetSymbol)}&interval=${encodeURIComponent(targetTf)}&market=${encodeURIComponent(targetMarket)}&limit=200&fresh=1`
        );
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || `Gagal memuat data live (${res.status})`);
        }
        const data = (await res.json()) as MarketApiResponse;
        setMarketData(data);
        setLastLiveTickAt(data.updatedAt ?? Date.now());
      } catch (err) {
        if (!silent) {
          setMarketError(
            err instanceof Error
              ? err.message
              : 'Terjadi kesalahan saat mengambil data live Binance.'
          );
        }
      } finally {
        if (!silent) setLoadingMarket(false);
      }
    },
    []
  );

  const fetchScanner = useCallback(
    async (
      targetTf: string,
      targetMarket: MarketType,
      targetQuote: string,
      targetSearch: string,
      targetPage: number,
      silent = false
    ) => {
      if (!silent) setLoadingScanner(true);
      setScannerError(null);
      try {
        const params = new URLSearchParams({
          interval: targetTf,
          market: targetMarket,
          quote: targetQuote,
          search: targetSearch,
          page: String(targetPage),
          pageSize: '15',
        });
        const res = await fetch(`/api/binance/scanner?${params.toString()}`);
        if (!res.ok) {
          throw new Error(`Scanner error (${res.status})`);
        }
        const data = (await res.json()) as ScannerApiResponse;
        setScannerRows(data.rows);
        setScannerTotalCount(data.totalCount);
        setScannerTotalPages(data.totalPages);
        setScannerPage(data.page);
        setScannerUpdatedAt(data.updatedAt);
      } catch (err) {
        if (!silent) {
          setScannerError(
            err instanceof Error ? err.message : 'Gagal menjalankan Market Scanner.'
          );
        }
      } finally {
        if (!silent) setLoadingScanner(false);
      }
    },
    []
  );

  const fetchSimulationState = useCallback(async (silent = false) => {
    if (!silent) setLoadingSim(true);
    setSimError(null);
    try {
      const res = await fetch('/api/simulation/state');
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Gagal memuat data simulasi (${res.status})`);
      }
      const data = (await res.json()) as SimulationStatePayload;
      setSimData(data);
    } catch (err) {
      if (!silent) {
        setSimError(
          err instanceof Error ? err.message : 'Gagal memuat status simulasi & winrate.'
        );
      }
    } finally {
      if (!silent) setLoadingSim(false);
    }
  }, []);

  // Load ALL active Binance pairs across all quote assets (Spot 1,376+ / Futures 817+)
  useEffect(() => {
    let active = true;
    const loadSymbols = () => {
      fetch(`/api/binance/symbols?market=${encodeURIComponent(market)}&quote=ALL`)
        .then((r) => r.json())
        .then((d: { symbols?: SymbolOption[] }) => {
          if (active && Array.isArray(d.symbols) && d.symbols.length > 0) {
            setAvailableSymbols(d.symbols);
          }
        })
        .catch(() => {
          // Keep current symbol list
        });
    };
    loadSymbols();
    const timer = setInterval(loadSymbols, 5 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [market]);

  // Real-Time Binance SSE Stream (WebSocket-backed Spot / High-frequency live REST Futures) + backup auto-poll
  useEffect(() => {
    let cancelled = false;
    setLoadingMarket(true);
    setMarketError(null);
    streamConnectedRef.current = false;
    setStreamConnected(false);

    // Initial immediate fetch so first paint is instant
    void fetchMarket(symbol, timeframe, market, false);

    const streamUrl = `/api/binance/stream?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}&market=${encodeURIComponent(market)}`;
    const es = new EventSource(streamUrl);

    es.onopen = () => {
      if (!cancelled) {
        streamConnectedRef.current = true;
        setStreamConnected(true);
      }
    };

    es.addEventListener('market', (ev) => {
      if (cancelled) return;
      try {
        const payload = JSON.parse((ev as MessageEvent<string>).data) as MarketApiResponse;
        setMarketData(payload);
        setMarketError(null);
        setLoadingMarket(false);
        streamConnectedRef.current = true;
        setStreamConnected(true);
        setLastLiveTickAt(payload.updatedAt ?? Date.now());
      } catch {
        // Ignore malformed SSE payload
      }
    });

    es.addEventListener('stream_error', (ev) => {
      if (cancelled) return;
      try {
        const errPayload = JSON.parse((ev as MessageEvent<string>).data) as { error?: string };
        if (errPayload.error) {
          setMarketError(errPayload.error);
        }
      } catch {
        // Ignore
      }
      streamConnectedRef.current = false;
      setStreamConnected(false);
    });

    es.onerror = () => {
      if (!cancelled) {
        streamConnectedRef.current = false;
        setStreamConnected(false);
      }
    };

    // Backup silent auto-refresh every 4s only when EventSource is disconnected
    const backupTimer = setInterval(() => {
      if (!cancelled && !streamConnectedRef.current) {
        void fetchMarket(symbol, timeframe, market, true);
      }
    }, 4000);

    return () => {
      cancelled = true;
      es.close();
      clearInterval(backupTimer);
    };
  }, [symbol, timeframe, market, fetchMarket]);

  // Auto-refresh Market Scanner every 12s when active
  useEffect(() => {
    if (activePage !== 'scanner') return;
    void fetchScanner(
      timeframe,
      market,
      scannerQuote,
      debouncedScannerSearch,
      scannerPage,
      false
    );
    const timer = setInterval(() => {
      void fetchScanner(
        timeframe,
        market,
        scannerQuote,
        debouncedScannerSearch,
        scannerPage,
        true
      );
    }, 12000);
    return () => clearInterval(timer);
  }, [
    activePage,
    timeframe,
    market,
    scannerQuote,
    debouncedScannerSearch,
    scannerPage,
    fetchScanner,
  ]);

  // Fetch & auto-refresh simulation & winrate state every 2.5s when active
  useEffect(() => {
    void fetchSimulationState(false);
  }, [fetchSimulationState]);

  useEffect(() => {
    if (activePage !== 'simulation' && activePage !== 'coin_entry_analysis') return;
    void fetchSimulationState(false);
    const timer = setInterval(() => {
      void fetchSimulationState(true);
    }, 2500);
    return () => clearInterval(timer);
  }, [activePage, fetchSimulationState]);

  const handleSimulationPost = useCallback(
    async (endpoint: string, body?: Record<string, unknown>) => {
      setSimActionLoading(true);
      setSimError(null);
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body ?? {}),
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || `Gagal memproses simulasi (${res.status})`);
        }
        const data = (await res.json()) as SimulationStatePayload;
        setSimData(data);
      } catch (err) {
        setSimError(
          err instanceof Error ? err.message : 'Gagal menjalankan aksi simulasi.'
        );
      } finally {
        setSimActionLoading(false);
      }
    },
    []
  );

  const handleStartAutoSim = (targetSymbol: string, targetMarket: MarketType) => {
    void handleSimulationPost('/api/simulation/start', {
      symbol: targetSymbol,
      market: targetMarket,
    });
  };

  const handleToggleSimEnabled = (enabled: boolean) => {
    void handleSimulationPost('/api/simulation/config', { enabled });
  };

  const handleSyncSimTarget = (targetSymbol: string, targetMarket: MarketType) => {
    void handleSimulationPost('/api/simulation/config', {
      symbol: targetSymbol,
      market: targetMarket,
    });
  };

  const handleRunSimNow = (targetSymbol: string, targetMarket: MarketType) => {
    void handleSimulationPost('/api/simulation/run-now', {
      symbol: targetSymbol,
      market: targetMarket,
    });
  };

  const handleResetSim = () => {
    void handleSimulationPost('/api/simulation/reset');
  };

  const handleToggleAutoReversalTp = (autoTakeProfitOnReversal: boolean) => {
    void handleSimulationPost('/api/simulation/config', { autoTakeProfitOnReversal });
  };

  const handleCloseSimTrade = (tradeId: string) => {
    void handleSimulationPost('/api/simulation/close-trade', { tradeId });
  };

  const handleInspectCoinPage = (coinSymbol: string) => {
    setAnalysisCoinSymbol(coinSymbol);
    setActivePage('coin_entry_analysis');
    setMobileMenuOpen(false);
  };

  const handleSelectSymbolFromScanner = (nextSym: string) => {
    setSymbol(nextSym);
    setActivePage('dashboard');
  };

  const handleNavigate = (page: PageId) => {
    setActivePage(page);
    setMobileMenuOpen(false);
  };

  const activePageTitle =
    NAV_ITEMS.find((n) => n.id === activePage)?.label ?? 'Dashboard Analisis';

  const handleAddJournalEntry = (entry: ManualJournalEntry) => {
    setJournalEntries((prev) => [entry, ...prev]);
  };

  const handleUpdateJournalStatus = (
    id: string,
    status: ManualJournalEntry['status'],
    pnlUsdt: number
  ) => {
    setJournalEntries((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status, pnlUsdt } : item))
    );
  };

  const handleDeleteJournalEntry = (id: string) => {
    setJournalEntries((prev) => prev.filter((item) => item.id !== id));
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/30 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Left Sidebar Navigation */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[248px] bg-white border-r border-slate-200 flex flex-col justify-between transition-transform duration-150 lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div>
          {/* Brand Header */}
          <div className="h-14 px-5 flex items-center justify-between border-b border-slate-200">
            <span className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
              ArthaQuant
            </span>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Tutup menu navigasi"
              className="lg:hidden p-1.5 text-slate-500 hover:text-slate-900"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Primary Navigation */}
          <nav aria-label="Menu utama" className="p-3 space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activePage === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavigate(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Quick Coin Watchlist */}
          <div className="px-4 pt-4 pb-2 border-t border-slate-200 mt-2">
            <div className="text-xs font-medium text-slate-500 mb-2">
              Watchlist Koin Cepat
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {QUICK_WATCHLIST.map((coin) => {
                const active = symbol === coin;
                return (
                  <button
                    key={coin}
                    type="button"
                    onClick={() => {
                      setSymbol(coin);
                      if (activePage === 'scanner') {
                        setActivePage('dashboard');
                      }
                      setMobileMenuOpen(false);
                    }}
                    className={`px-2.5 py-1.5 rounded text-xs font-mono text-left transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-slate-900 text-white font-semibold'
                        : 'text-slate-700 border border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {coin.replace('USDT', '')}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-slate-200 text-xs text-slate-500 space-y-1">
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                streamConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
              }`}
            />
            <span className="text-slate-900 font-semibold">
              {market === 'futures' ? 'Binance Futures Live' : 'Binance Spot Live'}
            </span>
          </div>
          <div className="text-slate-500 font-mono text-[11px] tabular-nums">
            {lastLiveTickAt
              ? `Real-time · ${new Date(lastLiveTickAt).toLocaleTimeString('id-ID')}`
              : 'Menghubungkan stream...'}
          </div>
          <div className="text-slate-400">Eksekusi Manual oleh Trader</div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Workspace Header */}
        <header className="h-14 px-4 lg:px-6 border-b border-slate-200 bg-white flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Buka menu navigasi"
              className="lg:hidden p-2 -ml-1 rounded text-slate-600 hover:bg-slate-100 shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-xs text-slate-500 min-w-0">
              <span className="hidden 2xl:inline shrink-0">Workspace</span>
              <span className="hidden 2xl:inline text-slate-300 shrink-0">/</span>
              <span className="text-slate-900 font-semibold whitespace-nowrap shrink-0">
                {activePageTitle}
              </span>
              <span
                data-testid="live-stream-status"
                className="hidden md:inline-flex items-center gap-1.5 ml-1.5 pl-2 border-l border-slate-200 font-mono text-[11px] text-emerald-700 whitespace-nowrap shrink-0"
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    streamConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                  }`}
                />
                <span>
                  {streamConnected ? 'LIVE' : 'SYNC'}
                  {lastLiveTickAt
                    ? ` · ${new Date(lastLiveTickAt).toLocaleTimeString('id-ID')}`
                    : ''}
                </span>
              </span>
            </div>
          </div>

          {/* Workspace Controls: Market Mode + Searchable Coin Picker + All Timeframes + Sync */}
          <div className="flex items-center gap-1.5 shrink-0">
            <div
              role="group"
              aria-label="Pilih tipe pasar"
              className="hidden sm:flex items-center p-0.5 rounded-md border border-slate-200 bg-slate-100"
            >
              <button
                type="button"
                onClick={() => setMarket('spot')}
                className={`px-2 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  market === 'spot'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Spot
              </button>
              <button
                type="button"
                onClick={() => setMarket('futures')}
                className={`px-2 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  market === 'futures'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Futures
              </button>
            </div>

            <SymbolSearchSelect
              value={symbol}
              options={availableSymbols}
              onChange={(nextSym) => setSymbol(nextSym)}
            />

            <div
              role="group"
              aria-label="Pilih timeframe analisis"
              data-testid="timeframe-switcher"
              className="hidden sm:flex items-center p-0.5 rounded-md border border-slate-200 bg-slate-100"
            >
              {TIMEFRAME_OPTIONS.map((tf) => (
                <button
                  key={tf.value}
                  type="button"
                  title={tf.label}
                  onClick={() => setTimeframe(tf.value)}
                  className={`px-2 py-1 text-xs font-mono rounded transition-colors whitespace-nowrap shrink-0 ${
                    timeframe === tf.value
                      ? 'bg-white text-slate-900 font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tf.value}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                if (activePage === 'scanner') {
                  void fetchScanner(
                    timeframe,
                    market,
                    scannerQuote,
                    debouncedScannerSearch,
                    scannerPage
                  );
                } else if (activePage === 'simulation' || activePage === 'coin_entry_analysis') {
                  void fetchSimulationState(false);
                } else {
                  void fetchMarket(symbol, timeframe, market);
                }
              }}
              aria-label="Sinkronkan ulang sekarang"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  loadingMarket || loadingScanner || loadingSim ? 'animate-spin' : ''
                }`}
              />
              <span className="hidden 2xl:inline">Sync</span>
            </button>
          </div>
        </header>

        {/* Mobile Market & Timeframe Bar */}
        <div className="sm:hidden px-4 py-2 border-b border-slate-200 bg-white flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMarket('spot')}
              className={`px-2 py-1 text-xs rounded ${
                market === 'spot' ? 'bg-slate-900 text-white font-semibold' : 'text-slate-600'
              }`}
            >
              Spot
            </button>
            <button
              type="button"
              onClick={() => setMarket('futures')}
              className={`px-2 py-1 text-xs rounded ${
                market === 'futures'
                  ? 'bg-slate-900 text-white font-semibold'
                  : 'text-slate-600'
              }`}
            >
              Futures
            </button>
          </div>
          <div
            role="group"
            aria-label="Pilih timeframe mobile"
            className="flex items-center gap-0.5 p-0.5 rounded-md border border-slate-200 bg-slate-100 overflow-x-auto"
          >
            {TIMEFRAME_OPTIONS.map((tf) => (
              <button
                key={tf.value}
                type="button"
                onClick={() => setTimeframe(tf.value)}
                className={`px-2 py-1 text-xs font-mono rounded ${
                  timeframe === tf.value
                    ? 'bg-white text-slate-900 font-semibold shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                {tf.value}
              </button>
            ))}
          </div>
        </div>

        {/* Main Scrollable Viewport */}
        <main className="flex-1 p-4 lg:p-6 max-w-[1600px] w-full mx-auto">
          {marketError &&
          !marketData &&
          activePage !== 'scanner' &&
          activePage !== 'simulation' &&
          activePage !== 'coin_entry_analysis' &&
          activePage !== 'methodology' &&
          activePage !== 'futures_account' ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-rose-800">
                  Gagal Memuat Data Live Binance ({symbol})
                </h2>
                <p className="text-xs text-rose-700 mt-1">{marketError}</p>
              </div>
              <button
                type="button"
                onClick={() => void fetchMarket(symbol, timeframe, market)}
                className="px-4 py-2 rounded-md bg-rose-100 hover:bg-rose-200 text-xs font-semibold text-rose-900 whitespace-nowrap"
              >
                Coba Hubungkan Ulang
              </button>
            </div>
          ) : loadingMarket &&
            !marketData &&
            activePage !== 'scanner' &&
            activePage !== 'simulation' &&
            activePage !== 'coin_entry_analysis' &&
            activePage !== 'methodology' &&
            activePage !== 'futures_account' ? (
            <div className="space-y-4 animate-pulse">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-24 rounded-lg border border-slate-200 bg-white"
                  />
                ))}
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
                <div className="xl:col-span-8 h-[480px] rounded-lg border border-slate-200 bg-white" />
                <div className="xl:col-span-4 h-[480px] rounded-lg border border-slate-200 bg-white" />
              </div>
            </div>
          ) : (
            <>
              {activePage === 'dashboard' && marketData && (
                <DashboardView
                  symbol={marketData.symbol}
                  timeframe={marketData.interval}
                  market={marketData.market}
                  ticker={marketData.ticker}
                  candles={marketData.candles}
                  analysis={marketData.analysis}
                  mtfRecommendation={marketData.mtfRecommendation}
                  futuresMeta={marketData.futuresMeta}
                  onSelectTimeframe={(tf) => setTimeframe(tf)}
                  onOpenLiquidityPage={() => setActivePage('liquidity')}
                  onUseExecutionPlan={() => setActivePage('journal')}
                />
              )}

              {activePage === 'simulation' && (
                <SimulationWinrateView
                  activeSymbol={symbol}
                  activeMarket={market}
                  liveStreamPrice={
                    marketData &&
                    marketData.symbol === symbol &&
                    marketData.market === market
                      ? marketData.ticker.lastPrice
                      : null
                  }
                  liveStreamUpdatedAt={lastLiveTickAt}
                  data={simData}
                  loading={loadingSim}
                  actionLoading={simActionLoading}
                  error={simError}
                  onRefresh={() => void fetchSimulationState(false)}
                  onStartAuto={handleStartAutoSim}
                  onToggleEnabled={handleToggleSimEnabled}
                  onToggleAutoReversalTp={handleToggleAutoReversalTp}
                  onSyncSchedulerTarget={handleSyncSimTarget}
                  onRunNow={handleRunSimNow}
                  onCloseTrade={handleCloseSimTrade}
                  onInspectCoinPage={handleInspectCoinPage}
                  onReset={handleResetSim}
                />
              )}

              {activePage === 'coin_entry_analysis' && (
                <CoinEntryAnalysisView
                  selectedCoin={analysisCoinSymbol}
                  onSelectCoin={(nextCoin) => setAnalysisCoinSymbol(nextCoin)}
                  activeMarket={market}
                  liveStreamPrice={
                    marketData &&
                    marketData.symbol === analysisCoinSymbol &&
                    marketData.market === market
                      ? marketData.ticker.lastPrice
                      : null
                  }
                  liveStreamSymbol={analysisCoinSymbol}
                  liveStreamUpdatedAt={lastLiveTickAt}
                  data={simData}
                  loading={loadingSim}
                  actionLoading={simActionLoading}
                  error={simError}
                  onRefresh={() => void fetchSimulationState(false)}
                  onStartAuto={handleStartAutoSim}
                  onToggleEnabled={handleToggleSimEnabled}
                  onToggleAutoReversalTp={handleToggleAutoReversalTp}
                  onRunNow={handleRunSimNow}
                  onCloseTrade={handleCloseSimTrade}
                  onOpenMarketChart={(coinSym, tf) => {
                    setSymbol(coinSym);
                    if (tf) setTimeframe(tf);
                    setActivePage('dashboard');
                  }}
                />
              )}

              {activePage === 'scanner' && (
                <MarketScannerView
                  rows={scannerRows}
                  interval={timeframe}
                  market={market}
                  quote={scannerQuote}
                  searchQuery={scannerSearch}
                  page={scannerPage}
                  pageSize={15}
                  totalCount={scannerTotalCount}
                  totalPages={scannerTotalPages}
                  updatedAt={scannerUpdatedAt}
                  loading={loadingScanner}
                  error={scannerError}
                  onQuoteChange={(nextQ) => {
                    setScannerQuote(nextQ);
                    setScannerPage(1);
                  }}
                  onSearchChange={(nextS) => setScannerSearch(nextS)}
                  onPageChange={(nextP) => setScannerPage(nextP)}
                  onRefresh={() =>
                    void fetchScanner(
                      timeframe,
                      market,
                      scannerQuote,
                      debouncedScannerSearch,
                      scannerPage
                    )
                  }
                  onSelectSymbol={handleSelectSymbolFromScanner}
                />
              )}

              {activePage === 'liquidity' && marketData && (
                <LiquidityAnalysisView
                  symbol={marketData.symbol}
                  timeframe={marketData.interval}
                  orderbook={marketData.orderbook}
                  analysis={marketData.analysis}
                />
              )}

              {activePage === 'futures_account' && (
                <FuturesAccountView
                  symbol={symbol}
                  futuresMeta={marketData?.futuresMeta ?? null}
                />
              )}

              {activePage === 'journal' &&
                marketData &&
                (() => {
                  const isEntryChart =
                    marketData.interval === '1m' ||
                    marketData.interval === '5m' ||
                    marketData.interval === '15m';
                  const useMtfEntry = !isEntryChart && Boolean(marketData.mtfRecommendation);
                  const entryTf = useMtfEntry
                    ? marketData.mtfRecommendation!.recommendedTimeframe
                    : marketData.interval;
                  const initialEntry = useMtfEntry
                    ? marketData.mtfRecommendation!.recommendedOptimalEntry
                    : marketData.analysis.executionPlan.optimalEntry;
                  const initialSl = useMtfEntry
                    ? marketData.mtfRecommendation!.recommendedStopLoss
                    : marketData.analysis.executionPlan.stopLoss;
                  const initialTp = useMtfEntry
                    ? marketData.mtfRecommendation!.recommendedTakeProfit1
                    : marketData.analysis.executionPlan.takeProfit1;
                  const rawBias = useMtfEntry
                    ? marketData.mtfRecommendation!.recommendedBias
                    : marketData.analysis.executionPlan.bias;
                  const verdictLabel = useMtfEntry
                    ? marketData.mtfRecommendation!.recommendedMovementLabel
                    : marketData.analysis.verdictLabel;

                  return (
                    <JournalCalculatorView
                      key={`${marketData.symbol}-${entryTf}-${initialEntry.toFixed(6)}`}
                      symbol={marketData.symbol}
                      timeframe={entryTf}
                      initialEntry={initialEntry}
                      initialStopLoss={initialSl}
                      initialTakeProfit={initialTp}
                      initialSide={rawBias === 'SHORT' ? 'SHORT' : 'LONG'}
                      verdictLabel={verdictLabel}
                      journalEntries={journalEntries}
                      onAddJournalEntry={handleAddJournalEntry}
                      onUpdateStatus={handleUpdateJournalStatus}
                      onDeleteEntry={handleDeleteJournalEntry}
                    />
                  );
                })()}

              {activePage === 'methodology' && (
                <MethodologyView
                  dataSource={marketData?.source ?? 'binance-live'}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
