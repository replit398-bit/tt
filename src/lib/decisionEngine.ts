import type {
  AllowedTimeframe,
  Candle,
  DecisionFactor,
  DecisionVerdict,
  ManualExecutionPlan,
  MarketAnalysisResult,
  MultiTimeframeRecommendation,
  OrderbookData,
  TimeframeAnalysisDigest,
  TimeframeRole,
} from '../types/market';
import {
  analyzeOrderbookLiquidity,
  computeAllIndicators,
  detectSwingLiquidity,
} from './indicators';
import { computeAdvancedTechnicalAnalysis } from './advancedAnalysis';
import { partitionClosedCandles } from './realtime';

export const MIN_ENTRY_MOMENTUM_PERCENT = 70;

export function evaluateEntrySignalFromScores(
  bullishPct: number,
  bearishPct: number
): {
  canEnter: boolean;
  side: 'LONG' | 'SHORT' | 'NEUTRAL';
  verdict: DecisionVerdict;
  verdictLabel: string;
} {
  if (bullishPct > MIN_ENTRY_MOMENTUM_PERCENT && bullishPct > bearishPct) {
    return {
      canEnter: true,
      side: 'LONG',
      verdict: bullishPct >= 82 ? 'STRONG_BUY' : 'BUY',
      verdictLabel:
        bullishPct >= 82 ? 'STRUKTUR BULLISH KUAT (>70%)' : 'MOMENTUM BULLISH >70%',
    };
  }
  if (bearishPct > MIN_ENTRY_MOMENTUM_PERCENT && bearishPct > bullishPct) {
    return {
      canEnter: true,
      side: 'SHORT',
      verdict: bearishPct >= 82 ? 'STRONG_SELL' : 'SELL',
      verdictLabel:
        bearishPct >= 82 ? 'STRUKTUR BEARISH KUAT (>70%)' : 'MOMENTUM BEARISH >70%',
    };
  }
  return {
    canEnter: false,
    side: 'NEUTRAL',
    verdict: 'WAIT',
    verdictLabel: 'TIDAK PERLU ENTRY (≤70%)',
  };
}

function formatPrice(val: number): string {
  if (val >= 1000) return val.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (val >= 1) return val.toFixed(4);
  return val.toFixed(6);
}

export function calculatePositionSizing(params: {
  capitalUsdt: number;
  riskPercent: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
}): {
  riskAmountUsdt: number;
  positionSizeCoins: number;
  positionValueUsdt: number;
  leverageEquivalent: number;
  potentialProfitUsdt: number;
  rewardToRisk: number;
  valid: boolean;
  error?: string;
} {
  const { capitalUsdt, riskPercent, entryPrice, stopLoss, takeProfit } = params;
  if (
    capitalUsdt <= 0 ||
    riskPercent <= 0 ||
    entryPrice <= 0 ||
    stopLoss <= 0 ||
    Math.abs(entryPrice - stopLoss) < 1e-12
  ) {
    return {
      riskAmountUsdt: 0,
      positionSizeCoins: 0,
      positionValueUsdt: 0,
      leverageEquivalent: 0,
      potentialProfitUsdt: 0,
      rewardToRisk: 0,
      valid: false,
      error: 'Pastikan modal, persentase risiko, harga entry, dan stop loss bernilai valid serta Entry != Stop Loss.',
    };
  }

  const riskPerCoin = Math.abs(entryPrice - stopLoss);
  const riskAmountUsdt = capitalUsdt * (riskPercent / 100);
  const positionSizeCoins = riskAmountUsdt / riskPerCoin;
  const positionValueUsdt = positionSizeCoins * entryPrice;
  const leverageEquivalent = positionValueUsdt / capitalUsdt;
  const rewardPerCoin = Math.abs(takeProfit - entryPrice);
  const potentialProfitUsdt = positionSizeCoins * rewardPerCoin;
  const rewardToRisk = riskPerCoin > 0 ? rewardPerCoin / riskPerCoin : 0;

  return {
    riskAmountUsdt,
    positionSizeCoins,
    positionValueUsdt,
    leverageEquivalent,
    potentialProfitUsdt,
    rewardToRisk,
    valid: true,
  };
}

