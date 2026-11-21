import type { Candle, OrderbookData, Ticker24h } from '../types/market';

const BASE_PRICES: Record<string, number> = {
  BTCUSDT: 59000,
  ETHUSDT: 2950,
  BNBUSDT: 565,
  SOLUSDT: 152,
  XRPUSDT: 0.62,
  ADAUSDT: 0.48,
  DOGEUSDT: 0.145,
  AVAXUSDT: 34.5,
  LINKUSDT: 15.8,
  DOTUSDT: 6.9,
  NEARUSDT: 5.4,
  SUIUSDT: 1.85,
  ARBUSDT: 0.92,
  OPUSDT: 1.75,
  LTCUSDT: 78.5,
  UNIUSDT: 8.6,
};

function seededRandom(seed: number): () => number {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function hashSymbol(symbol: string): number {
  let h = 1337;
  for (let i = 0; i < symbol.length; i++) {
    h = (h * 31 + symbol.charCodeAt(i)) % 1000000;
  }
  return h;
}

export function generateFallbackCandles(
  symbol: string,
  interval: string,
  limit = 220
): Candle[] {
  const base = BASE_PRICES[symbol.toUpperCase()] ?? 25.0;
  const intervalMsMap: Record<string, number> = {
    '1m': 60 * 1000,
    '3m': 3 * 60 * 1000,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '30m': 30 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '2h': 2 * 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '8h': 8 * 60 * 60 * 1000,
    '12h': 12 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
    '3d': 3 * 24 * 60 * 60 * 1000,
    '1w': 7 * 24 * 60 * 60 * 1000,
    '1M': 30 * 24 * 60 * 60 * 1000,
  };
  const stepMs = intervalMsMap[interval] ?? 60 * 60 * 1000;
  const now = Date.now();
  const rand = seededRandom(hashSymbol(symbol + interval));

  const candles: Candle[] = [];
  let price = base * 0.94;
  const trendBias = symbol.includes('BTC') || symbol.includes('SOL') ? 0.00055 : -0.0002;

  for (let i = 0; i < limit; i++) {
    const openTime = now - (limit - i) * stepMs;
    const wave = Math.sin(i / 14) * 0.006;
    const noise = (rand() - 0.49) * 0.015;
    const pctMove = trendBias + wave * 0.25 + noise;
    const open = price;
    const close = Math.max(base * 0.2, open * (1 + pctMove));
    const wickUp = Math.abs(rand() * 0.009) * Math.max(open, close);
    const wickDown = Math.abs(rand() * 0.009) * Math.min(open, close);
    const high = Math.max(open, close) + wickUp;
    const low = Math.min(open, close) - wickDown;
    const volume = (base > 1000 ? 450 : 125000) * (0.6 + rand() * 1.4);

    candles.push({
      openTime,
      open,
      high,
      low,
      close,
      volume,
      closeTime: openTime + stepMs - 1,
      quoteVolume: volume * close,
      trades: Math.floor(800 + rand() * 4500),
    });
    price = close;
  }

  return candles;
}

export function generateFallbackOrderbook(
  symbol: string,
  referencePrice?: number
): OrderbookData {
  const mid = referencePrice ?? BASE_PRICES[symbol.toUpperCase()] ?? 25.0;
  const rand = seededRandom(hashSymbol(symbol + 'depth'));
  const bids: [number, number][] = [];
  const asks: [number, number][] = [];

  for (let i = 1; i <= 50; i++) {
    const bidPrice = Number((mid * (1 - i * 0.00055)).toFixed(mid > 100 ? 2 : 5));
    const askPrice = Number((mid * (1 + i * 0.00055)).toFixed(mid > 100 ? 2 : 5));
    const wallMultiplierBid = i === 8 || i === 22 ? 4.2 : 1;
    const wallMultiplierAsk = i === 12 || i === 28 ? 3.1 : 1;
    const baseUsd = 18000 + rand() * 55000;

    bids.push([bidPrice, Number(((baseUsd * wallMultiplierBid) / bidPrice).toFixed(4))]);
    asks.push([askPrice, Number(((baseUsd * wallMultiplierAsk) / askPrice).toFixed(4))]);
  }

  return {
    symbol: symbol.toUpperCase(),
    lastUpdateId: 900100200,
    bids,
    asks,
    source: 'fallback-sim',
  };
}

export function generateFallbackTicker(
  symbol: string,
  candles?: Candle[]
): Ticker24h {
  const lastPrice =
    candles && candles.length > 0
      ? candles[candles.length - 1].close
      : BASE_PRICES[symbol.toUpperCase()] ?? 25.0;
  const open24h =
    candles && candles.length > 24
      ? candles[candles.length - 25].close
      : lastPrice * 0.985;
  const priceChange = lastPrice - open24h;
  const priceChangePercent = open24h > 0 ? (priceChange / open24h) * 100 : 0;

  return {
    symbol: symbol.toUpperCase(),
    lastPrice,
    priceChange,
    priceChangePercent,
    highPrice: lastPrice * 1.032,
    lowPrice: lastPrice * 0.968,
    volume: 28500,
    quoteVolume: 28500 * lastPrice,
    weightedAvgPrice: lastPrice * 0.998,
    count: 984210,
    source: 'fallback-sim',
  };
}
