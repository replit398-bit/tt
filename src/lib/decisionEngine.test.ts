import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_ENTRY_MOMENTUM_PERCENT,
  analyzeMarketDecision,
  calculatePositionSizing,
  computeMultiTimeframeRecommendation,
  evaluateEntrySignalFromScores,
} from './decisionEngine';
import type { Candle, OrderbookData } from '../types/market';

function buildUptrendCandles(count = 120): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const open = price;
    const close = open * 1.006;
    const high = close * 1.003;
    const low = open * 0.998;
    candles.push({
      openTime: now - (count - i) * 3600000,
      open,
      high,
      low,
      close,
      volume: i === count - 1 ? 5000 : 1200,
      closeTime: now - (count - i - 1) * 3600000,
      quoteVolume: close * 1200,
      trades: 1000,
    });
    price = close;
  }
  return candles;
}

test('analyzeMarketDecision produces BUY/STRONG_BUY on strong uptrend + bid wall liquidity', () => {
  const candles = buildUptrendCandles(120);
  const lastPrice = candles[candles.length - 1].close;
  const orderbook: OrderbookData = {
    symbol: 'SOLUSDT',
    lastUpdateId: 1,
    bids: [
      [lastPrice * 0.999, 5000],
      [lastPrice * 0.995, 12000],
    ],
    asks: [
      [lastPrice * 1.001, 800],
      [lastPrice * 1.005, 1200],
    ],
    source: 'fallback-sim',
  };

  const result = analyzeMarketDecision('SOLUSDT', '1h', candles, orderbook);
  assert.ok(result.verdict === 'BUY' || result.verdict === 'STRONG_BUY');
  assert.equal(result.executionPlan.bias, 'LONG');
  assert.ok(result.executionPlan.stopLoss < result.executionPlan.optimalEntry);
  assert.ok(result.executionPlan.takeProfit1 > result.executionPlan.optimalEntry);
  assert.ok(result.executionPlan.takeProfit2 > result.executionPlan.takeProfit1);
  assert.equal(result.executionPlan.rewardToRiskTp1, 1);
  const actualLongRr =
    (result.executionPlan.takeProfit1 - result.executionPlan.optimalEntry) /
    (result.executionPlan.optimalEntry - result.executionPlan.stopLoss);
  assert.ok(Math.abs(actualLongRr - 1) < 1e-6);
  assert.ok(result.confidencePercent >= 55);
});

test('calculatePositionSizing computes exact risk amount and coin quantity', () => {
  const sizing = calculatePositionSizing({
    capitalUsdt: 2000,
    riskPercent: 2,
    entryPrice: 100,
    stopLoss: 95,
    takeProfit: 115,
  });

  assert.equal(sizing.valid, true);
  assert.equal(sizing.riskAmountUsdt, 40);
  assert.equal(sizing.positionSizeCoins, 8);
  assert.equal(sizing.positionValueUsdt, 800);
  assert.equal(sizing.potentialProfitUsdt, 120);
  assert.equal(sizing.rewardToRisk, 3);
});

test('calculatePositionSizing rejects invalid stop loss equal to entry', () => {
  const sizing = calculatePositionSizing({
    capitalUsdt: 1000,
    riskPercent: 1,
    entryPrice: 100,
    stopLoss: 100,
    takeProfit: 110,
  });
  assert.equal(sizing.valid, false);
});

test('analyzeMarketDecision keeps SHORT take profit levels realistic and enforces exact 1:1 R:R on high-ATR candles', () => {
  const candles: Candle[] = [];
  let price = 30.0;
  const now = Date.now();
  for (let i = 0; i < 100; i++) {
    const open = price;
    const isBounce = i % 3 === 1 && i < 95;
    const close = isBounce ? open + 0.12 : open - 0.18;
    const high = Math.max(open, close) * 1.035;
    const low = Math.min(open, close) * 0.996;
    const vol = i >= 97 ? 4_000_000 : 1_000_000;
    candles.push({
      openTime: now - (100 - i) * 7 * 86400000,
      open,
      high,
      low,
      close,
      volume: vol,
      closeTime: now - (99 - i) * 7 * 86400000 - 1000,
      quoteVolume: close * vol,
      trades: 5000,
    });
    price = close;
  }
  const last = candles[candles.length - 1].close;
  const orderbook: OrderbookData = {
    symbol: 'NEARUSDT',
    lastUpdateId: 1,
    bids: [[last * 0.99, 1000]],
    asks: [[last * 1.01, 5000]],
    source: 'binance-live',
  };
  const result = analyzeMarketDecision('NEARUSDT', '1w', candles, orderbook);
  assert.equal(result.executionPlan.bias, 'SHORT');
  assert.equal(result.executionPlan.rewardToRiskTp1, 1);
  const actualShortRr =
    (result.executionPlan.optimalEntry - result.executionPlan.takeProfit1) /
    (result.executionPlan.stopLoss - result.executionPlan.optimalEntry);
  assert.ok(Math.abs(actualShortRr - 1) < 1e-6);
  assert.ok(result.executionPlan.takeProfit1 > result.executionPlan.takeProfit2);
  assert.ok(result.executionPlan.takeProfit2 > result.executionPlan.takeProfit3);
  assert.ok(result.executionPlan.takeProfit3 > last * 0.2);
});