export function analyzeMarketDecision(
  symbol: string,
  timeframe: string,
  candles: Candle[],
  orderbook: OrderbookData,
  nowMs = Date.now()
): MarketAnalysisResult {
  if (candles.length === 0) {
    throw new Error('Data candlestick kosong untuk analisis.');
  }

  // Strictly exclude the live forming candle so indicator readings wait for candle close
  const { closedCandles, lastClosedCandle, nextCandleCloseTime } = partitionClosedCandles(
    candles,
    nowMs,
    timeframe
  );
  const analysisCandles = closedCandles.length > 0 ? closedCandles : candles;

  const series = computeAllIndicators(analysisCandles);
  const lastIdx = analysisCandles.length - 1;
  const prevIdx = Math.max(0, lastIdx - 1);
  const currentCandle = analysisCandles[lastIdx];
  const currentPrice = currentCandle.close;

  const sma20 = series.sma20[lastIdx];
  const sma50 = series.sma50[lastIdx];
  const sma200 = series.sma200[lastIdx];
  const ema9 = series.ema9[lastIdx];
  const ema21 = series.ema21[lastIdx];
  const ema55 = series.ema55[lastIdx];
  const rsi14 = series.rsi14[lastIdx];
  const macdLine = series.macdLine[lastIdx];
  const macdSignal = series.macdSignal[lastIdx];
  const macdHist = series.macdHist[lastIdx];
  const prevMacdHist = series.macdHist[prevIdx];
  const bbUpper = series.bbUpper[lastIdx];
  const bbLower = series.bbLower[lastIdx];
  const atr14 = series.atr14[lastIdx] ?? currentPrice * 0.015;

  const liquidityMetrics = analyzeOrderbookLiquidity(orderbook.bids, orderbook.asks);
  const { swingLevels, recentSweep } = detectSwingLiquidity(analysisCandles);
  const advanced = computeAdvancedTechnicalAnalysis(analysisCandles, series, swingLevels);

  // Average volume 20 against the latest closed candle
  const completedIdx = analysisCandles.length - 1;
  const volSliceStart = Math.max(0, completedIdx - 20);
  const volSlice = analysisCandles.slice(volSliceStart, completedIdx);
  const avgVol20 =
    volSlice.reduce((acc, c) => acc + c.volume, 0) / Math.max(1, volSlice.length);
  const volumeCandle = analysisCandles[completedIdx];
  const volumeRatio20 = avgVol20 > 0 ? volumeCandle.volume / avgVol20 : 1;

  const factors: DecisionFactor[] = [];

  // 1. EMA Ribbon Short-Term (EMA 9 vs EMA 21 vs Price)
  if (ema9 !== null && ema21 !== null) {
    const bull = currentPrice > ema9 && ema9 > ema21;
    const bear = currentPrice < ema9 && ema9 < ema21;
    factors.push({
      id: 'ema-ribbon',
      name: 'EMA 9 / EMA 21 Trend',
      category: 'Trend',
      bias: bull ? 'bullish' : bear ? 'bearish' : 'neutral',
      weight: 18,
      valueText: `${formatPrice(ema9)} / ${formatPrice(ema21)}`,
      explanation: bull
        ? 'Harga berada di atas EMA 9 dan EMA 9 > EMA 21 (momentum naik terkonfirmasi).'
        : bear
        ? 'Harga berada di bawah EMA 9 dan EMA 9 < EMA 21 (tekanan turun aktif).'
        : 'EMA 9 dan EMA 21 saling bersilangan atau harga berkonsolidasi di tengah.',
    });
  }

  // 2. SMA Structural Trend (SMA 20 vs SMA 50)
  if (sma20 !== null && sma50 !== null) {
    const bull = sma20 > sma50 && currentPrice > sma20;
    const bear = sma20 < sma50 && currentPrice < sma20;
    factors.push({
      id: 'sma-structure',
      name: 'SMA 20 / SMA 50 Struktur',
      category: 'Trend',
      bias: bull ? 'bullish' : bear ? 'bearish' : 'neutral',
      weight: 16,
      valueText: `${formatPrice(sma20)} / ${formatPrice(sma50)}`,
      explanation: bull
        ? 'SMA 20 di atas SMA 50 menandakan struktur tren menengah yang sehat.'
        : bear
        ? 'SMA 20 di bawah SMA 50 menandakan struktur tren menengah bearish.'
        : 'Struktur SMA 20/50 berada dalam fase transisi atau sideways.',
    });
  }

  // 3. Macro Trend Filter (SMA 200)
  if (sma200 !== null) {
    const bull = currentPrice > sma200;
    factors.push({
      id: 'sma-200',
      name: 'SMA 200 Makro Filter',
      category: 'Trend',
      bias: bull ? 'bullish' : 'bearish',
      weight: 12,
      valueText: formatPrice(sma200),
      explanation: bull
        ? 'Harga diperdagangkan di atas SMA 200 (bias makro bullish).'
        : 'Harga diperdagangkan di bawah SMA 200 (bias makro bearish).',
    });
  } else if (ema55 !== null) {
    const bull = currentPrice > ema55;
    factors.push({
      id: 'ema-55',
      name: 'EMA 55 Menengah',
      category: 'Trend',
      bias: bull ? 'bullish' : 'bearish',
      weight: 12,
      valueText: formatPrice(ema55),
      explanation: bull
        ? 'Harga bertahan di atas EMA 55 sebagai support dinamis.'
        : 'Harga tertahan di bawah EMA 55 sebagai resistance dinamis.',
    });
  }

  // 4. RSI (14) Momentum
  if (rsi14 !== null) {
    let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let explanation = 'RSI berada di zona netral (45–55), menunggu dorongan arah.';
    if (rsi14 >= 55 && rsi14 <= 70) {
      bias = 'bullish';
      explanation = 'RSI menguat di zona momentum bullish sehat tanpa jenuh beli ekstrem.';
    } else if (rsi14 < 32) {
      bias = 'bullish';
      explanation = 'RSI memasuki area jenuh jual (oversold < 32), berpotensi terjadi technical rebound.';
    } else if (rsi14 > 72) {
      bias = 'bearish';
      explanation = 'RSI overbought (> 72), risiko koreksi jangka pendek meningkat.';
    } else if (rsi14 <= 45 && rsi14 >= 32) {
      bias = 'bearish';
      explanation = 'RSI melemah di bawah garis 45, momentum penjual mendominasi.';
    }
    factors.push({
      id: 'rsi-14',
      name: 'RSI (14) Momentum',
      category: 'Momentum',
      bias,
      weight: 14,
      valueText: rsi14.toFixed(1),
      explanation,
    });
  }

  // 5. MACD (12, 26, 9)
  if (macdLine !== null && macdSignal !== null && macdHist !== null) {
    const histRising = prevMacdHist !== null ? macdHist > prevMacdHist : macdHist > 0;
    const bull = macdLine > macdSignal && histRising;
    const bear = macdLine < macdSignal && !histRising;
    factors.push({
      id: 'macd',
      name: 'MACD (12,26,9)',
      category: 'Momentum',
      bias: bull ? 'bullish' : bear ? 'bearish' : 'neutral',
      weight: 12,
      valueText: `Hist ${macdHist >= 0 ? '+' : ''}${macdHist.toFixed(4)}`,
      explanation: bull
        ? 'Garis MACD di atas Signal dengan histogram mengembang positif.'
        : bear
        ? 'Garis MACD di bawah Signal dengan momentum histogram melemah.'
        : 'MACD dalam fase konsolidasi atau konvergensi menuju crossover.',
    });
  }

  // 6. Bollinger Bands Position
  if (bbUpper !== null && bbLower !== null) {
    const bandWidth = bbUpper - bbLower;
    const position = bandWidth > 0 ? (currentPrice - bbLower) / bandWidth : 0.5;
    let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let explanation = 'Harga bergerak stabil di area tengah Bollinger Bands.';
    if (position <= 0.2) {
      bias = 'bullish';
      explanation = 'Harga menyentuh Lower Band (diskon statistik / potensi pantulan mean-reversion).';
    } else if (position >= 0.85) {
      bias = 'bearish';
      explanation = 'Harga mendekati atau menembus Upper Band, rawan pullback menuju Middle Band.';
    }
    factors.push({
      id: 'bollinger',
      name: 'Bollinger Bands (20,2)',
      category: 'Volatilitas',
      bias,
      weight: 8,
      valueText: `${(position * 100).toFixed(0)}% Band`,
      explanation,
    });
  }

  // 7. Orderbook Liquidity Imbalance (±2% Depth)
  const imbPct = (liquidityMetrics.imbalanceRatio * 100).toFixed(1);
  factors.push({
    id: 'orderbook-liquidity',
    name: 'Likuiditas Orderbook (±2%)',
    category: 'Likuiditas',
    bias:
      liquidityMetrics.bias === 'BID_DOMINANT'
        ? 'bullish'
        : liquidityMetrics.bias === 'ASK_DOMINANT'
        ? 'bearish'
        : 'neutral',
    weight: 12,
    valueText: `Bid ${imbPct}%`,
    explanation:
      liquidityMetrics.bias === 'BID_DOMINANT'
        ? `Dinding beli (Bid) mendominasi ${imbPct}% dari likuiditas ±2%, menahan penurunan harga.`
        : liquidityMetrics.bias === 'ASK_DOMINANT'
        ? `Dinding jual (Ask) mendominasi ${(100 - liquidityMetrics.imbalanceRatio * 100).toFixed(1)}% orderbook, membatasi kenaikan.`
        : 'Kedalaman orderbook Bid dan Ask relatif seimbang di sekitar harga saat ini.',
  });

  // 8. Liquidity Sweep / Volume Confirmation
  if (recentSweep) {
    factors.push({
      id: 'liquidity-sweep',
      name: 'Sapuan Likuiditas (Sweep)',
      category: 'Likuiditas',
      bias: recentSweep.type === 'SSL_SWEEP' ? 'bullish' : 'bearish',
      weight: 8,
      valueText: recentSweep.type === 'SSL_SWEEP' ? 'SSL Sweep' : 'BSL Sweep',
      explanation: recentSweep.description,
    });
  } else {
    factors.push({
      id: 'volume-spike',
      name: 'Partisipasi Volume',
      category: 'Volume',
      bias:
        volumeRatio20 >= 1.35
          ? currentCandle.close >= currentCandle.open
            ? 'bullish'
            : 'bearish'
          : 'neutral',
      weight: 6,
      valueText: `${volumeRatio20.toFixed(2)}x Avg20`,
      explanation:
        volumeRatio20 >= 1.35
          ? `Volume penutupan candle ${volumeRatio20.toFixed(2)}x lebih tinggi dari rata-rata 20 candle, mengonfirmasi tekanan ${currentCandle.close >= currentCandle.open ? 'beli' : 'jual'}.`
          : 'Volume transaksi berada pada rata-rata normal tanpa anomali likuiditas.',
    });
  }

  // 9. EMA 20 / 50 / 200 & Golden/Death Cross
  const ema20Val = series.ema20[lastIdx];
  const ema50Val = series.ema50[lastIdx];
  if (ema20Val !== null && ema50Val !== null) {
    const bull = advanced.maCross.goldenCross || (currentPrice > ema20Val && ema20Val > ema50Val);
    const bear = advanced.maCross.deathCross || (currentPrice < ema20Val && ema20Val < ema50Val);
    factors.push({
      id: 'ema-20-50-200',
      name: 'EMA 20 / 50 / 200 & Cross',
      category: 'Trend',
      bias: bull ? 'bullish' : bear ? 'bearish' : 'neutral',
      weight: 10,
      valueText: advanced.maCross.goldenCross
        ? 'Golden Cross'
        : advanced.maCross.deathCross
        ? 'Death Cross'
        : ema20Val > ema50Val
        ? 'EMA20 > EMA50'
        : 'EMA20 < EMA50',
      explanation: advanced.maCross.ema2050200Status,
    });
  }

  // 10. ADX (14) Trend Strength + DI
  if (advanced.adx.adx14 !== null && advanced.adx.plusDi !== null && advanced.adx.minusDi !== null) {
    const strongTrend = advanced.adx.adx14 >= 25;
    const diBull = advanced.adx.plusDi > advanced.adx.minusDi;
    factors.push({
      id: 'adx-14',
      name: 'ADX (14) Kekuatan Tren',
      category: 'Trend',
      bias: strongTrend ? (diBull ? 'bullish' : 'bearish') : 'neutral',
      weight: 8,
      valueText: `ADX ${advanced.adx.adx14.toFixed(1)}`,
      explanation: `${advanced.adx.trendStrengthLabel} (+DI ${advanced.adx.plusDi.toFixed(1)} vs -DI ${advanced.adx.minusDi.toFixed(1)}).`,
    });
  }

  // 11. Ichimoku Cloud
  if (advanced.ichimoku.spanA !== null && advanced.ichimoku.spanB !== null) {
    const bull = advanced.ichimoku.cloudStatus === 'ABOVE_CLOUD';
    const bear = advanced.ichimoku.cloudStatus === 'BELOW_CLOUD';
    factors.push({
      id: 'ichimoku-cloud',
      name: 'Ichimoku Cloud (Kumo)',
      category: 'Trend',
      bias: bull ? 'bullish' : bear ? 'bearish' : 'neutral',
      weight: 9,
      valueText: bull ? 'Di Atas Cloud' : bear ? 'Di Bawah Cloud' : 'Di Dalam Cloud',
      explanation: bull
        ? 'Harga berada di atas awan Kumo (tren & support dinamis bullish).'
        : bear
        ? 'Harga berada di bawah awan Kumo (tren & resistance dinamis bearish).'
        : 'Harga bergerak di dalam awan Ichimoku (zona transisi / konsolidasi).',
    });
  }

  // 12. Trendline & Channel + Dow / Elliott / Price Action
  const paBull = advanced.cycleAndPriceAction.dowStructure === 'UPTREND_HH_HL';
  const paBear = advanced.cycleAndPriceAction.dowStructure === 'DOWNTREND_LH_LL';
  factors.push({
    id: 'price-action-dow',
    name: 'Price Action, Channel & Teori Dow',
    category: 'Pola & Price Action',
    bias: paBull ? 'bullish' : paBear ? 'bearish' : 'neutral',
    weight: 10,
    valueText:
      paBull ? 'HH / HL' : paBear ? 'LH / LL' : 'Sideways',
    explanation: `${advanced.cycleAndPriceAction.priceActionNote} ${advanced.trendlineChannel.summary}`,
  });

  // 13. Pola Candlestick & Pola Grafik
  const combinedPatterns = [
    ...advanced.candlestickPatterns,
    ...advanced.chartPatterns,
  ];
  const patBull = combinedPatterns.filter((p) => p.bias === 'bullish').length;
  const patBear = combinedPatterns.filter((p) => p.bias === 'bearish').length;
  factors.push({
    id: 'candlestick-chart-patterns',
    name: 'Pola Candlestick & Grafik',
    category: 'Pola & Price Action',
    bias: patBull > patBear ? 'bullish' : patBear > patBull ? 'bearish' : 'neutral',
    weight: combinedPatterns.length > 0 ? 8 : 2,
    valueText:
      combinedPatterns.length > 0
        ? combinedPatterns.slice(0, 2).map((p) => p.name).join(' · ')
        : 'Tidak ada pola ekstrem',
    explanation:
      combinedPatterns.length > 0
        ? combinedPatterns.map((p) => `${p.name}: ${p.description}`).slice(0, 2).join(' ')
        : 'Tidak ada pola candlestick pembalikan atau pola grafik mayor yang terbentuk pada candle close terbaru.',
  });

  // 14. Stochastic, CCI & Williams %R + Divergensi
  const { stochK, cci20, williamsR14 } = advanced.momentumOscillators;
  if (stochK !== null && cci20 !== null && williamsR14 !== null) {
    const bullDiv =
      advanced.divergences.rsiDivergence === 'BULLISH' ||
      advanced.divergences.macdDivergence === 'BULLISH';
    const bearDiv =
      advanced.divergences.rsiDivergence === 'BEARISH' ||
      advanced.divergences.macdDivergence === 'BEARISH';
    const oversoldCount =
      (stochK < 25 ? 1 : 0) + (cci20 < -100 ? 1 : 0) + (williamsR14 < -80 ? 1 : 0);
    const overboughtCount =
      (stochK > 80 ? 1 : 0) + (cci20 > 100 ? 1 : 0) + (williamsR14 > -20 ? 1 : 0);
    const oscBias: 'bullish' | 'bearish' | 'neutral' = bullDiv
      ? 'bullish'
      : bearDiv
      ? 'bearish'
      : oversoldCount >= 2
      ? 'bullish'
      : overboughtCount >= 2
      ? 'bearish'
      : 'neutral';
    factors.push({
      id: 'stoch-cci-wr',
      name: 'Stochastic / CCI / Williams %R',
      category: 'Momentum',
      bias: oscBias,
      weight: 7,
      valueText: `Stoch ${stochK.toFixed(0)} · CCI ${cci20.toFixed(0)}`,
      explanation: `${
        bullDiv
          ? 'Terdeteksi Bullish Divergence pada RSI/MACD. '
          : bearDiv
          ? 'Terdeteksi Bearish Divergence pada RSI/MACD. '
          : ''
      }Stoch %K ${stochK.toFixed(1)}, CCI ${cci20.toFixed(0)}, Williams %R ${williamsR14.toFixed(1)}.`,
    });
  }

  // 15. OBV & VWAP Volume Flow
  const vwapVal = advanced.volumeAnalysis.vwap;
  if (vwapVal !== null) {
    const aboveVwap = currentPrice > vwapVal;
    const obvUp = advanced.volumeAnalysis.obvTrend === 'UP';
    const obvDown = advanced.volumeAnalysis.obvTrend === 'DOWN';
    factors.push({
      id: 'obv-vwap',
      name: 'OBV & VWAP',
      category: 'Volume',
      bias:
        aboveVwap && obvUp
          ? 'bullish'
          : !aboveVwap && obvDown
          ? 'bearish'
          : 'neutral',
      weight: 8,
      valueText: `VWAP ${formatPrice(vwapVal)} (${advanced.volumeAnalysis.priceVsVwapPct >= 0 ? '+' : ''}${advanced.volumeAnalysis.priceVsVwapPct.toFixed(2)}%)`,
      explanation: `Harga ${aboveVwap ? 'di atas' : 'di bawah'} VWAP harian, dengan tren akumulasi OBV ${
        obvUp ? 'menguat (akumulasi)' : obvDown ? 'melemah (distribusi)' : 'mendatar'
      }.`,
    });
  }

  // 16. Fibonacci Retracement & Pivot Points
  const { pp, r1, s1 } = advanced.pivotPoints;
  factors.push({
    id: 'fibonacci-pivot',
    name: 'Fibonacci & Pivot Points',
    category: 'Fibonacci & Pivot',
    bias:
      currentPrice > pp && currentPrice < r1
        ? 'bullish'
        : currentPrice < pp && currentPrice > s1
        ? 'bearish'
        : 'neutral',
    weight: 6,
    valueText: `PP ${formatPrice(pp)} · 61.8% ${formatPrice(advanced.fibonacci.ret618)}`,
    explanation: `${advanced.fibonacci.activeZoneNote} Pivot harian PP ${formatPrice(pp)} (S1 ${formatPrice(s1)} / R1 ${formatPrice(r1)}).`,
  });

  // Score calculation
  let totalWeight = 0;
  let bullishScore = 0;
  let bearishScore = 0;
  for (const f of factors) {
    totalWeight += f.weight;
    if (f.bias === 'bullish') bullishScore += f.weight;
    if (f.bias === 'bearish') bearishScore += f.weight;
  }

  const netScore = totalWeight > 0 ? ((bullishScore - bearishScore) / totalWeight) * 100 : 0;
  const bullishPct = Math.round((bullishScore / Math.max(1, totalWeight)) * 100);
  const bearishPct = Math.round((bearishScore / Math.max(1, totalWeight)) * 100);

  const signalDecision = evaluateEntrySignalFromScores(bullishPct, bearishPct);
  const verdict: DecisionVerdict = signalDecision.verdict;
  const verdictLabel = signalDecision.verdictLabel;

  const confidencePercent = Math.min(
    96,
    Math.max(40, Math.round(50 + Math.abs(netScore) * 0.48))
  );

  const executionPlan = buildExecutionPlanForBias({
    bias: signalDecision.side,
    currentPrice,
    ema21,
    atr14,
    nearestBidWall: liquidityMetrics.topBidWalls[0]?.price,
    nearestAskWall: liquidityMetrics.topAskWalls[0]?.price,
    nearestSsl: swingLevels.find((s) => s.type === 'SSL')?.price,
    nearestBsl: swingLevels.find((s) => s.type === 'BSL')?.price,
  });

  const bullCount = factors.filter((f) => f.bias === 'bullish').length;
  const bearCount = factors.filter((f) => f.bias === 'bearish').length;

  const summary =
    verdict === 'STRONG_BUY' || verdict === 'BUY'
      ? `Momentum Bullish ${symbol} (${timeframe}) mencapai ${bullishPct}% (>70%) dengan ${bullCount}/${factors.length} indikator selaras naik. Area entry LONG berada di ${formatPrice(executionPlan.entryLow)} – ${formatPrice(executionPlan.entryHigh)} dengan batas risiko ${formatPrice(executionPlan.stopLoss)} (R:R 1:1).`
      : verdict === 'STRONG_SELL' || verdict === 'SELL'
      ? `Momentum Bearish ${symbol} (${timeframe}) mencapai ${bearishPct}% (>70%) dengan ${bearCount}/${factors.length} indikator negatif. Area pantauan SHORT berada di ${formatPrice(executionPlan.entryLow)} – ${formatPrice(executionPlan.entryHigh)} dengan SL ${formatPrice(executionPlan.stopLoss)} (R:R 1:1).`
      : `Tekanan Bullish (${bullishPct}%) dan Bearish (${bearishPct}%) pada ${symbol} (${timeframe}) masih ≤ 70% — tidak perlu entry dulu. Tunggu penutupan candle dengan momentum Bullish atau Bearish > 70%.`;

  return {
    symbol,
    timeframe,
    isClosedCandleBasis: true,
    analyzedCandleOpenTime: (lastClosedCandle ?? currentCandle).openTime,
    analyzedCandleCloseTime: (lastClosedCandle ?? currentCandle).closeTime,
    nextCandleCloseTime,
    currentPrice,
    verdict,
    verdictLabel,
    confidencePercent,
    bullishScore: bullishPct,
    bearishScore: bearishPct,
    summary,
    factors,
    executionPlan,
    liquidityMetrics,
    swingLevels,
    recentSweep,
    volumeRatio20,
    series,
    advanced,
  };
}

