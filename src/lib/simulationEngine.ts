import type {
  AllowedTimeframe,
  Candle,
  MarketAnalysisResult,
  MarketType,
  OrderbookData,
  SimulatedTrade,
  SimulatedTradeSource,
  SimulationOverallStats,
  SymbolWinrateStat,
  TimeframeWinrateStat,
} from '../types/market';
import {
  ALLOWED_TIMEFRAMES,
  MIN_ENTRY_MOMENTUM_PERCENT,
  analyzeMarketDecision,
  buildExecutionPlanForBias,
  getTimeframeRole,
} from './decisionEngine';
import {
  analyzeRunningTradeReversal,
  buildTradeEntryAnalysisSnapshot,
  buildTradeExitAnalysisSnapshot,
} from './tradeAnalysisSnapshot';

export const DEFAULT_SIMULATION_COINS = [
  'BTCUSDT',
  'NEARUSDT',
  'RENDERUSDT',
  'PUMPUSDT',
  'UNIUSDT',
] as const;

export function normalizeSimulationCoins(input?: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0) {
    return [...DEFAULT_SIMULATION_COINS];
  }
  const cleaned = Array.from(
    new Set(
      input
        .map((s) => String(s).toUpperCase().trim())
        .filter((s) => /^[A-Z0-9]{4,20}$/.test(s))
    )
  );
  return cleaned.length > 0 ? cleaned : [...DEFAULT_SIMULATION_COINS];
}

export const SIMULATION_CYCLE_MS = 30 * 60 * 1000;
export const DEFAULT_TF_STARTING_BALANCE_USD = 100;
export const DEFAULT_RISK_PERCENT_PER_TRADE = 5; // 5% of each (coin, TF) $100 account ($5.00 risk / $5.00 reward 1:1)
export const DEFAULT_COIN_STARTING_BALANCE_USD =
  DEFAULT_TF_STARTING_BALANCE_USD * ALLOWED_TIMEFRAMES.length; // $700 per coin across 7 TF accounts
export const DEFAULT_VIRTUAL_CAPITAL_USD = DEFAULT_COIN_STARTING_BALANCE_USD;

export function get30MinuteSlotTime(nowMs = Date.now()): number {
  return Math.floor(nowMs / SIMULATION_CYCLE_MS) * SIMULATION_CYCLE_MS;
}

export function getNext30MinuteBoundary(nowMs = Date.now()): number {
  return get30MinuteSlotTime(nowMs) + SIMULATION_CYCLE_MS;
}

export function getCoinTimeframeAccountBalance(
  trades: SimulatedTrade[],
  symbol: string,
  timeframe: AllowedTimeframe,
  startingBalanceUsd = DEFAULT_TF_STARTING_BALANCE_USD
): number {
  const closedPnl = trades
    .filter((t) => t.symbol === symbol && t.timeframe === timeframe && t.status !== 'OPEN')
    .reduce((acc, t) => acc + t.pnlUsd, 0);
  return Number(Math.max(0, startingBalanceUsd + closedPnl).toFixed(2));
}

export function getTimeframeAccountBalance(
  trades: SimulatedTrade[],
  timeframe: AllowedTimeframe,
  startingBalanceUsd = DEFAULT_TF_STARTING_BALANCE_USD,
  symbol?: string
): number {
  const closedPnl = trades
    .filter(
      (t) =>
        t.timeframe === timeframe &&
        t.status !== 'OPEN' &&
        (symbol ? t.symbol === symbol : true)
    )
    .reduce((acc, t) => acc + t.pnlUsd, 0);
  return Number(Math.max(0, startingBalanceUsd + closedPnl).toFixed(2));
}

export function computeTradeRiskUsd(
  tfBalanceUsd: number,
  riskPercent = DEFAULT_RISK_PERCENT_PER_TRADE
): number {
  if (!Number.isFinite(tfBalanceUsd) || tfBalanceUsd < 0.5) return 0;
  const raw = (tfBalanceUsd * riskPercent) / 100;
  return Number(Math.min(tfBalanceUsd, Math.max(0.5, raw)).toFixed(2));
}

