import type {
  Candle,
  IndicatorSeries,
  LiquiditySweepEvent,
  LiquidityWall,
  OrderbookLevel,
  OrderbookLiquidityMetrics,
  SwingLevel,
} from '../types/market';

export function calculateSMA(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) {
    return result;
  }

  let rollingSum = 0;
  for (let i = 0; i < values.length; i++) {
    rollingSum += values[i];
    if (i >= period) {
      rollingSum -= values[i - period];
    }
    if (i >= period - 1) {
      result[i] = rollingSum / period;
    }
  }
  return result;
}

export function calculateEMA(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) {
    return result;
  }

  let initialSum = 0;
  for (let i = 0; i < period; i++) {
    initialSum += values[i];
  }
  let ema = initialSum / period;
  result[period - 1] = ema;

  const multiplier = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    ema = (values[i] - ema) * multiplier + ema;
    result[i] = ema;
  }
  return result;
}

export function calculateRSI(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  if (period <= 0 || closes.length <= period) {
    return result;
  }

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) {
      gainSum += diff;
    } else {
      lossSum += Math.abs(diff);
    }
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  const firstRs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + firstRs);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) {
      result[i] = avgGain === 0 ? 50 : 100;
    } else {
      const rs = avgGain / avgLoss;
      result[i] = 100 - 100 / (1 + rs);
    }
  }

  return result;
}

export function calculateMACD(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): {
  macdLine: (number | null)[];
  signalLine: (number | null)[];
  histogram: (number | null)[];
} {
  const fastEma = calculateEMA(closes, fastPeriod);
  const slowEma = calculateEMA(closes, slowPeriod);
  const macdLine: (number | null)[] = closes.map((_, i) => {
    const f = fastEma[i];
    const s = slowEma[i];
    return f !== null && s !== null ? f - s : null;
  });

  const validStart = macdLine.findIndex((v) => v !== null);
  const signalLine: (number | null)[] = new Array(closes.length).fill(null);
  const histogram: (number | null)[] = new Array(closes.length).fill(null);

  if (validStart === -1) {
    return { macdLine, signalLine, histogram };
  }

  const validMacdValues = macdLine.slice(validStart) as number[];
  const rawSignals = calculateEMA(validMacdValues, signalPeriod);

  for (let i = 0; i < rawSignals.length; i++) {
    const targetIdx = validStart + i;
    const sig = rawSignals[i];
    signalLine[targetIdx] = sig;
    const macd = macdLine[targetIdx];
    if (macd !== null && sig !== null) {
      histogram[targetIdx] = macd - sig;
    }
  }

  return { macdLine, signalLine, histogram };
}

export function calculateBollingerBands(
  closes: number[],
  period = 20,
  stdDevMultiplier = 2
): {
  upper: (number | null)[];
  middle: (number | null)[];
  lower: (number | null)[];
} {
  const middle = calculateSMA(closes, period);
  const upper: (number | null)[] = new Array(closes.length).fill(null);
  const lower: (number | null)[] = new Array(closes.length).fill(null);

  for (let i = period - 1; i < closes.length; i++) {
    const mean = middle[i];
    if (mean === null) continue;
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j] - mean;
      sumSq += diff * diff;
    }
    const stdDev = Math.sqrt(sumSq / period);
    upper[i] = mean + stdDevMultiplier * stdDev;
    lower[i] = mean - stdDevMultiplier * stdDev;
  }

  return { upper, middle, lower };
}

export function calculateATR(candles: Candle[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length <= period || period <= 0) {
    return result;
  }

  const trueRanges: number[] = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    const highLow = candles[i].high - candles[i].low;
    const highPrevClose = Math.abs(candles[i].high - candles[i - 1].close);
    const lowPrevClose = Math.abs(candles[i].low - candles[i - 1].close);
    trueRanges.push(Math.max(highLow, highPrevClose, lowPrevClose));
  }

  let atrSum = 0;
  for (let i = 1; i <= period; i++) {
    atrSum += trueRanges[i];
  }
  let atr = atrSum / period;
  result[period] = atr;

  for (let i = period + 1; i < candles.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
    result[i] = atr;
  }

  return result;
}