export function buildExecutionPlanForBias(params: {
  bias: 'LONG' | 'SHORT' | 'NEUTRAL';
  currentPrice: number;
  ema21: number | null;
  atr14: number;
  nearestBidWall?: number;
  nearestAskWall?: number;
  nearestSsl?: number;
  nearestBsl?: number;
}): ManualExecutionPlan {
  const {
    bias,
    currentPrice,
    ema21,
    atr14,
    nearestBidWall,
    nearestAskWall,
    nearestSsl,
    nearestBsl,
  } = params;

  if (bias === 'LONG') {
    const entryLow = Math.max(
      currentPrice - atr14 * 0.45,
      ema21 ? Math.min(currentPrice, ema21) : currentPrice * 0.992
    );
    const entryHigh = currentPrice * 1.0015;
    const optimalEntry = Number(((entryLow + entryHigh) / 2).toFixed(6));

    const atrSl = optimalEntry - atr14 * 1.65;
    const structuralFloor = nearestSsl ?? nearestBidWall ?? atrSl;
    const stopLossRaw =
      structuralFloor < optimalEntry * 0.995 && structuralFloor > optimalEntry * 0.9
        ? Math.min(atrSl, structuralFloor * 0.997)
        : atrSl;
    const minSlDist = Math.min(atr14 * 0.8, optimalEntry * 0.15);
    const stopLoss = Math.max(optimalEntry * 0.5, Math.min(stopLossRaw, optimalEntry - minSlDist));

    const riskDist = Math.max(optimalEntry - stopLoss, 1e-8);
    const tp1 = optimalEntry + riskDist * 1.0;
    const tp2 =
      nearestBsl && nearestBsl > tp1
        ? Math.max(nearestBsl, optimalEntry + riskDist * 1.5)
        : optimalEntry + riskDist * 1.5;
    const tp3 = Math.max(tp2 + riskDist * 0.5, optimalEntry + riskDist * 2.0);

    return {
      bias: 'LONG',
      entryLow,
      entryHigh,
      optimalEntry,
      stopLoss,
      takeProfit1: tp1,
      takeProfit2: tp2,
      takeProfit3: tp3,
      riskPercentToSl: ((optimalEntry - stopLoss) / optimalEntry) * 100,
      rewardToRiskTp1: 1.0,
      rewardToRiskTp2: Number(((tp2 - optimalEntry) / riskDist).toFixed(2)),
      atr14,
      invalidationNote: `Setup LONG batal jika candle ditutup di bawah ${formatPrice(stopLoss)} atau dinding Bid di orderbook menghilang. Target TP1 menggunakan rasio Risk:Reward 1:1.`,
    };
  }

  if (bias === 'SHORT') {
    const entryLow = currentPrice * 0.9985;
    const entryHigh = Math.min(
      currentPrice + atr14 * 0.45,
      ema21 ? Math.max(currentPrice, ema21) : currentPrice * 1.008
    );
    const optimalEntry = Number(((entryLow + entryHigh) / 2).toFixed(6));

    const atrSl = optimalEntry + atr14 * 1.65;
    const structuralCeil = nearestBsl ?? nearestAskWall ?? atrSl;
    const stopLossRaw =
      structuralCeil > optimalEntry * 1.005 && structuralCeil < optimalEntry * 1.1
        ? Math.max(atrSl, structuralCeil * 1.003)
        : atrSl;
    const minSlDist = Math.min(atr14 * 0.8, optimalEntry * 0.12);
    const stopLoss = Math.min(optimalEntry * 1.2, Math.max(stopLossRaw, optimalEntry + minSlDist));

    const riskDist = Math.max(stopLoss - optimalEntry, 1e-8);
    // Exact 1:1 Risk:Reward for TP1 (always >= 0.80 * optimalEntry)
    const tp1 = optimalEntry - riskDist * 1.0;
    const tp2Linear = optimalEntry - riskDist * 1.5;
    const tp2Floor = optimalEntry * 0.35;
    const tp2Baseline = tp2Linear >= tp2Floor ? tp2Linear : Math.max(tp2Floor, tp1 * 0.85);
    const tp2 =
      nearestSsl && nearestSsl < tp1 && nearestSsl > tp2Floor
        ? Math.min(nearestSsl, tp2Baseline)
        : tp2Baseline;
    const tp3 = Math.max(
      optimalEntry * 0.25,
      Math.min(tp2 * 0.9, optimalEntry - riskDist * 2.0)
    );

    return {
      bias: 'SHORT',
      entryLow,
      entryHigh,
      optimalEntry,
      stopLoss,
      takeProfit1: tp1,
      takeProfit2: tp2,
      takeProfit3: tp3,
      riskPercentToSl: ((stopLoss - optimalEntry) / optimalEntry) * 100,
      rewardToRiskTp1: 1.0,
      rewardToRiskTp2: Number(((optimalEntry - tp2) / riskDist).toFixed(2)),
      atr14,
      invalidationNote: `Setup SHORT batal jika harga menembus dan bertahan di atas ${formatPrice(stopLoss)}. Target TP1 menggunakan rasio Risk:Reward 1:1.`,
    };
  }

  const minSlDist = Math.min(atr14 * 1.25, currentPrice * 0.15);
  const stopLoss = currentPrice - minSlDist;
  const riskDist = Math.max(currentPrice - stopLoss, 1e-8);
  const tp1 = currentPrice + riskDist * 1.0;
  const tp2 = currentPrice + riskDist * 1.5;
  const tp3 = currentPrice + riskDist * 2.0;

  return {
    bias: 'NEUTRAL',
    entryLow: currentPrice - atr14 * 0.6,
    entryHigh: currentPrice + atr14 * 0.6,
    optimalEntry: currentPrice,
    stopLoss,
    takeProfit1: tp1,
    takeProfit2: tp2,
    takeProfit3: tp3,
    riskPercentToSl: ((currentPrice - stopLoss) / currentPrice) * 100,
    rewardToRiskTp1: 1.0,
    rewardToRiskTp2: 1.5,
    atr14,
    invalidationNote:
      'Sinyal TF analisis masih bercampur (konfluensi rendah). Disarankan menunggu konfirmasi penembusan level likuiditas atau keselarasan 1h & 30m sebelum entry manual (R:R 1:1).',
  };
}

