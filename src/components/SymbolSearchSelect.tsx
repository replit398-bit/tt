import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { formatUsdCompact } from '../utils/format';

export interface SymbolOption {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  contractType?: string;
  quoteVolume?: number;
}

interface SymbolSearchSelectProps {
  value: string;
  options: SymbolOption[];
  onChange: (symbol: string) => void;
}

type QuoteFilter = 'ALL' | 'USDT' | 'USDC' | 'OTHER';

export const SymbolSearchSelect: React.FC<SymbolSearchSelectProps> = ({
  value,
  options,
  onChange,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [quoteFilter, setQuoteFilter] = useState<QuoteFilter>('ALL');
  const [renderLimit, setRenderLimit] = useState(120);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (open) {
      setRenderLimit(120);
      setTimeout(() => inputRef.current?.focus(), 20);
    } else {
      setQuery('');
    }
  }, [open]);

  const counts = useMemo(() => {
    let usdt = 0;
    let usdc = 0;
    let other = 0;
    for (const o of options) {
      if (o.quoteAsset === 'USDT') usdt++;
      else if (o.quoteAsset === 'USDC') usdc++;
      else other++;
    }
    return { all: options.length, usdt, usdc, other };
  }, [options]);

  const filteredAll = useMemo(() => {
    const q = query.trim().toUpperCase();
    return options.filter((o) => {
      if (quoteFilter === 'USDT' && o.quoteAsset !== 'USDT') return false;
      if (quoteFilter === 'USDC' && o.quoteAsset !== 'USDC') return false;
      if (quoteFilter === 'OTHER' && (o.quoteAsset === 'USDT' || o.quoteAsset === 'USDC')) {
        return false;
      }
      if (!q) return true;
      return (
        o.symbol.includes(q) ||
        o.baseAsset.includes(q) ||
        o.quoteAsset.includes(q)
      );
    });
  }, [options, query, quoteFilter]);

  const visibleList = useMemo(() => {
    if (query.trim().length > 0) return filteredAll;
    return filteredAll.slice(0, renderLimit);
  }, [filteredAll, query, renderLimit]);

  const hasMore = !query.trim() && visibleList.length < filteredAll.length;

  const handleListScroll = () => {
    const el = listRef.current;
    if (!el || !hasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
      setRenderLimit((prev) => Math.min(filteredAll.length, prev + 160));
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Pilih koin (${value})`}
        data-testid="symbol-picker-trigger"
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-xs font-mono font-semibold text-slate-900 transition-colors whitespace-nowrap shrink-0"
      >
        <span>{value}</span>
        <span className="text-[11px] font-sans font-normal text-slate-500">
          ({options.length} pair)
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Cari pasangan koin Binance"
          className="absolute right-0 mt-1.5 w-80 rounded-lg border border-slate-200 bg-white shadow-lg z-50 overflow-hidden"
        >
          <div className="p-2 border-b border-slate-200 bg-slate-50 space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <label htmlFor="coin-search-input" className="sr-only">
                Cari koin di semua pair Binance
              </label>
              <input
                ref={inputRef}
                id="coin-search-input"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari dari semua koin (NEAR, PEPE, ARB...)"
                className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900"
              />
            </div>

            <div className="grid grid-cols-4 gap-1 text-[11px]">
              {(
                [
                  { id: 'ALL', label: `Semua (${counts.all})` },
                  { id: 'USDT', label: `USDT (${counts.usdt})` },
                  { id: 'USDC', label: `USDC (${counts.usdc})` },
                  { id: 'OTHER', label: `Lain (${counts.other})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setQuoteFilter(tab.id);
                    setRenderLimit(120);
                  }}
                  className={`py-1 px-1.5 rounded font-medium truncate transition-colors ${
                    quoteFilter === tab.id
                      ? 'bg-slate-900 text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div
            ref={listRef}
            onScroll={handleListScroll}
            role="listbox"
            className="max-h-72 overflow-y-auto divide-y divide-slate-100"
          >
            {visibleList.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-500">
                Koin &ldquo;{query}&rdquo; tidak ditemukan pada filter saat ini.
              </div>
            ) : (
              <>
                {visibleList.map((opt) => {
                  const selected = opt.symbol === value;
                  return (
                    <button
                      key={opt.symbol}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        onChange(opt.symbol);
                        setOpen(false);
                      }}
                      className={`w-full px-3 py-2 flex items-center justify-between text-xs text-left transition-colors ${
                        selected
                          ? 'bg-slate-900 text-white'
                          : 'hover:bg-slate-50 text-slate-800'
                      }`}
                    >
                      <span className="font-mono font-semibold">
                        {opt.baseAsset}
                        <span className={selected ? 'text-slate-300' : 'text-slate-400'}>
                          /{opt.quoteAsset}
                        </span>
                      </span>
                      {opt.quoteVolume !== undefined && opt.quoteVolume > 0 && (
                        <span
                          className={`font-mono tabular-nums text-[11px] ${
                            selected ? 'text-slate-200' : 'text-slate-500'
                          }`}
                        >
                          Vol {formatUsdCompact(opt.quoteVolume)}
                        </span>
                      )}
                    </button>
                  );
                })}
                {hasMore && (
                  <button
                    type="button"
                    onClick={() => setRenderLimit(filteredAll.length)}
                    className="w-full py-2.5 text-center text-xs font-medium text-sky-700 hover:bg-slate-50"
                  >
                    Tampilkan semua {filteredAll.length} pair ({filteredAll.length - visibleList.length} lagi)
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
