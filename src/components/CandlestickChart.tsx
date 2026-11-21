import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AdvancedTechnicalAnalysis,
  Candle,
  IndicatorSeries,
  ManualExecutionPlan,
  SwingLevel,
} from '../types/market';
import { formatPrice, formatTimestamp } from '../utils/format';

interface CandlestickChartProps {
  symbol: string;
  timeframe: string;
  candles: Candle[];
  series: IndicatorSeries;
  executionPlan: ManualExecutionPlan;
  swingLevels: SwingLevel[];
  advanced?: AdvancedTechnicalAnalysis;
}

type OverlayKey =
  | 'sma20'
  | 'sma50'
  | 'ema9'
  | 'ema20'
  | 'ema21'
  | 'ema50'
  | 'ema200'
  | 'bb'
  | 'vwap'
  | 'ichimoku'
  | 'channel'
  | 'fibo'
  | 'pivot'
  | 'plan'
  | 'liquidity';

const OVERLAY_LABELS: { key: OverlayKey; label: string; color: string }[] = [
  { key: 'sma20', label: 'SMA 20', color: '#0284C7' },
  { key: 'sma50', label: 'SMA 50', color: '#7C3AED' },
  { key: 'ema20', label: 'EMA 20', color: '#0D9488' },
  { key: 'ema21', label: 'EMA 21', color: '#EA580C' },
  { key: 'ema50', label: 'EMA 50', color: '#6366F1' },
  { key: 'ema200', label: 'EMA 200', color: '#C026D3' },
  { key: 'bb', label: 'Bollinger', color: '#64748B' },
  { key: 'vwap', label: 'VWAP', color: '#0369A1' },
  { key: 'ichimoku', label: 'Ichimoku', color: '#10B981' },
  { key: 'channel', label: 'Channel', color: '#475569' },
  { key: 'fibo', label: 'Fibonacci', color: '#B45309' },
  { key: 'pivot', label: 'Pivot S/R', color: '#9333EA' },
  { key: 'plan', label: 'Entry/SL/TP', color: '#059669' },
  { key: 'liquidity', label: 'Likuiditas', color: '#E11D48' },
];