export function resolveQualifiedTradeSide(analysis: MarketAnalysisResult): {
  side: 'LONG' | 'SHORT';
  verdictLabel: string;
} | null {
  if (
    analysis.bullishScore > MIN_ENTRY_MOMENTUM_PERCENT &&
    analysis.bullishScore > analysis.bearishScore
  ) {
    return { side: 'LONG', verdictLabel: analysis.verdictLabel };
  }
  if (
    analysis.bearishScore > MIN_ENTRY_MOMENTUM_PERCENT &&
    analysis.bearishScore > analysis.bullishScore
  ) {
    return { side: 'SHORT', verdictLabel: analysis.verdictLabel };
  }
  return null;
}

export function createSimulatedTradeFromAnalysis(params: {
  symbol: string;
  market: MarketType;
  timeframe: AllowedTimeframe;
  analysis: MarketAnalysisResult;
  sourceMode: SimulatedTradeSource;
  executedAt: number;
  cycleSlotTime: number;
  liveEntryPrice?: number | null;
  riskUsd?: number;
  idSuffix?: string;
}): SimulatedTrade | null {
  const {
    symbol,
    market,
    timeframe,
    analysis,
    sourceMode,
    executedAt,
    cycleSlotTime,
    liveEntryPrice,
    riskUsd = computeTradeRiskUsd(DEFAULT_TF_STARTING_BALANCE_USD),
    idSuffix,
  } = params;

  const qualified = resolveQualifiedTradeSide(analysis);
  if (!qualified) {
    return null;
  }
  const { side, verdictLabel } = qualified;
  const lastIdx = analysis.series.ema21.length - 1;
  const ema21 = lastIdx >= 0 ? analysis.series.ema21[lastIdx] : null;

  const hasLivePrice =
    liveEntryPrice !== null &&
    liveEntryPrice !== undefined &&
    Number.isFinite(liveEntryPrice) &&
    liveEntryPrice > 0;

  if (hasLivePrice) {
    // Live execution: enter right at real-time Binance price with 1:1 SL/TP anchored on ATR(14)
    const entryPrice = liveEntryPrice;
    const plan = buildExecutionPlanForBias({
      bias: side,
      currentPrice: entryPrice,
      ema21,
      atr14: analysis.executionPlan.atr14,
      nearestBidWall: analysis.liquidityMetrics.topBidWalls[0]?.price,
      nearestAskWall: analysis.liquidityMetrics.topAskWalls[0]?.price,
      nearestSsl: analysis.swingLevels.find((s) => s.type === 'SSL')?.price,
      nearestBsl: analysis.swingLevels.find((s) => s.type === 'BSL')?.price,
    });
    const rawRiskDist = Math.abs(plan.optimalEntry - plan.stopLoss);
    const minLiveDist = Math.max(entryPrice * 0.0012, analysis.executionPlan.atr14 * 0.85);
    const riskDist = Math.max(rawRiskDist, minLiveDist);
    const stopLoss =
      side === 'LONG' ? Math.max(entryPrice * 0.5, entryPrice - riskDist) : entryPrice + riskDist;
    const actualRiskDist = Math.abs(entryPrice - stopLoss);
    const takeProfit =
      side === 'LONG'
        ? entryPrice + actualRiskDist
        : Math.max(entryPrice * 0.1, entryPrice - actualRiskDist);

    return {
      id: `sim-${symbol}-${market}-${timeframe}-${executedAt}-${idSuffix ?? Math.random().toString(36).slice(2, 6)}`,
      symbol,
      market,
      timeframe,
      side,
      verdictLabel,
      confidencePercent: analysis.confidencePercent,
      sourceMode,
      cycleSlotTime,
      executedAt,
      entryPrice,
      stopLoss,
      takeProfit,
      rewardToRisk: 1.0,
      riskUsd,
      status: 'OPEN',
      exitPrice: null,
      closedAt: null,
      pnlR: 0,
      pnlUsd: 0,
      entryAnalysis: buildTradeEntryAnalysisSnapshot({
        analysis,
        side,
        entryPrice,
        stopLoss,
        takeProfit,
        executedAt,
      }),
    };
  }

  const plan =
    analysis.executionPlan.bias === side
      ? analysis.executionPlan
      : buildExecutionPlanForBias({
          bias: side,
          currentPrice: analysis.currentPrice,
          ema21,
          atr14: analysis.executionPlan.atr14,
          nearestBidWall: analysis.liquidityMetrics.topBidWalls[0]?.price,
          nearestAskWall: analysis.liquidityMetrics.topAskWalls[0]?.price,
          nearestSsl: analysis.swingLevels.find((s) => s.type === 'SSL')?.price,
          nearestBsl: analysis.swingLevels.find((s) => s.type === 'BSL')?.price,
        });

  return {
    id: `sim-${symbol}-${market}-${timeframe}-${cycleSlotTime}-${idSuffix ?? executedAt}`,
    symbol,
    market,
    timeframe,
    side,
    verdictLabel,
    confidencePercent: analysis.confidencePercent,
    sourceMode,
    cycleSlotTime,
    executedAt,
    entryPrice: plan.optimalEntry,
    stopLoss: plan.stopLoss,
    takeProfit: plan.takeProfit1,
    rewardToRisk: 1.0,
    riskUsd,
    status: 'OPEN',
    exitPrice: null,
    closedAt: null,
    pnlR: 0,
    pnlUsd: 0,
    entryAnalysis: buildTradeEntryAnalysisSnapshot({
      analysis,
      side,
      entryPrice: plan.optimalEntry,
      stopLoss: plan.stopLoss,
      takeProfit: plan.takeProfit1,
      executedAt,
    }),
  };
}