export const ALLOWED_TIMEFRAMES: AllowedTimeframe[] = ['1m', '5m', '15m', '30m', '1h', '1d', '1w'];
export const ANALYSIS_TIMEFRAMES: AllowedTimeframe[] = ['30m', '1h', '1d', '1w'];
export const ENTRY_TIMEFRAMES: ('15m' | '5m' | '1m')[] = ['15m', '5m', '1m'];

export function getTimeframeRole(tf: AllowedTimeframe): TimeframeRole {
  return tf === '30m' || tf === '1h' || tf === '1d' || tf === '1w' ? 'ANALYSIS' : 'ENTRY';
}

export function computeMultiTimeframeRecommendation(
  symbol: string,
  analysesByTf: Record<AllowedTimeframe, MarketAnalysisResult>
): MultiTimeframeRecommendation {
  const digests: TimeframeAnalysisDigest[] = ALLOWED_TIMEFRAMES.map((tf) => {
    const a = analysesByTf[tf];
    const lastIdx = a.series.rsi14.length - 1;
    return {
      timeframe: tf,
      role: getTimeframeRole(tf),
      verdict: a.verdict,
      movementLabel: a.verdictLabel,
      bias: a.executionPlan.bias,
      confidencePercent: a.confidencePercent,
      rsi14: lastIdx >= 0 ? a.series.rsi14[lastIdx] : null,
      entryLow: a.executionPlan.entryLow,
      entryHigh: a.executionPlan.entryHigh,
      optimalEntry: a.executionPlan.optimalEntry,
      stopLoss: a.executionPlan.stopLoss,
      takeProfit1: a.executionPlan.takeProfit1,
      rewardToRiskTp1: a.executionPlan.rewardToRiskTp1,
      closedCandleOpenTime: a.analyzedCandleOpenTime,
      closedCandleCloseTime: a.analyzedCandleCloseTime,
      nextCandleCloseTime: a.nextCandleCloseTime,
    };
  });

  // 1. Directional Analysis strictly from 30m, 1h, 1d & 1w closed candles
  const tf30mBias = analysesByTf['30m'].executionPlan.bias;
  const tf1hBias = analysesByTf['1h'].executionPlan.bias;
  const tf1dBias = analysesByTf['1d'].executionPlan.bias;
  const tf1wBias = analysesByTf['1w'].executionPlan.bias;

  const analysisWeights: { tf: AllowedTimeframe; bias: 'LONG' | 'SHORT' | 'NEUTRAL'; w: number }[] = [
    { tf: '30m', bias: tf30mBias, w: 1.2 },
    { tf: '1h', bias: tf1hBias, w: 1.5 },
    { tf: '1d', bias: tf1dBias, w: 2.0 },
    { tf: '1w', bias: tf1wBias, w: 2.0 },
  ];

  let netDirectionScore = 0;
  let longTfs: AllowedTimeframe[] = [];
  let shortTfs: AllowedTimeframe[] = [];
  for (const item of analysisWeights) {
    if (item.bias === 'LONG') {
      netDirectionScore += item.w;
      longTfs.push(item.tf);
    } else if (item.bias === 'SHORT') {
      netDirectionScore -= item.w;
      shortTfs.push(item.tf);
    }
  }

  let combinedBias: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
  let analysisBiasSummary = '';

  if (netDirectionScore >= 1.5) {
    combinedBias = 'LONG';
    analysisBiasSummary =
      longTfs.length === 4
        ? 'Keempat TF analisis (30m, 1h, 1d, 1w) selaras BULLISH (LONG).'
        : `Bias analisis condong BULLISH (${longTfs.join(', ')} LONG${
            shortTfs.length > 0 ? `; ${shortTfs.join(', ')} SHORT` : ''
          }).`;
  } else if (netDirectionScore <= -1.5) {
    combinedBias = 'SHORT';
    analysisBiasSummary =
      shortTfs.length === 4
        ? 'Keempat TF analisis (30m, 1h, 1d, 1w) selaras BEARISH (SHORT).'
        : `Bias analisis condong BEARISH (${shortTfs.join(', ')} SHORT${
            longTfs.length > 0 ? `; ${longTfs.join(', ')} LONG` : ''
          }).`;
  } else if (longTfs.length > 0 && shortTfs.length > 0) {
    combinedBias = 'NEUTRAL';
    analysisBiasSummary = `TF analisis terbelah antara makro/swing dan intraday (LONG: ${longTfs.join(
      ', '
    )} vs SHORT: ${shortTfs.join(', ')}) — tunggu konfirmasi keselarasan.`;
  } else {
    combinedBias = 'NEUTRAL';
    analysisBiasSummary = 'TF analisis (30m, 1h, 1d, 1w) masih netral / konsolidasi.';
  }

  // 2. Entry Chart Selection strictly from 15m, 5m & 1m
  const entryDigests = digests.filter(
    (d): d is TimeframeAnalysisDigest & { timeframe: '1m' | '5m' | '15m' } =>
      d.timeframe === '15m' || d.timeframe === '5m' || d.timeframe === '1m'
  );

  const scoreEntryDigest = (d: TimeframeAnalysisDigest): number => {
    let score = d.confidencePercent;
    if (combinedBias !== 'NEUTRAL') {
      if (d.bias === combinedBias) score += 30;
      else if (d.bias === 'NEUTRAL') score += 6;
      else score -= 18;
    } else if (d.bias === 'NEUTRAL') {
      score -= 10;
    }

    // 15m & 5m provide cleaner intraday entry structure while 1m offers tighter scalp trigger
    if (d.timeframe === '15m') score += 8;
    else if (d.timeframe === '5m') score += 6;

    if (d.rsi14 !== null) {
      const evalBias = combinedBias !== 'NEUTRAL' ? combinedBias : d.bias;
      if (evalBias === 'LONG') {
        if (d.rsi14 > 70) score -= 14;
        else if (d.rsi14 >= 38 && d.rsi14 <= 64) score += 10;
      } else if (evalBias === 'SHORT') {
        if (d.rsi14 < 30) score -= 14;
        else if (d.rsi14 >= 36 && d.rsi14 <= 62) score += 10;
      }
    }
    return score;
  };

  let bestEntry = entryDigests[entryDigests.length - 1]; // default 15m
  let bestScore = -Infinity;
  for (const d of entryDigests) {
    const s = scoreEntryDigest(d);
    if (s > bestScore) {
      bestScore = s;
      bestEntry = d;
    }
  }

  // Ensure the entry zone on the chosen 1m/5m/15m chart aligns with the 30m/1h/1d/1w analysis bias and strict 1:1 R:R
  const entryAnalysis = analysesByTf[bestEntry.timeframe];
  const lastIdx = entryAnalysis.series.ema21.length - 1;
  const entryEma21 = lastIdx >= 0 ? entryAnalysis.series.ema21[lastIdx] : null;
  const alignedEntryPlan =
    entryAnalysis.executionPlan.bias === combinedBias
      ? entryAnalysis.executionPlan
      : buildExecutionPlanForBias({
          bias: combinedBias,
          currentPrice: entryAnalysis.currentPrice,
          ema21: entryEma21,
          atr14: entryAnalysis.executionPlan.atr14,
          nearestBidWall: entryAnalysis.liquidityMetrics.topBidWalls[0]?.price,
          nearestAskWall: entryAnalysis.liquidityMetrics.topAskWalls[0]?.price,
          nearestSsl: entryAnalysis.swingLevels.find((s) => s.type === 'SSL')?.price,
          nearestBsl: entryAnalysis.swingLevels.find((s) => s.type === 'BSL')?.price,
        });

  const recommendedMovementLabel =
    combinedBias === 'LONG'
      ? entryAnalysis.executionPlan.bias === 'LONG'
        ? entryAnalysis.verdictLabel
        : 'BULLISH >70% (MENGIKUTI TF ANALISIS)'
      : combinedBias === 'SHORT'
      ? entryAnalysis.executionPlan.bias === 'SHORT'
        ? entryAnalysis.verdictLabel
        : 'BEARISH >70% (MENGIKUTI TF ANALISIS)'
      : 'TIDAK PERLU ENTRY (MOMENTUM ≤ 70%)';

  const alignmentSummary = analysisBiasSummary;

  const recommendationReason =
    combinedBias === 'NEUTRAL'
      ? `Belum ada kesepakatan momentum >70% pada TF 30m (${tf30mBias}), 1h (${tf1hBias}), 1d (${tf1dBias}), dan 1w (${tf1wBias}). Tidak perlu entry saat skor Bullish & Bearish ≤ 70% — pantau chart ${bestEntry.timeframe} sampai muncul momentum > 70% setelah candle close.`
      : `Analisis arah utama membaca candle close TF 30m (${tf30mBias}), 1h (${tf1hBias}), 1d (${tf1dBias}), dan 1w (${tf1wBias}), sedangkan presisi area entry menggunakan chart TF ${bestEntry.timeframe} (konfluensi ${bestEntry.confidencePercent}%). Saran area entry ${combinedBias} di ${formatPrice(alignedEntryPlan.entryLow)} – ${formatPrice(alignedEntryPlan.entryHigh)} (optimal ${formatPrice(alignedEntryPlan.optimalEntry)}), SL ${formatPrice(alignedEntryPlan.stopLoss)}, TP1 ${formatPrice(alignedEntryPlan.takeProfit1)} dengan rasio Risk:Reward 1:1.`;

  return {
    symbol,
    isClosedCandleBasis: true,
    analysisTimeframesBias: {
      tf30m: tf30mBias,
      tf1h: tf1hBias,
      tf1d: tf1dBias,
      tf1w: tf1wBias,
      combinedBias,
      summary: analysisBiasSummary,
    },
    recommendedTimeframe: bestEntry.timeframe,
    recommendedBias: combinedBias,
    recommendedMovementLabel,
    recommendedEntryLow: alignedEntryPlan.entryLow,
    recommendedEntryHigh: alignedEntryPlan.entryHigh,
    recommendedOptimalEntry: alignedEntryPlan.optimalEntry,
    recommendedStopLoss: alignedEntryPlan.stopLoss,
    recommendedTakeProfit1: alignedEntryPlan.takeProfit1,
    recommendedRiskReward: '1:1',
    alignmentSummary,
    recommendationReason,
    timeframes: digests,
  };
}
