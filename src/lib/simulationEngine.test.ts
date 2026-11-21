import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_COIN_STARTING_BALANCE_USD,
  DEFAULT_SIMULATION_COINS,
  DEFAULT_TF_STARTING_BALANCE_USD,
  DEFAULT_VIRTUAL_CAPITAL_USD,
  buildWalkForwardReplayTrades,
  computeCoinSimulationMetrics,
  computeRealtimeSimulationSnapshot,
  computeSimulationMetrics,
  computeSymbolSimulationMetrics,
  computeTradeRiskUsd,
  computeUnrealizedTradePnl,
  createSimulatedTradeFromAnalysis,
  evaluateOpenTradeAgainstCandles,
  evaluateOpenTradeAgainstLivePrice,
  evaluateOpenTradeReversalTakeProfit,
  getCoinTimeframeAccountBalance,
  getTimeframeAccountBalance,
  resolveQualifiedTradeSide,
} from './simulationEngine';
import { ALLOWED_TIMEFRAMES, analyzeMarketDecision } from './decisionEngine';
import type { AllowedTimeframe, Candle, OrderbookData, SimulatedTrade } from '../types/market';

function buildTrendSeries(count = 120, start = 100, stepPct = 0.006): Candle[] {
  const candles: Candle[] = [];
  let price = start;
  const now = Date.now() - 10_000_000;
  for (let i = 0; i < count; i++) {
    const open = price;
    const close = open * (1 + stepPct);
    const high = Math.max(open, close) * 1.003;
    const low = Math.min(open, close) * 0.998;
    const vol = i >= 60 ? 3200 : 1200;
    candles.push({
      openTime: now + i * 60_000,
      open,
      high,
      low,
      close,
      volume: vol,
      closeTime: now + (i + 1) * 60_000 - 1,
      quoteVolume: close * vol,
      trades: 400,
    });
    price = close;
  }
  return candles;
}

test('createSimulatedTradeFromAnalysis enforces exact 1:1 R:R ($5 default risk on $100 TF balance) and resolves WIN/LOSS', () => {
  const candles = buildTrendSeries(120, 100, 0.006);
  const lastPrice = candles[candles.length - 1].close;
  const orderbook: OrderbookData = {
    symbol: 'BTCUSDT',
    lastUpdateId: 1,
    bids: [[lastPrice * 0.999, 9000]],
    asks: [[lastPrice * 1.001, 1200]],
    source: 'binance-live',
  };

  const analysis = analyzeMarketDecision(
    'BTCUSDT',
    '15m',
    candles,
    orderbook,
    candles[candles.length - 1].closeTime + 10
  );
  const trade = createSimulatedTradeFromAnalysis({
    symbol: 'BTCUSDT',
    market: 'spot',
    timeframe: '15m',
    analysis,
    sourceMode: 'AUTO_LIVE',
    executedAt: candles[candles.length - 1].closeTime + 10,
    cycleSlotTime: candles[candles.length - 1].closeTime,
  });

  assert.ok(trade, 'Strong uptrend >70% must open simulated trade');
  assert.equal(trade.status, 'OPEN');
  assert.equal(trade.side, 'LONG');
  assert.equal(trade.rewardToRisk, 1);
  assert.equal(trade.riskUsd, 5);
  const rr = (trade.takeProfit - trade.entryPrice) / (trade.entryPrice - trade.stopLoss);
  assert.ok(Math.abs(rr - 1) < 1e-5);

  // Hit TP on future candle
  const tpCandle: Candle = {
    openTime: trade.executedAt + 1000,
    open: trade.entryPrice,
    high: trade.takeProfit * 1.005,
    low: trade.entryPrice * 0.999,
    close: trade.takeProfit,
    volume: 500,
    closeTime: trade.executedAt + 60_000,
    quoteVolume: 50000,
    trades: 50,
  };
  const winTrade = evaluateOpenTradeAgainstCandles(trade, [tpCandle]);
  assert.equal(winTrade.status, 'WIN');
  assert.equal(winTrade.pnlR, 1);
  assert.equal(winTrade.pnlUsd, 5);

  // Hit SL on live price
  const lossTrade = evaluateOpenTradeAgainstLivePrice(trade, trade.stopLoss * 0.999);
  assert.equal(lossTrade.status, 'LOSS');
  assert.equal(lossTrade.pnlR, -1);
  assert.equal(lossTrade.pnlUsd, -5);
});