export function evaluateOpenTradeAgainstCandles(
  trade: SimulatedTrade,
  candles: Candle[],
  exitAnalysisResult?: MarketAnalysisResult | null
): SimulatedTrade {
  if (trade.status !== 'OPEN' || candles.length === 0) {
    return trade;
  }

  // Only inspect bars that occur strictly after the trade was opened
  for (const c of candles) {
    if (c.openTime <= trade.executedAt) continue;

    if (trade.side === 'LONG') {
      const hitSl = c.low <= trade.stopLoss;
      const hitTp = c.high >= trade.takeProfit;
      if (hitSl) {
        return {
          ...trade,
          status: 'LOSS',
          exitPrice: trade.stopLoss,
          closedAt: c.closeTime,
          pnlR: -1,
          pnlUsd: -trade.riskUsd,
          exitAnalysis: buildTradeExitAnalysisSnapshot({
            trade,
            outcome: 'LOSS',
            exitPrice: trade.stopLoss,
            closedAt: c.closeTime,
            triggerType: 'HIT_SL_CANDLE',
            exitAnalysisResult,
            triggeringCandle: c,
          }),
        };
      }
      if (hitTp) {
        const winR = trade.rewardToRisk || 1;
        return {
          ...trade,
          status: 'WIN',
          exitPrice: trade.takeProfit,
          closedAt: c.closeTime,
          pnlR: winR,
          pnlUsd: Number((trade.riskUsd * winR).toFixed(2)),
          exitAnalysis: buildTradeExitAnalysisSnapshot({
            trade,
            outcome: 'WIN',
            exitPrice: trade.takeProfit,
            closedAt: c.closeTime,
            triggerType: 'HIT_TP_CANDLE',
            exitAnalysisResult,
            triggeringCandle: c,
          }),
        };
      }
    } else {
      const hitSl = c.high >= trade.stopLoss;
      const hitTp = c.low <= trade.takeProfit;
      if (hitSl) {
        return {
          ...trade,
          status: 'LOSS',
          exitPrice: trade.stopLoss,
          closedAt: c.closeTime,
          pnlR: -1,
          pnlUsd: -trade.riskUsd,
          exitAnalysis: buildTradeExitAnalysisSnapshot({
            trade,
            outcome: 'LOSS',
            exitPrice: trade.stopLoss,
            closedAt: c.closeTime,
            triggerType: 'HIT_SL_CANDLE',
            exitAnalysisResult,
            triggeringCandle: c,
          }),
        };
      }
      if (hitTp) {
        const winR = trade.rewardToRisk || 1;
        return {
          ...trade,
          status: 'WIN',
          exitPrice: trade.takeProfit,
          closedAt: c.closeTime,
          pnlR: winR,
          pnlUsd: Number((trade.riskUsd * winR).toFixed(2)),
          exitAnalysis: buildTradeExitAnalysisSnapshot({
            trade,
            outcome: 'WIN',
            exitPrice: trade.takeProfit,
            closedAt: c.closeTime,
            triggerType: 'HIT_TP_CANDLE',
            exitAnalysisResult,
            triggeringCandle: c,
          }),
        };
      }
    }
  }

  return trade;
}

