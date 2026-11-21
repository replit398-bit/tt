import type {
  AdvancedTechnicalAnalysis,
  Candle,
  DetectedPatternItem,
  IndicatorSeries,
  SwingLevel,
  TrendlineChannelInfo,
} from '../types/market';
import { calculateADX } from './indicators';

function formatNum(val: number): string {
  if (val >= 1000) return val.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (val >= 1) return val.toFixed(4);
  return val.toFixed(6);
}

interface PivotPoint {
  index: number;
  price: number;
  time: number;
}

function extractPivots(
  candles: Candle[],
  lookback = 3
): { highs: PivotPoint[]; lows: PivotPoint[] } {
  const highs: PivotPoint[] = [];
  const lows: PivotPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isH = true;
    let isL = true;
    for (let k = i - lookback; k <= i + lookback; k++) {
      if (k === i) continue;
      if (candles[k].high >= candles[i].high) isH = false;
      if (candles[k].low <= candles[i].low) isL = false;
    }
    if (isH) highs.push({ index: i, price: candles[i].high, time: candles[i].openTime });
    if (isL) lows.push({ index: i, price: candles[i].low, time: candles[i].openTime });
  }
  return { highs, lows };
}

export function detectCandlestickPatterns(candles: Candle[]): DetectedPatternItem[] {
  const detected: DetectedPatternItem[] = [];
  const n = candles.length;
  if (n < 3) return detected;

  const c0 = candles[n - 1];
  const c1 = candles[n - 2];
  const c2 = candles[n - 3];

  const body0 = Math.abs(c0.close - c0.open);
  const range0 = Math.max(1e-9, c0.high - c0.low);
  const upperWick0 = c0.high - Math.max(c0.open, c0.close);
  const lowerWick0 = Math.min(c0.open, c0.close) - c0.low;

  const body1 = Math.abs(c1.close - c1.open);
  const range1 = Math.max(1e-9, c1.high - c1.low);

  // 1. Doji
  if (body0 <= range0 * 0.12) {
    detected.push({
      name: 'Doji',
      bias: 'neutral',
      description:
        'Candle penutupan membentuk Doji (ketidakpastian antara buyer & seller; potensi jeda atau pembalikan arah).',
    });
  }

  // 2. Hammer (bullish rejection from lower wick)
  if (lowerWick0 >= body0 * 2.1 && upperWick0 <= body0 * 0.6 && body0 >= range0 * 0.04) {
    detected.push({
      name: 'Hammer',
      bias: 'bullish',
      description:
        'Ekor bawah panjang (Hammer) menolak penurunan harga — indikasi minat beli kuat di area support.',
    });
  }

  // 3. Shooting Star (bearish rejection from upper wick)
  if (upperWick0 >= body0 * 2.1 && lowerWick0 <= body0 * 0.6 && body0 >= range0 * 0.04) {
    detected.push({
      name: 'Shooting Star',
      bias: 'bearish',
      description:
        'Ekor atas panjang (Shooting Star) menunjukkan penolakan harga tinggi oleh tekanan jual.',
    });
  }

  // 4. Bullish / Bearish Engulfing
  const prevBear = c1.close < c1.open;
  const prevBull = c1.close > c1.open;
  const currBull = c0.close > c0.open;
  const currBear = c0.close < c0.open;

  if (prevBear && currBull && c0.open <= c1.close && c0.close >= c1.open && body0 > body1) {
    detected.push({
      name: 'Bullish Engulfing',
      bias: 'bullish',
      description:
        'Candle bullish menelan penuh body candle bearish sebelumnya, menandakan pergeseran kendali ke buyer.',
    });
  } else if (prevBull && currBear && c0.open >= c1.close && c0.close <= c1.open && body0 > body1) {
    detected.push({
      name: 'Bearish Engulfing',
      bias: 'bearish',
      description:
        'Candle bearish menelan penuh body candle bullish sebelumnya, menandakan tekanan jual dominan.',
    });
  }

  // 5. Morning Star / Evening Star (3-bar reversal)
  const c2Bear = c2.close < c2.open && Math.abs(c2.close - c2.open) > (c2.high - c2.low) * 0.45;
  const c2Bull = c2.close > c2.open && Math.abs(c2.close - c2.open) > (c2.high - c2.low) * 0.45;
  const smallMiddle = body1 < range1 * 0.4;
  const midC2 = (c2.open + c2.close) / 2;

  if (c2Bear && smallMiddle && currBull && c0.close > midC2) {
    detected.push({
      name: 'Morning Star',
      bias: 'bullish',
      description:
        'Pola 3-candle Morning Star terkonfirmasi (penurunan -> jeda kecil -> penutupan naik melewati titik tengah candle pertama).',
    });
  } else if (c2Bull && smallMiddle && currBear && c0.close < midC2) {
    detected.push({
      name: 'Evening Star',
      bias: 'bearish',
      description:
        'Pola 3-candle Evening Star terkonfirmasi (kenaikan -> jeda kecil -> penutupan turun melewati titik tengah candle pertama).',
    });
  }

  return detected;
}

