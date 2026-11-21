import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import {
  ALLOWED_TIMEFRAMES,
  MIN_ENTRY_MOMENTUM_PERCENT,
  analyzeMarketDecision,
  computeMultiTimeframeRecommendation,
} from './src/lib/decisionEngine.ts';
import { mergeLiveCandle, partitionClosedCandles } from './src/lib/realtime.ts';
import {
  DEFAULT_COIN_STARTING_BALANCE_USD,
  DEFAULT_RISK_PERCENT_PER_TRADE,
  DEFAULT_SIMULATION_COINS,
  DEFAULT_TF_STARTING_BALANCE_USD,
  computeSimulationMetrics,
  computeSymbolSimulationMetrics,
  computeTradeRiskUsd,
  createSimulatedTradeFromAnalysis,
  evaluateOpenTradeAgainstCandles,
  evaluateOpenTradeAgainstLivePrice,
  evaluateOpenTradeReversalTakeProfit,
  get30MinuteSlotTime,
  getCoinTimeframeAccountBalance,
  normalizeSimulationCoins,
  resolveQualifiedTradeSide,
} from './src/lib/simulationEngine.ts';
import type {
  AllowedTimeframe,
  Candle,
  FuturesAccountSummary,
  FuturesMarketMeta,
  MarketAnalysisResult,
  MarketType,
  MultiTimeframeRecommendation,
  OrderbookData,
  ScannerApiResponse,
  ScannerRow,
  SimulatedTrade,
  SimulatedTradeSource,
  SimulationStatePayload,
  SpotGeneralInfo,
  Ticker24h,
  TimeframeSimScanStatus,
} from './src/types/market.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BINANCE_SPOT_PUBLIC_BASES = [
  'https://data-api.binance.vision',
  'https://api.binance.com',
  'https://api1.binance.com',
  'https://api3.binance.com',
];
const BINANCE_SPOT_WS_BASE = 'wss://data-stream.binance.vision/stream';
const BINANCE_SPOT_API_BASE = 'https://api.binance.com';
const BINANCE_FUTURES_API_BASE = 'https://fapi.binance.com';

const VALID_INTERVALS = new Set<string>(ALLOWED_TIMEFRAMES);
const SYMBOL_REGEX = /^[A-Z0-9]{4,20}$/;

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCached<T>(key: string, data: T, ttlMs: number): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

let binanceTimeOffsetMs = 0;
let lastTimeSyncAt = 0;
function getBinanceNow(): number {
  return Date.now() + binanceTimeOffsetMs;
}
async function syncBinanceServerTime(): Promise<void> {
  if (Date.now() - lastTimeSyncAt < 60_000) return;
  lastTimeSyncAt = Date.now();
  try {
    const t0 = Date.now();
    const res = await fetchJsonFromBases<{ serverTime: number }>(
      BINANCE_SPOT_PUBLIC_BASES,
      '/api/v3/time'
    );
    const t1 = Date.now();
    binanceTimeOffsetMs = res.serverTime - Math.round((t0 + t1) / 2);
  } catch {
    // Keep existing offset if offline
  }
}

const closedAnalysisCache = new Map<string, MarketAnalysisResult>();
function getOrComputeClosedAnalysis(
  market: MarketType,
  symbol: string,
  tf: string,
  candles: Candle[],
  orderbook: OrderbookData,
  nowMs = getBinanceNow()
): MarketAnalysisResult {
  const { closedCandles, lastClosedCandle } = partitionClosedCandles(candles, nowMs, tf);
  const closedKey = lastClosedCandle
    ? `${market}:${symbol}:${tf}:${lastClosedCandle.openTime}:${closedCandles.length}`
    : `${market}:${symbol}:${tf}:none:${candles.length}`;

  const locked = closedAnalysisCache.get(closedKey);
  if (locked) {
    return locked;
  }

  const computed = analyzeMarketDecision(symbol, tf, candles, orderbook, nowMs);
  if (closedAnalysisCache.size > 600) {
    const oldestKey = closedAnalysisCache.keys().next().value;
    if (oldestKey) closedAnalysisCache.delete(oldestKey);
  }
  closedAnalysisCache.set(closedKey, computed);
  return computed;
}

async function fetchJsonFromBases<T>(bases: string[], endpointPath: string): Promise<T> {
  let lastErr: Error | null = null;
  for (const base of bases) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5500);
    try {
      const response = await fetch(`${base}${endpointPath}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timer);
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Binance HTTP ${response.status}: ${text.slice(0, 140)}`);
      }
      return (await response.json()) as T;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastErr ?? new Error('Binance API unreachable');
}

