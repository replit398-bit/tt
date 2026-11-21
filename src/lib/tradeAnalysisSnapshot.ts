import type {
  Candle,
  ExitTriggerType,
  MarketAnalysisResult,
  ReversalStatus,
  SimulatedTrade,
  TradeEntryAnalysisSnapshot,
  TradeExitAnalysisSnapshot,
  TradeReversalMonitor,
  TradeTechnicalSnapshot,
} from '../types/market';

function lastVal(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (v !== null && Number.isFinite(v)) return Number(v.toFixed(4));
  }
  return null;
}

function fmtNum(val: number | null, digits = 2): string {
  if (val === null || !Number.isFinite(val)) return 'N/A';
  return val.toFixed(digits);
}

function fmtPriceCompact(val: number): string {
  if (!Number.isFinite(val)) return '0';
  if (Math.abs(val) >= 1000) return val.toFixed(2);
  if (Math.abs(val) >= 1) return val.toFixed(4);
  return val.toFixed(6);
}

export function formatDurationId(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '< 1 dtk';
  const totalSec = Math.round(durationMs / 1000);
  if (totalSec < 60) return `${totalSec} dtk`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) return secs > 0 ? `${mins} mnt ${secs} dtk` : `${mins} mnt`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours} jam ${remMins} mnt` : `${hours} jam`;
}

export function buildTradeTechnicalSnapshot(
  analysis: MarketAnalysisResult,
  capturedAt = Date.now(),
  overridePrice?: number
): TradeTechnicalSnapshot {
  const price =
    overridePrice && Number.isFinite(overridePrice) && overridePrice > 0
      ? overridePrice
      : analysis.currentPrice;

  return {
    capturedAt,
    price,
    verdict: analysis.verdict,
    verdictLabel: analysis.verdictLabel,
    confidencePercent: analysis.confidencePercent,
    bullishScore: analysis.bullishScore,
    bearishScore: analysis.bearishScore,
    rsi14: lastVal(analysis.series.rsi14),
    ema20: lastVal(analysis.series.ema20),
    ema50: lastVal(analysis.series.ema50),
    ema200: lastVal(analysis.series.ema200),
    macdHist: lastVal(analysis.series.macdHist),
    adx14: analysis.advanced.adx.adx14,
    atr14: Number(analysis.executionPlan.atr14.toFixed(6)),
    stochK: analysis.advanced.momentumOscillators.stochK,
    cci20: analysis.advanced.momentumOscillators.cci20,
    williamsR14: analysis.advanced.momentumOscillators.williamsR14,
    bbBandwidthPct: Number(analysis.advanced.bollingerSqueeze.bandwidthPct.toFixed(2)),
    bbSqueeze: analysis.advanced.bollingerSqueeze.isSqueeze,
    ichimokuCloud: analysis.advanced.ichimoku.cloudStatus,
    obvTrend: analysis.advanced.volumeAnalysis.obvTrend,
    vwap: analysis.advanced.volumeAnalysis.vwap,
    priceVsVwapPct: Number(analysis.advanced.volumeAnalysis.priceVsVwapPct.toFixed(2)),
    imbalanceRatio: Number(analysis.liquidityMetrics.imbalanceRatio.toFixed(3)),
    orderbookBias: analysis.liquidityMetrics.bias,
    dowStructure: analysis.advanced.cycleAndPriceAction.dowStructure,
    elliottWavePhase: analysis.advanced.cycleAndPriceAction.elliottWavePhase,
    candlestickPatterns: analysis.advanced.candlestickPatterns.map((p) => p.name),
    chartPatterns: analysis.advanced.chartPatterns.map((p) => p.name),
    supportLevels: analysis.advanced.supportLevels.slice(0, 3),
    resistanceLevels: analysis.advanced.resistanceLevels.slice(0, 3),
    fibonacciZone: analysis.advanced.fibonacci.activeZoneNote,
    pivotPp: analysis.advanced.pivotPoints.pp,
    pivotS1: analysis.advanced.pivotPoints.s1,
    pivotR1: analysis.advanced.pivotPoints.r1,
    volumeRatio20: Number(analysis.volumeRatio20.toFixed(2)),
  };
}

export function buildTradeEntryAnalysisSnapshot(params: {
  analysis: MarketAnalysisResult;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  executedAt: number;
}): TradeEntryAnalysisSnapshot {
  const { analysis, side, entryPrice, stopLoss, takeProfit, executedAt } = params;
  const snapshot = buildTradeTechnicalSnapshot(analysis, executedAt, entryPrice);
  const desiredBias = side === 'LONG' ? 'bullish' : 'bearish';
  const oppositeBias = side === 'LONG' ? 'bearish' : 'bullish';

  const supportingReasons = analysis.factors
    .filter((f) => f.bias === desiredBias)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4)
    .map((f) => `${f.name} (${f.valueText}): ${f.explanation}`);

  if (supportingReasons.length === 0) {
    supportingReasons.push(
      `Skor komposit ${side === 'LONG' ? 'Bullish' : 'Bearish'} (${snapshot.bullishScore} vs ${snapshot.bearishScore}) dengan struktur ${snapshot.dowStructure}.`
    );
  }

  const cautionRisks = analysis.factors
    .filter((f) => f.bias === oppositeBias)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((f) => `Sinyal berlawanan dari ${f.name} (${f.valueText})`);

  if (snapshot.adx14 !== null && snapshot.adx14 < 20) {
    cautionRisks.push(`ADX(14) di ${fmtNum(snapshot.adx14, 1)} (< 20): kekuatan tren masih lemah/sideways.`);
  }
  if (side === 'LONG' && snapshot.rsi14 !== null && snapshot.rsi14 >= 68) {
    cautionRisks.push(`RSI(14) sudah tinggi (${fmtNum(snapshot.rsi14, 1)}), rawan koreksi jangka pendek.`);
  }
  if (side === 'SHORT' && snapshot.rsi14 !== null && snapshot.rsi14 <= 32) {
    cautionRisks.push(`RSI(14) sudah rendah (${fmtNum(snapshot.rsi14, 1)}), rawan technical rebound.`);
  }
  if (analysis.executionPlan.bias === 'NEUTRAL') {
    cautionRisks.push('Verdict dasar adalah WAIT/Netral; entry mengambil arah lean skor indikator.');
  }

  const tpDistPct = Math.abs(((takeProfit - entryPrice) / entryPrice) * 100);
  const predictionSummary =
    `Prediksi ${side} pada ${analysis.timeframe} (${snapshot.verdictLabel}, keyakinan ${snapshot.confidencePercent}%). ` +
    `Skor Bullish ${snapshot.bullishScore} vs Bearish ${snapshot.bearishScore}. ` +
    `Target TP ${fmtPriceCompact(takeProfit)} (${side === 'LONG' ? '+' : '-'}${tpDistPct.toFixed(2)}%) ` +
    `dan batas risiko SL ${fmtPriceCompact(stopLoss)} dengan rasio 1:1 berbasis ATR ${fmtPriceCompact(snapshot.atr14)}.`;

  return {
    snapshot,
    predictionSummary,
    supportingReasons,
    cautionRisks,
    invalidationNote: analysis.executionPlan.invalidationNote,
  };
}

export function analyzeRunningTradeReversal(params: {
  trade: SimulatedTrade;
  analysis: MarketAnalysisResult;
  livePrice: number;
  evaluatedAt?: number;
}): TradeReversalMonitor {
  const { trade, analysis, livePrice, evaluatedAt = Date.now() } = params;
  const isLong = trade.side === 'LONG';
  const oppositeBias = isLong ? 'bearish' : 'bullish';
  const signals: string[] = [];
  let score = 0;

  const lastIdx = analysis.series.ema9.length - 1;
  const prevIdx = Math.max(0, lastIdx - 1);
  const ema9 = lastIdx >= 0 ? analysis.series.ema9[lastIdx] : null;
  const ema21 = lastIdx >= 0 ? analysis.series.ema21[lastIdx] : null;
  const rsi14 = lastIdx >= 0 ? analysis.series.rsi14[lastIdx] : null;
  const macdHist = lastIdx >= 0 ? analysis.series.macdHist[lastIdx] : null;
  const prevMacdHist = prevIdx >= 0 ? analysis.series.macdHist[prevIdx] : null;

  const oppositeScore = isLong ? analysis.bearishScore : analysis.bullishScore;
  const sameScore = isLong ? analysis.bullishScore : analysis.bearishScore;

  // 1. Directional score shift against active position
  if (oppositeScore > sameScore + 5 && oppositeScore >= 40) {
    score += oppositeScore >= 68 ? 32 : oppositeScore >= 54 ? 24 : 18;
    signals.push(
      `Tekanan arah berbalik ${isLong ? 'Bearish' : 'Bullish'} (${oppositeScore}% vs ${sameScore}%)`
    );
  }
  if (
    (isLong && (analysis.verdict === 'SELL' || analysis.verdict === 'STRONG_SELL')) ||
    (!isLong && (analysis.verdict === 'BUY' || analysis.verdict === 'STRONG_BUY'))
  ) {
    score += 18;
    signals.push(`Verdict teknikal berbalik menjadi ${analysis.verdictLabel}`);
  }

  // 2. RSI / MACD Divergences
  const rsiDiv = analysis.advanced.divergences.rsiDivergence;
  const macdDiv = analysis.advanced.divergences.macdDivergence;
  if (
    (isLong && (rsiDiv === 'BEARISH' || macdDiv === 'BEARISH')) ||
    (!isLong && (rsiDiv === 'BULLISH' || macdDiv === 'BULLISH'))
  ) {
    score += 22;
    const divTypes = [
      rsiDiv !== 'NONE' ? `RSI ${rsiDiv}` : null,
      macdDiv !== 'NONE' ? `MACD ${macdDiv}` : null,
    ]
      .filter(Boolean)
      .join(' & ');
    signals.push(`Divergensi pembalikan terdeteksi (${divTypes})`);
  }

  // 3. Candlestick & Chart Reversal Patterns
  const oppPatterns = [
    ...analysis.advanced.candlestickPatterns,
    ...analysis.advanced.chartPatterns,
  ].filter((p) => p.bias === oppositeBias);
  if (oppPatterns.length > 0) {
    score += 18;
    signals.push(`Pola pembalikan: ${oppPatterns.map((p) => p.name).slice(0, 2).join(', ')}`);
  }

  // 4. EMA 9/21 Ribbon / MA Cross Flip
  const emaFlip =
    ema9 !== null &&
    ema21 !== null &&
    ((isLong && ema9 < ema21 && livePrice < ema21) ||
      (!isLong && ema9 > ema21 && livePrice > ema21));
  const maCrossFlip = isLong ? analysis.advanced.maCross.deathCross : analysis.advanced.maCross.goldenCross;
  if (emaFlip || maCrossFlip) {
    score += 16;
    signals.push(
      maCrossFlip
        ? `Terjadi ${isLong ? 'Death Cross' : 'Golden Cross'} MA terhadap arah ${trade.side}`
        : `Harga (${fmtPriceCompact(livePrice)}) & EMA9 memotong berlawanan dari EMA21`
    );
  }

  // 5. MACD Histogram Flip & RSI Exhaustion Turn
  const macdOppMomentum =
    macdHist !== null &&
    ((isLong && macdHist < 0 && (prevMacdHist === null || prevMacdHist >= 0 || macdHist < prevMacdHist || emaFlip || oppositeScore > sameScore)) ||
      (!isLong && macdHist > 0 && (prevMacdHist === null || prevMacdHist <= 0 || macdHist > prevMacdHist || emaFlip || oppositeScore > sameScore)));
  const rsiTurn =
    rsi14 !== null && ((isLong && rsi14 >= 72) || (!isLong && rsi14 <= 28));
  if (macdOppMomentum || rsiTurn) {
    score += 14;
    if (macdOppMomentum) {
      signals.push(`Momentum MACD histogram berbalik ${isLong ? 'negatif' : 'positif'} (${fmtNum(macdHist, 4)})`);
    }
    if (rsiTurn) {
      signals.push(
        `RSI(14) di area ekstrem ${rsi14!.toFixed(1)} (${isLong ? 'jenuh beli / rawan turun' : 'jenuh jual / rawan pantul'})`
      );
    }
  }

  // 6. Orderbook Imbalance Flip / Liquidity Sweep / Dow Flip
  const obFlip =
    (isLong && analysis.liquidityMetrics.bias === 'ASK_DOMINANT' && analysis.liquidityMetrics.imbalanceRatio <= 0.44) ||
    (!isLong && analysis.liquidityMetrics.bias === 'BID_DOMINANT' && analysis.liquidityMetrics.imbalanceRatio >= 0.56);
  const sweepOpp =
    (isLong && analysis.recentSweep?.type === 'BSL_SWEEP') ||
    (!isLong && analysis.recentSweep?.type === 'SSL_SWEEP');
  if (obFlip || sweepOpp) {
    score += 14;
    if (obFlip) {
      signals.push(
        `Orderbook bergeser ${analysis.liquidityMetrics.bias} (Bid ${(analysis.liquidityMetrics.imbalanceRatio * 100).toFixed(1)}%)`
      );
    }
    if (sweepOpp && analysis.recentSweep) {
      signals.push(`Sapuan likuiditas berlawanan: ${analysis.recentSweep.type}`);
    }
  }

  const reversalScore = Math.min(100, Math.round(score));
  const riskDist = Math.abs(trade.entryPrice - trade.stopLoss);
  const pnlR =
    riskDist > 1e-12
      ? (isLong ? livePrice - trade.entryPrice : trade.entryPrice - livePrice) / riskDist
      : 0;

  const hasStrongReversal =
    (reversalScore >= 55 && signals.length >= 2) || oppositeScore > 70;
  const shouldAutoTakeProfit = hasStrongReversal && pnlR >= 0.08;

  const status: ReversalStatus = shouldAutoTakeProfit
    ? 'TAKE_PROFIT_REVERSAL'
    : hasStrongReversal || reversalScore >= 40
      ? 'WASPADA_PEMBALIKAN'
      : 'AMAN';

  const summary = shouldAutoTakeProfit
    ? `Tanda pembalikan tren kuat (${reversalScore}%) saat posisi profit (+${pnlR.toFixed(2)}R) — langsung Take Profit di ${fmtPriceCompact(livePrice)}.`
    : status === 'WASPADA_PEMBALIKAN'
      ? `Terdeteksi ${signals.length} indikasi awal pelemahan/pembalikan tren (skor ${reversalScore}%). Memantau ketat untuk penguncian profit.`
      : `Tren masih mendukung posisi ${trade.side} (${sameScore}% vs ${oppositeScore}% berlawanan, skor pembalikan ${reversalScore}%).`;

  return {
    checkedAt: evaluatedAt,
    livePrice,
    bullishScore: analysis.bullishScore,
    bearishScore: analysis.bearishScore,
    reversalScore,
    status,
    shouldAutoTakeProfit,
    signals,
    summary,
  };
}

export function buildTradeExitAnalysisSnapshot(params: {
  trade: SimulatedTrade;
  outcome: 'WIN' | 'LOSS';
  exitPrice: number;
  closedAt: number;
  triggerType: ExitTriggerType;
  exitAnalysisResult?: MarketAnalysisResult | null;
  triggeringCandle?: Candle | null;
  reversalMonitor?: TradeReversalMonitor | null;
  pnlR?: number;
  pnlUsd?: number;
}): TradeExitAnalysisSnapshot {
  const {
    trade,
    outcome,
    exitPrice,
    closedAt,
    triggerType,
    exitAnalysisResult,
    triggeringCandle,
    reversalMonitor,
    pnlR,
    pnlUsd,
  } = params;

  const durationMs = Math.max(0, closedAt - trade.executedAt);
  const durationText = formatDurationId(durationMs);
  const priceChangePct =
    trade.entryPrice > 0
      ? Number((((exitPrice - trade.entryPrice) / trade.entryPrice) * 100).toFixed(2))
      : 0;
  const favorableMovePct = trade.side === 'LONG' ? priceChangePct : -priceChangePct;
  const resolvedPnlR = pnlR !== undefined ? pnlR : outcome === 'WIN' ? trade.rewardToRisk || 1 : -1;
  const resolvedPnlUsd =
    pnlUsd !== undefined ? pnlUsd : outcome === 'WIN' ? Number((trade.riskUsd * (trade.rewardToRisk || 1)).toFixed(2)) : -trade.riskUsd;

  const entrySnap = trade.entryAnalysis?.snapshot ?? null;
  const exitTechnical = exitAnalysisResult
    ? buildTradeTechnicalSnapshot(exitAnalysisResult, closedAt, exitPrice)
    : null;

  const reasons: string[] = [];
  const triggerText =
    triggerType === 'EARLY_TP_REVERSAL'
      ? 'deteksi otomatis tanda-tanda pembalikan tren saat posisi sedang profit'
      : triggerType === 'MANUAL_CLOSE'
        ? 'eksekusi Take Profit / tutup posisi manual pada harga live Binance'
        : triggerType === 'HIT_TP_LIVE'
          ? 'harga live real-time Binance menyentuh Take Profit'
          : triggerType === 'HIT_SL_LIVE'
            ? 'harga live real-time Binance menyentuh Stop Loss'
            : triggerType === 'HIT_TP_CANDLE'
              ? 'pergerakan high/low candle berikutnya menembus Take Profit'
              : 'pergerakan high/low candle berikutnya menyentuh Stop Loss';

  if (triggerType === 'EARLY_TP_REVERSAL') {
    reasons.push(
      `Auto Take Profit Pembalikan Tren (+${resolvedPnlR.toFixed(2)}R / +$${resolvedPnlUsd.toFixed(2)}) dieksekusi di ${fmtPriceCompact(exitPrice)} (${favorableMovePct >= 0 ? '+' : ''}${favorableMovePct.toFixed(2)}% dalam ${durationText}) karena ${triggerText}.`
    );
    if (reversalMonitor && reversalMonitor.signals.length > 0) {
      for (const sig of reversalMonitor.signals) {
        reasons.push(`Sinyal Pembalikan: ${sig}`);
      }
    }
    const responseTitle = `TAKE PROFIT PEMBALIKAN TREN (+$${resolvedPnlUsd.toFixed(2)} / +${resolvedPnlR.toFixed(2)}R)`;
    const responseSummary =
      `Posisi ${trade.side} pada ${trade.symbol} (${trade.timeframe}) langsung Take Profit di ${fmtPriceCompact(exitPrice)} karena sistem mendeteksi tanda pembalikan tren (skor ${reversalMonitor?.reversalScore ?? 0}%).`;
    const lessonLearned =
      `Mengunci profit lebih awal saat muncul divergensi/pola pembalikan menjaga saldo akun TF tetap bertumbuh sebelum profit tergerus menuju Stop Loss.`;

    return {
      evaluatedAt: closedAt,
      triggerType,
      outcome,
      durationMs,
      priceChangePct,
      exitTechnical,
      responseTitle,
      responseSummary,
      reasons,
      lessonLearned,
    };
  }

  if (triggerType === 'MANUAL_CLOSE') {
    const isWin = outcome === 'WIN';
    reasons.push(
      `Posisi ditutup manual di ${fmtPriceCompact(exitPrice)} (${favorableMovePct >= 0 ? '+' : ''}${favorableMovePct.toFixed(2)}% dalam ${durationText}, ${resolvedPnlR >= 0 ? '+' : ''}${resolvedPnlR.toFixed(2)}R / ${resolvedPnlUsd >= 0 ? '+' : '-'}$${Math.abs(resolvedPnlUsd).toFixed(2)}).`
    );
    if (reversalMonitor && reversalMonitor.signals.length > 0) {
      reasons.push(`Catatan monitor tren saat tutup: ${reversalMonitor.signals.slice(0, 3).join('; ')}.`);
    }
    return {
      evaluatedAt: closedAt,
      triggerType,
      outcome,
      durationMs,
      priceChangePct,
      exitTechnical,
      responseTitle: isWin
        ? `TAKE PROFIT MANUAL (+$${resolvedPnlUsd.toFixed(2)} / +${resolvedPnlR.toFixed(2)}R)`
        : `TUTUP MANUAL (-$${Math.abs(resolvedPnlUsd).toFixed(2)} / ${resolvedPnlR.toFixed(2)}R)`,
      responseSummary: `Trader menutup posisi ${trade.side} pada ${trade.symbol} (${trade.timeframe}) di harga live ${fmtPriceCompact(exitPrice)} setelah ${durationText}.`,
      reasons,
      lessonLearned: isWin
        ? 'Penguncian profit manual di harga live mengamankan kenaikan modal akun TF.'
        : 'Penutupan lebih awal membatasi risiko sebelum menyentuh Stop Loss penuh (-1.0R).',
    };
  }

  if (outcome === 'WIN') {
    reasons.push(
      `Target tercapai (+${resolvedPnlR.toFixed(2)}R / +$${resolvedPnlUsd.toFixed(2)}) karena ${triggerText} di level ${fmtPriceCompact(exitPrice)} (${favorableMovePct >= 0 ? '+' : ''}${favorableMovePct.toFixed(2)}% dalam ${durationText}).`
    );

    if (entrySnap) {
      const alignedStructure =
        (trade.side === 'LONG' && entrySnap.dowStructure === 'UPTREND_HH_HL') ||
        (trade.side === 'SHORT' && entrySnap.dowStructure === 'DOWNTREND_LH_LL');
      if (alignedStructure) {
        reasons.push(
          `Struktur tren Dow (${entrySnap.dowStructure}) dan arah ${trade.side} selaras sehingga momentum melanjutkan pergerakan menuju TP.`
        );
      }

      const alignedOb =
        (trade.side === 'LONG' && entrySnap.imbalanceRatio >= 0.54) ||
        (trade.side === 'SHORT' && entrySnap.imbalanceRatio <= 0.46);
      if (alignedOb) {
        reasons.push(
          `Tekanan orderbook saat entry (${entrySnap.orderbookBias}, Bid Imbalance ${(entrySnap.imbalanceRatio * 100).toFixed(1)}%) terbukti mendukung dorongan harga ke target.`
        );
      }

      if (entrySnap.candlestickPatterns.length > 0 || entrySnap.chartPatterns.length > 0) {
        const patterns = [...entrySnap.candlestickPatterns, ...entrySnap.chartPatterns].slice(0, 3);
        reasons.push(`Konfirmasi pola (${patterns.join(', ')}) tervalidasi dengan follow-through harga ke TP.`);
      }
    }

    if (exitTechnical && entrySnap) {
      const rsiDelta =
        exitTechnical.rsi14 !== null && entrySnap.rsi14 !== null
          ? exitTechnical.rsi14 - entrySnap.rsi14
          : null;
      if (rsiDelta !== null) {
        reasons.push(
          `Momentum RSI(14) bergerak dari ${fmtNum(entrySnap.rsi14, 1)} saat entry menjadi ${fmtNum(exitTechnical.rsi14, 1)} saat TP (${rsiDelta >= 0 ? '+' : ''}${rsiDelta.toFixed(1)} poin), mengonfirmasi dorongan ${trade.side}.`
        );
      }
      if (
        (trade.side === 'LONG' && exitTechnical.obvTrend === 'UP') ||
        (trade.side === 'SHORT' && exitTechnical.obvTrend === 'DOWN')
      ) {
        reasons.push(
          `Arus volume OBV (${exitTechnical.obvTrend}) tetap searah hingga penutupan TP.`
        );
      }
    } else if (triggeringCandle) {
      const rangePct =
        triggeringCandle.open > 0
          ? (((triggeringCandle.high - triggeringCandle.low) / triggeringCandle.open) * 100).toFixed(2)
          : '0.00';
      reasons.push(
        `Candle penentu memiliki rentang ${rangePct}% dengan penutupan di ${fmtPriceCompact(triggeringCandle.close)} yang menembus area target.`
      );
    }

    const responseTitle = `BERHASIL · Kena Take Profit (+$${resolvedPnlUsd.toFixed(2)} / +${resolvedPnlR.toFixed(2)}R)`;
    const responseSummary =
      `Prediksi ${trade.side} pada ${trade.symbol} (${trade.timeframe}) berhasil mencapai target TP ${fmtPriceCompact(trade.takeProfit)} dalam ${durationText}.`;
    const lessonLearned =
      entrySnap && entrySnap.adx14 !== null && entrySnap.adx14 >= 22
        ? `Setup searah tren kuat (ADX ${fmtNum(entrySnap.adx14, 1)}) dengan jarak ATR 1:1 memberi probabilitas follow-through yang solid.`
        : `Disiplin target 1:1 berbasis ATR memungkinkan profit dikunci tepat waktu sebelum volatilitas berbalik.`;

    return {
      evaluatedAt: closedAt,
      triggerType,
      outcome,
      durationMs,
      priceChangePct,
      exitTechnical,
      responseTitle,
      responseSummary,
      reasons,
      lessonLearned,
    };
  }

  // LOSS post-mortem reasoning
  reasons.push(
    `Stop Loss tersentuh (-1.0R / -$${trade.riskUsd.toFixed(2)}) karena ${triggerText} di level ${fmtPriceCompact(exitPrice)} (${favorableMovePct.toFixed(2)}% terhadap arah ${trade.side} dalam ${durationText}).`
  );

  if (entrySnap) {
    if (entrySnap.verdict === 'WAIT') {
      reasons.push(
        `Sinyal awal berada pada kondisi WAIT/Netral (skor ${entrySnap.bullishScore} vs ${entrySnap.bearishScore}); konfluensi arah belum cukup kuat sehingga mudah terkena whipsaw.`
      );
    }

    if (entrySnap.adx14 !== null && entrySnap.adx14 < 20) {
      reasons.push(
        `Saat entry ADX(14) lemah (${fmtNum(entrySnap.adx14, 1)} < 20, pasar konsolidasi/choppy), membuat breakout ${trade.side} gagal bertahan.`
      );
    }

    if (
      (trade.side === 'LONG' && entrySnap.dowStructure === 'DOWNTREND_LH_LL') ||
      (trade.side === 'SHORT' && entrySnap.dowStructure === 'UPTREND_HH_HL')
    ) {
      reasons.push(
        `Posisi melawan struktur tren utama Dow (${entrySnap.dowStructure}), sehingga tekanan tren dominan kembali menekan harga ke SL.`
      );
    }

    if (trade.side === 'LONG' && entrySnap.rsi14 !== null && entrySnap.rsi14 >= 65) {
      reasons.push(
        `Entry LONG dilakukan saat RSI(14) sudah tinggi (${fmtNum(entrySnap.rsi14, 1)}), memicu aksi profit-taking ke Stop Loss.`
      );
    } else if (trade.side === 'SHORT' && entrySnap.rsi14 !== null && entrySnap.rsi14 <= 35) {
      reasons.push(
        `Entry SHORT dilakukan saat RSI(14) sudah jenuh jual (${fmtNum(entrySnap.rsi14, 1)}), memicu pantulan balik ke Stop Loss.`
      );
    }

    if (
      (trade.side === 'LONG' && entrySnap.imbalanceRatio < 0.48) ||
      (trade.side === 'SHORT' && entrySnap.imbalanceRatio > 0.52)
    ) {
      reasons.push(
        `Orderbook saat entry kurang mendukung (${entrySnap.orderbookBias}, Bid Imbalance ${(entrySnap.imbalanceRatio * 100).toFixed(1)}%), sehingga suplai/permintaan berlawanan menyerap harga.`
      );
    }
  }

  if (exitTechnical && entrySnap) {
    if (exitTechnical.orderbookBias !== entrySnap.orderbookBias) {
      reasons.push(
        `Terjadi pergeseran dominasi orderbook dari ${entrySnap.orderbookBias} menjadi ${exitTechnical.orderbookBias} (Bid ${(exitTechnical.imbalanceRatio * 100).toFixed(1)}%) yang mendorong harga ke SL.`
      );
    }
    if (
      (trade.side === 'LONG' && exitTechnical.macdHist !== null && exitTechnical.macdHist < 0) ||
      (trade.side === 'SHORT' && exitTechnical.macdHist !== null && exitTechnical.macdHist > 0)
    ) {
      reasons.push(
        `Histogram MACD berbalik berlawanan (${fmtNum(exitTechnical.macdHist, 4)}) saat penutupan, mengonfirmasi hilangnya momentum ${trade.side}.`
      );
    }
  } else if (triggeringCandle) {
    const spikePct =
      triggeringCandle.open > 0
        ? (((triggeringCandle.high - triggeringCandle.low) / triggeringCandle.open) * 100).toFixed(2)
        : '0.00';
    reasons.push(
      `Terjadi lonjakan volatilitas candle (${spikePct}%) yang menyapu level SL sebelum harga sempat bergerak ke TP.`
    );
  }

  if (reasons.length === 1) {
    reasons.push(
      `Fluktuasi harga berlawanan jangka pendek menembus jarak Stop Loss 1R sebelum momentum ${trade.side} sempat terbentuk.`
    );
  }

  const responseTitle = `GAGAL · Kena Stop Loss (-$${trade.riskUsd.toFixed(2)} / -1.0R)`;
  const responseSummary =
    `Prediksi ${trade.side} pada ${trade.symbol} (${trade.timeframe}) gagal mencapai TP dan terhenti di SL ${fmtPriceCompact(trade.stopLoss)} setelah ${durationText}.`;
  const lessonLearned =
    entrySnap && entrySnap.verdict === 'WAIT'
      ? `Hindari atau kurangi eksposur saat verdict netral/ADX < 20; tunggu konfluensi tren & orderbook lebih selaras.`
      : `Stop Loss 1:1 bekerja membatasi kerugian tetap terukur (-5% saldo TF); evaluasi ulang arah struktur sebelum re-entry otomatis berikutnya.`;

  return {
    evaluatedAt: closedAt,
    triggerType,
    outcome,
    durationMs,
    priceChangePct,
    exitTechnical,
    responseTitle,
    responseSummary,
    reasons,
    lessonLearned,
  };
}
