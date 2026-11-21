import type { Candle } from '../types/market';

/**
 * Merges an incoming live Binance kline bar into an ordered Candle array.
 * - Updates the last candle in-place (immutably) when openTime matches.
 * - Appends a new candle and preserves the max window size when openTime advances.
 * - Ignores out-of-order older timestamps.
 */
export function mergeLiveCandle(
  candles: Candle[],
  incoming: Candle,
  maxLength = 250
): Candle[] {
  if (candles.length === 0) {
    return [incoming];
  }

  const last = candles[candles.length - 1];
  if (incoming.openTime === last.openTime) {
    const next = candles.slice();
    next[next.length - 1] = incoming;
    return next;
  }

  if (incoming.openTime > last.openTime) {
    const next = [...candles, incoming];
    if (next.length > maxLength) {
      return next.slice(next.length - maxLength);
    }
    return next;
  }

  return candles;
}

export const INTERVAL_DURATION_MS: Record<string, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
};

export interface ClosedCandlePartition {
  closedCandles: Candle[];
  formingCandle: Candle | null;
  lastClosedCandle: Candle | null;
  nextCandleCloseTime: number | null;
}

/**
 * Splits ordered candles into confirmed closed candles (`closeTime <= nowMs`)
 * and the currently forming (unclosed) candle so indicator analysis never repaints mid-bar.
 */
export function partitionClosedCandles(
  candles: Candle[],
  nowMs = Date.now(),
  interval?: string
): ClosedCandlePartition {
  if (candles.length === 0) {
    return {
      closedCandles: [],
      formingCandle: null,
      lastClosedCandle: null,
      nextCandleCloseTime: null,
    };
  }

  const closedCandles: Candle[] = [];
  let formingCandle: Candle | null = null;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (c.closeTime <= nowMs) {
      closedCandles.push(c);
    } else if (i === candles.length - 1) {
      formingCandle = c;
    }
  }

  if (closedCandles.length === 0 && candles.length >= 2) {
    const fallbackClosed = candles.slice(0, candles.length - 1);
    const activeForming = candles[candles.length - 1];
    return {
      closedCandles: fallbackClosed,
      formingCandle: activeForming,
      lastClosedCandle: fallbackClosed[fallbackClosed.length - 1],
      nextCandleCloseTime: activeForming.closeTime,
    };
  }

  if (closedCandles.length === 0) {
    // Single-candle edge case
    return {
      closedCandles: [candles[0]],
      formingCandle: null,
      lastClosedCandle: candles[0],
      nextCandleCloseTime: candles[0].closeTime,
    };
  }

  const lastClosedCandle = closedCandles[closedCandles.length - 1];
  const intervalMs = interval ? INTERVAL_DURATION_MS[interval] : undefined;
  const fallbackSpan = Math.max(
    60_000,
    lastClosedCandle.closeTime - lastClosedCandle.openTime + 1
  );
  const nextCandleCloseTime = formingCandle
    ? formingCandle.closeTime
    : lastClosedCandle.closeTime + (intervalMs ?? fallbackSpan);

  return {
    closedCandles,
    formingCandle,
    lastClosedCandle,
    nextCandleCloseTime,
  };
}