test('computeMultiTimeframeRecommendation uses 30m/1h/1d/1w for analysis and selects 1m/5m/15m entry with 1:1 R:R', () => {
  const uptrend = buildUptrendCandles(120);
  const lastPrice = uptrend[uptrend.length - 1].close;
  const bullBook: OrderbookData = {
    symbol: 'BTCUSDT',
    lastUpdateId: 1,
    bids: [[lastPrice * 0.999, 8000]],
    asks: [[lastPrice * 1.001, 1500]],
    source: 'binance-live',
  };

  // Flat sideways candles for 1m/15m to verify bias comes from analysis TFs (30m/1h/1d/1w) while entry stays 1m/5m/15m
  const sideways: Candle[] = uptrend.map((c, idx) => ({
    ...c,
    open: lastPrice,
    high: lastPrice * 1.001,
    low: lastPrice * 0.999,
    close: lastPrice * (idx % 2 === 0 ? 1.0002 : 0.9998),
  }));

  const mtf = computeMultiTimeframeRecommendation('BTCUSDT', {
    '1m': analyzeMarketDecision('BTCUSDT', '1m', sideways, bullBook),
    '5m': analyzeMarketDecision('BTCUSDT', '5m', uptrend, bullBook),
    '15m': analyzeMarketDecision('BTCUSDT', '15m', sideways, bullBook),
    '30m': analyzeMarketDecision('BTCUSDT', '30m', uptrend, bullBook),
    '1h': analyzeMarketDecision('BTCUSDT', '1h', uptrend, bullBook),
    '1d': analyzeMarketDecision('BTCUSDT', '1d', uptrend, bullBook),
    '1w': analyzeMarketDecision('BTCUSDT', '1w', uptrend, bullBook),
  });

  assert.equal(mtf.timeframes.length, 7);
  assert.equal(mtf.timeframes.find((t) => t.timeframe === '1w')?.role, 'ANALYSIS');
  assert.equal(mtf.timeframes.find((t) => t.timeframe === '1d')?.role, 'ANALYSIS');
  assert.equal(mtf.timeframes.find((t) => t.timeframe === '1h')?.role, 'ANALYSIS');
  assert.equal(mtf.timeframes.find((t) => t.timeframe === '30m')?.role, 'ANALYSIS');
  assert.equal(mtf.timeframes.find((t) => t.timeframe === '15m')?.role, 'ENTRY');
  assert.equal(mtf.timeframes.find((t) => t.timeframe === '5m')?.role, 'ENTRY');
  assert.equal(mtf.timeframes.find((t) => t.timeframe === '1m')?.role, 'ENTRY');

  assert.equal(mtf.analysisTimeframesBias.tf1d, 'LONG');
  assert.equal(mtf.analysisTimeframesBias.tf1w, 'LONG');
  assert.equal(mtf.analysisTimeframesBias.combinedBias, 'LONG');
  assert.equal(mtf.recommendedBias, 'LONG');
  assert.equal(mtf.recommendedTimeframe, '5m');
  assert.equal(mtf.recommendedRiskReward, '1:1');
  assert.ok(mtf.recommendedOptimalEntry > 0);
  assert.ok(mtf.recommendedStopLoss < mtf.recommendedOptimalEntry);
  assert.ok(mtf.recommendedTakeProfit1 > mtf.recommendedOptimalEntry);

  const entryRr =
    (mtf.recommendedTakeProfit1 - mtf.recommendedOptimalEntry) /
    (mtf.recommendedOptimalEntry - mtf.recommendedStopLoss);
  assert.ok(Math.abs(entryRr - 1) < 1e-6);
});

