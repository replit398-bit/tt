export function formatPrice(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  if (val >= 1000) {
    return val.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  if (val >= 10) {
    return val.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 3,
    });
  }
  if (val >= 1) {
    return val.toLocaleString('en-US', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 4,
    });
  }
  return val.toLocaleString('en-US', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  });
}

export function formatUsdCompact(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

export function formatPercent(val: number | null | undefined, withSign = true): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  const prefix = withSign && val > 0 ? '+' : '';
  return `${prefix}${val.toFixed(2)}%`;
}

export function formatTimestamp(ms: number, timeframe: string): string {
  const d = new Date(ms);
  if (
    timeframe === '1d' ||
    timeframe === '3d' ||
    timeframe === '1w' ||
    timeframe === '1M'
  ) {
    return d.toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: '2-digit',
    });
  }
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
