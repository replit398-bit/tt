import test from 'node:test';
import assert from 'node:assert/strict';
import type { Candle } from '../types/market';
import { mergeLiveCandle, partitionClosedCandles } from './realtime';

function makeCandle(openTime: number, close: number, closeTime = openTime + 59999): Candle {
  return {
    openTime,
    open: close - 1,
    high: close + 2,
    low: close - 2,
    close,
    volume: 100,
    closeTime,
    quoteVolume: close * 100,
    trades: 25,
  };
}

test('mergeLiveCandle updates current candle in place when openTime matches', () => {
  const initial = [makeCandle(1000, 100), makeCandle(2000, 105)];
  const tick = makeCandle(2000, 108);
  const merged = mergeLiveCandle(initial, tick, 200);

  assert.equal(merged.length, 2);
  assert.equal(merged[1].close, 108);
  assert.equal(initial[1].close, 105);
});

test('mergeLiveCandle appends new candle and trims to maxLength when openTime advances', () => {
  const initial = [makeCandle(1000, 100), makeCandle(2000, 105), makeCandle(3000, 107)];
  const nextBar = makeCandle(4000, 111);
  const merged = mergeLiveCandle(initial, nextBar, 3);

  assert.equal(merged.length, 3);
  assert.equal(merged[0].openTime, 2000);
  assert.equal(merged[2].openTime, 4000);
  assert.equal(merged[2].close, 111);
});

test('mergeLiveCandle ignores stale out-of-order candles', () => {
  const initial = [makeCandle(2000, 105), makeCandle(3000, 107)];
  const stale = makeCandle(1000, 99);
  const merged = mergeLiveCandle(initial, stale, 200);

  assert.equal(merged.length, 2);
  assert.equal(merged[0].openTime, 2000);
});

test('partitionClosedCandles separates closed bars from live forming bar', () => {
  const now = 1_700_000_090_000;
  const c1 = makeCandle(now - 120_000, 100, now - 60_001);
  const c2 = makeCandle(now - 60_000, 104, now - 1);
  const forming = makeCandle(now, 120, now + 59_999);

  const part = partitionClosedCandles([c1, c2, forming], now, '1m');
  assert.equal(part.closedCandles.length, 2);
  assert.equal(part.lastClosedCandle?.openTime, c2.openTime);
  assert.equal(part.formingCandle?.openTime, forming.openTime);
  assert.equal(part.nextCandleCloseTime, forming.closeTime);
});