test('createSimulatedTradeFromAnalysis anchors liveEntryPrice directly at Binance spot/futures price with 1:1 SL/TP', () => {
  const candles = buildTrendSeries(120, 100, 0.006);
  const lastPrice = candles[candles.length - 1].close;
  const orderbook: OrderbookData = {
    symbol: 'BTCUSDT',
    lastUpdateId: 1,
    bids: [[lastPrice * 0.999, 9000]],
    asks: [[lastPrice * 1.001, 1200]],
    source: 'binance-live',
  };

  const analysis = analyzeMarketDecision(
    'BTCUSDT',
    '5m',
    candles,
    orderbook,
    candles[candles.length - 1].closeTime + 10
  );
  const liveTickerPrice = lastPrice * 1.012;
  const trade = createSimulatedTradeFromAnalysis({
    symbol: 'BTCUSDT',
    market: 'spot',
    timeframe: '5m',
    analysis,
    sourceMode: 'REENTRY_TP_SL',
    executedAt: candles[candles.length - 1].closeTime + 20,
    cycleSlotTime: candles[candles.length - 1].closeTime,
    liveEntryPrice: liveTickerPrice,
    riskUsd: 5.5,
  });

  assert.ok(trade, 'Strong uptrend >70% must open simulated trade');
  assert.equal(trade.entryPrice, liveTickerPrice);
  assert.equal(trade.riskUsd, 5.5);
  assert.equal(trade.rewardToRisk, 1);
  const rr = Math.abs(trade.takeProfit - trade.entryPrice) / Math.abs(trade.entryPrice - trade.stopLoss);
  assert.ok(Math.abs(rr - 1) < 1e-5);
});

test('buildWalkForwardReplayTrades & computeSimulationMetrics cover all 7 timeframes and $100/TF capital', () => {
  const uptrend = buildTrendSeries(120, 50, 0.006);
  const lastPrice = uptrend[uptrend.length - 1].close;
  const orderbook: OrderbookData = {
    symbol: 'SOLUSDT',
    lastUpdateId: 2,
    bids: [[lastPrice * 0.999, 6000]],
    asks: [[lastPrice * 1.001, 1500]],
    source: 'binance-live',
  };

  const candlesByTf = Object.fromEntries(
    ALLOWED_TIMEFRAMES.map((tf) => [tf, uptrend])
  ) as Record<AllowedTimeframe, Candle[]>;

  const trades = buildWalkForwardReplayTrades({
    symbol: 'SOLUSDT',
    market: 'spot',
    candlesByTf,
    orderbook,
    checkpointsPerTf: 4,
  });

  assert.equal(trades.length, 7 * 4);
  const { stats, byTimeframe } = computeSimulationMetrics(trades);

  assert.equal(DEFAULT_TF_STARTING_BALANCE_USD, 100);
  assert.equal(DEFAULT_VIRTUAL_CAPITAL_USD, 700);
  assert.equal(stats.startingCapitalUsd, 700);
  assert.equal(byTimeframe.length, 7);
  for (const tfStat of byTimeframe) {
    assert.equal(tfStat.startingBalanceUsd, 100);
    assert.equal(tfStat.totalTrades, 4);
    assert.ok(tfStat.winratePercent >= 0 && tfStat.winratePercent <= 100);
  }
  assert.equal(stats.totalTrades, 28);
  assert.equal(stats.wins + stats.losses + stats.openTrades, 28);
});

