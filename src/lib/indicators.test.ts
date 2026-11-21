import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeOrderbookLiquidity,
  calculateATR,
  calculateBollingerBands,
  calculateEMA,
  calculateMACD,
  calculateRSI,
  calculateSMA,
  estimateOrderSlippage,
} from './indicators';
import { generateFallbackCandles } from './fallbackMarketData';

test('calculateSMA computes exact rolling averages', () => {
  const values = [10, 20, 30, 40, 50];
  const sma3 = calculateSMA(values, 3);
  assert.deepEqual(sma3, [null, null, 20, 30, 40]);
});

test('calculateEMA seeds with SMA and applies smoothing multiplier', () => {
  const values = [10, 20, 30, 40, 50];
  const ema3 = calculateEMA(values, 3);
  assert.equal(ema3[0], null);
  assert.equal(ema3[1], null);
  assert.equal(ema3[2], 20);
  // k = 2 / (3 + 1) = 0.5 -> (40 - 20)*0.5 + 20 = 30
  assert.equal(ema3[3], 30);
  // (50 - 30)*0.5 + 30 = 40
  assert.equal(ema3[4], 40);
});

test('calculateRSI returns bounded 0..100 values and detects uptrend strength', () => {
  const rising = Array.from({ length: 30 }, (_, i) => 100 + i * 2);
  const rsiRising = calculateRSI(rising, 14);
  assert.equal(rsiRising[13], null);
  assert.equal(rsiRising[29], 100);

  const falling = Array.from({ length: 30 }, (_, i) => 200 - i * 2);
  const rsiFalling = calculateRSI(falling, 14);
  assert.equal(rsiFalling[29], 0);
});

test('calculateMACD and Bollinger Bands produce valid aligned arrays', () => {
  const candles = generateFallbackCandles('BTCUSDT', '1h', 80);
  const closes = candles.map((c) => c.close);
  const macd = calculateMACD(closes);
  assert.equal(macd.macdLine.length, 80);
  assert.ok(macd.macdLine[79] !== null);
  assert.ok(macd.signalLine[79] !== null);
  assert.ok(macd.histogram[79] !== null);

  const bb = calculateBollingerBands(closes, 20, 2);
  const lastUpper = bb.upper[79]!;
  const lastMid = bb.middle[79]!;
  const lastLower = bb.lower[79]!;
  assert.ok(lastUpper > lastMid && lastMid > lastLower);
});

test('calculateATR returns positive volatility measurement', () => {
  const candles = generateFallbackCandles('ETHUSDT', '4h', 50);
  const atr = calculateATR(candles, 14);
  assert.equal(atr[13], null);
  assert.ok((atr[49] ?? 0) > 0);
});

test('analyzeOrderbookLiquidity detects bid dominance and slippage correctly', () => {
  const bids: [number, number][] = [
    [99.9, 100], // $9,990
    [99.5, 500], // $49,750
    [99.0, 400], // $39,600
  ];
  const asks: [number, number][] = [
    [100.1, 50], // $5,005
    [100.5, 100], // $10,050
    [101.0, 150], // $15,150
  ];

  const metrics = analyzeOrderbookLiquidity(bids, asks);
  assert.equal(metrics.bias, 'BID_DOMINANT');
  assert.ok(metrics.imbalanceRatio > 0.7);
  assert.equal(metrics.topBidWalls[0].price, 99.5);

  const slippage = estimateOrderSlippage('BUY', 10000, bids, asks);
  assert.equal(slippage.filledUsd, 10000);
  assert.equal(slippage.unfilledUsd, 0);
  assert.equal(slippage.levelsConsumed, 2);
  assert.ok(slippage.avgFillPrice > 100.1 && slippage.avgFillPrice < 100.5);
});