export function calculateVWAP(candles: Candle[]): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length === 0) return result;

  let currentDay = -1;
  let cumPv = 0;
  let cumVol = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const day = Math.floor(c.openTime / 86_400_000);
    if (day !== currentDay) {
      currentDay = day;
      cumPv = 0;
      cumVol = 0;
    }
    const typical = (c.high + c.low + c.close) / 3;
    cumPv += typical * c.volume;
    cumVol += c.volume;
    result[i] = cumVol > 0 ? cumPv / cumVol : c.close;
  }
  return result;
}

export function calculateIchimoku(candles: Candle[]): {
  tenkan: (number | null)[];
  kijun: (number | null)[];
  spanA: (number | null)[];
  spanB: (number | null)[];
} {
  const len = candles.length;
  const tenkan: (number | null)[] = new Array(len).fill(null);
  const kijun: (number | null)[] = new Array(len).fill(null);
  const spanA: (number | null)[] = new Array(len).fill(null);
  const spanB: (number | null)[] = new Array(len).fill(null);

  const midpoint = (endIdx: number, period: number): number | null => {
    if (endIdx < period - 1) return null;
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = endIdx - period + 1; j <= endIdx; j++) {
      if (candles[j].high > hi) hi = candles[j].high;
      if (candles[j].low < lo) lo = candles[j].low;
    }
    return (hi + lo) / 2;
  };

  const rawSpanA: (number | null)[] = new Array(len).fill(null);
  const rawSpanB: (number | null)[] = new Array(len).fill(null);

  for (let i = 0; i < len; i++) {
    tenkan[i] = midpoint(i, 9);
    kijun[i] = midpoint(i, 26);
    if (tenkan[i] !== null && kijun[i] !== null) {
      rawSpanA[i] = (tenkan[i]! + kijun[i]!) / 2;
    }
    rawSpanB[i] = midpoint(i, 52);
  }

  // Shift Senkou Span A/B forward by 26 bars so index i holds the active Kumo cloud at bar i
  const shift = 26;
  for (let i = 0; i < len; i++) {
    const srcIdx = i - shift;
    if (srcIdx >= 0) {
      spanA[i] = rawSpanA[srcIdx];
      spanB[i] = rawSpanB[srcIdx];
    }
  }

  return { tenkan, kijun, spanA, spanB };
}

export function calculateADX(
  candles: Candle[],
  period = 14
): {
  adx: (number | null)[];
  plusDi: (number | null)[];
  minusDi: (number | null)[];
} {
  const len = candles.length;
  const adx: (number | null)[] = new Array(len).fill(null);
  const plusDi: (number | null)[] = new Array(len).fill(null);
  const minusDi: (number | null)[] = new Array(len).fill(null);

  if (len <= period * 2 || period <= 0) {
    return { adx, plusDi, minusDi };
  }

  const tr: number[] = [0];
  const dmPlus: number[] = [0];
  const dmMinus: number[] = [0];

  for (let i = 1; i < len; i++) {
    const highDiff = candles[i].high - candles[i - 1].high;
    const lowDiff = candles[i - 1].low - candles[i].low;
    dmPlus.push(highDiff > lowDiff && highDiff > 0 ? highDiff : 0);
    dmMinus.push(lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0);
    const hl = candles[i].high - candles[i].low;
    const hc = Math.abs(candles[i].high - candles[i - 1].close);
    const lc = Math.abs(candles[i].low - candles[i - 1].close);
    tr.push(Math.max(hl, hc, lc));
  }

  let smoothTr = 0;
  let smoothPlus = 0;
  let smoothMinus = 0;
  for (let i = 1; i <= period; i++) {
    smoothTr += tr[i];
    smoothPlus += dmPlus[i];
    smoothMinus += dmMinus[i];
  }

  const dxValues: number[] = [];
  const dxStartIdx = period;

  for (let i = period; i < len; i++) {
    if (i > period) {
      smoothTr = smoothTr - smoothTr / period + tr[i];
      smoothPlus = smoothPlus - smoothPlus / period + dmPlus[i];
      smoothMinus = smoothMinus - smoothMinus / period + dmMinus[i];
    }
    const pdi = smoothTr > 0 ? (smoothPlus / smoothTr) * 100 : 0;
    const mdi = smoothTr > 0 ? (smoothMinus / smoothTr) * 100 : 0;
    plusDi[i] = pdi;
    minusDi[i] = mdi;
    const diSum = pdi + mdi;
    const dx = diSum > 0 ? (Math.abs(pdi - mdi) / diSum) * 100 : 0;
    dxValues.push(dx);

    if (dxValues.length === period) {
      const initialAdx =
        dxValues.reduce((acc, v) => acc + v, 0) / period;
      adx[i] = initialAdx;
    } else if (dxValues.length > period) {
      const prevAdx = adx[i - 1] ?? dx;
      adx[i] = (prevAdx * (period - 1) + dx) / period;
    }
  }
  void dxStartIdx;

  return { adx, plusDi, minusDi };
}

