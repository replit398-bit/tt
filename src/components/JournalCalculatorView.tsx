import React, { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { calculatePositionSizing } from '../lib/decisionEngine';
import type { ManualJournalEntry } from '../types/market';
import { formatPrice } from '../utils/format';

interface JournalCalculatorViewProps {
  symbol: string;
  timeframe: string;
  initialEntry: number;
  initialStopLoss: number;
  initialTakeProfit: number;
  initialSide: 'LONG' | 'SHORT';
  verdictLabel: string;
  journalEntries: ManualJournalEntry[];
  onAddJournalEntry: (entry: ManualJournalEntry) => void;
  onUpdateStatus: (id: string, status: ManualJournalEntry['status'], pnlUsdt: number) => void;
  onDeleteEntry: (id: string) => void;
}

export const JournalCalculatorView: React.FC<JournalCalculatorViewProps> = ({
  symbol,
  timeframe,
  initialEntry,
  initialStopLoss,
  initialTakeProfit,
  initialSide,
  verdictLabel,
  journalEntries,
  onAddJournalEntry,
  onUpdateStatus,
  onDeleteEntry,
}) => {
  const [capitalStr, setCapitalStr] = useState('1000');
  const [riskStr, setRiskStr] = useState('2');
  const [side, setSide] = useState<'LONG' | 'SHORT'>(initialSide);
  const [entryStr, setEntryStr] = useState(initialEntry > 0 ? String(Number(initialEntry.toFixed(4))) : '');
  const [slStr, setSlStr] = useState(initialStopLoss > 0 ? String(Number(initialStopLoss.toFixed(4))) : '');
  const [tpStr, setTpStr] = useState(initialTakeProfit > 0 ? String(Number(initialTakeProfit.toFixed(4))) : '');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const capitalUsdt = Number(capitalStr) || 0;
  const riskPercent = Number(riskStr) || 0;
  const entryPrice = Number(entryStr) || 0;
  const stopLoss = Number(slStr) || 0;
  const takeProfit = Number(tpStr) || 0;

  const sizing = useMemo(
    () =>
      calculatePositionSizing({
        capitalUsdt,
        riskPercent,
        entryPrice,
        stopLoss,
        takeProfit,
      }),
    [capitalUsdt, riskPercent, entryPrice, stopLoss, takeProfit]
  );

  const handleSaveEntry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sizing.valid) {
      setFormError(sizing.error ?? 'Input posisi belum valid.');
      return;
    }
    setFormError(null);
    const newEntry: ManualJournalEntry = {
      id: `trade-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString(),
      symbol,
      timeframe,
      side,
      capitalUsdt,
      riskPercent,
      quantity: sizing.positionSizeCoins,
      entryPrice,
      stopLoss,
      takeProfit,
      verdictAtEntry: verdictLabel,
      status: 'OPEN',
      pnlUsdt: 0,
      notes: notes.trim() || `Setup ${verdictLabel} (${timeframe})`,
    };
    onAddJournalEntry(newEntry);
    setNotes('');
  };

  const stats = useMemo(() => {
    const closed = journalEntries.filter((j) => j.status !== 'OPEN');
    const wins = closed.filter((j) => j.status === 'WIN').length;
    const totalPnl = closed.reduce((acc, j) => acc + j.pnlUsdt, 0);
    const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;
    return {
      totalCount: journalEntries.length,
      openCount: journalEntries.filter((j) => j.status === 'OPEN').length,
      winRate,
      totalPnl,
    };
  }, [journalEntries]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h1 className="text-lg font-semibold text-slate-900">
          Kalkulator Posisi & Jurnal Eksekusi Manual
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          Hitung ukuran lot/koin ideal sebelum Anda mengeksekusi order secara manual di Binance, lalu catat hasilnya untuk evaluasi disiplin trading.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        {/* Left: Position Sizing Calculator */}
        <form
          onSubmit={handleSaveEntry}
          className="xl:col-span-5 rounded-lg border border-slate-200 bg-white p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              Kalkulator Risiko ({symbol})
            </h2>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setSide('LONG')}
                className={`px-2.5 py-1 text-xs font-semibold rounded border transition-colors ${
                  side === 'LONG'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                    : 'text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                Setup LONG
              </button>
              <button
                type="button"
                onClick={() => setSide('SHORT')}
                className={`px-2.5 py-1 text-xs font-semibold rounded border transition-colors ${
                  side === 'SHORT'
                    ? 'bg-rose-50 text-rose-800 border-rose-300'
                    : 'text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                Setup SHORT
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="calc-capital" className="block text-xs text-slate-600 mb-1">
                Modal Akun (USDT)
              </label>
              <input
                id="calc-capital"
                type="number"
                step="any"
                value={capitalStr}
                onChange={(e) => setCapitalStr(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded border border-slate-200 bg-slate-50 text-slate-900 focus:outline-none focus:bg-white focus:border-slate-900"
              />
            </div>
            <div>
              <label htmlFor="calc-risk" className="block text-xs text-slate-600 mb-1">
                Risiko per Trade (%)
              </label>
              <input
                id="calc-risk"
                type="number"
                step="0.1"
                value={riskStr}
                onChange={(e) => setRiskStr(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded border border-slate-200 bg-slate-50 text-slate-900 focus:outline-none focus:bg-white focus:border-slate-900"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label htmlFor="calc-entry" className="block text-xs text-slate-600 mb-1">
                Harga Entry ({timeframe})
              </label>
              <input
                id="calc-entry"
                type="number"
                step="any"
                value={entryStr}
                onChange={(e) => setEntryStr(e.target.value)}
                className="w-full px-2.5 py-2 text-xs font-mono tabular-nums rounded border border-slate-200 bg-slate-50 text-slate-900 focus:outline-none focus:bg-white focus:border-slate-900"
              />
            </div>
            <div>
              <label htmlFor="calc-sl" className="block text-xs text-slate-600 mb-1">
                Stop Loss (1R)
              </label>
              <input
                id="calc-sl"
                type="number"
                step="any"
                value={slStr}
                onChange={(e) => setSlStr(e.target.value)}
                className="w-full px-2.5 py-2 text-xs font-mono tabular-nums rounded border border-slate-200 bg-slate-50 text-slate-900 focus:outline-none focus:bg-white focus:border-slate-900"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="calc-tp" className="block text-xs text-slate-600">
                  Take Profit (1R)
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const risk = Math.abs(entryPrice - stopLoss);
                    if (risk > 0 && entryPrice > 0) {
                      const nextTp = side === 'SHORT' ? Math.max(0.000001, entryPrice - risk) : entryPrice + risk;
                      setTpStr(String(Number(nextTp.toFixed(6))));
                    }
                  }}
                  className="text-[10px] font-mono font-semibold text-emerald-700 hover:text-emerald-900 underline underline-offset-2"
                >
                  Set 1:1
                </button>
              </div>
              <input
                id="calc-tp"
                type="number"
                step="any"
                value={tpStr}
                onChange={(e) => setTpStr(e.target.value)}
                className="w-full px-2.5 py-2 text-xs font-mono tabular-nums rounded border border-slate-200 bg-slate-50 text-slate-900 focus:outline-none focus:bg-white focus:border-slate-900"
              />
            </div>
          </div>

          <div>
            <label htmlFor="calc-notes" className="block text-xs text-slate-600 mb-1">
              Catatan Eksekusi Manual
            </label>
            <input
              id="calc-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Mis. Entry setelah pantulan EMA 21 + bid wall"
              className="w-full px-3 py-2 text-xs rounded border border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-900"
            />
          </div>

          {/* Calculation Results */}
          <div className="pt-3 border-t border-slate-200 space-y-2 text-xs font-mono tabular-nums">
            <div className="flex justify-between">
              <span className="font-sans text-slate-600">Jumlah Koin untuk Order Manual</span>
              <span className="text-slate-900 font-bold">
                {sizing.valid ? `${sizing.positionSizeCoins.toFixed(4)} ${symbol.replace('USDT', '')}` : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="font-sans text-slate-600">Nilai Posisi Total</span>
              <span className="text-slate-800">
                {sizing.valid ? `$${sizing.positionValueUsdt.toFixed(2)}` : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="font-sans text-slate-600">Risiko Maksimal Jika Kena SL</span>
              <span className="text-rose-700 font-semibold">
                {sizing.valid ? `-$${sizing.riskAmountUsdt.toFixed(2)}` : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="font-sans text-slate-600">Potensi Profit Jika Kena TP</span>
              <span className="text-emerald-700 font-semibold">
                {sizing.valid ? `+$${sizing.potentialProfitUsdt.toFixed(2)} (R:R 1:${sizing.rewardToRisk.toFixed(2)})` : '—'}
              </span>
            </div>
          </div>

          {formError && <p className="text-xs text-rose-700">{formError}</p>}

          <button
            type="submit"
            className="w-full py-2.5 px-4 rounded-md bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs transition-colors"
          >
            Simpan ke Jurnal Manual
          </button>
        </form>

        {/* Right: Manual Trading Journal */}
        <section className="xl:col-span-7 rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-sm font-semibold text-slate-900">
              Jurnal Eksekusi Manual ({stats.totalCount})
            </h2>
            <div className="flex items-center gap-4 text-xs font-mono tabular-nums">
              <span className="text-slate-600">
                Win Rate: <strong className="text-slate-900">{stats.winRate.toFixed(0)}%</strong>
              </span>
              <span className="text-slate-600">
                Net PnL:{' '}
                <strong className={stats.totalPnl >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
                  {stats.totalPnl >= 0 ? '+' : ''}${stats.totalPnl.toFixed(2)}
                </strong>
              </span>
            </div>
          </div>

          {journalEntries.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              Belum ada catatan eksekusi manual. Gunakan kalkulator di samping lalu klik &ldquo;Simpan ke Jurnal Manual&rdquo; saat Anda membuka posisi di Binance.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                    <th className="py-2.5 px-3 font-medium">Koin / Arah</th>
                    <th className="py-2.5 px-3 font-medium text-right">Qty</th>
                    <th className="py-2.5 px-3 font-medium text-right">Entry / SL / TP</th>
                    <th className="py-2.5 px-3 font-medium">Status</th>
                    <th className="py-2.5 px-3 font-medium text-right">Hapus</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {journalEntries.map((entry) => {
                    const riskUsd = entry.capitalUsdt * (entry.riskPercent / 100);
                    const estProfitUsd =
                      entry.quantity * Math.abs(entry.takeProfit - entry.entryPrice);

                    return (
                      <tr key={entry.id} className="hover:bg-slate-50">
                        <td className="py-3 px-3">
                          <div className="font-semibold text-slate-900">
                            {entry.symbol}{' '}
                            <span
                              className={
                                entry.side === 'LONG' ? 'text-emerald-700' : 'text-rose-700'
                              }
                            >
                              {entry.side}
                            </span>
                          </div>
                          <div className="text-slate-500 mt-0.5 truncate max-w-[200px]">
                            {entry.notes}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800">
                          {entry.quantity.toFixed(4)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                          <div>E: {formatPrice(entry.entryPrice)}</div>
                          <div className="text-slate-400">
                            SL: {formatPrice(entry.stopLoss)} · TP: {formatPrice(entry.takeProfit)}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <label htmlFor={`status-${entry.id}`} className="sr-only">
                            Status trade {entry.symbol}
                          </label>
                          <select
                            id={`status-${entry.id}`}
                            value={entry.status}
                            onChange={(e) => {
                              const nextStatus = e.target.value as ManualJournalEntry['status'];
                              const nextPnl =
                                nextStatus === 'WIN'
                                  ? Number(estProfitUsd.toFixed(2))
                                  : nextStatus === 'LOSS'
                                  ? -Number(riskUsd.toFixed(2))
                                  : 0;
                              onUpdateStatus(entry.id, nextStatus, nextPnl);
                            }}
                            className="px-2 py-1 rounded border border-slate-200 bg-white text-slate-800 text-xs"
                          >
                            <option value="OPEN">OPEN</option>
                            <option value="WIN">WIN (+${estProfitUsd.toFixed(1)})</option>
                            <option value="LOSS">LOSS (-${riskUsd.toFixed(1)})</option>
                            <option value="BE">BE ($0)</option>
                          </select>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => onDeleteEntry(entry.id)}
                            aria-label={`Hapus jurnal ${entry.symbol}`}
                            className="p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