export function evaluateOpenTradeAgainstLivePrice(
  trade: SimulatedTrade,
  livePrice: number,
  nowMs = Date.now(),
  exitAnalysisResult?: MarketAnalysisResult | null
): SimulatedTrade {
  if (trade.status !== 'OPEN' || !Number.isFinite(livePrice) || livePrice <= 0) {
    return trade;
  }

  const winR = trade.rewardToRisk || 1;
  if (trade.side === 'LONG') {
    if (livePrice <= trade.stopLoss) {
      return {
        ...trade,
        status: 'LOSS',
        exitPrice: trade.stopLoss,
        closedAt: nowMs,
        pnlR: -1,
        pnlUsd: -trade.riskUsd,
        exitAnalysis: buildTradeExitAnalysisSnapshot({
          trade,
          outcome: 'LOSS',
          exitPrice: trade.stopLoss,
          closedAt: nowMs,
          triggerType: 'HIT_SL_LIVE',
          exitAnalysisResult,
        }),
      };
    }
    if (livePrice >= trade.takeProfit) {
      return {
        ...trade,
        status: 'WIN',
        exitPrice: trade.takeProfit,
        closedAt: nowMs,
        pnlR: winR,
        pnlUsd: Number((trade.riskUsd * winR).toFixed(2)),
        exitAnalysis: buildTradeExitAnalysisSnapshot({
          trade,
          outcome: 'WIN',
          exitPrice: trade.takeProfit,
          closedAt: nowMs,
          triggerType: 'HIT_TP_LIVE',
          exitAnalysisResult,
        }),
      };
    }
  } else {
    if (livePrice >= trade.stopLoss) {
      return {
        ...trade,
        status: 'LOSS',
        exitPrice: trade.stopLoss,
        closedAt: nowMs,
        pnlR: -1,
        pnlUsd: -trade.riskUsd,
        exitAnalysis: buildTradeExitAnalysisSnapshot({
          trade,
          outcome: 'LOSS',
          exitPrice: trade.stopLoss,
          closedAt: nowMs,
          triggerType: 'HIT_SL_LIVE',
          exitAnalysisResult,
        }),
      };
    }
    if (livePrice <= trade.takeProfit) {
      return {
        ...trade,
        status: 'WIN',
        exitPrice: trade.takeProfit,
        closedAt: nowMs,
        pnlR: winR,
        pnlUsd: Number((trade.riskUsd * winR).toFixed(2)),
        exitAnalysis: buildTradeExitAnalysisSnapshot({
          trade,
          outcome: 'WIN',
          exitPrice: trade.takeProfit,
          closedAt: nowMs,
          triggerType: 'HIT_TP_LIVE',
          exitAnalysisResult,
        }),
      };
    }
  }

  return trade;
}

export function evaluateOpenTradeReversalTakeProfit(params: {
  trade: SimulatedTrade;
  analysis: MarketAnalysisResult;
  livePrice: number;
  nowMs?: number;
  autoTakeProfitOnReversal?: boolean;
  forceManualClose?: boolean;
}): SimulatedTrade {
  const {
    trade,
    analysis,
    livePrice,
    nowMs = Date.now(),
    autoTakeProfitOnReversal = true,
    forceManualClose = false,
  } = params;

  if (trade.status !== 'OPEN' || !Number.isFinite(livePrice) || livePrice <= 0) {
    return trade;
  }

  const monitor = analyzeRunningTradeReversal({
    trade,
    analysis,
    livePrice,
    evaluatedAt: nowMs,
  });

  if (forceManualClose || (autoTakeProfitOnReversal && monitor.shouldAutoTakeProfit)) {
    const unrealized = computeUnrealizedTradePnl(trade, livePrice);
    const outcome: 'WIN' | 'LOSS' = unrealized.pnlUsd >= 0 ? 'WIN' : 'LOSS';
    const triggerType = forceManualClose ? 'MANUAL_CLOSE' : 'EARLY_TP_REVERSAL';

    return {
      ...trade,
      status: outcome,
      exitPrice: livePrice,
      closedAt: nowMs,
      pnlR: unrealized.pnlR,
      pnlUsd: unrealized.pnlUsd,
      reversalMonitor: monitor,
      exitAnalysis: buildTradeExitAnalysisSnapshot({
        trade,
        outcome,
        exitPrice: livePrice,
        closedAt: nowMs,
        triggerType,
        exitAnalysisResult: analysis,
        reversalMonitor: monitor,
        pnlR: unrealized.pnlR,
        pnlUsd: unrealized.pnlUsd,
      }),
    };
  }

  return {
    ...trade,
    reversalMonitor: monitor,
  };
}