export function calculateStochastic(
  candles: Candle[],
  kPeriod = 14,
  smoothK = 3,
  dPeriod = 3
): { k: (number | null)[]; d: (number | null)[] } {
  const len = candles.length;
  const rawK: (number | null)[] = new Array(len).fill(null);

  for (let i = kPeriod - 1; i < len; i++) {
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (candles[j].high > highest) highest = candles[j].high;
      if (candles[j].low < lowest) lowest = candles[j].low;
    }
    const range = highest - lowest;
    rawK[i] = range > 0 ? ((candles[i].close - lowest) / range) * 100 : 50;
  }

  const k: (number | null)[] = new Array(len).fill(null);
  for (let i = kPeriod - 1 + smoothK - 1; i < len; i++) {
    let sum = 0;
    let valid = true;
    for (let j = i - smoothK + 1; j <= i; j++) {
      if (rawK[j] === null) {
        valid = false;
        break;
      }
      sum += rawK[j]!;
    }
    if (valid) k[i] = sum / smoothK;
  }

  const d: (number | null)[] = new Array(len).fill(null);
  for (let i = kPeriod - 1 + smoothK - 1 + dPeriod - 1; i < len; i++) {
    let sum = 0;
    let valid = true;
    for (let j = i - dPeriod + 1; j <= i; j++) {
      if (k[j] === null) {
        valid = false;
        break;
      }
      sum += k[j]!;
    }
    if (valid) d[i] = sum / dPeriod;
  }

  return { k, d };
}

export function calculateCCI(candles: Candle[], period = 20): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length < period) return result;

  const typicals = candles.map((c) => (c.high + c.low + c.close) / 3);
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += typicals[j];
    const smaTp = sum / period;
    let devSum = 0;
    for (let j = i - period + 1; j <= i; j++) devSum += Math.abs(typicals[j] - smaTp);
    const meanDev = devSum / period;
    result[i] = meanDev > 0 ? (typicals[i] - smaTp) / (0.015 * meanDev) : 0;
  }
  return result;
}

export function calculateWilliamsR(candles: Candle[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length < period) return result;

  for (let i = period - 1; i < candles.length; i++) {
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (candles[j].high > highest) highest = candles[j].high;
      if (candles[j].low < lowest) lowest = candles[j].low;
    }
    const range = highest - lowest;
    result[i] = range > 0 ? ((highest - candles[i].close) / range) * -100 : -50;
  }
  return result;
}

export function calculateOBV(candles: Candle[]): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length === 0) return result;
  let obv = 0;
  result[0] = 0;
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[i - 1].close) {
      obv += candles[i].volume;
    } else if (candles[i].close < candles[i - 1].close) {
      obv -= candles[i].volume;
    }
    result[i] = obv;
  }
  return result;
}

export function computeAllIndicators(candles: Candle[]): IndicatorSeries {
  const closes = candles.map((c) => c.close);
  const macd = calculateMACD(closes, 12, 26, 9);
  const bb = calculateBollingerBands(closes, 20, 2);
  const ichi = calculateIchimoku(candles);
  const adxData = calculateADX(candles, 14);
  const stoch = calculateStochastic(candles, 14, 3, 3);

  return {
    sma20: calculateSMA(closes, 20),
    sma50: calculateSMA(closes, 50),
    sma200: calculateSMA(closes, 200),
    ema9: calculateEMA(closes, 9),
    ema20: calculateEMA(closes, 20),
    ema21: calculateEMA(closes, 21),
    ema50: calculateEMA(closes, 50),
    ema55: calculateEMA(closes, 55),
    ema200: calculateEMA(closes, 200),
    rsi14: calculateRSI(closes, 14),
    macdLine: macd.macdLine,
    macdSignal: macd.signalLine,
    macdHist: macd.histogram,
    bbUpper: bb.upper,
    bbMiddle: bb.middle,
    bbLower: bb.lower,
    atr14: calculateATR(candles, 14),
    vwap: calculateVWAP(candles),
    ichimokuTenkan: ichi.tenkan,
    ichimokuKijun: ichi.kijun,
    ichimokuSpanA: ichi.spanA,
    ichimokuSpanB: ichi.spanB,
    adx14: adxData.adx,
    stochK: stoch.k,
    stochD: stoch.d,
    cci20: calculateCCI(candles, 20),
    williamsR14: calculateWilliamsR(candles, 14),
    obv: calculateOBV(candles),
  };
}