test('independent $100 per-timeframe accounts isolate balances and compute 5% compounding risk per TF', () => {
  const closedWin1m: SimulatedTrade = {
    id: 'w1',
    symbol: 'BTCUSDT',
    market: 'spot',
    timeframe: '1m',
    side: 'LONG',
    verdictLabel: 'BUY',
    confidencePercent: 75,
    sourceMode: 'AUTO_LIVE',
    cycleSlotTime: 1000,
    executedAt: 1000,
    entryPrice: 50000,
    stopLoss: 49000,
    takeProfit: 51000,
    rewardToRisk: 1,
    riskUsd: 5,
    status: 'WIN',
    exitPrice: 51000,
    closedAt: 2000,
    pnlR: 1,
    pnlUsd: 5,
  };
  const closedLoss5m: SimulatedTrade = {
    ...closedWin1m,
    id: 'l1',
    timeframe: '5m',
    status: 'LOSS',
    exitPrice: 49000,
    pnlR: -1,
    pnlUsd: -5,
  };

  assert.equal(getTimeframeAccountBalance([closedWin1m, closedLoss5m], '1m'), 105);
  assert.equal(getTimeframeAccountBalance([closedWin1m, closedLoss5m], '5m'), 95);
  assert.equal(getTimeframeAccountBalance([closedWin1m, closedLoss5m], '15m'), 100);

  assert.equal(computeTradeRiskUsd(105), 5.25);
  assert.equal(computeTradeRiskUsd(95), 4.75);
  assert.equal(computeTradeRiskUsd(100), 5);
  assert.equal(computeTradeRiskUsd(0), 0);

  const { stats, byTimeframe } = computeSimulationMetrics([closedWin1m, closedLoss5m]);
  assert.equal(stats.startingCapitalUsd, 700);
  assert.equal(stats.currentEquityUsd, 700);
  const tf1m = byTimeframe.find((b) => b.timeframe === '1m')!;
  const tf5m = byTimeframe.find((b) => b.timeframe === '5m')!;
  const tf15m = byTimeframe.find((b) => b.timeframe === '15m')!;
  assert.equal(tf1m.realizedBalanceUsd, 105);
  assert.equal(tf1m.returnPercent, 5);
  assert.equal(tf5m.realizedBalanceUsd, 95);
  assert.equal(tf5m.returnPercent, -5);
  assert.equal(tf15m.realizedBalanceUsd, 100);
  assert.equal(tf15m.returnPercent, 0);
});

test('computeUnrealizedTradePnl and computeRealtimeSimulationSnapshot calculate live floating Profit/Loss accurately on $700 total modal', () => {
  const longOpen: SimulatedTrade = {
    id: 't1',
    symbol: 'BTCUSDT',
    market: 'spot',
    timeframe: '15m',
    side: 'LONG',
    verdictLabel: 'BUY',
    confidencePercent: 72,
    sourceMode: 'AUTO_LIVE',
    cycleSlotTime: 1000,
    executedAt: 1000,
    entryPrice: 50000,
    stopLoss: 49000,
    takeProfit: 51000,
    rewardToRisk: 1,
    riskUsd: 5,
    status: 'OPEN',
    exitPrice: null,
    closedAt: null,
    pnlR: 0,
    pnlUsd: 0,
  };
  const shortClosed: SimulatedTrade = {
    ...longOpen,
    id: 't2',
    timeframe: '1h',
    side: 'SHORT',
    status: 'WIN',
    exitPrice: 49000,
    closedAt: 2000,
    pnlR: 1,
    pnlUsd: 5,
  };

  const profitU = computeUnrealizedTradePnl(longOpen, 50500);
  assert.equal(profitU.hasLivePrice, true);
  assert.equal(profitU.pnlR, 0.5);
  assert.equal(profitU.pnlUsd, 2.5);

  const lossU = computeUnrealizedTradePnl(longOpen, 49600);
  assert.equal(lossU.pnlR, -0.4);
  assert.equal(lossU.pnlUsd, -2);

  const snap = computeRealtimeSimulationSnapshot([longOpen, shortClosed], {
    'BTCUSDT:spot': 50500,
  });
  assert.equal(snap.realizedPnlUsd, 5);
  assert.equal(snap.floatingPnlUsd, 2.5);
  assert.equal(snap.totalRealtimePnlUsd, 7.5);
  assert.equal(snap.realtimeEquityUsd, 707.5);
  assert.equal(snap.floatingByTimeframe['15m'].floatingPnlUsd, 2.5);
  assert.equal(snap.floatingByTimeframe['1h'].totalRealtimePnlUsd, 5);
});