export const CandlestickChart: React.FC<CandlestickChartProps> = ({
  symbol,
  timeframe,
  candles,
  series,
  executionPlan,
  swingLevels,
  advanced,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [visibleCount, setVisibleCount] = useState<number>(90);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [activeOverlays, setActiveOverlays] = useState<Record<OverlayKey, boolean>>({
    sma20: true,
    sma50: true,
    ema9: false,
    ema20: false,
    ema21: true,
    ema50: false,
    ema200: false,
    bb: false,
    vwap: false,
    ichimoku: false,
    channel: false,
    fibo: false,
    pivot: false,
    plan: true,
    liquidity: true,
  });

  const toggleOverlay = (key: OverlayKey) => {
    setActiveOverlays((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const sliceStart = Math.max(0, candles.length - visibleCount);
  const visibleCandles = useMemo(
    () => candles.slice(sliceStart),
    [candles, sliceStart]
  );

  const inspectedGlobalIdx =
    hoverIdx !== null && hoverIdx >= 0 && hoverIdx < visibleCandles.length
      ? sliceStart + hoverIdx
      : candles.length - 1;

  const inspectedCandle = candles[inspectedGlobalIdx];

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || visibleCandles.length === 0) return;

    const renderChart = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(320, Math.floor(rect.width));
      const height = 420;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);

      // Clean white canvas background
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);

      const padLeft = 12;
      const padRight = 96;
      const padTop = 16;
      const priceHeight = 264;
      const volTop = padTop + priceHeight + 10;
      const volHeight = 46;
      const rsiTop = volTop + volHeight + 16;
      const rsiHeight = 52;
      const plotWidth = width - padLeft - padRight;

      let minPrice = Infinity;
      let maxPrice = -Infinity;
      let maxVol = 0;

      for (let i = 0; i < visibleCandles.length; i++) {
        const c = visibleCandles[i];
        const gIdx = sliceStart + i;
        if (c.low < minPrice) minPrice = c.low;
        if (c.high > maxPrice) maxPrice = c.high;
        if (c.volume > maxVol) maxVol = c.volume;

        if (activeOverlays.bb) {
          const bbu = series.bbUpper[gIdx];
          const bbl = series.bbLower[gIdx];
          if (bbu != null && bbu > maxPrice) maxPrice = bbu;
          if (bbl != null && bbl < minPrice) minPrice = bbl;
        }
      }

      if (activeOverlays.plan && executionPlan.bias !== 'NEUTRAL') {
        const planPrices = [
          executionPlan.stopLoss,
          executionPlan.optimalEntry,
          executionPlan.takeProfit1,
        ];
        for (const p of planPrices) {
          if (p > 0 && Math.abs(p - visibleCandles[visibleCandles.length - 1].close) / p < 0.2) {
            if (p < minPrice) minPrice = p;
            if (p > maxPrice) maxPrice = p;
          }
        }
      }

      const rangePad = (maxPrice - minPrice) * 0.08 || maxPrice * 0.02;
      minPrice -= rangePad;
      maxPrice += rangePad;
      const priceSpan = maxPrice - minPrice || 1;

      const yForPrice = (p: number) =>
        padTop + ((maxPrice - p) / priceSpan) * priceHeight;
      const stepX = plotWidth / visibleCandles.length;
      const candleW = Math.max(2, Math.min(11, stepX * 0.66));
      const xForIndex = (i: number) => padLeft + i * stepX + stepX / 2;

      const activePlanYs: number[] = [];
      if (activeOverlays.plan && executionPlan.bias !== 'NEUTRAL') {
        for (const p of [
          executionPlan.takeProfit1,
          executionPlan.optimalEntry,
          executionPlan.stopLoss,
        ]) {
          if (p >= minPrice && p <= maxPrice) {
            activePlanYs.push(yForPrice(p));
          }
        }
      }

      // Horizontal Grid Lines & Right Axis Labels
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.06)';
      ctx.fillStyle = '#64748B';
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';

      const gridSteps = 5;
      for (let g = 0; g <= gridSteps; g++) {
        const y = padTop + (priceHeight / gridSteps) * g;
        const val = maxPrice - (priceSpan / gridSteps) * g;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(padLeft + plotWidth, y);
        ctx.stroke();

        const collides = activePlanYs.some((py) => Math.abs(py - y) < 15);
        if (!collides) {
          ctx.fillText(formatPrice(val), padLeft + plotWidth + 8, y);
        }
      }

      // Swing Liquidity Levels (BSL / SSL)
      if (activeOverlays.liquidity) {
        for (const lvl of swingLevels) {
          if (lvl.price < minPrice || lvl.price > maxPrice) continue;
          const y = yForPrice(lvl.price);
          ctx.save();
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle =
            lvl.type === 'BSL'
              ? 'rgba(225, 29, 72, 0.45)'
              : 'rgba(5, 150, 105, 0.45)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(padLeft, y);
          ctx.lineTo(padLeft + plotWidth, y);
          ctx.stroke();
          ctx.restore();

          ctx.fillStyle = lvl.type === 'BSL' ? '#BE123C' : '#047857';
          ctx.font = '600 10px "JetBrains Mono", monospace';
          ctx.fillText(lvl.type, padLeft + 4, y - 7);
        }
      }

      // Manual Execution Plan Horizontal Lines (Entry / SL / TP1)
      if (activeOverlays.plan && executionPlan.bias !== 'NEUTRAL') {
        const usedTagYs: number[] = [];
        const drawPlanLine = (price: number, color: string, label: string) => {
          if (price < minPrice || price > maxPrice) return;
          const rawY = yForPrice(price);
          ctx.save();
          ctx.setLineDash([6, 3]);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(padLeft, rawY);
          ctx.lineTo(padLeft + plotWidth, rawY);
          ctx.stroke();
          ctx.restore();

          let tagY = rawY;
          for (const prevY of usedTagYs) {
            if (Math.abs(tagY - prevY) < 19) {
              tagY = prevY + (tagY >= prevY ? 19 : -19);
            }
          }
          usedTagYs.push(tagY);

          ctx.fillStyle = color;
          ctx.fillRect(padLeft + plotWidth + 4, tagY - 9, padRight - 8, 18);
          ctx.fillStyle = '#FFFFFF';
          ctx.font = 'bold 10px "JetBrains Mono", monospace';
          const shortVal =
            price >= 1000 ? Math.round(price).toString() : formatPrice(price);
          ctx.fillText(`${label} ${shortVal}`, padLeft + plotWidth + 7, tagY);
        };

        drawPlanLine(executionPlan.takeProfit1, '#059669', 'TP1');
        drawPlanLine(executionPlan.optimalEntry, '#D97706', 'ENT');
        drawPlanLine(executionPlan.stopLoss, '#DC2626', 'SL');
      }

      // Ichimoku Cloud Fill (Span A & Span B)
      if (activeOverlays.ichimoku) {
        ctx.save();
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < visibleCandles.length; i++) {
          const sa = series.ichimokuSpanA[sliceStart + i];
          const sb = series.ichimokuSpanB[sliceStart + i];
          if (sa == null || sb == null) continue;
          const x = xForIndex(i);
          const y = yForPrice(sa);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        for (let i = visibleCandles.length - 1; i >= 0; i--) {
          const sa = series.ichimokuSpanA[sliceStart + i];
          const sb = series.ichimokuSpanB[sliceStart + i];
          if (sa == null || sb == null) continue;
          ctx.lineTo(xForIndex(i), yForPrice(sb));
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(16, 185, 129, 0.11)';
        ctx.fill();
        ctx.restore();
      }

      // Trendline & Channel
      if (activeOverlays.channel && advanced) {
        const ch = advanced.trendlineChannel;
        const localStart = Math.max(0, ch.startIndex - sliceStart);
        const localEnd = Math.min(visibleCandles.length - 1, ch.endIndex - sliceStart);
        if (localEnd > localStart) {
          ctx.save();
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = 'rgba(71, 85, 105, 0.75)';
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          ctx.moveTo(xForIndex(localStart), yForPrice(ch.upperStart));
          ctx.lineTo(xForIndex(localEnd), yForPrice(ch.upperEnd));
          ctx.moveTo(xForIndex(localStart), yForPrice(ch.lowerStart));
          ctx.lineTo(xForIndex(localEnd), yForPrice(ch.lowerEnd));
          ctx.stroke();
          ctx.restore();
        }
      }

      // Fibonacci Retracement Levels (38.2%, 50%, 61.8%)
      if (activeOverlays.fibo && advanced) {
        const fibLevels = [
          { label: 'Fib 38.2%', price: advanced.fibonacci.ret382, color: 'rgba(180, 83, 9, 0.55)' },
          { label: 'Fib 50.0%', price: advanced.fibonacci.ret500, color: 'rgba(217, 119, 6, 0.65)' },
          { label: 'Fib 61.8%', price: advanced.fibonacci.ret618, color: 'rgba(180, 83, 9, 0.75)' },
        ];
        for (const fl of fibLevels) {
          if (fl.price < minPrice || fl.price > maxPrice) continue;
          const y = yForPrice(fl.price);
          ctx.save();
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = fl.color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(padLeft, y);
          ctx.lineTo(padLeft + plotWidth, y);
          ctx.stroke();
          ctx.restore();
          ctx.fillStyle = '#92400E';
          ctx.font = '600 10px "JetBrains Mono", monospace';
          ctx.fillText(fl.label, padLeft + 4, y - 6);
        }
      }

      // Classic Pivot Points (PP, R1, S1)
      if (activeOverlays.pivot && advanced) {
        const pivs = [
          { label: 'R1', price: advanced.pivotPoints.r1, color: 'rgba(147, 51, 234, 0.55)' },
          { label: 'PP', price: advanced.pivotPoints.pp, color: 'rgba(107, 33, 168, 0.75)' },
          { label: 'S1', price: advanced.pivotPoints.s1, color: 'rgba(147, 51, 234, 0.55)' },
        ];
        for (const pv of pivs) {
          if (pv.price < minPrice || pv.price > maxPrice) continue;
          const y = yForPrice(pv.price);
          ctx.save();
          ctx.setLineDash([2, 4]);
          ctx.strokeStyle = pv.color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(padLeft, y);
          ctx.lineTo(padLeft + plotWidth, y);
          ctx.stroke();
          ctx.restore();
          ctx.fillStyle = '#7E22CE';
          ctx.font = '600 10px "JetBrains Mono", monospace';
          ctx.fillText(pv.label, padLeft + 58, y - 6);
        }
      }

      // Bollinger Band Fill & Lines
      if (activeOverlays.bb) {
        ctx.save();
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < visibleCandles.length; i++) {
          const val = series.bbUpper[sliceStart + i];
          if (val == null) continue;
          const x = xForIndex(i);
          const y = yForPrice(val);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        for (let i = visibleCandles.length - 1; i >= 0; i--) {
          const val = series.bbLower[sliceStart + i];
          if (val == null) continue;
          ctx.lineTo(xForIndex(i), yForPrice(val));
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(100, 116, 139, 0.09)';
        ctx.fill();
        ctx.restore();
      }

      // Candlesticks & Volume Bars
      for (let i = 0; i < visibleCandles.length; i++) {
        const c = visibleCandles[i];
        const x = xForIndex(i);
        const isUp = c.close >= c.open;
        const bodyColor = isUp ? '#059669' : '#DC2626';

        ctx.strokeStyle = bodyColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, yForPrice(c.high));
        ctx.lineTo(x, yForPrice(c.low));
        ctx.stroke();

        const yOpen = yForPrice(c.open);
        const yClose = yForPrice(c.close);
        const bodyTop = Math.min(yOpen, yClose);
        const bodyH = Math.max(1.5, Math.abs(yClose - yOpen));
        ctx.fillStyle = bodyColor;
        ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);

        const vH = maxVol > 0 ? (c.volume / maxVol) * volHeight : 0;
        ctx.fillStyle = isUp ? 'rgba(5, 150, 105, 0.25)' : 'rgba(220, 38, 38, 0.25)';
        ctx.fillRect(x - candleW / 2, volTop + volHeight - vH, candleW, vH);
      }

      const drawLine = (
        arr: (number | null)[],
        color: string,
        lineWidth = 1.5
      ) => {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        let active = false;
        for (let i = 0; i < visibleCandles.length; i++) {
          const val = arr[sliceStart + i];
          if (val == null || val < minPrice * 0.5 || val > maxPrice * 1.5) {
            active = false;
            continue;
          }
          const x = xForIndex(i);
          const y = yForPrice(val);
          if (!active) {
            ctx.moveTo(x, y);
            active = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
        ctx.restore();
      };

      if (activeOverlays.bb) {
        drawLine(series.bbUpper, 'rgba(100, 116, 139, 0.55)', 1);
        drawLine(series.bbLower, 'rgba(100, 116, 139, 0.55)', 1);
      }
      if (activeOverlays.ichimoku) {
        drawLine(series.ichimokuTenkan, '#059669', 1.2);
        drawLine(series.ichimokuKijun, '#E11D48', 1.2);
      }
      if (activeOverlays.vwap) drawLine(series.vwap, '#0369A1', 1.6);
      if (activeOverlays.sma20) drawLine(series.sma20, '#0284C7', 1.5);
      if (activeOverlays.sma50) drawLine(series.sma50, '#7C3AED', 1.5);
      if (activeOverlays.ema9) drawLine(series.ema9, '#D97706', 1.4);
      if (activeOverlays.ema20) drawLine(series.ema20, '#0D9488', 1.5);
      if (activeOverlays.ema21) drawLine(series.ema21, '#EA580C', 1.6);
      if (activeOverlays.ema50) drawLine(series.ema50, '#6366F1', 1.6);
      if (activeOverlays.ema200) drawLine(series.ema200, '#C026D3', 1.7);

      // RSI Sub-pane
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.08)';
      ctx.beginPath();
      ctx.moveTo(padLeft, rsiTop);
      ctx.lineTo(padLeft + plotWidth, rsiTop);
      ctx.stroke();

      const yRsi70 = rsiTop + ((100 - 70) / 100) * rsiHeight;
      const yRsi30 = rsiTop + ((100 - 30) / 100) * rsiHeight;
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(100, 116, 139, 0.3)';
      ctx.beginPath();
      ctx.moveTo(padLeft, yRsi70);
      ctx.lineTo(padLeft + plotWidth, yRsi70);
      ctx.moveTo(padLeft, yRsi30);
      ctx.lineTo(padLeft + plotWidth, yRsi30);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = '#64748B';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillText('RSI 70', padLeft + plotWidth + 8, yRsi70);
      ctx.fillText('RSI 30', padLeft + plotWidth + 8, yRsi30);

      ctx.strokeStyle = '#0284C7';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let rsiStarted = false;
      for (let i = 0; i < visibleCandles.length; i++) {
        const val = series.rsi14[sliceStart + i];
        if (val == null) continue;
        const x = xForIndex(i);
        const y = rsiTop + ((100 - val) / 100) * rsiHeight;
        if (!rsiStarted) {
          ctx.moveTo(x, y);
          rsiStarted = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      // Hover Crosshair
      if (hoverIdx !== null && hoverIdx >= 0 && hoverIdx < visibleCandles.length) {
        const hx = xForIndex(hoverIdx);
        const hy = yForPrice(visibleCandles[hoverIdx].close);
        ctx.save();
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(hx, padTop);
        ctx.lineTo(hx, rsiTop + rsiHeight);
        ctx.moveTo(padLeft, hy);
        ctx.lineTo(padLeft + plotWidth, hy);
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();
    };

    renderChart();
    const observer = new ResizeObserver(renderChart);
    observer.observe(container);
    return () => observer.disconnect();
  }, [
    visibleCandles,
    sliceStart,
    series,
    activeOverlays,
    executionPlan,
    swingLevels,
    advanced,
    hoverIdx,
  ]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || visibleCandles.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const padLeft = 12;
    const padRight = 96;
    const plotWidth = rect.width - padLeft - padRight;
    if (x < padLeft || x > padLeft + plotWidth) {
      setHoverIdx(null);
      return;
    }
    const idx = Math.min(
      visibleCandles.length - 1,
      Math.max(0, Math.floor(((x - padLeft) / plotWidth) * visibleCandles.length))
    );
    setHoverIdx(idx);
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      {/* Chart Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-200">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-900 whitespace-nowrap">
            Grafik {symbol} ({timeframe})
          </span>
          <span className="text-xs text-slate-400">·</span>
          <div className="flex items-center gap-1">
            {[60, 90, 140, 200].map((count) => (
              <button
                key={count}
                type="button"
                onClick={() => setVisibleCount(count)}
                className={`px-2 py-1 text-xs font-mono rounded transition-colors whitespace-nowrap shrink-0 ${
                  visibleCount === count
                    ? 'bg-slate-900 text-white font-semibold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                {count}c
              </button>
            ))}
          </div>
        </div>

        {/* Indicator Toggle Controls */}
        <div className="flex flex-wrap items-center gap-1.5">
          {OVERLAY_LABELS.map((item) => {
            const active = activeOverlays[item.key];
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => toggleOverlay(item.key)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-slate-50 border-slate-300 text-slate-900 font-medium'
                    : 'bg-white border-slate-200 text-slate-500 hover:text-slate-800'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-xs shrink-0"
                  style={{ backgroundColor: active ? item.color : '#CBD5E1' }}
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Live OHLCV Inspection Bar */}
      {inspectedCandle && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs font-mono tabular-nums text-slate-600">
          <span className="text-slate-800 font-medium">
            {formatTimestamp(inspectedCandle.openTime, timeframe)}
          </span>
          <span>
            O: <strong className="text-slate-900">{formatPrice(inspectedCandle.open)}</strong>
          </span>
          <span>
            H: <strong className="text-emerald-700">{formatPrice(inspectedCandle.high)}</strong>
          </span>
          <span>
            L: <strong className="text-rose-700">{formatPrice(inspectedCandle.low)}</strong>
          </span>
          <span>
            C: <strong className="text-slate-900">{formatPrice(inspectedCandle.close)}</strong>
          </span>
          {series.sma20[inspectedGlobalIdx] != null && (
            <span className="text-sky-700 font-medium">
              SMA20: {formatPrice(series.sma20[inspectedGlobalIdx])}
            </span>
          )}
          {series.ema21[inspectedGlobalIdx] != null && (
            <span className="text-orange-700 font-medium">
              EMA21: {formatPrice(series.ema21[inspectedGlobalIdx])}
            </span>
          )}
          {series.rsi14[inspectedGlobalIdx] != null && (
            <span className="text-slate-800 font-medium">
              RSI: {series.rsi14[inspectedGlobalIdx]!.toFixed(1)}
            </span>
          )}
        </div>
      )}

      {/* Canvas Plot */}
      <div
        ref={containerRef}
        className="w-full relative bg-white"
        data-testid="price-chart"
        aria-label={`Grafik candlestick ${symbol} timeframe ${timeframe}`}
      >
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIdx(null)}
          className="block w-full cursor-crosshair"
        />
      </div>
    </section>
  );
};