export function detectChartPatterns(
  candles: Candle[],
  pivots: { highs: PivotPoint[]; lows: PivotPoint[] }
): DetectedPatternItem[] {
  const patterns: DetectedPatternItem[] = [];
  const n = candles.length;
  if (n < 30) return patterns;

  const { highs, lows } = pivots;
  const currentPrice = candles[n - 1].close;

  // Double Top / Double Bottom
  if (highs.length >= 2) {
    const h1 = highs[highs.length - 2];
    const h2 = highs[highs.length - 1];
    const diffPct = Math.abs(h1.price - h2.price) / Math.max(1e-9, h1.price);
    if (diffPct <= 0.008 && h2.index - h1.index >= 5 && currentPrice < h2.price * 0.996) {
      patterns.push({
        name: 'Double Top',
        bias: 'bearish',
        description: `Dua puncak setara terbentuk di area ${formatNum((h1.price + h2.price) / 2)}, rawan penolakan lanjutan jika neckline ditembus.`,
      });
    }
  }

  if (lows.length >= 2) {
    const l1 = lows[lows.length - 2];
    const l2 = lows[lows.length - 1];
    const diffPct = Math.abs(l1.price - l2.price) / Math.max(1e-9, l1.price);
    if (diffPct <= 0.008 && l2.index - l1.index >= 5 && currentPrice > l2.price * 1.004) {
      patterns.push({
        name: 'Double Bottom',
        bias: 'bullish',
        description: `Dua dasar setara terbentuk di area ${formatNum((l1.price + l2.price) / 2)}, menandakan pertahanan demand kuat.`,
      });
    }
  }

  // Head and Shoulders / Inverse H&S
  if (highs.length >= 3) {
    const ls = highs[highs.length - 3];
    const head = highs[highs.length - 2];
    const rs = highs[highs.length - 1];
    const shoulderSym = Math.abs(ls.price - rs.price) / Math.max(1e-9, ls.price) <= 0.015;
    if (head.price > ls.price * 1.006 && head.price > rs.price * 1.006 && shoulderSym) {
      patterns.push({
        name: 'Head & Shoulders',
        bias: 'bearish',
        description: `Pola pembalikan Head & Shoulders (Head ${formatNum(head.price)} diapit dua bahu lebih rendah); waspadai penembusan neckline.`,
      });
    }
  }

  if (lows.length >= 3) {
    const ls = lows[lows.length - 3];
    const head = lows[lows.length - 2];
    const rs = lows[lows.length - 1];
    const shoulderSym = Math.abs(ls.price - rs.price) / Math.max(1e-9, ls.price) <= 0.015;
    if (head.price < ls.price * 0.994 && head.price < rs.price * 0.994 && shoulderSym) {
      patterns.push({
        name: 'Inverse Head & Shoulders',
        bias: 'bullish',
        description: `Pola pembalikan Inverse H&S (Head ${formatNum(head.price)} lebih dalam dari kedua bahu), berpotensi mendorong pembalikan naik.`,
      });
    }
  }

  // Triangle & Wedge from last 2 highs + last 2 lows
  if (highs.length >= 2 && lows.length >= 2) {
    const h1 = highs[highs.length - 2];
    const h2 = highs[highs.length - 1];
    const l1 = lows[lows.length - 2];
    const l2 = lows[lows.length - 1];

    const hSlope = (h2.price - h1.price) / Math.max(1, h2.index - h1.index) / h1.price;
    const lSlope = (l2.price - l1.price) / Math.max(1, l2.index - l1.index) / l1.price;

    if (hSlope < -0.0002 && lSlope > 0.0002) {
      patterns.push({
        name: 'Symmetrical Triangle',
        bias: 'neutral',
        description:
          'Puncak makin rendah dan dasar makin tinggi (kompresi Triangle), menanti breakout terkonfirmasi volume.',
      });
    } else if (Math.abs(hSlope) <= 0.00025 && lSlope > 0.0003) {
      patterns.push({
        name: 'Ascending Triangle',
        bias: 'bullish',
        description:
          'Resistance mendatar dengan Higher Low menekan naik (Ascending Triangle), cenderung breakout ke atas.',
      });
    } else if (hSlope < -0.0003 && Math.abs(lSlope) <= 0.00025) {
      patterns.push({
        name: 'Descending Triangle',
        bias: 'bearish',
        description:
          'Support mendatar dengan Lower High menekan turun (Descending Triangle), rawan breakdown ke bawah.',
      });
    } else if (hSlope > 0.0003 && lSlope > hSlope * 1.15) {
      patterns.push({
        name: 'Rising Wedge',
        bias: 'bearish',
        description:
          'Kanal naik menyempit (Rising Wedge) menandakan pelemahan momentum beli dan risiko breakdown.',
      });
    } else if (lSlope < -0.0003 && hSlope < lSlope * 1.15) {
      patterns.push({
        name: 'Falling Wedge',
        bias: 'bullish',
        description:
          'Kanal turun menyempit (Falling Wedge) menunjukkan pelemahan tekanan jual dan peluang breakout naik.',
      });
    }
  }

  // Flag continuation: sharp impulse in prior 18..7 bars followed by tight consolidation in last 7 bars
  if (n >= 22) {
    const poleStart = candles[n - 20].close;
    const poleEnd = candles[n - 8].close;
    const poleMovePct = ((poleEnd - poleStart) / Math.max(1e-9, poleStart)) * 100;
    const flagSlice = candles.slice(n - 7);
    const flagHigh = Math.max(...flagSlice.map((c) => c.high));
    const flagLow = Math.min(...flagSlice.map((c) => c.low));
    const flagRangePct = ((flagHigh - flagLow) / Math.max(1e-9, poleEnd)) * 100;

    if (poleMovePct > 3.0 && flagRangePct < Math.abs(poleMovePct) * 0.65) {
      patterns.push({
        name: 'Bull Flag',
        bias: 'bullish',
        description: `Lonjakan +${poleMovePct.toFixed(1)}% diikuti konsolidasi rapat (${flagRangePct.toFixed(1)}%), pola kelanjutan naik.`,
      });
    } else if (poleMovePct < -3.0 && flagRangePct < Math.abs(poleMovePct) * 0.65) {
      patterns.push({
        name: 'Bear Flag',
        bias: 'bearish',
        description: `Penurunan ${poleMovePct.toFixed(1)}% diikuti konsolidasi sempit (${flagRangePct.toFixed(1)}%), pola kelanjutan turun.`,
      });
    }
  }

  return patterns;
}