export function detectSwingLiquidity(
  candles: Candle[],
  pivotWindow = 3
): { swingLevels: SwingLevel[]; recentSweep: LiquiditySweepEvent | null } {
  if (candles.length < pivotWindow * 2 + 5) {
    return { swingLevels: [], recentSweep: null };
  }

  const swingHighs: SwingLevel[] = [];
  const swingLows: SwingLevel[] = [];

  for (let i = pivotWindow; i < candles.length - pivotWindow; i++) {
    let isHigh = true;
    let isLow = true;
    for (let k = i - pivotWindow; k <= i + pivotWindow; k++) {
      if (k === i) continue;
      if (candles[k].high >= candles[i].high) isHigh = false;
      if (candles[k].low <= candles[i].low) isLow = false;
    }

    if (isHigh) {
      swingHighs.push({
        type: 'BSL',
        price: candles[i].high,
        strength: 1,
        time: candles[i].openTime,
      });
    }
    if (isLow) {
      swingLows.push({
        type: 'SSL',
        price: candles[i].low,
        strength: 1,
        time: candles[i].openTime,
      });
    }
  }

  // Cluster levels within 0.35% proximity
  const clusterLevels = (levels: SwingLevel[]): SwingLevel[] => {
    const clustered: SwingLevel[] = [];
    for (const lvl of levels) {
      const match = clustered.find(
        (c) => Math.abs(c.price - lvl.price) / lvl.price < 0.0035
      );
      if (match) {
        match.strength += 1;
        match.price = (match.price + lvl.price) / 2;
        match.time = Math.max(match.time, lvl.time);
      } else {
        clustered.push({ ...lvl });
      }
    }
    return clustered;
  };

  const latestClose = candles[candles.length - 1].close;
  const bslAbove = clusterLevels(swingHighs)
    .filter((s) => s.price > latestClose * 0.995)
    .sort((a, b) => a.price - b.price)
    .slice(0, 3);

  const sslBelow = clusterLevels(swingLows)
    .filter((s) => s.price < latestClose * 1.005)
    .sort((a, b) => b.price - a.price)
    .slice(0, 3);

  const swingLevels = [...bslAbove, ...sslBelow];

  // Check last 5 candles for liquidity sweep (stop hunt)
  let recentSweep: LiquiditySweepEvent | null = null;
  const startCheck = Math.max(pivotWindow + 2, candles.length - 5);
  for (let i = candles.length - 1; i >= startCheck; i--) {
    const c = candles[i];
    const priorHighs = swingHighs.filter((s) => s.time < c.openTime).slice(-4);
    const priorLows = swingLows.filter((s) => s.time < c.openTime).slice(-4);

    for (const sh of priorHighs) {
      if (c.high > sh.price && c.close < sh.price) {
        recentSweep = {
          type: 'BSL_SWEEP',
          levelPrice: sh.price,
          sweepTime: c.openTime,
          description: `Likuiditas atas (BSL) di ${sh.price.toFixed(2)} tersapu wick lalu harga ditutup kembali di bawahnya (indikasi penolakan/distribusi).`,
        };
        break;
      }
    }
    if (recentSweep) break;

    for (const sl of priorLows) {
      if (c.low < sl.price && c.close > sl.price) {
        recentSweep = {
          type: 'SSL_SWEEP',
          levelPrice: sl.price,
          sweepTime: c.openTime,
          description: `Likuiditas bawah (SSL) di ${sl.price.toFixed(2)} tersapu wick lalu harga rebound ditutup di atasnya (indikasi akumulasi/stop-hunt).`,
        };
        break;
      }
    }
    if (recentSweep) break;
  }

  return { swingLevels, recentSweep };
}