test('simulation skips entry when bullishScore <= 70 and bearishScore <= 70', () => {
  const sideways: Candle[] = Array.from({ length: 80 }, (_, idx) => {
    const base = 100;
    const close = base * (idx % 2 === 0 ? 1.0004 : 0.9996);
    return {
      openTime: Date.now() - (80 - idx) * 60_000,
      open: base,
      high: base * 1.001,
      low: base * 0.999,
      close,
      volume: 1000,
      closeTime: Date.now() - (79 - idx) * 60_000 - 1,
      quoteVolume: close * 1000,
      trades: 100,
    };
  });
  const balancedBook: OrderbookData = {
    symbol: 'BTCUSDT',
    lastUpdateId: 1,
    bids: [[99.9, 1000]],
    asks: [[100.1, 1000]],
    source: 'binance-live',
  };
  const analysis = analyzeMarketDecision(
    'BTCUSDT',
    '15m',
    sideways,
    balancedBook,
    sideways[sideways.length - 1].closeTime + 10
  );
  assert.ok(analysis.bullishScore <= 70 && analysis.bearishScore <= 70);
  assert.equal(resolveQualifiedTradeSide(analysis), null);

  const trade = createSimulatedTradeFromAnalysis({
    symbol: 'BTCUSDT',
    market: 'spot',
    timeframe: '15m',
    analysis,
    sourceMode: 'AUTO_LIVE',
    executedAt: Date.now(),
    cycleSlotTime: sideways[sideways.length - 1].closeTime,
  });
  assert.equal(trade, null);
});

test('multi-coin simulation tracks BTC, NEAR, RENDER, PUMP, UNI live prices and per-coin winrate/PnL', () => {
  assert.deepEqual([...DEFAULT_SIMULATION_COINS], [
    'BTCUSDT',
    'NEARUSDT',
    'RENDERUSDT',
    'PUMPUSDT',
    'UNIUSDT',
  ]);

  const pumpWin: SimulatedTrade = {
    id: 'pump-win',
    symbol: 'PUMPUSDT',
    market: 'spot',
    timeframe: '5m',
    side: 'LONG',
    verdictLabel: 'BUY',
    confidencePercent: 74,
    sourceMode: 'AUTO_LIVE',
    cycleSlotTime: 1000,
    executedAt: 1000,
    entryPrice: 0.0023,
    stopLoss: 0.0022,
    takeProfit: 0.0024,
    rewardToRisk: 1,
    riskUsd: 5,
    status: 'WIN',
    exitPrice: 0.0024,
    closedAt: 2000,
    pnlR: 1,
    pnlUsd: 5,
  };
  const nearOpen: SimulatedTrade = {
    ...pumpWin,
    id: 'near-open',
    symbol: 'NEARUSDT',
    timeframe: '1d',
    side: 'SHORT',
    entryPrice: 2.8,
    stopLoss: 3.0,
    takeProfit: 2.6,
    status: 'OPEN',
    exitPrice: null,
    closedAt: null,
    pnlR: 0,
    pnlUsd: 0,
  };

  const livePrices = {
    'BTCUSDT:spot': 57850,
    'NEARUSDT:spot': 2.75,
    'RENDERUSDT:spot': 1.229,
    'PUMPUSDT:spot': 0.00231,
    'UNIUSDT:spot': 4.41,
  };

  const bySym = computeSymbolSimulationMetrics(
    [pumpWin, nearOpen],
    [...DEFAULT_SIMULATION_COINS],
    livePrices,
    'spot'
  );
  assert.equal(bySym.length, 5);
  const pump = bySym.find((s) => s.symbol === 'PUMPUSDT')!;
  const near = bySym.find((s) => s.symbol === 'NEARUSDT')!;
  assert.equal(pump.wins, 1);
  assert.equal(pump.winratePercent, 100);
  assert.equal(pump.realizedPnlUsd, 5);
  assert.equal(near.openTrades, 1);
  assert.equal(near.floatingPnlUsd, 1.25);
  assert.equal(near.livePrice, 2.75);
  assert.equal(pump.startingBalanceUsd, 700);
  assert.equal(pump.realtimeBalanceUsd, 705);
  assert.equal(near.startingBalanceUsd, 700);
  assert.equal(near.realtimeBalanceUsd, 701.25);
});