export function computeTrendlineChannel(candles: Candle[]): TrendlineChannelInfo {
  const n = candles.length;
  const window = Math.min(48, n);
  const startIndex = n - window;
  const endIndex = n - 1;
  const slice = candles.slice(startIndex);

  if (slice.length < 5) {
    const p = candles[n - 1]?.close ?? 0;
    return {
      direction: 'SIDEWAYS',
      slopePercentPerBar: 0,
      upperStart: p,
      upperEnd: p,
      lowerStart: p,
      lowerEnd: p,
      startIndex,
      endIndex,
      positionRatio: 0.5,
      summary: 'Data belum cukup untuk membentuk trendline & channel.',
    };
  }

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  const m = slice.length;
  for (let i = 0; i < m; i++) {
    sumX += i;
    sumY += slice[i].close;
    sumXY += i * slice[i].close;
    sumXX += i * i;
  }
  const denom = m * sumXX - sumX * sumX;
  const slope = denom !== 0 ? (m * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / m;

  let maxUpperDev = 0;
  let maxLowerDev = 0;
  for (let i = 0; i < m; i++) {
    const regY = intercept + slope * i;
    const upDev = slice[i].high - regY;
    const loDev = regY - slice[i].low;
    if (upDev > maxUpperDev) maxUpperDev = upDev;
    if (loDev > maxLowerDev) maxLowerDev = loDev;
  }

  const startBase = intercept;
  const endBase = intercept + slope * (m - 1);
  const upperStart = startBase + maxUpperDev;
  const upperEnd = endBase + maxUpperDev;
  const lowerStart = startBase - maxLowerDev;
  const lowerEnd = endBase - maxLowerDev;

  const avgPrice = sumY / m || 1;
  const slopePercentPerBar = (slope / avgPrice) * 100;
  const direction: 'UP' | 'DOWN' | 'SIDEWAYS' =
    slopePercentPerBar > 0.04 ? 'UP' : slopePercentPerBar < -0.04 ? 'DOWN' : 'SIDEWAYS';

  const lastClose = slice[m - 1].close;
  const chanWidth = upperEnd - lowerEnd;
  const positionRatio =
    chanWidth > 0 ? Math.min(1, Math.max(0, (lastClose - lowerEnd) / chanWidth)) : 0.5;

  const summary =
    direction === 'UP'
      ? `Channel tren naik (slope +${slopePercentPerBar.toFixed(2)}%/bar); harga di posisi ${(positionRatio * 100).toFixed(0)}% kanal.`
      : direction === 'DOWN'
      ? `Channel tren turun (slope ${slopePercentPerBar.toFixed(2)}%/bar); harga di posisi ${(positionRatio * 100).toFixed(0)}% kanal.`
      : `Channel mendatar (sideways); batas bawah ${formatNum(lowerEnd)} – atas ${formatNum(upperEnd)}.`;

  return {
    direction,
    slopePercentPerBar,
    upperStart,
    upperEnd,
    lowerStart,
    lowerEnd,
    startIndex,
    endIndex,
    positionRatio,
    summary,
  };
}

function detectDivergence(
  pivots: { highs: PivotPoint[]; lows: PivotPoint[] },
  indicator: (number | null)[]
): 'BULLISH' | 'BEARISH' | 'NONE' {
  if (pivots.lows.length >= 2) {
    const l1 = pivots.lows[pivots.lows.length - 2];
    const l2 = pivots.lows[pivots.lows.length - 1];
    const ind1 = indicator[l1.index];
    const ind2 = indicator[l2.index];
    if (
      ind1 !== null &&
      ind2 !== null &&
      l2.index - l1.index >= 4 &&
      l2.price < l1.price * 0.998 &&
      ind2 > ind1 + 1.5
    ) {
      return 'BULLISH';
    }
  }
  if (pivots.highs.length >= 2) {
    const h1 = pivots.highs[pivots.highs.length - 2];
    const h2 = pivots.highs[pivots.highs.length - 1];
    const ind1 = indicator[h1.index];
    const ind2 = indicator[h2.index];
    if (
      ind1 !== null &&
      ind2 !== null &&
      h2.index - h1.index >= 4 &&
      h2.price > h1.price * 1.002 &&
      ind2 < ind1 - 1.5
    ) {
      return 'BEARISH';
    }
  }
  return 'NONE';
}

export function computeAdvancedTechnicalAnalysis(
  candles: Candle[],
  series: IndicatorSeries,
  swingLevels: SwingLevel[]
): AdvancedTechnicalAnalysis {
  const n = candles.length;
  const lastIdx = n - 1;
  const lastCandle = candles[lastIdx];
  const price = lastCandle.close;

  const pivots = extractPivots(candles, 3);
  const supportLevels = swingLevels
    .filter((s) => s.type === 'SSL')
    .map((s) => s.price)
    .slice(0, 3);
  const resistanceLevels = swingLevels
    .filter((s) => s.type === 'BSL')
    .map((s) => s.price)
    .slice(0, 3);

  const trendlineChannel = computeTrendlineChannel(candles);
  const candlestickPatterns = detectCandlestickPatterns(candles);
  const chartPatterns = detectChartPatterns(candles, pivots);

  // Moving Average Cross (EMA 20 vs EMA 50, or SMA 50 vs SMA 200)
  const ema20Now = series.ema20[lastIdx];
  const ema50Now = series.ema50[lastIdx];
  const ema200Now = series.ema200[lastIdx];
  const ema20Prev = lastIdx > 0 ? series.ema20[lastIdx - 1] : null;
  const ema50Prev = lastIdx > 0 ? series.ema50[lastIdx - 1] : null;

  let goldenCross = false;
  let deathCross = false;
  if (ema20Now !== null && ema50Now !== null && ema20Prev !== null && ema50Prev !== null) {
    goldenCross = ema20Prev <= ema50Prev && ema20Now > ema50Now;
    deathCross = ema20Prev >= ema50Prev && ema20Now < ema50Now;
  }
  const sma50Now = series.sma50[lastIdx];
  const sma200Now = series.sma200[lastIdx];
  const sma50Prev = lastIdx > 0 ? series.sma50[lastIdx - 1] : null;
  const sma200Prev = lastIdx > 0 ? series.sma200[lastIdx - 1] : null;
  if (sma50Now !== null && sma200Now !== null && sma50Prev !== null && sma200Prev !== null) {
    if (sma50Prev <= sma200Prev && sma50Now > sma200Now) goldenCross = true;
    if (sma50Prev >= sma200Prev && sma50Now < sma200Now) deathCross = true;
  }

  let ema2050200Status = 'Transisi / Silang EMA 20/50/200';
  if (ema20Now !== null && ema50Now !== null && ema200Now !== null) {
    if (price > ema20Now && ema20Now > ema50Now && ema50Now > ema200Now) {
      ema2050200Status = 'Penyelarasan Penuh Bullish (Harga > EMA20 > EMA50 > EMA200)';
    } else if (price < ema20Now && ema20Now < ema50Now && ema50Now < ema200Now) {
      ema2050200Status = 'Penyelarasan Penuh Bearish (Harga < EMA20 < EMA50 < EMA200)';
    } else if (ema20Now > ema50Now) {
      ema2050200Status = 'EMA 20 di atas EMA 50 (tren menengah positif)';
    } else {
      ema2050200Status = 'EMA 20 di bawah EMA 50 (tren menengah tertekan)';
    }
  } else if (ema20Now !== null && ema50Now !== null) {
    ema2050200Status =
      ema20Now > ema50Now
        ? 'EMA 20 di atas EMA 50 (Golden bias menengah)'
        : 'EMA 20 di bawah EMA 50 (Death bias menengah)';
  }

  const rsiDivergence = detectDivergence(pivots, series.rsi14);
  const macdDivergence = detectDivergence(pivots, series.macdLine);

  // Ichimoku Cloud status
  const tenkan = series.ichimokuTenkan[lastIdx];
  const kijun = series.ichimokuKijun[lastIdx];
  const spanA = series.ichimokuSpanA[lastIdx];
  const spanB = series.ichimokuSpanB[lastIdx];
  let cloudStatus: 'ABOVE_CLOUD' | 'BELOW_CLOUD' | 'IN_CLOUD' = 'IN_CLOUD';
  if (spanA !== null && spanB !== null) {
    const cloudTop = Math.max(spanA, spanB);
    const cloudBot = Math.min(spanA, spanB);
    if (price > cloudTop) cloudStatus = 'ABOVE_CLOUD';
    else if (price < cloudBot) cloudStatus = 'BELOW_CLOUD';
  }

  // ADX + DI
  const adxFull = calculateADX(candles, 14);
  const adx14 = adxFull.adx[lastIdx];
  const plusDi = adxFull.plusDi[lastIdx];
  const minusDi = adxFull.minusDi[lastIdx];
  const trendStrengthLabel =
    adx14 === null
      ? 'Belum cukup data'
      : adx14 >= 25
      ? `Tren Kuat (ADX ${adx14.toFixed(1)})`
      : adx14 >= 20
      ? `Tren Sedang (ADX ${adx14.toFixed(1)})`
      : `Tren Lemah / Sideways (ADX ${adx14.toFixed(1)})`;

  // Momentum Extra
  const stochK = series.stochK[lastIdx];
  const stochD = series.stochD[lastIdx];
  const cci20 = series.cci20[lastIdx];
  const williamsR14 = series.williamsR14[lastIdx];

  // Bollinger Squeeze
  const bbu = series.bbUpper[lastIdx];
  const bbm = series.bbMiddle[lastIdx];
  const bbl = series.bbLower[lastIdx];
  const bandwidthPct =
    bbu !== null && bbl !== null && bbm !== null && bbm > 0
      ? ((bbu - bbl) / bbm) * 100
      : 0;
  let bwSum = 0;
  let bwCount = 0;
  for (let i = Math.max(0, lastIdx - 40); i <= lastIdx; i++) {
    const u = series.bbUpper[i];
    const m = series.bbMiddle[i];
    const l = series.bbLower[i];
    if (u !== null && m !== null && l !== null && m > 0) {
      bwSum += ((u - l) / m) * 100;
      bwCount += 1;
    }
  }
  const avgBw = bwCount > 0 ? bwSum / bwCount : bandwidthPct;
  const isSqueeze = bandwidthPct > 0 && avgBw > 0 && bandwidthPct < avgBw * 0.72;

  // OBV Trend & VWAP
  const obvNow = series.obv[lastIdx];
  const obvPrev = series.obv[Math.max(0, lastIdx - 10)];
  let obvTrend: 'UP' | 'DOWN' | 'FLAT' = 'FLAT';
  if (obvNow !== null && obvPrev !== null) {
    if (obvNow > obvPrev * 1.005 || (obvPrev < 0 && obvNow > obvPrev)) obvTrend = 'UP';
    else if (obvNow < obvPrev * 0.995 || (obvPrev > 0 && obvNow < obvPrev)) obvTrend = 'DOWN';
  }
  const vwap = series.vwap[lastIdx];
  const priceVsVwapPct = vwap && vwap > 0 ? ((price - vwap) / vwap) * 100 : 0;

  // Fibonacci Retracement & Extension over recent 60 closed candles
  const fibSlice = candles.slice(Math.max(0, n - 60));
  let highIdx = 0;
  let lowIdx = 0;
  for (let i = 1; i < fibSlice.length; i++) {
    if (fibSlice[i].high > fibSlice[highIdx].high) highIdx = i;
    if (fibSlice[i].low < fibSlice[lowIdx].low) lowIdx = i;
  }
  const swingHigh = fibSlice[highIdx].high;
  const swingLow = fibSlice[lowIdx].low;
  const fibSpan = Math.max(1e-9, swingHigh - swingLow);
  const direction: 'UPTREND' | 'DOWNTREND' = lowIdx <= highIdx ? 'UPTREND' : 'DOWNTREND';

  const ret382 =
    direction === 'UPTREND' ? swingHigh - fibSpan * 0.382 : swingLow + fibSpan * 0.382;
  const ret500 =
    direction === 'UPTREND' ? swingHigh - fibSpan * 0.5 : swingLow + fibSpan * 0.5;
  const ret618 =
    direction === 'UPTREND' ? swingHigh - fibSpan * 0.618 : swingLow + fibSpan * 0.618;
  const ext1272 =
    direction === 'UPTREND' ? swingLow + fibSpan * 1.272 : swingHigh - fibSpan * 1.272;
  const ext1618 =
    direction === 'UPTREND' ? swingLow + fibSpan * 1.618 : swingHigh - fibSpan * 1.618;

  const fibZoneLow = Math.min(ret382, ret618);
  const fibZoneHigh = Math.max(ret382, ret618);
  const activeZoneNote =
    price >= fibZoneLow && price <= fibZoneHigh
      ? `Harga berada di Golden Zone Retracement (38.2%–61.8%: ${formatNum(fibZoneLow)}–${formatNum(fibZoneHigh)}).`
      : direction === 'UPTREND'
      ? `Area koreksi ideal 38.2%–61.8% di ${formatNum(ret618)}–${formatNum(ret382)}; target Ext 1.618 di ${formatNum(ext1618)}.`
      : `Area pantulan ideal 38.2%–61.8% di ${formatNum(ret382)}–${formatNum(ret618)}; target Ext 1.618 di ${formatNum(ext1618)}.`;

  // Classic Pivot Points using prior closed session / last 24h block (or prior candle fallback)
  const pivotWindow = candles.slice(Math.max(0, n - 25), Math.max(1, n - 1));
  const prevHigh = Math.max(...pivotWindow.map((c) => c.high));
  const prevLow = Math.min(...pivotWindow.map((c) => c.low));
  const prevClose = pivotWindow[pivotWindow.length - 1].close;
  const pp = (prevHigh + prevLow + prevClose) / 3;
  const r1 = 2 * pp - prevLow;
  const s1 = 2 * pp - prevHigh;
  const r2 = pp + (prevHigh - prevLow);
  const s2 = pp - (prevHigh - prevLow);

  // Dow Theory, Elliott Wave Phase & Price Action
  let dowStructure: 'UPTREND_HH_HL' | 'DOWNTREND_LH_LL' | 'KONSOLIDASI' = 'KONSOLIDASI';
  if (pivots.highs.length >= 2 && pivots.lows.length >= 2) {
    const hh = pivots.highs[pivots.highs.length - 1].price > pivots.highs[pivots.highs.length - 2].price;
    const hl = pivots.lows[pivots.lows.length - 1].price > pivots.lows[pivots.lows.length - 2].price;
    const lh = pivots.highs[pivots.highs.length - 1].price < pivots.highs[pivots.highs.length - 2].price;
    const ll = pivots.lows[pivots.lows.length - 1].price < pivots.lows[pivots.lows.length - 2].price;
    if (hh && hl) dowStructure = 'UPTREND_HH_HL';
    else if (lh && ll) dowStructure = 'DOWNTREND_LH_LL';
  }

  let elliottWavePhase = 'Fase Korektif / Transisi (Gelombang A-B-C)';
  if (dowStructure === 'UPTREND_HH_HL') {
    elliottWavePhase =
      price > ret382
        ? 'Struktur Impulsif Naik (Gelombang 3 / 5)'
        : 'Fase Pullback Impulsif (Koreksi Gelombang 2 / 4 menuju Fibo)';
  } else if (dowStructure === 'DOWNTREND_LH_LL') {
    elliottWavePhase =
      price < ret382
        ? 'Struktur Impulsif Turun (Gelombang 3 / C Turun)'
        : 'Fase Rebound Korektif (Gelombang 2 / 4 Bearish)';
  }

  const nearestRes = resistanceLevels[0];
  const nearestSup = supportLevels[0];
  let priceActionNote =
    dowStructure === 'UPTREND_HH_HL'
      ? 'Price action mempertahankan Higher High & Higher Low.'
      : dowStructure === 'DOWNTREND_LH_LL'
      ? 'Price action membentuk Lower High & Lower Low.'
      : 'Price action bergerak dalam rentang konsolidasi menunggu breakout.';

  if (nearestRes && lastCandle.close > nearestRes && candles[Math.max(0, n - 2)].close <= nearestRes) {
    priceActionNote = `Breakout bersih menembus resistance ${formatNum(nearestRes)} pada penutupan candle.`;
  } else if (nearestSup && lastCandle.close < nearestSup && candles[Math.max(0, n - 2)].close >= nearestSup) {
    priceActionNote = `Breakdown menembus support ${formatNum(nearestSup)} pada penutupan candle.`;
  } else if (nearestSup && Math.abs(lastCandle.low - nearestSup) / nearestSup < 0.004 && lastCandle.close > nearestSup) {
    priceActionNote = `Retest support ${formatNum(nearestSup)} terkonfirmasi pantulan penutupan candle.`;
  }

  return {
    supportLevels,
    resistanceLevels,
    trendlineChannel,
    candlestickPatterns,
    chartPatterns,
    maCross: {
      goldenCross,
      deathCross,
      ema2050200Status,
    },
    divergences: {
      rsiDivergence,
      macdDivergence,
    },
    ichimoku: {
      tenkan,
      kijun,
      spanA,
      spanB,
      cloudStatus,
    },
    adx: {
      adx14,
      plusDi,
      minusDi,
      trendStrengthLabel,
    },
    momentumOscillators: {
      stochK,
      stochD,
      cci20,
      williamsR14,
    },
    bollingerSqueeze: {
      isSqueeze,
      bandwidthPct,
    },
    volumeAnalysis: {
      obvTrend,
      vwap,
      priceVsVwapPct,
    },
    fibonacci: {
      direction,
      swingHigh,
      swingLow,
      ret382,
      ret500,
      ret618,
      ext1272,
      ext1618,
      activeZoneNote,
    },
    pivotPoints: {
      pp,
      r1,
      r2,
      s1,
      s2,
    },
    cycleAndPriceAction: {
      dowStructure,
      elliottWavePhase,
      priceActionNote,
    },
  };
}
