import test from 'node:test';
import assert from 'node:assert/strict';
import type { Candle } from '../types/market';
import {
  calculateADX,
  calculateCCI,
  calculateIchimoku,
  calculateOBV,
  calculateStochastic,
  calculateVWAP,
  calculateWilliamsR,
  computeAllIndicators,
} from './indicators';
import {
  computeAdvancedTechnicalAnalysis,
  computeTrendlineChannel,
  detectCandlestickPatterns,
} from './advancedAnalysis';

function makeBar(
  openTime: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 1000
): Candle {
  return {
    openTime,
    open,
    high,
    low,
    close,
    volume,
    closeTime: openTime + 3_599_999,
    quoteVolume: close * volume,
    trades: 100,
  };
}

test('detectCandlestickPatterns detects Hammer and Bullish Engulfing accurately', () => {
  const t0 = 1_700_000_000_000;
  const c1 = makeBar(t0, 105, 106, 100, 101); // bearish bar
  const c2 = makeBar(t0 + 3_600_000, 100.5, 107, 99.5, 106.5); // engulfs c1 body (101..105)
  const hammer = makeBar(t0 + 7_200_000, 105.5, 107.0, 99.0, 106.9); // tiny upper wick, long lower wick

  const eng = detectCandlestickPatterns([makeBar(t0 - 3_600_000, 106, 107, 104, 105), c1, c2]);
  assert.ok(eng.some((p) => p.name === 'Bullish Engulfing'));

  const ham = detectCandlestickPatterns([c1, c2, hammer]);
  assert.ok(ham.some((p) => p.name === 'Hammer'));
});

test('Ichimoku, ADX, Stochastic, CCI, Williams %R, OBV, VWAP, Fibonacci & Pivot compute valid finite outputs', () => {
  const candles: Candle[] = [];
  let price = 100;
  const base = 1_700_000_000_000;
  for (let i = 0; i < 120; i++) {
    const open = price;
    const close = open * (i % 5 === 0 ? 0.996 : 1.005);
    const high = Math.max(open, close) * 1.004;
    const low = Math.min(open, close) * 0.995;
    candles.push(makeBar(base + i * 3_600_000, open, high, low, close, 1000 + i * 15));
    price = close;
  }

  const series = computeAllIndicators(candles);
  const ichi = calculateIchimoku(candles);
  const adx = calculateADX(candles, 14);
  const stoch = calculateStochastic(candles, 14, 3, 3);
  const cci = calculateCCI(candles, 20);
  const wr = calculateWilliamsR(candles, 14);
  const obv = calculateOBV(candles);
  const vwap = calculateVWAP(candles);

  const last = candles.length - 1;
  assert.ok(ichi.tenkan[last] !== null && ichi.kijun[last] !== null);
  assert.ok(ichi.spanA[last] !== null && ichi.spanB[last] !== null);
  assert.ok(adx.adx[last] !== null && adx.adx[last]! >= 0);
  assert.ok(stoch.k[last] !== null && stoch.k[last]! >= 0 && stoch.k[last]! <= 100);
  assert.ok(cci[last] !== null && Number.isFinite(cci[last]!));
  assert.ok(wr[last] !== null && wr[last]! <= 0 && wr[last]! >= -100);
  assert.ok(obv[last] !== null && obv[last]! > 0);
  assert.ok(vwap[last] !== null && vwap[last]! > 0);

  const channel = computeTrendlineChannel(candles);
  assert.equal(channel.direction, 'UP');

  const adv = computeAdvancedTechnicalAnalysis(candles, series, []);
  assert.ok(adv.fibonacci.ret382 > adv.fibonacci.ret500);
  assert.ok(adv.fibonacci.ret500 > adv.fibonacci.ret618);
  assert.ok(adv.fibonacci.ext1618 > adv.fibonacci.ext1272);
  assert.ok(adv.pivotPoints.r2 > adv.pivotPoints.r1);
  assert.ok(adv.pivotPoints.r1 > adv.pivotPoints.pp);
  assert.ok(adv.pivotPoints.pp > adv.pivotPoints.s1);
  assert.ok(adv.pivotPoints.s1 > adv.pivotPoints.s2);
});