test('analyzeMarketDecision ignores unclosed forming candle movements until candle close', () => {
  const now = Date.now();
  const baseCandles = buildUptrendCandles(100);
  // Shift timestamps so all 100 baseCandles are strictly closed before `now`
  const closedSet: Candle[] = baseCandles.map((c, idx) => ({
    ...c,
    openTime: now - (100 - idx) * 900_000,
    closeTime: now - (99 - idx) * 900_000 - 1,
  }));
  const lastClosed = closedSet[closedSet.length - 1];
  const orderbook: OrderbookData = {
    symbol: 'BTCUSDT',
    lastUpdateId: 1,
    bids: [[lastClosed.close * 0.999, 5000]],
    asks: [[lastClosed.close * 1.001, 1500]],
    source: 'binance-live',
  };

  // Unclosed forming candle with dramatic mid-bar crash
  const formingCrash: Candle = {
    openTime: lastClosed.closeTime + 1,
    open: lastClosed.close,
    high: lastClosed.close,
    low: lastClosed.close * 0.5,
    close: lastClosed.close * 0.55,
    volume: 999999,
    closeTime: lastClosed.closeTime + 900_000,
    quoteVolume: 999999,
    trades: 9000,
  };

  const beforeMove = analyzeMarketDecision('BTCUSDT', '15m', closedSet, orderbook, now);
  const whileMoving = analyzeMarketDecision(
    'BTCUSDT',
    '15m',
    [...closedSet, formingCrash],
    orderbook,
    now
  );

  // Must remain identical while formingCrash is unclosed
  assert.equal(whileMoving.isClosedCandleBasis, true);
  assert.equal(whileMoving.analyzedCandleOpenTime, lastClosed.openTime);
  assert.equal(whileMoving.currentPrice, beforeMove.currentPrice);
  assert.equal(whileMoving.verdict, beforeMove.verdict);
  assert.equal(whileMoving.executionPlan.optimalEntry, beforeMove.executionPlan.optimalEntry);

  // Once formingCrash closes (now >= formingCrash.closeTime), analysis updates to the closed candle
  const afterClose = analyzeMarketDecision(
    'BTCUSDT',
    '15m',
    [...closedSet, formingCrash],
    orderbook,
    formingCrash.closeTime + 10
  );
  assert.equal(afterClose.analyzedCandleOpenTime, formingCrash.openTime);
  assert.equal(afterClose.currentPrice, formingCrash.close);
});

test('strict > 70% entry gate blocks entries at or below 70% and allows entries strictly above 70%', () => {
  assert.equal(MIN_ENTRY_MOMENTUM_PERCENT, 70);

  const atExact70Bull = evaluateEntrySignalFromScores(70, 20);
  assert.equal(atExact70Bull.canEnter, false);
  assert.equal(atExact70Bull.side, 'NEUTRAL');
  assert.equal(atExact70Bull.verdict, 'WAIT');

  const at68Bear = evaluateEntrySignalFromScores(15, 68);
  assert.equal(at68Bear.canEnter, false);
  assert.equal(at68Bear.side, 'NEUTRAL');

  const above70Bull = evaluateEntrySignalFromScores(71, 15);
  assert.equal(above70Bull.canEnter, true);
  assert.equal(above70Bull.side, 'LONG');
  assert.equal(above70Bull.verdict, 'BUY');

  const above70Bear = evaluateEntrySignalFromScores(12, 74);
  assert.equal(above70Bear.canEnter, true);
  assert.equal(above70Bear.side, 'SHORT');
  assert.equal(above70Bear.verdict, 'SELL');

  // Sideways candles produce <=70% scores -> WAIT / NEUTRAL (no entry)
  const flat: Candle[] = Array.from({ length: 80 }, (_, idx) => {
    const base = 100;
    const close = base * (idx % 2 === 0 ? 1.0005 : 0.9995);
    return {
      openTime: Date.now() - (80 - idx) * 900_000,
      open: base,
      high: base * 1.001,
      low: base * 0.999,
      close,
      volume: 1000,
      closeTime: Date.now() - (79 - idx) * 900_000 - 1,
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
  const sidewaysResult = analyzeMarketDecision('BTCUSDT', '15m', flat, balancedBook);
  assert.ok(sidewaysResult.bullishScore <= 70 && sidewaysResult.bearishScore <= 70);
  assert.equal(sidewaysResult.verdict, 'WAIT');
  assert.equal(sidewaysResult.executionPlan.bias, 'NEUTRAL');
});