test('per-coin $700 ($100/TF) accounts isolate coin+timeframe balances independently', () => {
  const btcWin1m: SimulatedTrade = {
    id: 'btc-1m-win',
    symbol: 'BTCUSDT',
    market: 'spot',
    timeframe: '1m',
    side: 'LONG',
    verdictLabel: 'BUY',
    confidencePercent: 75,
    sourceMode: 'AUTO_LIVE',
    cycleSlotTime: 1000,
    executedAt: 1000,
    entryPrice: 50000,
    stopLoss: 49000,
    takeProfit: 51000,
    rewardToRisk: 1,
    riskUsd: 5,
    status: 'WIN',
    exitPrice: 51000,
    closedAt: 2000,
    pnlR: 1,
    pnlUsd: 5,
  };
  const nearLoss1m: SimulatedTrade = {
    ...btcWin1m,
    id: 'near-1m-loss',
    symbol: 'NEARUSDT',
    entryPrice: 3,
    stopLoss: 2.9,
    takeProfit: 3.1,
    status: 'LOSS',
    exitPrice: 2.9,
    pnlR: -1,
    pnlUsd: -5,
  };

  assert.equal(getCoinTimeframeAccountBalance([btcWin1m, nearLoss1m], 'BTCUSDT', '1m'), 105);
  assert.equal(getCoinTimeframeAccountBalance([btcWin1m, nearLoss1m], 'NEARUSDT', '1m'), 95);
  assert.equal(getCoinTimeframeAccountBalance([btcWin1m, nearLoss1m], 'RENDERUSDT', '1m'), 100);

  const btcMetrics = computeCoinSimulationMetrics([btcWin1m, nearLoss1m], 'BTCUSDT', {
    'BTCUSDT:spot': 50000,
  });
  assert.equal(DEFAULT_COIN_STARTING_BALANCE_USD, 700);
  assert.equal(btcMetrics.stats.startingCapitalUsd, 700);
  assert.equal(btcMetrics.stats.currentEquityUsd, 705);
  assert.equal(btcMetrics.byTimeframe.find((r) => r.timeframe === '1m')?.realizedBalanceUsd, 105);
  assert.equal(btcMetrics.byTimeframe.find((r) => r.timeframe === '5m')?.realizedBalanceUsd, 100);
});