async function fetchSignedBinanceJson<T>(
  baseUrl: string,
  endpointPath: string,
  apiKey: string,
  secretKey: string,
  extraParams: Record<string, string | number> = {}
): Promise<T> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(extraParams)) {
    params.set(k, String(v));
  }
  params.set('recvWindow', '10000');
  params.set('timestamp', String(Date.now()));

  const queryString = params.toString();
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(queryString)
    .digest('hex');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(
      `${baseUrl}${endpointPath}?${queryString}&signature=${signature}`,
      {
        signal: controller.signal,
        headers: {
          'X-MBX-APIKEY': apiKey,
          Accept: 'application/json',
        },
      }
    );
    clearTimeout(timer);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Binance ${response.status}: ${text.slice(0, 160)}`);
    }
    return (await response.json()) as T;
  } catch (err) {
    clearTimeout(timer);
    throw err instanceof Error ? err : new Error(String(err));
  }
}

function parseKlines(raw: unknown[][]): Candle[] {
  return raw.map((row) => ({
    openTime: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    closeTime: Number(row[6]),
    quoteVolume: Number(row[7]),
    trades: Number(row[8]),
  }));
}

interface Raw24hTicker {
  symbol: string;
  lastPrice: string;
  priceChange: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  weightedAvgPrice: string;
  count: number;
}

export interface UniverseSymbolEntry {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  contractType?: string;
  lastPrice: number;
  priceChangePercent: number;
  quoteVolume: number;
  quoteVolumeUsd: number;
}

async function loadSymbolUniverse(market: MarketType): Promise<UniverseSymbolEntry[]> {
  const cacheKey = `universe:${market}`;
  const cached = getCached<UniverseSymbolEntry[]>(cacheKey);
  if (cached) return cached;

  if (market === 'futures') {
    const [info, tickers] = await Promise.all([
      fetchJsonFromBases<{
        symbols: {
          symbol: string;
          baseAsset: string;
          quoteAsset: string;
          status: string;
          contractType: string;
        }[];
      }>([BINANCE_FUTURES_API_BASE], '/fapi/v1/exchangeInfo'),
      fetchJsonFromBases<Raw24hTicker[]>(
        [BINANCE_FUTURES_API_BASE],
        '/fapi/v1/ticker/24hr'
      ),
    ]);

    const tickerMap = new Map<string, Raw24hTicker>();
    for (const t of tickers) {
      tickerMap.set(t.symbol, t);
    }

    const btcPrice = Number(tickerMap.get('BTCUSDT')?.lastPrice ?? 60000) || 60000;
    const entries: UniverseSymbolEntry[] = info.symbols
      .filter((s) => s.status === 'TRADING')
      .map((s) => {
        const t = tickerMap.get(s.symbol);
        const rawVol = Number(t?.quoteVolume ?? 0) || 0;
        const mult =
          s.quoteAsset === 'USDT' || s.quoteAsset === 'USDC' || s.quoteAsset === 'FDUSD'
            ? 1
            : s.quoteAsset === 'BTC'
            ? btcPrice
            : 1;
        return {
          symbol: s.symbol,
          baseAsset: s.baseAsset,
          quoteAsset: s.quoteAsset,
          contractType: s.contractType,
          lastPrice: Number(t?.lastPrice ?? 0) || 0,
          priceChangePercent: Number(t?.priceChangePercent ?? 0) || 0,
          quoteVolume: rawVol,
          quoteVolumeUsd: rawVol * mult,
        };
      })
      .sort((a, b) => b.quoteVolumeUsd - a.quoteVolumeUsd || a.symbol.localeCompare(b.symbol));

    setCached(cacheKey, entries, 15000);
    return entries;
  }

  const [info, tickers] = await Promise.all([
    fetchJsonFromBases<{
      symbols: { symbol: string; baseAsset: string; quoteAsset: string; status: string }[];
    }>(BINANCE_SPOT_PUBLIC_BASES, '/api/v3/exchangeInfo'),
    fetchJsonFromBases<Raw24hTicker[]>(BINANCE_SPOT_PUBLIC_BASES, '/api/v3/ticker/24hr'),
  ]);

  const tickerMap = new Map<string, Raw24hTicker>();
  for (const t of tickers) {
    tickerMap.set(t.symbol, t);
  }

  const getUsdRate = (quote: string): number => {
    if (quote === 'USDT' || quote === 'USDC' || quote === 'FDUSD' || quote === 'USD1' || quote === 'U') {
      return 1;
    }
    const direct = Number(tickerMap.get(`${quote}USDT`)?.lastPrice ?? 0);
    if (direct > 0) return direct;
    const inverse = Number(tickerMap.get(`USDT${quote}`)?.lastPrice ?? 0);
    if (inverse > 0) return 1 / inverse;
    return 0.01;
  };

  const entries: UniverseSymbolEntry[] = info.symbols
    .filter((s) => s.status === 'TRADING')
    .map((s) => {
      const t = tickerMap.get(s.symbol);
      const rawVol = Number(t?.quoteVolume ?? 0) || 0;
      const usdMult = getUsdRate(s.quoteAsset);
      return {
        symbol: s.symbol,
        baseAsset: s.baseAsset,
        quoteAsset: s.quoteAsset,
        lastPrice: Number(t?.lastPrice ?? 0) || 0,
        priceChangePercent: Number(t?.priceChangePercent ?? 0) || 0,
        quoteVolume: rawVol,
        quoteVolumeUsd: rawVol * usdMult,
      };
    })
    .sort((a, b) => b.quoteVolumeUsd - a.quoteVolumeUsd || a.symbol.localeCompare(b.symbol));

  setCached(cacheKey, entries, 15000);
  return entries;
}

async function loadFuturesMeta(symbol: string, bypassCache = false): Promise<FuturesMarketMeta> {
  const cacheKey = `fmeta:${symbol}`;
  if (!bypassCache) {
    const cached = getCached<FuturesMarketMeta>(cacheKey);
    if (cached) return cached;
  }

  const [premium, oi, fundingHist] = await Promise.all([
    fetchJsonFromBases<{
      symbol: string;
      markPrice: string;
      indexPrice: string;
      estimatedSettlePrice: string;
      lastFundingRate: string;
      nextFundingTime: number;
    }>(
      [BINANCE_FUTURES_API_BASE],
      `/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`
    ),
    fetchJsonFromBases<{ symbol: string; openInterest: string }>(
      [BINANCE_FUTURES_API_BASE],
      `/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`
    ),
    fetchJsonFromBases<
      { symbol: string; fundingTime: number; fundingRate: string; markPrice: string }[]
    >(
      [BINANCE_FUTURES_API_BASE],
      `/fapi/v1/fundingRate?symbol=${encodeURIComponent(symbol)}&limit=8`
    ).catch(() => []),
  ]);

  const markPrice = Number(premium.markPrice);
  const openInterest = Number(oi.openInterest);
  const meta: FuturesMarketMeta = {
    symbol,
    markPrice,
    indexPrice: Number(premium.indexPrice),
    estimatedSettlePrice: Number(premium.estimatedSettlePrice),
    lastFundingRate: Number(premium.lastFundingRate),
    nextFundingTime: Number(premium.nextFundingTime),
    openInterest,
    openInterestUsd: openInterest * markPrice,
    fundingHistory: fundingHist.map((f) => ({
      fundingTime: Number(f.fundingTime),
      fundingRate: Number(f.fundingRate),
      markPrice: Number(f.markPrice || markPrice),
    })),
    source: 'binance-live',
  };
  setCached(cacheKey, meta, 2000);
  return meta;
}

async function loadSymbolBundle(
  symbol: string,
  interval: string,
  limit: number,
  market: MarketType = 'spot',
  bypassCache = false
): Promise<{
  candles: Candle[];
  orderbook: OrderbookData;
  ticker: Ticker24h;
  futuresMeta: FuturesMarketMeta | null;
  source: 'binance-live';
}> {
  const cacheKey = `bundle:${market}:${symbol}:${interval}:${limit}`;
  if (!bypassCache) {
    const cached = getCached<{
      candles: Candle[];
      orderbook: OrderbookData;
      ticker: Ticker24h;
      futuresMeta: FuturesMarketMeta | null;
      source: 'binance-live';
    }>(cacheKey);
    if (cached) return cached;
  }

  const bases =
    market === 'futures' ? [BINANCE_FUTURES_API_BASE] : BINANCE_SPOT_PUBLIC_BASES;
  const prefix = market === 'futures' ? '/fapi/v1' : '/api/v3';

  const [rawKlines, rawDepth, rawTicker, futuresMeta] = await Promise.all([
    fetchJsonFromBases<unknown[][]>(
      bases,
      `${prefix}/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`
    ),
    fetchJsonFromBases<{
      lastUpdateId: number;
      bids: [string, string][];
      asks: [string, string][];
    }>(bases, `${prefix}/depth?symbol=${encodeURIComponent(symbol)}&limit=100`),
    fetchJsonFromBases<Raw24hTicker>(
      bases,
      `${prefix}/ticker/24hr?symbol=${encodeURIComponent(symbol)}`
    ),
    market === 'futures'
      ? loadFuturesMeta(symbol, bypassCache).catch(() => null)
      : Promise.resolve(null),
  ]);

  const candles = parseKlines(rawKlines);
  const orderbook: OrderbookData = {
    symbol,
    lastUpdateId: rawDepth.lastUpdateId,
    bids: rawDepth.bids.map(([p, q]) => [Number(p), Number(q)]),
    asks: rawDepth.asks.map(([p, q]) => [Number(p), Number(q)]),
    source: 'binance-live',
  };
  const ticker: Ticker24h = {
    symbol: rawTicker.symbol,
    lastPrice: Number(rawTicker.lastPrice),
    priceChange: Number(rawTicker.priceChange),
    priceChangePercent: Number(rawTicker.priceChangePercent),
    highPrice: Number(rawTicker.highPrice),
    lowPrice: Number(rawTicker.lowPrice),
    volume: Number(rawTicker.volume),
    quoteVolume: Number(rawTicker.quoteVolume),
    weightedAvgPrice: Number(rawTicker.weightedAvgPrice),
    count: Number(rawTicker.count),
    source: 'binance-live',
  };

  const bundle = {
    candles,
    orderbook,
    ticker,
    futuresMeta,
    source: 'binance-live' as const,
  };
  setCached(cacheKey, bundle, 1200);
  return bundle;
}

async function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  // Binance Spot General REST API: /api/v3/ping, /api/v3/time, /api/v3/exchangeInfo
  app.get('/api/binance/spot/general', async (req, res) => {
    const rawSymbol = String(req.query.symbol ?? 'BTCUSDT').toUpperCase().trim();
    if (!SYMBOL_REGEX.test(rawSymbol)) {
      res.status(400).json({ error: 'Format simbol tidak valid.' });
      return;
    }

    try {
      const t0 = Date.now();
      await fetchJsonFromBases<Record<string, never>>(
        BINANCE_SPOT_PUBLIC_BASES,
        '/api/v3/ping'
      );
      const pingLatencyMs = Date.now() - t0;

      const [timeRes, exchangeRes] = await Promise.all([
        fetchJsonFromBases<{ serverTime: number }>(
          BINANCE_SPOT_PUBLIC_BASES,
          '/api/v3/time'
        ),
        fetchJsonFromBases<{
          symbols: {
            symbol: string;
            status: string;
            baseAsset: string;
            quoteAsset: string;
            baseAssetPrecision: number;
            quotePrecision: number;
            orderTypes: string[];
            isSpotTradingAllowed: boolean;
            isMarginTradingAllowed: boolean;
            filters: {
              filterType: string;
              tickSize?: string;
              stepSize?: string;
              minQty?: string;
              minNotional?: string;
            }[];
          }[];
        }>(
          BINANCE_SPOT_PUBLIC_BASES,
          `/api/v3/exchangeInfo?symbol=${encodeURIComponent(rawSymbol)}`
        ),
      ]);

      const sym = exchangeRes.symbols?.[0] ?? null;
      const priceFilter = sym?.filters.find((f) => f.filterType === 'PRICE_FILTER');
      const lotFilter = sym?.filters.find((f) => f.filterType === 'LOT_SIZE');
      const notionalFilter = sym?.filters.find(
        (f) => f.filterType === 'NOTIONAL' || f.filterType === 'MIN_NOTIONAL'
      );

      const payload: SpotGeneralInfo = {
        pingOk: true,
        pingLatencyMs,
        serverTime: timeRes.serverTime,
        timeOffsetMs: timeRes.serverTime - Date.now(),
        symbolInfo: sym
          ? {
              symbol: sym.symbol,
              status: sym.status,
              baseAsset: sym.baseAsset,
              quoteAsset: sym.quoteAsset,
              baseAssetPrecision: sym.baseAssetPrecision,
              quotePrecision: sym.quotePrecision,
              orderTypes: sym.orderTypes,
              isSpotTradingAllowed: sym.isSpotTradingAllowed,
              isMarginTradingAllowed: sym.isMarginTradingAllowed,
              tickSize: priceFilter?.tickSize ?? '0.01',
              stepSize: lotFilter?.stepSize ?? '0.0001',
              minQty: lotFilter?.minQty ?? '0.0001',
              minNotional: notionalFilter?.minNotional ?? '5.00',
            }
          : null,
        source: 'binance-live',
      };

      res.json(payload);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Gagal terhubung ke Binance Spot General API.',
      });
    }
  });

  // Full list of ALL active Binance Spot (1,376+) or Futures (817+) trading pairs
  app.get('/api/binance/symbols', async (req, res) => {
    const market: MarketType = req.query.market === 'futures' ? 'futures' : 'spot';
    const quote = String(req.query.quote ?? 'ALL').toUpperCase().trim();

    try {
      const universe = await loadSymbolUniverse(market);
      const filtered =
        quote && quote !== 'ALL'
          ? universe.filter((s) => s.quoteAsset === quote)
          : universe;

      res.json({
        symbols: filtered.map((s) => ({
          symbol: s.symbol,
          baseAsset: s.baseAsset,
          quoteAsset: s.quoteAsset,
          contractType: s.contractType,
          quoteVolume: s.quoteVolumeUsd,
        })),
        totalAllQuotes: universe.length,
        source: 'binance-live',
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Gagal memuat daftar lengkap koin Binance.',
      });
    }
  });

  async function loadMultiTimeframeCandles(
    symbol: string,
    activeInterval: AllowedTimeframe,
    activeCandles: Candle[],
    market: MarketType,
    nowMs = getBinanceNow()
  ): Promise<Record<AllowedTimeframe, Candle[]>> {
    const bases =
      market === 'futures' ? [BINANCE_FUTURES_API_BASE] : BINANCE_SPOT_PUBLIC_BASES;
    const prefix = market === 'futures' ? '/fapi/v1' : '/api/v3';

    const entries = await Promise.all(
      ALLOWED_TIMEFRAMES.map(async (tf): Promise<[AllowedTimeframe, Candle[]]> => {
        if (tf === activeInterval) {
          return [tf, activeCandles];
        }
        const ck = `klines_v2:${market}:${symbol}:${tf}`;
        const cached = getCached<{ candles: Candle[]; nextCloseTime: number }>(ck);
        if (cached && nowMs < cached.nextCloseTime + 300) {
          return [tf, cached.candles];
        }

        try {
          const raw = await fetchJsonFromBases<unknown[][]>(
            bases,
            `${prefix}/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(tf)}&limit=200`
          );
          const parsed = parseKlines(raw);
          const part = partitionClosedCandles(parsed, nowMs, tf);
          const nextCloseTime = part.nextCandleCloseTime ?? nowMs + 15000;
          const ttlMs = Math.max(2000, Math.min(60_000, nextCloseTime - nowMs + 500));
          setCached(ck, { candles: parsed, nextCloseTime }, ttlMs);
          return [tf, parsed];
        } catch {
          return [tf, cached?.candles ?? activeCandles];
        }
      })
    );

    return Object.fromEntries(entries) as Record<AllowedTimeframe, Candle[]>;
  }

  function buildMtfFromCandles(
    market: MarketType,
    symbol: string,
    activeInterval: AllowedTimeframe,
    candlesByTf: Record<AllowedTimeframe, Candle[]>,
    orderbook: OrderbookData,
    activeAnalysis: MarketAnalysisResult,
    nowMs = getBinanceNow()
  ): MultiTimeframeRecommendation {
    const analyses = {} as Record<AllowedTimeframe, MarketAnalysisResult>;
    for (const tf of ALLOWED_TIMEFRAMES) {
      if (tf === activeInterval) {
        analyses[tf] = activeAnalysis;
      } else {
        analyses[tf] = getOrComputeClosedAnalysis(
          market,
          symbol,
          tf,
          candlesByTf[tf],
          orderbook,
          nowMs
        );
      }
    }
    return computeMultiTimeframeRecommendation(symbol, analyses);
  }

  app.get('/api/binance/market', async (req, res) => {
    const rawSymbol = String(req.query.symbol ?? 'BTCUSDT').toUpperCase().trim();
    const rawInterval = String(req.query.interval ?? '1h').trim();
    const rawLimit = Number(req.query.limit ?? 200);
    const market: MarketType = req.query.market === 'futures' ? 'futures' : 'spot';
    const fresh = req.query.fresh === '1';

    if (!SYMBOL_REGEX.test(rawSymbol)) {
      res.status(400).json({ error: 'Format simbol koin tidak valid (contoh: BTCUSDT).' });
      return;
    }
    const interval: AllowedTimeframe = VALID_INTERVALS.has(rawInterval)
      ? (rawInterval as AllowedTimeframe)
      : '1h';
    const limit = Number.isFinite(rawLimit)
      ? Math.min(300, Math.max(60, Math.floor(rawLimit)))
      : 200;

    try {
      void syncBinanceServerTime();
      const nowMs = getBinanceNow();
      const bundle = await loadSymbolBundle(rawSymbol, interval, limit, market, fresh);
      const analysis = getOrComputeClosedAnalysis(
        market,
        rawSymbol,
        interval,
        bundle.candles,
        bundle.orderbook,
        nowMs
      );
      const candlesByTf = await loadMultiTimeframeCandles(
        rawSymbol,
        interval,
        bundle.candles,
        market,
        nowMs
      );
      const mtfRecommendation = buildMtfFromCandles(
        market,
        rawSymbol,
        interval,
        candlesByTf,
        bundle.orderbook,
        analysis,
        nowMs
      );

      res.json({
        symbol: rawSymbol,
        interval,
        market,
        source: bundle.source,
        updatedAt: Date.now(),
        ticker: bundle.ticker,
        candles: bundle.candles,
        orderbook: bundle.orderbook,
        futuresMeta: bundle.futuresMeta,
        analysis,
        mtfRecommendation,
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Gagal memuat data pasar live Binance.',
      });
    }
  });

  // Real-time SSE stream backed by Binance live WebSocket (Spot) and high-frequency live REST (Futures)
  app.get('/api/binance/stream', async (req, res) => {
    const rawSymbol = String(req.query.symbol ?? 'BTCUSDT').toUpperCase().trim();
    const rawInterval = String(req.query.interval ?? '1h').trim();
    const market: MarketType = req.query.market === 'futures' ? 'futures' : 'spot';

    if (!SYMBOL_REGEX.test(rawSymbol)) {
      res.status(400).json({ error: 'Format simbol tidak valid.' });
      return;
    }
    const interval: AllowedTimeframe = VALID_INTERVALS.has(rawInterval)
      ? (rawInterval as AllowedTimeframe)
      : '1h';
    const limit = 200;

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let closed = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;
    let pollTimer: NodeJS.Timeout | null = null;
    let mtfTimer: NodeJS.Timeout | null = null;
    let pushTimer: NodeJS.Timeout | null = null;
    let pingTimer: NodeJS.Timeout | null = null;

    let currentState: {
      candles: Candle[];
      orderbook: OrderbookData;
      ticker: Ticker24h;
      futuresMeta: FuturesMarketMeta | null;
      candlesByTf: Record<AllowedTimeframe, Candle[]>;
    } | null = null;

    let dirty = false;
    let lastEmitAt = 0;

    const sendEvent = (event: string, data: unknown) => {
      if (closed) return;
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const emitAnalysisState = (overrideNowMs?: number) => {
      if (closed || !currentState) return;
      try {
        const nowMs = overrideNowMs ?? getBinanceNow();
        const analysis = getOrComputeClosedAnalysis(
          market,
          rawSymbol,
          interval,
          currentState.candles,
          currentState.orderbook,
          nowMs
        );
        const syncedCandlesByTf: Record<AllowedTimeframe, Candle[]> = {
          ...currentState.candlesByTf,
          [interval]: currentState.candles,
        };
        const mtfRecommendation = buildMtfFromCandles(
          market,
          rawSymbol,
          interval,
          syncedCandlesByTf,
          currentState.orderbook,
          analysis,
          nowMs
        );
        sendEvent('market', {
          symbol: rawSymbol,
          interval,
          market,
          source: 'binance-live' as const,
          updatedAt: Date.now(),
          ticker: currentState.ticker,
          candles: currentState.candles,
          orderbook: currentState.orderbook,
          futuresMeta: currentState.futuresMeta,
          analysis,
          mtfRecommendation,
        });
        lastEmitAt = Date.now();
        dirty = false;
      } catch {
        // Skip partial frame computation error
      }
    };

    const scheduleEmit = () => {
      if (closed) return;
      dirty = true;
      const elapsed = Date.now() - lastEmitAt;
      if (elapsed >= 750 && !pushTimer) {
        emitAnalysisState();
        return;
      }
      if (!pushTimer) {
        pushTimer = setTimeout(() => {
          pushTimer = null;
          if (dirty && !closed) {
            emitAnalysisState();
          }
        }, Math.max(80, 750 - elapsed));
      }
    };

    // Initial live REST snapshot across all 7 TFs (1m, 5m, 15m, 30m, 1h, 1d, 1w)
    try {
      await syncBinanceServerTime();
      const nowMs = getBinanceNow();
      const initial = await loadSymbolBundle(rawSymbol, interval, limit, market, true);
      const candlesByTf = await loadMultiTimeframeCandles(
        rawSymbol,
        interval,
        initial.candles,
        market,
        nowMs
      );
      if (closed) return;
      currentState = {
        candles: initial.candles,
        orderbook: initial.orderbook,
        ticker: initial.ticker,
        futuresMeta: initial.futuresMeta,
        candlesByTf,
      };
      emitAnalysisState(nowMs);
    } catch (err) {
      sendEvent('stream_error', {
        error: err instanceof Error ? err.message : 'Gagal memulai stream live Binance.',
      });
    }

    // Watch companion timeframes (1m, 5m, 15m, 30m, 1h, 1d, 1w): immediately refresh & emit when any TF candle closes
    let mtfBusy = false;
    mtfTimer = setInterval(async () => {
      if (closed || !currentState || mtfBusy) return;
      const nowMs = getBinanceNow();
      const hasClosedAnyCompanion = ALLOWED_TIMEFRAMES.some((tf) => {
        if (tf === interval) return false;
        const part = partitionClosedCandles(currentState!.candlesByTf[tf], nowMs, tf);
        return part.nextCandleCloseTime !== null && nowMs >= part.nextCandleCloseTime + 350;
      });
      if (!hasClosedAnyCompanion) return;

      mtfBusy = true;
      try {
        const refreshed = await loadMultiTimeframeCandles(
          rawSymbol,
          interval,
          currentState.candles,
          market,
          nowMs
        );
        if (!closed && currentState) {
          currentState.candlesByTf = refreshed;
          emitAnalysisState(nowMs);
        }
      } catch {
        // Retry next tick
      } finally {
        mtfBusy = false;
      }
    }, 1500);

    const connectSpotWs = () => {
      if (closed || market !== 'spot') return;
      const symLower = rawSymbol.toLowerCase();
      const wsUrl = `${BINANCE_SPOT_WS_BASE}?streams=${symLower}@kline_${interval}/${symLower}@depth20@1000ms/${symLower}@ticker`;
      try {
        ws = new WebSocket(wsUrl);
        ws.onmessage = (ev) => {
          if (closed || !currentState) return;
          try {
            const msg = JSON.parse(String(ev.data)) as {
              stream?: string;
              data?: Record<string, unknown>;
            };
            const payload = msg.data;
            const streamName = msg.stream ?? '';
            if (!payload) return;

            if (streamName.includes('@kline_') && payload.k) {
              const k = payload.k as Record<string, unknown>;
              const isFinalClosed = Boolean(k.x);
              const liveCandle: Candle = {
                openTime: Number(k.t),
                open: Number(k.o),
                high: Number(k.h),
                low: Number(k.l),
                close: Number(k.c),
                volume: Number(k.v),
                closeTime: Number(k.T),
                quoteVolume: Number(k.q),
                trades: Number(k.n),
              };
              currentState.candles = mergeLiveCandle(currentState.candles, liveCandle, limit);
              currentState.ticker = {
                ...currentState.ticker,
                lastPrice: liveCandle.close,
              };
              if (isFinalClosed) {
                if (pushTimer) {
                  clearTimeout(pushTimer);
                  pushTimer = null;
                }
                emitAnalysisState(Math.max(getBinanceNow(), liveCandle.closeTime));
              } else {
                scheduleEmit();
              }
            } else if (streamName.includes('@depth20')) {
              const bidsRaw = payload.bids as [string, string][] | undefined;
              const asksRaw = payload.asks as [string, string][] | undefined;
              if (Array.isArray(bidsRaw) && Array.isArray(asksRaw)) {
                currentState.orderbook = {
                  symbol: rawSymbol,
                  lastUpdateId: Number(payload.lastUpdateId ?? Date.now()),
                  bids: bidsRaw.map(([p, q]) => [Number(p), Number(q)]),
                  asks: asksRaw.map(([p, q]) => [Number(p), Number(q)]),
                  source: 'binance-live',
                };
                scheduleEmit();
              }
            } else if (streamName.includes('@ticker')) {
              currentState.ticker = {
                symbol: rawSymbol,
                lastPrice: Number(payload.c ?? currentState.ticker.lastPrice),
                priceChange: Number(payload.p ?? currentState.ticker.priceChange),
                priceChangePercent: Number(payload.P ?? currentState.ticker.priceChangePercent),
                highPrice: Number(payload.h ?? currentState.ticker.highPrice),
                lowPrice: Number(payload.l ?? currentState.ticker.lowPrice),
                volume: Number(payload.v ?? currentState.ticker.volume),
                quoteVolume: Number(payload.q ?? currentState.ticker.quoteVolume),
                weightedAvgPrice: Number(payload.w ?? currentState.ticker.weightedAvgPrice),
                count: Number(payload.n ?? currentState.ticker.count),
                source: 'binance-live',
              };
              scheduleEmit();
            }
          } catch {
            // Ignore malformed WS frame
          }
        };
        ws.onclose = () => {
          ws = null;
          if (!closed) {
            reconnectTimer = setTimeout(connectSpotWs, 2000);
          }
        };
        ws.onerror = () => {
          try {
            ws?.close();
          } catch {
            // ignore
          }
        };
      } catch {
        if (!closed) {
          reconnectTimer = setTimeout(connectSpotWs, 2500);
        }
      }
    };

    if (market === 'spot') {
      connectSpotWs();
      // Periodic full REST depth (100 levels) + kline reconciliation every 10s
      let restBusy = false;
      pollTimer = setInterval(async () => {
        if (closed || restBusy) return;
        restBusy = true;
        try {
          const fresh = await loadSymbolBundle(rawSymbol, interval, limit, market, true);
          if (!closed) {
            currentState = {
              candles: fresh.candles,
              orderbook: fresh.orderbook,
              ticker: fresh.ticker,
              futuresMeta: fresh.futuresMeta,
              candlesByTf: currentState?.candlesByTf ?? {
                '1m': fresh.candles,
                '5m': fresh.candles,
                '15m': fresh.candles,
                '30m': fresh.candles,
                '1h': fresh.candles,
                '1d': fresh.candles,
                '1w': fresh.candles,
              },
            };
            emitAnalysisState();
          }
        } catch {
          // Keep active WS state if REST sync briefly hiccups
        } finally {
          restBusy = false;
        }
      }, 10000);
    } else {
      // Futures: high-frequency live REST sync every 1.8s
      let restBusy = false;
      pollTimer = setInterval(async () => {
        if (closed || restBusy) return;
        restBusy = true;
        try {
          const fresh = await loadSymbolBundle(rawSymbol, interval, limit, 'futures', true);
          if (!closed) {
            currentState = {
              candles: fresh.candles,
              orderbook: fresh.orderbook,
              ticker: fresh.ticker,
              futuresMeta: fresh.futuresMeta,
              candlesByTf: currentState?.candlesByTf ?? {
                '1m': fresh.candles,
                '5m': fresh.candles,
                '15m': fresh.candles,
                '30m': fresh.candles,
                '1h': fresh.candles,
                '1d': fresh.candles,
                '1w': fresh.candles,
              },
            };
            emitAnalysisState();
          }
        } catch {
          // Retry next tick
        } finally {
          restBusy = false;
        }
      }, 1800);
    }

    pingTimer = setInterval(() => {
      if (!closed) {
        res.write(`: ping ${Date.now()}\n\n`);
      }
    }, 15000);

    req.on('close', () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pollTimer) clearInterval(pollTimer);
      if (mtfTimer) clearInterval(mtfTimer);
      if (pushTimer) clearTimeout(pushTimer);
      if (pingTimer) clearInterval(pingTimer);
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
        ws = null;
      }
      res.end();
    });
  });

  // Paginated Full-Universe Market Scanner covering ALL active Binance pairs
  app.get('/api/binance/scanner', async (req, res) => {
    const rawInterval = String(req.query.interval ?? '1h').trim();
    const interval = VALID_INTERVALS.has(rawInterval) ? rawInterval : '1h';
    const market: MarketType = req.query.market === 'futures' ? 'futures' : 'spot';
    const quote = String(req.query.quote ?? 'USDT').toUpperCase().trim();
    const search = String(req.query.search ?? '').toUpperCase().trim();
    const pageRaw = Number(req.query.page ?? 1);
    const pageSizeRaw = Number(req.query.pageSize ?? 15);
    const pageSize = Number.isFinite(pageSizeRaw)
      ? Math.min(25, Math.max(10, Math.floor(pageSizeRaw)))
      : 15;

    const cacheKey = `scanner:${market}:${interval}:${quote}:${search}:${pageRaw}:${pageSize}`;
    const cached = getCached<ScannerApiResponse>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    try {
      const universe = await loadSymbolUniverse(market);
      const filteredUniverse = universe.filter((item) => {
        if (quote && quote !== 'ALL' && item.quoteAsset !== quote) {
          return false;
        }
        if (search) {
          return (
            item.symbol.includes(search) ||
            item.baseAsset.includes(search) ||
            item.quoteAsset.includes(search)
          );
        }
        return true;
      });

      const totalCount = filteredUniverse.length;
      const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
      const page = Number.isFinite(pageRaw)
        ? Math.min(totalPages, Math.max(1, Math.floor(pageRaw)))
        : 1;
      const start = (page - 1) * pageSize;
      const pageItems = filteredUniverse.slice(start, start + pageSize);

      const bases =
        market === 'futures' ? [BINANCE_FUTURES_API_BASE] : BINANCE_SPOT_PUBLIC_BASES;
      const prefix = market === 'futures' ? '/fapi/v1' : '/api/v3';

      const results = await Promise.all(
        pageItems.map(async (item): Promise<ScannerRow | null> => {
          try {
            const [rawKlines, rawDepth] = await Promise.all([
              fetchJsonFromBases<unknown[][]>(
                bases,
                `${prefix}/klines?symbol=${encodeURIComponent(item.symbol)}&interval=${encodeURIComponent(interval)}&limit=120`
              ),
              fetchJsonFromBases<{
                lastUpdateId: number;
                bids: [string, string][];
                asks: [string, string][];
              }>(bases, `${prefix}/depth?symbol=${encodeURIComponent(item.symbol)}&limit=50`),
            ]);
            const candles = parseKlines(rawKlines);
            const orderbook: OrderbookData = {
              symbol: item.symbol,
              lastUpdateId: rawDepth.lastUpdateId,
              bids: rawDepth.bids.map(([p, q]) => [Number(p), Number(q)]),
              asks: rawDepth.asks.map(([p, q]) => [Number(p), Number(q)]),
              source: 'binance-live',
            };
            const analysis = getOrComputeClosedAnalysis(
              market,
              item.symbol,
              interval,
              candles,
              orderbook,
              getBinanceNow()
            );
            const lastIdx = analysis.series.sma20.length - 1;
            return {
              symbol: item.symbol,
              baseAsset: item.baseAsset,
              quoteAsset: item.quoteAsset,
              lastPrice: item.lastPrice || analysis.currentPrice,
              priceChangePercent: item.priceChangePercent,
              quoteVolume24h: item.quoteVolumeUsd,
              sma20: lastIdx >= 0 ? analysis.series.sma20[lastIdx] : null,
              ema21: lastIdx >= 0 ? analysis.series.ema21[lastIdx] : null,
              rsi14: lastIdx >= 0 ? analysis.series.rsi14[lastIdx] : null,
              imbalanceRatio: analysis.liquidityMetrics.imbalanceRatio,
              verdict: analysis.verdict,
              verdictLabel: analysis.verdictLabel,
              confidencePercent: analysis.confidencePercent,
              optimalEntry: analysis.executionPlan.optimalEntry,
              stopLoss: analysis.executionPlan.stopLoss,
              takeProfit1: analysis.executionPlan.takeProfit1,
            };
          } catch {
            return null;
          }
        })
      );

      const rows = results.filter((r): r is ScannerRow => r !== null);
      const payload: ScannerApiResponse = {
        interval,
        market,
        quote,
        page,
        pageSize,
        totalCount,
        totalPages,
        source: 'binance-live',
        updatedAt: Date.now(),
        rows,
      };
      setCached(cacheKey, payload, 8000);
      res.json(payload);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Gagal menjalankan Market Scanner live.',
      });
    }
  });

  // Signed Spot Account Information & Open Orders (/api/v3/account, /api/v3/openOrders)
  app.get('/api/binance/account', async (_req, res) => {
    const apiKey = process.env.BINANCE_API_KEY?.trim();
    const secretKey = process.env.BINANCE_SECRET_KEY?.trim();
    if (!apiKey || !secretKey) {
      res.json({
        configured: false,
        balances: [],
        openOrders: [],
        note: 'BINANCE_API_KEY dan BINANCE_SECRET_KEY belum diset di file .env server.',
      });
      return;
    }

    try {
      const [accountData, openOrders] = await Promise.all([
        fetchSignedBinanceJson<{
          canTrade: boolean;
          accountType: string;
          balances: { asset: string; free: string; locked: string }[];
        }>(BINANCE_SPOT_API_BASE, '/api/v3/account', apiKey, secretKey),
        fetchSignedBinanceJson<
          {
            symbol: string;
            orderId: number;
            side: string;
            type: string;
            price: string;
            origQty: string;
            status: string;
          }[]
        >(BINANCE_SPOT_API_BASE, '/api/v3/openOrders', apiKey, secretKey).catch(
          () => []
        ),
      ]);

      const nonZero = accountData.balances
        .filter((b) => Number(b.free) > 0 || Number(b.locked) > 0)
        .map((b) => ({
          asset: b.asset,
          free: Number(b.free),
          locked: Number(b.locked),
        }));

      res.json({
        configured: true,
        canTrade: accountData.canTrade,
        accountType: accountData.accountType,
        balances: nonZero,
        openOrders: openOrders.map((o) => ({
          symbol: o.symbol,
          orderId: o.orderId,
          side: o.side,
          type: o.type,
          price: Number(o.price),
          origQty: Number(o.origQty),
          status: o.status,
        })),
      });
    } catch (err) {
      res.status(502).json({
        configured: true,
        error: err instanceof Error ? err.message : 'Gagal mengakses endpoint akun Spot.',
      });
    }
  });

  // Signed USD-S-M Futures Account Endpoints (/fapi/v2/account, /fapi/v2/balance, /fapi/v2/positionRisk, /fapi/v1/income, /fapi/v1/leverageBracket, /fapi/v1/commissionRate, /fapi/v1/positionSide/dual, /fapi/v1/multiAssetsMargin)
  app.get('/api/binance/futures/account', async (req, res) => {
    const rawSymbol = String(req.query.symbol ?? 'BTCUSDT').toUpperCase().trim();
    if (!SYMBOL_REGEX.test(rawSymbol)) {
      res.status(400).json({ error: 'Format simbol tidak valid.' });
      return;
    }

    const apiKey = process.env.BINANCE_API_KEY?.trim();
    const secretKey = process.env.BINANCE_SECRET_KEY?.trim();
    if (!apiKey || !secretKey) {
      res.json({
        configured: false,
        note: 'BINANCE_API_KEY dan BINANCE_SECRET_KEY belum diset di environment server (.env). Atur keduanya untuk menampilkan saldo, posisi, income, komisi, dan mode margin USD-M Futures secara read-only.',
      } satisfies FuturesAccountSummary);
      return;
    }

    try {
      const [
        accountRes,
        balanceRes,
        positionRes,
        incomeRes,
        dualSideRes,
        multiAssetRes,
        commissionRes,
        bracketRes,
      ] = await Promise.all([
        fetchSignedBinanceJson<{
          totalWalletBalance: string;
          totalUnrealizedProfit: string;
          totalMarginBalance: string;
          availableBalance: string;
          maxWithdrawAmount: string;
          canTrade: boolean;
          canDeposit: boolean;
          canWithdraw: boolean;
        }>(BINANCE_FUTURES_API_BASE, '/fapi/v2/account', apiKey, secretKey),
        fetchSignedBinanceJson<
          {
            asset: string;
            balance: string;
            availableBalance: string;
            crossWalletBalance: string;
            crossUnPnl: string;
          }[]
        >(BINANCE_FUTURES_API_BASE, '/fapi/v2/balance', apiKey, secretKey),
        fetchSignedBinanceJson<
          {
            symbol: string;
            positionAmt: string;
            entryPrice: string;
            markPrice: string;
            unRealizedProfit: string;
            liquidationPrice: string;
            leverage: string;
            marginType: string;
            positionSide: string;
            notional: string;
          }[]
        >(BINANCE_FUTURES_API_BASE, '/fapi/v2/positionRisk', apiKey, secretKey),
        fetchSignedBinanceJson<
          {
            symbol: string;
            incomeType: string;
            income: string;
            asset: string;
            time: number;
          }[]
        >(BINANCE_FUTURES_API_BASE, '/fapi/v1/income', apiKey, secretKey, {
          limit: 15,
        }).catch(() => []),
        fetchSignedBinanceJson<{ dualSidePosition: boolean }>(
          BINANCE_FUTURES_API_BASE,
          '/fapi/v1/positionSide/dual',
          apiKey,
          secretKey
        ).catch(() => ({ dualSidePosition: false })),
        fetchSignedBinanceJson<{ multiAssetsMargin: boolean }>(
          BINANCE_FUTURES_API_BASE,
          '/fapi/v1/multiAssetsMargin',
          apiKey,
          secretKey
        ).catch(() => ({ multiAssetsMargin: false })),
        fetchSignedBinanceJson<{
          symbol: string;
          makerCommissionRate: string;
          takerCommissionRate: string;
        }>(BINANCE_FUTURES_API_BASE, '/fapi/v1/commissionRate', apiKey, secretKey, {
          symbol: rawSymbol,
        }).catch(() => null),
        fetchSignedBinanceJson<
          {
            symbol: string;
            brackets: {
              bracket: number;
              initialLeverage: number;
              notionalCap: number;
              notionalFloor: number;
              maintMarginRatio: number;
            }[];
          }[]
        >(BINANCE_FUTURES_API_BASE, '/fapi/v1/leverageBracket', apiKey, secretKey, {
          symbol: rawSymbol,
        }).catch(() => []),
      ]);

      const summary: FuturesAccountSummary = {
        configured: true,
        dualSidePosition: dualSideRes.dualSidePosition,
        multiAssetsMargin: multiAssetRes.multiAssetsMargin,
        account: {
          totalWalletBalance: Number(accountRes.totalWalletBalance),
          totalUnrealizedProfit: Number(accountRes.totalUnrealizedProfit),
          totalMarginBalance: Number(accountRes.totalMarginBalance),
          availableBalance: Number(accountRes.availableBalance),
          maxWithdrawAmount: Number(accountRes.maxWithdrawAmount),
          canTrade: accountRes.canTrade,
          canDeposit: accountRes.canDeposit,
          canWithdraw: accountRes.canWithdraw,
        },
        balances: balanceRes
          .filter((b) => Number(b.balance) > 0 || Number(b.crossUnPnl) !== 0)
          .map((b) => ({
            asset: b.asset,
            balance: Number(b.balance),
            availableBalance: Number(b.availableBalance),
            crossWalletBalance: Number(b.crossWalletBalance),
            crossUnPnl: Number(b.crossUnPnl),
          })),
        positions: positionRes
          .filter((p) => Number(p.positionAmt) !== 0)
          .map((p) => ({
            symbol: p.symbol,
            positionAmt: Number(p.positionAmt),
            entryPrice: Number(p.entryPrice),
            markPrice: Number(p.markPrice),
            unRealizedProfit: Number(p.unRealizedProfit),
            liquidationPrice: Number(p.liquidationPrice),
            leverage: Number(p.leverage),
            marginType: p.marginType,
            positionSide: p.positionSide,
            notional: Number(p.notional),
          })),
        incomes: incomeRes.map((inc) => ({
          symbol: inc.symbol,
          incomeType: inc.incomeType,
          income: Number(inc.income),
          asset: inc.asset,
          time: Number(inc.time),
        })),
        commissionRate: commissionRes
          ? {
              symbol: commissionRes.symbol,
              makerCommissionRate: Number(commissionRes.makerCommissionRate),
              takerCommissionRate: Number(commissionRes.takerCommissionRate),
            }
          : null,
        leverageBrackets: Array.isArray(bracketRes) && bracketRes[0]?.brackets
          ? bracketRes[0].brackets
          : [],
      };

      res.json(summary);
    } catch (err) {
      res.status(502).json({
        configured: true,
        error:
          err instanceof Error
            ? err.message
            : 'Gagal mengakses endpoint akun USD-M Futures Binance.',
      } satisfies FuturesAccountSummary);
    }
  });

  // =========================================================================
  // Autonomous TP/SL + Trend-Reversal Take-Profit Simulator ($700/Coin = $100/TF)
  // =========================================================================
  interface PersistedSimulationState {
    schemaVersion: string;
    enabled: boolean;
    autoTakeProfitOnReversal: boolean;
    symbol: string;
    symbols: string[];
    market: MarketType;
    livePrice: number | null;
    lastExecutionAt: number | null;
    trades: SimulatedTrade[];
  }

  const SIM_DIR = path.resolve(__dirname, '.sim-data');
  const SIM_FILE = path.join(SIM_DIR, 'simulation-state.json');
  const MAX_SIM_TRADES = 800;
  const CURRENT_SCHEMA_VERSION = 'tf-percoin-700-reversal-v5';

  function loadPersistedSimulation(): PersistedSimulationState {
    try {
      if (fs.existsSync(SIM_FILE)) {
        const raw = fs.readFileSync(SIM_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<PersistedSimulationState>;
        if (
          parsed.schemaVersion === CURRENT_SCHEMA_VERSION &&
          Array.isArray(parsed.trades)
        ) {
          return {
            schemaVersion: CURRENT_SCHEMA_VERSION,
            enabled: Boolean(parsed.enabled),
            autoTakeProfitOnReversal:
              typeof parsed.autoTakeProfitOnReversal === 'boolean'
                ? parsed.autoTakeProfitOnReversal
                : true,
            symbol: typeof parsed.symbol === 'string' ? parsed.symbol : 'BTCUSDT',
            symbols: normalizeSimulationCoins(parsed.symbols),
            market: parsed.market === 'futures' ? 'futures' : 'spot',
            livePrice: typeof parsed.livePrice === 'number' ? parsed.livePrice : null,
            lastExecutionAt:
              typeof parsed.lastExecutionAt === 'number' ? parsed.lastExecutionAt : null,
            trades: parsed.trades.slice(0, MAX_SIM_TRADES),
          };
        }
      }
    } catch {
      // Corrupted or legacy file — reset to clean empty state
    }
    const emptyState: PersistedSimulationState = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      enabled: false,
      autoTakeProfitOnReversal: true,
      symbol: 'BTCUSDT',
      symbols: [...DEFAULT_SIMULATION_COINS],
      market: 'spot',
      livePrice: null,
      lastExecutionAt: null,
      trades: [],
    };
    return emptyState;
  }

  function savePersistedSimulation(state: PersistedSimulationState): void {
    try {
      fs.mkdirSync(SIM_DIR, { recursive: true });
      fs.writeFileSync(
        SIM_FILE,
        JSON.stringify({
          ...state,
          schemaVersion: CURRENT_SCHEMA_VERSION,
          trades: state.trades.slice(0, MAX_SIM_TRADES),
        }),
        'utf-8'
      );
    } catch {
      // Ignore transient disk write errors
    }
  }

  const simState: PersistedSimulationState = loadPersistedSimulation();
  savePersistedSimulation(simState);
  const simLivePrices = new Map<string, number>();
  const simTfScans = new Map<string, TimeframeSimScanStatus>();
  if (simState.livePrice && simState.livePrice > 0) {
    simLivePrices.set(`${simState.symbol}:${simState.market}`, simState.livePrice);
  }
  let simBusy = false;
  let lastReconcileAt = 0;
  let lastReversalAuditAt = 0;
  let lastFullScanAt = 0;

  async function fetchAllTfForSim(symbol: string, market: MarketType): Promise<{
    candlesByTf: Record<AllowedTimeframe, Candle[]>;
    orderbook: OrderbookData;
    ticker: Ticker24h;
  }> {
    const bundle = await loadSymbolBundle(symbol, '15m', 200, market, true);
    const bases = market === 'futures' ? [BINANCE_FUTURES_API_BASE] : BINANCE_SPOT_PUBLIC_BASES;
    const prefix = market === 'futures' ? '/fapi/v1' : '/api/v3';

    const entries = await Promise.all(
      ALLOWED_TIMEFRAMES.map(async (tf): Promise<[AllowedTimeframe, Candle[]]> => {
        if (tf === '15m') return [tf, bundle.candles];
        const raw = await fetchJsonFromBases<unknown[][]>(
          bases,
          `${prefix}/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(tf)}&limit=200`
        );
        return [tf, parseKlines(raw)];
      })
    );

    return {
      candlesByTf: Object.fromEntries(entries) as Record<AllowedTimeframe, Candle[]>,
      orderbook: bundle.orderbook,
      ticker: bundle.ticker,
    };
  }

  async function ensureOpenTradesForTimeframes(
    targetSymbolsInput: string[],
    targetMarket: MarketType,
    preferredMode: SimulatedTradeSource,
    executeEntries = true
  ): Promise<void> {
    if (simBusy) return;
    simBusy = true;
    try {
      await syncBinanceServerTime();
      const nowMs = getBinanceNow();
      const slotTime = get30MinuteSlotTime(nowMs);
      const targetSymbols = normalizeSimulationCoins(targetSymbolsInput);

      const coinBundles = await Promise.all(
        targetSymbols.map(async (coinSym) => {
          try {
            const data = await fetchAllTfForSim(coinSym, targetMarket);
            return { coinSym, data };
          } catch {
            return { coinSym, data: null };
          }
        })
      );

      const newTrades: SimulatedTrade[] = [];
      for (const { coinSym, data } of coinBundles) {
        if (!data) continue;
        const { candlesByTf, orderbook, ticker } = data;
        const liveEntryPrice =
          Number.isFinite(ticker.lastPrice) && ticker.lastPrice > 0 ? ticker.lastPrice : null;

        if (liveEntryPrice !== null) {
          simLivePrices.set(`${coinSym}:${targetMarket}`, liveEntryPrice);
          if (coinSym === simState.symbol) {
            simState.livePrice = liveEntryPrice;
          }
        }

        for (const tf of ALLOWED_TIMEFRAMES) {
          const scanKey = `${coinSym}:${tf}`;
          const analysis = analyzeMarketDecision(
            coinSym,
            tf,
            candlesByTf[tf],
            orderbook,
            nowMs
          );
          const qualified = resolveQualifiedTradeSide(analysis);
          const hasOpen = simState.trades.some(
            (t) => t.symbol === coinSym && t.timeframe === tf && t.status === 'OPEN'
          );

          if (hasOpen) {
            simTfScans.set(scanKey, {
              symbol: coinSym,
              timeframe: tf,
              analyzedAt: nowMs,
              bullishScore: analysis.bullishScore,
              bearishScore: analysis.bearishScore,
              confidencePercent: analysis.confidencePercent,
              verdict: analysis.verdict,
              verdictLabel: analysis.verdictLabel,
              qualifiedSide: qualified?.side ?? null,
              actionStatus: 'OPEN_POSITION',
              note: `Posisi OPEN aktif · Bull ${analysis.bullishScore}% / Bear ${analysis.bearishScore}%`,
            });
            continue;
          }

          const tfBalance = getCoinTimeframeAccountBalance(
            simState.trades,
            coinSym,
            tf,
            DEFAULT_TF_STARTING_BALANCE_USD
          );
          const riskUsd = computeTradeRiskUsd(tfBalance, DEFAULT_RISK_PERCENT_PER_TRADE);

          if (riskUsd <= 0) {
            simTfScans.set(scanKey, {
              symbol: coinSym,
              timeframe: tf,
              analyzedAt: nowMs,
              bullishScore: analysis.bullishScore,
              bearishScore: analysis.bearishScore,
              confidencePercent: analysis.confidencePercent,
              verdict: analysis.verdict,
              verdictLabel: analysis.verdictLabel,
              qualifiedSide: qualified?.side ?? null,
              actionStatus: 'INSUFFICIENT_BALANCE',
              note: `Saldo ${coinSym} (${tf}) di bawah batas minimum risiko ($0.50).`,
            });
            continue;
          }

          if (!qualified) {
            simTfScans.set(scanKey, {
              symbol: coinSym,
              timeframe: tf,
              analyzedAt: nowMs,
              bullishScore: analysis.bullishScore,
              bearishScore: analysis.bearishScore,
              confidencePercent: analysis.confidencePercent,
              verdict: analysis.verdict,
              verdictLabel: analysis.verdictLabel,
              qualifiedSide: null,
              actionStatus: 'SKIPPED_BELOW_70',
              note: `Bull ${analysis.bullishScore}% · Bear ${analysis.bearishScore}% (≤ ${MIN_ENTRY_MOMENTUM_PERCENT}% — Tidak Entry)`,
            });
            continue;
          }

          if (!executeEntries) {
            simTfScans.set(scanKey, {
              symbol: coinSym,
              timeframe: tf,
              analyzedAt: nowMs,
              bullishScore: analysis.bullishScore,
              bearishScore: analysis.bearishScore,
              confidencePercent: analysis.confidencePercent,
              verdict: analysis.verdict,
              verdictLabel: analysis.verdictLabel,
              qualifiedSide: qualified.side,
              actionStatus: 'ENTERED',
              note: `Siap Entry ${qualified.side} (${Math.max(analysis.bullishScore, analysis.bearishScore)}% > ${MIN_ENTRY_MOMENTUM_PERCENT}%)`,
            });
            continue;
          }

          const hasClosedHistory = simState.trades.some(
            (t) => t.symbol === coinSym && t.timeframe === tf && t.status !== 'OPEN'
          );
          const mode: SimulatedTradeSource =
            preferredMode === 'MANUAL_RUN'
              ? 'MANUAL_RUN'
              : hasClosedHistory
              ? 'REENTRY_TP_SL'
              : preferredMode;

          const trade = createSimulatedTradeFromAnalysis({
            symbol: coinSym,
            market: targetMarket,
            timeframe: tf,
            analysis,
            sourceMode: mode,
            executedAt: nowMs,
            cycleSlotTime: slotTime,
            liveEntryPrice,
            riskUsd,
            idSuffix: `${coinSym.toLowerCase()}-${mode.toLowerCase()}-${nowMs}`,
          });
          if (trade) {
            const withInitialMonitor =
              liveEntryPrice !== null
                ? evaluateOpenTradeReversalTakeProfit({
                    trade,
                    analysis,
                    livePrice: liveEntryPrice,
                    nowMs,
                    autoTakeProfitOnReversal: false,
                  })
                : trade;
            newTrades.push(withInitialMonitor);
            simTfScans.set(scanKey, {
              symbol: coinSym,
              timeframe: tf,
              analyzedAt: nowMs,
              bullishScore: analysis.bullishScore,
              bearishScore: analysis.bearishScore,
              confidencePercent: analysis.confidencePercent,
              verdict: analysis.verdict,
              verdictLabel: analysis.verdictLabel,
              qualifiedSide: qualified.side,
              actionStatus: 'OPEN_POSITION',
              note: `Entry ${qualified.side} dieksekusi (${Math.max(analysis.bullishScore, analysis.bearishScore)}% > ${MIN_ENTRY_MOMENTUM_PERCENT}%)`,
            });
          }
        }
      }

      lastFullScanAt = Date.now();

      if (newTrades.length > 0) {
        simState.trades = [...newTrades, ...simState.trades]
          .sort((a, b) => b.executedAt - a.executedAt)
          .slice(0, MAX_SIM_TRADES);
        simState.lastExecutionAt = nowMs;
        savePersistedSimulation(simState);
      }
    } finally {
      simBusy = false;
    }
  }

  async function reconcileOpenSimTrades(force = false): Promise<void> {
    if (!force && Date.now() - lastReconcileAt < 1500) return;
    lastReconcileAt = Date.now();

    const openTrades = simState.trades.filter((t) => t.status === 'OPEN');
    const groups = new Map<string, { symbol: string; market: MarketType }>();
    for (const sym of normalizeSimulationCoins(simState.symbols)) {
      groups.set(`${sym}:${simState.market}`, { symbol: sym, market: simState.market });
    }
    for (const t of openTrades) {
      groups.set(`${t.symbol}:${t.market}`, { symbol: t.symbol, market: t.market });
    }

    let changed = false;
    await Promise.all(
      Array.from(groups.values()).map(async ({ symbol, market }) => {
        try {
          const bases = market === 'futures' ? [BINANCE_FUTURES_API_BASE] : BINANCE_SPOT_PUBLIC_BASES;
          const prefix = market === 'futures' ? '/fapi/v1' : '/api/v3';
          const hasOpenForGroup = openTrades.some(
            (t) => t.symbol === symbol && t.market === market
          );
          const [raw1m, rawTicker] = await Promise.all([
            hasOpenForGroup
              ? fetchJsonFromBases<unknown[][]>(
                  bases,
                  `${prefix}/klines?symbol=${encodeURIComponent(symbol)}&interval=1m&limit=500`
                )
              : Promise.resolve([] as unknown[][]),
            fetchJsonFromBases<Raw24hTicker>(
              bases,
              `${prefix}/ticker/24hr?symbol=${encodeURIComponent(symbol)}`
            ),
          ]);
          const livePrice = Number(rawTicker.lastPrice);
          if (Number.isFinite(livePrice) && livePrice > 0) {
            simLivePrices.set(`${symbol}:${market}`, livePrice);
            if (symbol === simState.symbol && market === simState.market) {
              simState.livePrice = livePrice;
            }
          }
          if (!hasOpenForGroup) return;

          const candles1m = parseKlines(raw1m);
          const nowMs = getBinanceNow();
          const groupOpen = simState.trades.filter(
            (t) => t.status === 'OPEN' && t.symbol === symbol && t.market === market
          );

          // Evaluate open trades against 1m candle highs/lows, live price, AND trend-reversal signs
          const runReversalAudit =
            force || Date.now() - lastReversalAuditAt >= 5500;
          const activeOpenTfs = new Set<AllowedTimeframe>();
          for (const trade of groupOpen) {
            activeOpenTfs.add(trade.timeframe);
          }

          const liveTfAnalysisMap = new Map<AllowedTimeframe, MarketAnalysisResult>();
          if (activeOpenTfs.size > 0 && runReversalAudit) {
            await Promise.all(
              Array.from(activeOpenTfs).map(async (tf) => {
                try {
                  const bundle = await loadSymbolBundle(symbol, tf, 200, market, force);
                  const resAnalysis = analyzeMarketDecision(
                    symbol,
                    tf,
                    bundle.candles,
                    bundle.orderbook,
                    nowMs
                  );
                  liveTfAnalysisMap.set(tf, resAnalysis);
                } catch {
                  // Fallback gracefully if transient error
                }
              })
            );
          }

          simState.trades = simState.trades.map((trade) => {
            if (trade.status !== 'OPEN' || trade.symbol !== symbol || trade.market !== market) {
              return trade;
            }
            const tfAnalysis = liveTfAnalysisMap.get(trade.timeframe) ?? null;
            let updated = evaluateOpenTradeAgainstCandles(trade, candles1m, tfAnalysis);
            if (updated.status === 'OPEN' && Number.isFinite(livePrice) && livePrice > 0) {
              updated = evaluateOpenTradeAgainstLivePrice(
                updated,
                livePrice,
                nowMs,
                tfAnalysis
              );
            }
            if (
              updated.status === 'OPEN' &&
              tfAnalysis &&
              Number.isFinite(livePrice) &&
              livePrice > 0
            ) {
              const reversalEvaluated = evaluateOpenTradeReversalTakeProfit({
                trade: updated,
                analysis: tfAnalysis,
                livePrice,
                nowMs,
                autoTakeProfitOnReversal: simState.autoTakeProfitOnReversal,
              });
              updated = reversalEvaluated;
            }
            if (updated.status !== trade.status) {
              changed = true;
            }
            return updated;
          });
        } catch {
          // Keep existing open state if live fetch briefly fails
        }
      })
    );

    if (force || Date.now() - lastReversalAuditAt >= 5500) {
      lastReversalAuditAt = Date.now();
    }

    if (changed) {
      savePersistedSimulation(simState);
    }

    // Continuously scan ALL 5 coins × 7 timeframes when auto-entry is enabled (or preview-only if paused/initial)
    const activeCoins = normalizeSimulationCoins(simState.symbols);
    const expectedScanCount = activeCoins.length * ALLOWED_TIMEFRAMES.length;
    if (
      simState.enabled &&
      !simBusy &&
      (changed || Date.now() - lastFullScanAt >= 10_000 || simTfScans.size < expectedScanCount)
    ) {
      await ensureOpenTradesForTimeframes(activeCoins, simState.market, 'REENTRY_TP_SL', true);
    } else if (!simState.enabled && !simBusy && simTfScans.size < expectedScanCount) {
      await ensureOpenTradesForTimeframes(activeCoins, simState.market, 'AUTO_LIVE', false);
    }
  }

  function buildSimulationPayload(): SimulationStatePayload {
    const livePricesObj = Object.fromEntries(simLivePrices.entries());
    const activeCoins = normalizeSimulationCoins(simState.symbols);
    const { stats, byTimeframe } = computeSimulationMetrics(
      simState.trades,
      livePricesObj,
      DEFAULT_TF_STARTING_BALANCE_USD,
      activeCoins.length
    );
    const bySymbol = computeSymbolSimulationMetrics(
      simState.trades,
      activeCoins,
      livePricesObj,
      simState.market,
      DEFAULT_TF_STARTING_BALANCE_USD
    );

    const tfScanStatuses: TimeframeSimScanStatus[] = [];
    for (const coinSym of activeCoins) {
      for (const tf of ALLOWED_TIMEFRAMES) {
        const existing = simTfScans.get(`${coinSym}:${tf}`);
        if (existing) {
          tfScanStatuses.push(existing);
        } else {
          tfScanStatuses.push({
            symbol: coinSym,
            timeframe: tf,
            analyzedAt: 0,
            bullishScore: 0,
            bearishScore: 0,
            confidencePercent: 50,
            verdict: 'WAIT',
            verdictLabel: 'MENUNGGU ANALISIS',
            qualifiedSide: null,
            actionStatus: 'SKIPPED_BELOW_70',
            note: `Menunggu analisis ${coinSym} (${tf})...`,
          });
        }
      }
    }

    return {
      enabled: simState.enabled,
      autoTakeProfitOnReversal: simState.autoTakeProfitOnReversal,
      symbol: simState.symbol,
      symbols: activeCoins,
      market: simState.market,
      startingBalancePerTfUsd: DEFAULT_TF_STARTING_BALANCE_USD,
      startingBalancePerCoinUsd: DEFAULT_COIN_STARTING_BALANCE_USD,
      riskPercentPerTrade: DEFAULT_RISK_PERCENT_PER_TRADE,
      minEntryScorePercent: MIN_ENTRY_MOMENTUM_PERCENT,
      rewardToRiskRatio: '1:1',
      dataSource: 'binance-live',
      livePrice: simState.livePrice,
      livePrices: livePricesObj,
      liveUpdatedAt: Date.now(),
      lastExecutionAt: simState.lastExecutionAt,
      stats,
      byTimeframe,
      bySymbol,
      tfScanStatuses,
      trades: simState.trades,
    };
  }

  app.get('/api/simulation/state', async (_req, res) => {
    try {
      await reconcileOpenSimTrades(false);
      res.json(buildSimulationPayload());
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Gagal memuat status simulasi.',
      });
    }
  });

  app.post('/api/simulation/start', async (req, res) => {
    const rawSymbol = String(req.body?.symbol ?? simState.symbol).toUpperCase().trim();
    const rawMarket: MarketType =
      req.body?.market === 'futures' || req.body?.market === 'spot'
        ? req.body.market
        : simState.market;
    const targetSymbols = normalizeSimulationCoins(req.body?.symbols ?? simState.symbols);
    if (!SYMBOL_REGEX.test(rawSymbol)) {
      res.status(400).json({ error: 'Format simbol tidak valid.' });
      return;
    }
    simState.enabled = true;
    simState.symbol = rawSymbol;
    simState.symbols = targetSymbols;
    simState.market = rawMarket;
    savePersistedSimulation(simState);
    try {
      await ensureOpenTradesForTimeframes(targetSymbols, rawMarket, 'AUTO_LIVE', true);
      await reconcileOpenSimTrades(true);
      res.json(buildSimulationPayload());
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Gagal memulai simulasi live.',
      });
    }
  });

  app.post('/api/simulation/run-now', async (req, res) => {
    const rawSymbol = String(req.body?.symbol ?? simState.symbol).toUpperCase().trim();
    const rawMarket: MarketType =
      req.body?.market === 'futures' || req.body?.market === 'spot'
        ? req.body.market
        : simState.market;
    const targetSymbols = normalizeSimulationCoins(req.body?.symbols ?? simState.symbols);
    if (!SYMBOL_REGEX.test(rawSymbol)) {
      res.status(400).json({ error: 'Format simbol tidak valid.' });
      return;
    }
    simState.symbol = rawSymbol;
    simState.symbols = targetSymbols;
    simState.market = rawMarket;
    try {
      await ensureOpenTradesForTimeframes(targetSymbols, rawMarket, 'MANUAL_RUN', true);
      await reconcileOpenSimTrades(true);
      res.json(buildSimulationPayload());
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Gagal mengeksekusi simulasi.',
      });
    }
  });

  app.post('/api/simulation/close-trade', async (req, res) => {
    const tradeId = String(req.body?.tradeId ?? '').trim();
    if (!tradeId) {
      res.status(400).json({ error: 'tradeId wajib disertakan.' });
      return;
    }
    const target = simState.trades.find((t) => t.id === tradeId && t.status === 'OPEN');
    if (!target) {
      res.status(404).json({ error: 'Posisi OPEN tidak ditemukan atau sudah tertutup.' });
      return;
    }

    try {
      await syncBinanceServerTime();
      const nowMs = getBinanceNow();
      const bundle = await loadSymbolBundle(
        target.symbol,
        target.timeframe,
        200,
        target.market,
        true
      );
      const livePrice =
        Number.isFinite(bundle.ticker.lastPrice) && bundle.ticker.lastPrice > 0
          ? bundle.ticker.lastPrice
          : bundle.candles[bundle.candles.length - 1]?.close ?? target.entryPrice;
      simLivePrices.set(`${target.symbol}:${target.market}`, livePrice);

      const liveAnalysis = analyzeMarketDecision(
        target.symbol,
        target.timeframe,
        bundle.candles,
        bundle.orderbook,
        nowMs
      );
      const closedTrade = evaluateOpenTradeReversalTakeProfit({
        trade: target,
        analysis: liveAnalysis,
        livePrice,
        nowMs,
        forceManualClose: true,
      });

      simState.trades = simState.trades.map((t) => (t.id === tradeId ? closedTrade : t));
      savePersistedSimulation(simState);

      if (simState.enabled && !simBusy) {
        await ensureOpenTradesForTimeframes(
          normalizeSimulationCoins(simState.symbols),
          simState.market,
          'REENTRY_TP_SL',
          true
        );
      }
      res.json(buildSimulationPayload());
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Gagal menutup posisi secara live.',
      });
    }
  });

  app.post('/api/simulation/config', async (req, res) => {
    if (typeof req.body?.enabled === 'boolean') {
      simState.enabled = req.body.enabled;
    }
    if (typeof req.body?.autoTakeProfitOnReversal === 'boolean') {
      simState.autoTakeProfitOnReversal = req.body.autoTakeProfitOnReversal;
    }
    if (typeof req.body?.symbol === 'string') {
      const candidate = req.body.symbol.toUpperCase().trim();
      if (SYMBOL_REGEX.test(candidate)) {
        simState.symbol = candidate;
      }
    }
    if (Array.isArray(req.body?.symbols)) {
      simState.symbols = normalizeSimulationCoins(req.body.symbols);
    }
    if (req.body?.market === 'spot' || req.body?.market === 'futures') {
      simState.market = req.body.market;
    }
    savePersistedSimulation(simState);
    if (!simBusy) {
      try {
        await ensureOpenTradesForTimeframes(
          simState.symbols,
          simState.market,
          'AUTO_LIVE',
          simState.enabled
        );
      } catch {
        // Non-fatal if brief network error
      }
    }
    res.json(buildSimulationPayload());
  });

  app.post('/api/simulation/reset', (_req, res) => {
    simState.trades = [];
    simState.enabled = false;
    simState.lastExecutionAt = null;
    simTfScans.clear();
    lastFullScanAt = 0;
    lastReversalAuditAt = 0;
    savePersistedSimulation(simState);
    res.json(buildSimulationPayload());
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('/{*splat}', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`ArthaQuant server listening on http://localhost:${port}`);

    // Monitor OPEN trades against live Binance prices every 4s & auto-reenter immediately when TP/SL hits
    setInterval(() => {
      if (!simBusy && (simState.enabled || simState.trades.some((t) => t.status === 'OPEN'))) {
        void reconcileOpenSimTrades(true).catch(() => {});
      }
    }, 4_000);
  });
}

createApp().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