export function buildWalkForwardReplayTrades(params: {
  symbol: string;
  market: MarketType;
  candlesByTf: Record<AllowedTimeframe, Candle[]>;
  orderbook: OrderbookData;
  checkpointsPerTf?: number;
}): SimulatedTrade[] {
  const { symbol, market, candlesByTf, orderbook, checkpointsPerTf = 6 } = params;
  const generated: SimulatedTrade[] = [];

  for (const tf of ALLOWED_TIMEFRAMES) {
    const candles = candlesByTf[tf];
    if (!candles || candles.length < 40) continue;

    const minStart = Math.min(candles.length - 8, Math.max(35, Math.floor(candles.length * 0.55)));
    const maxEnd = candles.length - 2;
    if (maxEnd <= minStart) continue;

    const span = maxEnd - minStart;
    const count = Math.min(checkpointsPerTf, Math.max(2, Math.floor(span / 2)));
    const step = Math.max(2, Math.floor(span / count));

    for (let i = 0; i < count; i++) {
      const idx = minStart + i * step;
      if (idx > maxEnd) break;

      const slice = candles.slice(0, idx + 1);
      const triggerCandle = slice[slice.length - 1];
      const evalTime = triggerCandle.closeTime + 1;
      const analysis = analyzeMarketDecision(symbol, tf, slice, orderbook, evalTime);
      const slotTime = get30MinuteSlotTime(evalTime);

      const rawTrade = createSimulatedTradeFromAnalysis({
        symbol,
        market,
        timeframe: tf,
        analysis,
        sourceMode: 'REPLAY_30M',
        executedAt: evalTime,
        cycleSlotTime: slotTime,
        idSuffix: `wf-${idx}`,
      });
      if (!rawTrade) continue;

      const resolved = evaluateOpenTradeAgainstCandles(rawTrade, candles.slice(idx + 1));
      generated.push(resolved);
    }
  }

  return generated.sort((a, b) => b.executedAt - a.executedAt);
}

export interface UnrealizedTradePnl {
  hasLivePrice: boolean;
  livePrice: number | null;
  pnlR: number;
  pnlUsd: number;
}

export function computeUnrealizedTradePnl(
  trade: SimulatedTrade,
  livePrice: number | null | undefined
): UnrealizedTradePnl {
  if (trade.status !== 'OPEN') {
    return {
      hasLivePrice: trade.exitPrice !== null,
      livePrice: trade.exitPrice,
      pnlR: trade.pnlR,
      pnlUsd: trade.pnlUsd,
    };
  }

  if (livePrice === null || livePrice === undefined || !Number.isFinite(livePrice) || livePrice <= 0) {
    return {
      hasLivePrice: false,
      livePrice: null,
      pnlR: 0,
      pnlUsd: 0,
    };
  }

  const riskDist = Math.abs(trade.entryPrice - trade.stopLoss);
  if (riskDist <= 1e-12) {
    return {
      hasLivePrice: true,
      livePrice,
      pnlR: 0,
      pnlUsd: 0,
    };
  }

  const priceDelta =
    trade.side === 'LONG' ? livePrice - trade.entryPrice : trade.entryPrice - livePrice;
  const rawR = priceDelta / riskDist;
  const pnlR = Number(rawR.toFixed(2));
  const pnlUsd = Number((rawR * trade.riskUsd).toFixed(2));

  return {
    hasLivePrice: true,
    livePrice,
    pnlR,
    pnlUsd,
  };
}

