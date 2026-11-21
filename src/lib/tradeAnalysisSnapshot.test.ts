import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMarketDecision } from './decisionEngine';
import {
  createSimulatedTradeFromAnalysis,
  evaluateOpenTradeAgainstCandles,
  evaluateOpenTradeAgainstLivePrice,
} from './simulationEngine';
import { analyzeRunningTradeReversal, formatDurationId } from './tradeAnalysisSnapshot';
import type { Candle, OrderbookData } from '../types/market';

function buildSeries(count = 120, start = 100, stepPct = 0.006): Candle[] {
  const candles: Candle[] = [];
  let price = start;
  const now = Date.now() - 10_000_000;
  for (let i = 0; i < count; i++) {
    const open = price;
    const close = open * (1 + stepPct);
    const high = Math.max(open, close) * 1.003;
    const low = Math.min(open, close) * 0.998;
    const vol = i >= count - 10 ? 3400 : 1200;
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

test('createSimulatedTradeFromAnalysis saves full technical prediction entryAnalysis', () => {
  const candles = buildSeries(120, 100, 0.006);
  const lastPrice = candles[candles.length - 1].close;
  const orderbook: OrderbookData = {
    symbol: 'ETHUSDT',
    lastUpdateId: 10,
    bids: [[lastPrice * 0.999, 8000]],
    asks: [[lastPrice * 1.001, 1500]],
    source: 'binance-live',
  };

  const entryAnalysisResult = analyzeMarketDecision(
    'ETHUSDT',
    '15m',
    candles,
    orderbook,
    candles[candles.length - 1].closeTime + 10
  );

  const trade = createSimulatedTradeFromAnalysis({
    symbol: 'ETHUSDT',
    market: 'spot',
    timeframe: '15m',
    analysis: entryAnalysisResult,
    sourceMode: 'AUTO_LIVE',
    executedAt: candles[candles.length - 1].closeTime + 20,
    cycleSlotTime: candles[candles.length - 1].closeTime,
    liveEntryPrice: lastPrice,
    riskUsd: 5,
  });

  assert.ok(trade, 'entryAnalysis test expects qualified trade >70%');
  assert.ok(trade.entryAnalysis, 'entryAnalysis must be stored on trade');
  assert.ok(trade.entryAnalysis.predictionSummary.includes('Prediksi LONG'));
  assert.ok(trade.entryAnalysis.supportingReasons.length >= 1);
  assert.ok(trade.entryAnalysis.snapshot.rsi14 !== null);
  assert.ok(trade.entryAnalysis.snapshot.ema20 !== null);
  assert.equal(trade.entryAnalysis.snapshot.orderbookBias, 'BID_DOMINANT');
  assert.ok(trade.entryAnalysis.invalidationNote.length > 0);
});

test('evaluateOpenTradeAgainstCandles & LivePrice save exitAnalysis with WIN/LOSS response and reasons', () => {
  const candles = buildSeries(120, 100, 0.006);
  const lastPrice = candles[candles.length - 1].close;
  const bidOb: OrderbookData = {
    symbol: 'BTCUSDT',
    lastUpdateId: 11,
    bids: [[lastPrice * 0.999, 9000]],
    asks: [[lastPrice * 1.001, 1200]],
    source: 'binance-live',
  };

  const entryResult = analyzeMarketDecision(
    'BTCUSDT',
    '5m',
    candles,
    bidOb,
    candles[candles.length - 1].closeTime + 10
  );

  const trade = createSimulatedTradeFromAnalysis({
    symbol: 'BTCUSDT',
    market: 'spot',
    timeframe: '5m',
    analysis: entryResult,
    sourceMode: 'AUTO_LIVE',
    executedAt: candles[candles.length - 1].closeTime + 20,
    cycleSlotTime: candles[candles.length - 1].closeTime,
    liveEntryPrice: lastPrice,
    riskUsd: 5,
  });

  assert.ok(trade, 'exitAnalysis test expects qualified trade >70%');

  // 1. WIN path via candle TP with exit technical snapshot
  const tpCandle: Candle = {
    openTime: trade.executedAt + 1000,
    open: trade.entryPrice,
    high: trade.takeProfit * 1.005,
    low: trade.entryPrice * 0.999,
    close: trade.takeProfit,
    volume: 1800,
    closeTime: trade.executedAt + 61_000,
    quoteVolume: 1800 * trade.takeProfit,
    trades: 200,
  };
  const winExitResult = analyzeMarketDecision(
    'BTCUSDT',
    '5m',
    [...candles, tpCandle],
    bidOb,
    tpCandle.closeTime + 10
  );
  const winTrade = evaluateOpenTradeAgainstCandles(trade, [tpCandle], winExitResult);

  assert.equal(winTrade.status, 'WIN');
  assert.ok(winTrade.exitAnalysis);
  assert.equal(winTrade.exitAnalysis.outcome, 'WIN');
  assert.equal(winTrade.exitAnalysis.triggerType, 'HIT_TP_CANDLE');
  assert.ok(winTrade.exitAnalysis.responseTitle.includes('BERHASIL'));
  assert.ok(winTrade.exitAnalysis.reasons.length >= 2);
  assert.ok(winTrade.exitAnalysis.exitTechnical !== null);
  assert.ok(winTrade.exitAnalysis.lessonLearned.length > 0);

  // 2. LOSS path via live price SL with orderbook flip at exit
  const askFlippedOb: OrderbookData = {
    symbol: 'BTCUSDT',
    lastUpdateId: 12,
    bids: [[trade.stopLoss * 0.999, 900]],
    asks: [[trade.stopLoss * 1.001, 9500]],
    source: 'binance-live',
  };
  const downtrendExitCandles = buildSeries(100, trade.entryPrice, -0.004);
  const lossExitResult = analyzeMarketDecision(
    'BTCUSDT',
    '5m',
    downtrendExitCandles,
    askFlippedOb,
    trade.executedAt + 125_000
  );
  const lossTrade = evaluateOpenTradeAgainstLivePrice(
    trade,
    trade.stopLoss * 0.998,
    trade.executedAt + 125_000,
    lossExitResult
  );

  assert.equal(lossTrade.status, 'LOSS');
  assert.ok(lossTrade.exitAnalysis);
  assert.equal(lossTrade.exitAnalysis.outcome, 'LOSS');
  assert.equal(lossTrade.exitAnalysis.triggerType, 'HIT_SL_LIVE');
  assert.ok(lossTrade.exitAnalysis.responseTitle.includes('GAGAL'));
  assert.ok(
    lossTrade.exitAnalysis.reasons.some((r) => r.includes('pergeseran dominasi orderbook')),
    'Should detect orderbook flip in LOSS reasoning'
  );
  assert.ok(lossTrade.exitAnalysis.exitTechnical !== null);
});

test('formatDurationId formats seconds, minutes, and hours cleanly', () => {
  assert.equal(formatDurationId(45_000), '45 dtk');
  assert.equal(formatDurationId(125_000), '2 mnt 5 dtk');
  assert.equal(formatDurationId(3_720_000), '1 jam 2 mnt');
});

test('analyzeRunningTradeReversal detects bearish reversal on LONG trade and flags TAKE_PROFIT_REVERSAL when profitable', () => {
  const uptrend = buildSeries(100, 100, 0.006);
  const entryPrice = uptrend[uptrend.length - 1].close;
  const bidOb: OrderbookData = {
    symbol: 'NEARUSDT',
    lastUpdateId: 1,
    bids: [[entryPrice * 0.999, 8500]],
    asks: [[entryPrice * 1.001, 1000]],
    source: 'binance-live',
  };
  const entryRes = analyzeMarketDecision('NEARUSDT', '15m', uptrend, bidOb, Date.now());
  const trade = createSimulatedTradeFromAnalysis({
    symbol: 'NEARUSDT',
    market: 'spot',
    timeframe: '15m',
    analysis: entryRes,
    sourceMode: 'AUTO_LIVE',
    executedAt: Date.now() - 120_000,
    cycleSlotTime: Date.now() - 120_000,
    liveEntryPrice: entryPrice,
    riskUsd: 5,
  });
  assert.ok(trade);

  const wideTrade = {
    ...trade,
    stopLoss: trade.entryPrice * 0.84,
    takeProfit: trade.entryPrice * 1.16,
  };
  const riskDist = wideTrade.takeProfit - wideTrade.entryPrice;
  const reversalCandles: Candle[] = [...uptrend];
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
    symbol: 'NEARUSDT',
    lastUpdateId: 2,
    bids: [[latestRevClose * 0.999, 700]],
    asks: [[latestRevClose * 1.001, 9500]],
    source: 'binance-live',
  };
  const oppRes = analyzeMarketDecision(
    'NEARUSDT',
    '15m',
    reversalCandles,
    askOb,
    lastClosed.closeTime + 500
  );
  const monitor = analyzeRunningTradeReversal({
    trade: wideTrade,
    analysis: oppRes,
    livePrice: latestRevClose,
  });

  assert.equal(monitor.shouldAutoTakeProfit, true);
  assert.equal(monitor.status, 'TAKE_PROFIT_REVERSAL');
  assert.ok(monitor.reversalScore >= 55);
  assert.ok(monitor.signals.length >= 2);
});