export function analyzeOrderbookLiquidity(
  bids: [number, number][],
  asks: [number, number][]
): OrderbookLiquidityMetrics {
  const bestBid = bids.length > 0 ? bids[0][0] : 0;
  const bestAsk = asks.length > 0 ? asks[0][0] : 0;
  const midPrice = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : bestBid || bestAsk;
  const spreadUsd = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0;
  const spreadPercent = midPrice > 0 ? (spreadUsd / midPrice) * 100 : 0;

  let cumBidUsd = 0;
  let bidLiquidity2PctUsd = 0;
  const cumulativeBids: OrderbookLevel[] = [];
  const bidWallsRaw: LiquidityWall[] = [];

  for (const [price, qty] of bids) {
    const usdValue = price * qty;
    cumBidUsd += usdValue;
    const distancePercent = midPrice > 0 ? ((midPrice - price) / midPrice) * 100 : 0;
    if (distancePercent <= 2) {
      bidLiquidity2PctUsd += usdValue;
    }
    cumulativeBids.push({
      price,
      quantity: qty,
      usdValue,
      cumulativeUsd: cumBidUsd,
    });
    bidWallsRaw.push({
      side: 'BID',
      price,
      quantity: qty,
      usdValue,
      distancePercent,
    });
  }

  let cumAskUsd = 0;
  let askLiquidity2PctUsd = 0;
  const cumulativeAsks: OrderbookLevel[] = [];
  const askWallsRaw: LiquidityWall[] = [];

  for (const [price, qty] of asks) {
    const usdValue = price * qty;
    cumAskUsd += usdValue;
    const distancePercent = midPrice > 0 ? ((price - midPrice) / midPrice) * 100 : 0;
    if (distancePercent <= 2) {
      askLiquidity2PctUsd += usdValue;
    }
    cumulativeAsks.push({
      price,
      quantity: qty,
      usdValue,
      cumulativeUsd: cumAskUsd,
    });
    askWallsRaw.push({
      side: 'ASK',
      price,
      quantity: qty,
      usdValue,
      distancePercent,
    });
  }

  const total2Pct = bidLiquidity2PctUsd + askLiquidity2PctUsd;
  const imbalanceRatio = total2Pct > 0 ? bidLiquidity2PctUsd / total2Pct : 0.5;
  const bias =
    imbalanceRatio >= 0.56
      ? 'BID_DOMINANT'
      : imbalanceRatio <= 0.44
      ? 'ASK_DOMINANT'
      : 'BALANCED';

  const topBidWalls = bidWallsRaw
    .sort((a, b) => b.usdValue - a.usdValue)
    .slice(0, 5);
  const topAskWalls = askWallsRaw
    .sort((a, b) => b.usdValue - a.usdValue)
    .slice(0, 5);

  return {
    midPrice,
    bestBid,
    bestAsk,
    spreadUsd,
    spreadPercent,
    bidLiquidity2PctUsd,
    askLiquidity2PctUsd,
    imbalanceRatio,
    bias,
    topBidWalls,
    topAskWalls,
    cumulativeBids,
    cumulativeAsks,
  };
}

export function estimateOrderSlippage(
  side: 'BUY' | 'SELL',
  orderSizeUsd: number,
  bids: [number, number][],
  asks: [number, number][]
): {
  avgFillPrice: number;
  slippagePercent: number;
  filledUsd: number;
  unfilledUsd: number;
  levelsConsumed: number;
} {
  const levels = side === 'BUY' ? asks : bids;
  if (levels.length === 0 || orderSizeUsd <= 0) {
    return {
      avgFillPrice: 0,
      slippagePercent: 0,
      filledUsd: 0,
      unfilledUsd: orderSizeUsd,
      levelsConsumed: 0,
    };
  }

  const referencePrice = levels[0][0];
  let remainingUsd = orderSizeUsd;
  let totalCoins = 0;
  let totalSpentUsd = 0;
  let levelsConsumed = 0;

  for (const [price, qty] of levels) {
    if (remainingUsd <= 0) break;
    const levelUsd = price * qty;
    levelsConsumed += 1;

    if (levelUsd >= remainingUsd) {
      totalCoins += remainingUsd / price;
      totalSpentUsd += remainingUsd;
      remainingUsd = 0;
    } else {
      totalCoins += qty;
      totalSpentUsd += levelUsd;
      remainingUsd -= levelUsd;
    }
  }

  const avgFillPrice = totalCoins > 0 ? totalSpentUsd / totalCoins : referencePrice;
  const slippagePercent =
    referencePrice > 0
      ? (Math.abs(avgFillPrice - referencePrice) / referencePrice) * 100
      : 0;

  return {
    avgFillPrice,
    slippagePercent,
    filledUsd: totalSpentUsd,
    unfilledUsd: remainingUsd,
    levelsConsumed,
  };
}