export function computeSimulationMetrics(
  trades: SimulatedTrade[],
  livePrices: Record<string, number> = {},
  startingBalancePerTf = DEFAULT_TF_STARTING_BALANCE_USD,
  coinCount = 1
): {
  stats: SimulationOverallStats;
  byTimeframe: TimeframeWinrateStat[];
} {
  const safeCoinCount = Math.max(1, Math.floor(coinCount));
  const tfStartingBalance = startingBalancePerTf * safeCoinCount;

  const byTimeframe: TimeframeWinrateStat[] = ALLOWED_TIMEFRAMES.map((tf) => {
    const tfTrades = trades.filter((t) => t.timeframe === tf);
    const wins = tfTrades.filter((t) => t.status === 'WIN').length;
    const losses = tfTrades.filter((t) => t.status === 'LOSS').length;
    const closedTrades = wins + losses;
    const openTradesList = tfTrades.filter((t) => t.status === 'OPEN');
    const openTrades = openTradesList.length;
    const winratePercent = closedTrades > 0 ? (wins / closedTrades) * 100 : 0;
    const netR = tfTrades.reduce((acc, t) => acc + t.pnlR, 0);
    const netPnlUsd = tfTrades
      .filter((t) => t.status !== 'OPEN')
      .reduce((acc, t) => acc + t.pnlUsd, 0);
    const floatingPnlUsd = openTradesList.reduce((acc, t) => {
      const lp = livePrices[`${t.symbol}:${t.market}`];
      return acc + computeUnrealizedTradePnl(t, lp).pnlUsd;
    }, 0);
    const realizedBalanceUsd = Number(Math.max(0, tfStartingBalance + netPnlUsd).toFixed(2));
    const realtimeBalanceUsd = Number(
      Math.max(0, realizedBalanceUsd + floatingPnlUsd).toFixed(2)
    );
    const returnPercent = Number(
      (((realtimeBalanceUsd - tfStartingBalance) / tfStartingBalance) * 100).toFixed(2)
    );

    const grossWinUsd = tfTrades
      .filter((t) => t.pnlUsd > 0)
      .reduce((acc, t) => acc + t.pnlUsd, 0);
    const grossLossUsd = Math.abs(
      tfTrades.filter((t) => t.pnlUsd < 0).reduce((acc, t) => acc + t.pnlUsd, 0)
    );
    const profitFactor =
      grossLossUsd > 0 ? Number((grossWinUsd / grossLossUsd).toFixed(2)) : grossWinUsd > 0 ? 9.99 : null;
    const avgConfidence =
      tfTrades.length > 0
        ? Math.round(tfTrades.reduce((acc, t) => acc + t.confidencePercent, 0) / tfTrades.length)
        : 0;

    return {
      timeframe: tf,
      role: getTimeframeRole(tf),
      startingBalanceUsd: tfStartingBalance,
      realizedBalanceUsd,
      floatingPnlUsd: Number(floatingPnlUsd.toFixed(2)),
      realtimeBalanceUsd,
      returnPercent,
      totalTrades: tfTrades.length,
      openTrades,
      closedTrades,
      wins,
      losses,
      winratePercent: Number(winratePercent.toFixed(1)),
      netR: Number(netR.toFixed(1)),
      netPnlUsd: Number(netPnlUsd.toFixed(2)),
      profitFactor,
      avgConfidence,
    };
  });

  const startingCapitalUsd = tfStartingBalance * ALLOWED_TIMEFRAMES.length;
  const wins = trades.filter((t) => t.status === 'WIN').length;
  const losses = trades.filter((t) => t.status === 'LOSS').length;
  const closedTrades = wins + losses;
  const openTrades = trades.filter((t) => t.status === 'OPEN').length;
  const winratePercent = closedTrades > 0 ? (wins / closedTrades) * 100 : 0;
  const netR = trades.reduce((acc, t) => acc + t.pnlR, 0);
  const totalPnlUsd = trades
    .filter((t) => t.status !== 'OPEN')
    .reduce((acc, t) => acc + t.pnlUsd, 0);
  const grossWinUsd = trades
    .filter((t) => t.pnlUsd > 0)
    .reduce((acc, t) => acc + t.pnlUsd, 0);
  const grossLossUsd = Math.abs(
    trades.filter((t) => t.pnlUsd < 0).reduce((acc, t) => acc + t.pnlUsd, 0)
  );
  const profitFactor =
    grossLossUsd > 0 ? Number((grossWinUsd / grossLossUsd).toFixed(2)) : grossWinUsd > 0 ? 9.99 : null;

  return {
    stats: {
      startingCapitalUsd,
      currentEquityUsd: Number((startingCapitalUsd + totalPnlUsd).toFixed(2)),
      totalPnlUsd: Number(totalPnlUsd.toFixed(2)),
      returnPercent: Number(((totalPnlUsd / startingCapitalUsd) * 100).toFixed(2)),
      totalTrades: trades.length,
      openTrades,
      closedTrades,
      wins,
      losses,
      winratePercent: Number(winratePercent.toFixed(1)),
      netR: Number(netR.toFixed(1)),
      expectancyR: closedTrades > 0 ? Number((netR / closedTrades).toFixed(2)) : 0,
      profitFactor,
    },
    byTimeframe,
  };
}