test('evaluateOpenTradeReversalTakeProfit auto-closes floating profit on reversal and supports MANUAL_CLOSE', () => {
  const uptrend = buildTrendSeries(100, 100, 0.006);
  const lastPrice = uptrend[uptrend.length - 1].close;
  const bidOb: OrderbookData = {
    symbol: 'BTCUSDT',
    lastUpdateId: 10,
    bids: [[lastPrice * 0.999, 9000]],
    asks: [[lastPrice * 1.001, 1200]],
    source: 'binance-live',
  };
  const entryAnalysis = analyzeMarketDecision(
    'BTCUSDT',
    '15m',
    uptrend,
    bidOb,
    uptrend[uptrend.length - 1].closeTime + 10
  );
  const trade = createSimulatedTradeFromAnalysis({
    symbol: 'BTCUSDT',
    market: 'spot',
    timeframe: '15m',
    analysis: entryAnalysis,
    sourceMode: 'AUTO_LIVE',
    executedAt: uptrend[uptrend.length - 1].closeTime + 20,
    cycleSlotTime: uptrend[uptrend.length - 1].closeTime,
    liveEntryPrice: lastPrice,
    riskUsd: 5,
  });
  assert.ok(trade);

  // Build realistic top reversal: trade has a natural stop/TP width, rallies to +0.85R, then reverses across 32 bars down to +0.28R
  const wideTrade: SimulatedTrade = {
    ...trade,
    stopLoss: trade.entryPrice * 0.84,
    takeProfit: trade.entryPrice * 1.16,
  };
  const riskDist = wideTrade.takeProfit - wideTrade.entryPrice;
  const reversalCandles: Candle[] = [...uptrend];
  // 14 rally bars pushing up to +0.85R
  for (let i = 0; i < 14; i++) {
    const prev = reversalCandles[reversalCandles.length - 1];
    const targetClose = wideTrade.entryPrice + riskDist * (0.15 + (i / 13) * 0.70);
    reversalCandles.push({
      openTime: prev.closeTime + 1,
      open: prev.close,
      high: targetClose * 1.003,
      low: Math.min(prev.close, targetClose) * 0.998,
      close: targetClose,
      volume: 2600,
      closeTime: prev.closeTime + 60_000,
      quoteVolume: targetClose * 2600,
      trades: 320,
    });
  }
  // 32 downtrend reversal bars breaking EMA9 below EMA21 and finishing around +0.28R
  for (let i = 0; i < 32; i++) {
    const prev = reversalCandles[reversalCandles.length - 1];
    const progress = (i + 1) / 32;
    const isFinal = i === 31;
    const targetClose = wideTrade.entryPrice + riskDist * (0.85 - progress * 0.57);
    const open = isFinal ? prev.close * 1.004 : prev.close;
    reversalCandles.push({
      openTime: prev.closeTime + 1,
      open,
      high: Math.max(open, targetClose) * 1.002,
      low: targetClose * 0.998,
      close: targetClose,
      volume: isFinal ? 5400 : 3500,
      closeTime: prev.closeTime + 60_000,
      quoteVolume: targetClose * 4000,
      trades: 450,
    });
  }
  const lastClosed = reversalCandles[reversalCandles.length - 1];
  reversalCandles.push({
    openTime: lastClosed.closeTime + 1,
    open: lastClosed.close,
    high: lastClosed.close * 1.001,
    low: lastClosed.close * 0.999,
    close: lastClosed.close,
    volume: 500,
    closeTime: lastClosed.closeTime + 60_000,
    quoteVolume: lastClosed.close * 500,
    trades: 20,
  });

  const latestRevClose = lastClosed.close;
  const askOb: OrderbookData = {
    symbol: 'BTCUSDT',
    lastUpdateId: 20,
    bids: [[latestRevClose * 0.999, 700]],
    asks: [[latestRevClose * 1.001, 9500]],
    source: 'binance-live',
  };
  const reversalAnalysis = analyzeMarketDecision(
    'BTCUSDT',
    '15m',
    reversalCandles,
    askOb,
    lastClosed.closeTime + 500
  );
  const floatingProfitPrice = latestRevClose;

  const autoTpTrade = evaluateOpenTradeReversalTakeProfit({
    trade: wideTrade,
    analysis: reversalAnalysis,
    livePrice: floatingProfitPrice,
    nowMs: lastClosed.closeTime + 1000,
    autoTakeProfitOnReversal: true,
  });

  assert.equal(autoTpTrade.status, 'WIN');
  assert.equal(autoTpTrade.exitPrice, floatingProfitPrice);
  assert.ok(autoTpTrade.pnlUsd > 0);
  assert.equal(autoTpTrade.exitAnalysis?.triggerType, 'EARLY_TP_REVERSAL');
  assert.ok(autoTpTrade.reversalMonitor && autoTpTrade.reversalMonitor.reversalScore >= 55);

  // If floating negative, reversal must warn instead of closing into a loss automatically
  const floatingLossPrice = wideTrade.entryPrice - (wideTrade.entryPrice - wideTrade.stopLoss) * 0.3;
  const heldTrade = evaluateOpenTradeReversalTakeProfit({
    trade: wideTrade,
    analysis: reversalAnalysis,
    livePrice: floatingLossPrice,
    nowMs: lastClosed.closeTime + 1000,
    autoTakeProfitOnReversal: true,
  });
  assert.equal(heldTrade.status, 'OPEN');
  assert.equal(heldTrade.reversalMonitor?.status, 'WASPADA_PEMBALIKAN');

  // Manual close overrides & records MANUAL_CLOSE
  const manualClosed = evaluateOpenTradeReversalTakeProfit({
    trade: wideTrade,
    analysis: reversalAnalysis,
    livePrice: floatingProfitPrice,
    nowMs: lastClosed.closeTime + 5000,
    forceManualClose: true,
  });
  assert.equal(manualClosed.status, 'WIN');
  assert.equal(manualClosed.exitAnalysis?.triggerType, 'MANUAL_CLOSE');
});