export function computeCoinSimulationMetrics(
  trades: SimulatedTrade[],
  symbol: string,
  livePrices: Record<string, number> = {},
  startingBalancePerTf = DEFAULT_TF_STARTING_BALANCE_USD
): {
  stats: SimulationOverallStats;
  byTimeframe: TimeframeWinrateStat[];
} {
  const coinTrades = trades.filter((t) => t.symbol === symbol);
  return computeSimulationMetrics(coinTrades, livePrices, startingBalancePerTf, 1);
}

export interface RealtimeSimulationSnapshot {
  realizedPnlUsd: number;
  floatingPnlUsd: number;
  totalRealtimePnlUsd: number;
  realizedNetR: number;
  floatingR: number;
  totalRealtimeR: number;
  realtimeEquityUsd: number;
  realtimeReturnPercent: number;
  floatingByTimeframe: Record<
    AllowedTimeframe,
    { floatingR: number; floatingPnlUsd: number; totalRealtimePnlUsd: number }
  >;
}

export function computeRealtimeSimulationSnapshot(
  trades: SimulatedTrade[],
  livePrices: Record<string, number>,
  startingCapitalUsd = DEFAULT_VIRTUAL_CAPITAL_USD
): RealtimeSimulationSnapshot {
  let realizedPnlUsd = 0;
  let realizedNetR = 0;
  let floatingPnlUsd = 0;
  let floatingR = 0;

  const floatingByTimeframe = Object.fromEntries(
    ALLOWED_TIMEFRAMES.map((tf) => [
      tf,
      { floatingR: 0, floatingPnlUsd: 0, totalRealtimePnlUsd: 0 },
    ])
  ) as RealtimeSimulationSnapshot['floatingByTimeframe'];

  for (const t of trades) {
    if (t.status === 'OPEN') {
      const lp = livePrices[`${t.symbol}:${t.market}`];
      const u = computeUnrealizedTradePnl(t, lp);
      floatingPnlUsd += u.pnlUsd;
      floatingR += u.pnlR;
      if (floatingByTimeframe[t.timeframe]) {
        floatingByTimeframe[t.timeframe].floatingPnlUsd += u.pnlUsd;
        floatingByTimeframe[t.timeframe].floatingR += u.pnlR;
        floatingByTimeframe[t.timeframe].totalRealtimePnlUsd += u.pnlUsd;
      }
    } else {
      realizedPnlUsd += t.pnlUsd;
      realizedNetR += t.pnlR;
      if (floatingByTimeframe[t.timeframe]) {
        floatingByTimeframe[t.timeframe].totalRealtimePnlUsd += t.pnlUsd;
      }
    }
  }

  for (const tf of ALLOWED_TIMEFRAMES) {
    floatingByTimeframe[tf].floatingPnlUsd = Number(
      floatingByTimeframe[tf].floatingPnlUsd.toFixed(2)
    );
    floatingByTimeframe[tf].floatingR = Number(floatingByTimeframe[tf].floatingR.toFixed(2));
    floatingByTimeframe[tf].totalRealtimePnlUsd = Number(
      floatingByTimeframe[tf].totalRealtimePnlUsd.toFixed(2)
    );
  }

  const totalRealtimePnlUsd = Number((realizedPnlUsd + floatingPnlUsd).toFixed(2));
  const totalRealtimeR = Number((realizedNetR + floatingR).toFixed(2));
  const realtimeEquityUsd = Number((startingCapitalUsd + totalRealtimePnlUsd).toFixed(2));

  return {
    realizedPnlUsd: Number(realizedPnlUsd.toFixed(2)),
    floatingPnlUsd: Number(floatingPnlUsd.toFixed(2)),
    totalRealtimePnlUsd,
    realizedNetR: Number(realizedNetR.toFixed(1)),
    floatingR: Number(floatingR.toFixed(2)),
    totalRealtimeR,
    realtimeEquityUsd,
    realtimeReturnPercent: Number(((totalRealtimePnlUsd / startingCapitalUsd) * 100).toFixed(2)),
    floatingByTimeframe,
  };
}

export function computeSymbolSimulationMetrics(
  trades: SimulatedTrade[],
  symbols: string[],
  livePrices: Record<string, number>,
  market: MarketType = 'spot',
  startingBalancePerTf = DEFAULT_TF_STARTING_BALANCE_USD
): SymbolWinrateStat[] {
  const ordered = normalizeSimulationCoins(symbols);
  for (const t of trades) {
    if (!ordered.includes(t.symbol)) {
      ordered.push(t.symbol);
    }
  }
  const startingBalancePerCoin = startingBalancePerTf * ALLOWED_TIMEFRAMES.length;

  return ordered.map((sym) => {
    const symTrades = trades.filter((t) => t.symbol === sym);
    const wins = symTrades.filter((t) => t.status === 'WIN').length;
    const losses = symTrades.filter((t) => t.status === 'LOSS').length;
    const earlyTpWins = symTrades.filter(
      (t) =>
        t.status === 'WIN' &&
        (t.exitAnalysis?.triggerType === 'EARLY_TP_REVERSAL' ||
          t.exitAnalysis?.triggerType === 'MANUAL_CLOSE')
    ).length;
    const closedTrades = wins + losses;
    const openList = symTrades.filter((t) => t.status === 'OPEN');
    const winratePercent = closedTrades > 0 ? (wins / closedTrades) * 100 : 0;
    const realizedPnlUsd = symTrades
      .filter((t) => t.status !== 'OPEN')
      .reduce((acc, t) => acc + t.pnlUsd, 0);
    const floatingPnlUsd = openList.reduce((acc, t) => {
      const lp = livePrices[`${t.symbol}:${t.market}`] ?? livePrices[`${sym}:${market}`];
      return acc + computeUnrealizedTradePnl(t, lp).pnlUsd;
    }, 0);
    const realizedBalanceUsd = Number(Math.max(0, startingBalancePerCoin + realizedPnlUsd).toFixed(2));
    const realtimeBalanceUsd = Number(Math.max(0, realizedBalanceUsd + floatingPnlUsd).toFixed(2));
    const realtimePnlUsd = Number((realizedPnlUsd + floatingPnlUsd).toFixed(2));
    const returnPercent = Number(
      (((realtimeBalanceUsd - startingBalancePerCoin) / startingBalancePerCoin) * 100).toFixed(2)
    );
    const reversalAlertCount = openList.filter(
      (t) => t.reversalMonitor && t.reversalMonitor.status !== 'AMAN'
    ).length;
    const livePrice = livePrices[`${sym}:${market}`] ?? null;

    return {
      symbol: sym,
      livePrice,
      startingBalanceUsd: startingBalancePerCoin,
      realizedBalanceUsd,
      realtimeBalanceUsd,
      returnPercent,
      totalTrades: symTrades.length,
      openTrades: openList.length,
      closedTrades,
      wins,
      losses,
      earlyTpWins,
      winratePercent: Number(winratePercent.toFixed(1)),
      realizedPnlUsd: Number(realizedPnlUsd.toFixed(2)),
      floatingPnlUsd: Number(floatingPnlUsd.toFixed(2)),
      realtimePnlUsd,
      reversalAlertCount,
    };
  });
}

