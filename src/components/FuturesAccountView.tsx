import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type {
  FuturesAccountSummary,
  FuturesMarketMeta,
  SpotGeneralInfo,
} from '../types/market';
import { formatPrice, formatUsdCompact } from '../utils/format';

interface SpotAccountSummary {
  configured: boolean;
  canTrade?: boolean;
  accountType?: string;
  balances?: { asset: string; free: number; locked: number }[];
  openOrders?: {
    symbol: string;
    orderId: number;
    side: string;
    type: string;
    price: number;
    origQty: number;
    status: string;
  }[];
  note?: string;
  error?: string;
}

interface FuturesAccountViewProps {
  symbol: string;
  futuresMeta: FuturesMarketMeta | null;
}

export const FuturesAccountView: React.FC<FuturesAccountViewProps> = ({
  symbol,
  futuresMeta,
}) => {
  const [spotGeneral, setSpotGeneral] = useState<SpotGeneralInfo | null>(null);
  const [spotAccount, setSpotAccount] = useState<SpotAccountSummary | null>(null);
  const [futuresAccount, setFuturesAccount] = useState<FuturesAccountSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [genRes, spotAccRes, futAccRes] = await Promise.all([
        fetch(`/api/binance/spot/general?symbol=${encodeURIComponent(symbol)}`).then((r) =>
          r.json()
        ),
        fetch('/api/binance/account').then((r) => r.json()),
        fetch(`/api/binance/futures/account?symbol=${encodeURIComponent(symbol)}`).then(
          (r) => r.json()
        ),
      ]);
      setSpotGeneral(genRes as SpotGeneralInfo);
      setSpotAccount(spotAccRes as SpotAccountSummary);
      setFuturesAccount(futAccRes as FuturesAccountSummary);
    } catch {
      // Errors handled via sub-card status
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    void loadAll();
    const timer = setInterval(() => {
      void loadAll();
    }, 15000);
    return () => clearInterval(timer);
  }, [loadAll]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">
            Spot General API & Akun USD-M Futures ({symbol})
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Implementasi endpoint Binance Spot General (ping, serverTime, exchangeInfo) dan USD-S-M Futures Account (saldo, posisi, income, leverage bracket, commission rate) secara read-only.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadAll()}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Sinkronkan API</span>
        </button>
      </div>

      {/* Section 1: Spot General Endpoints (Public) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Spot Trading — General API (/api/v3/ping, /time, /exchangeInfo)
            </h2>
            <span
              className={`text-xs font-semibold whitespace-nowrap shrink-0 ${
                spotGeneral?.pingOk ? 'text-emerald-700' : 'text-amber-700'
              }`}
            >
              {spotGeneral?.pingOk
                ? `Terhubung (${spotGeneral.pingLatencyMs} ms)`
                : 'Memeriksa...'}
            </span>
          </div>

          {spotGeneral?.symbolInfo ? (
            <div className="divide-y divide-slate-100 text-xs">
              <div className="py-2 flex justify-between">
                <span className="text-slate-500">Server Time & Selisih Jam Lokal</span>
                <span className="font-mono tabular-nums text-slate-900">
                  {new Date(spotGeneral.serverTime).toLocaleTimeString('id-ID')} ({spotGeneral.timeOffsetMs >= 0 ? '+' : ''}
                  {spotGeneral.timeOffsetMs} ms)
                </span>
              </div>
              <div className="py-2 flex justify-between">
                <span className="text-slate-500">Status Pair & Izin Spot/Margin</span>
                <span className="font-mono text-slate-900">
                  {spotGeneral.symbolInfo.status} · Spot:{' '}
                  {spotGeneral.symbolInfo.isSpotTradingAllowed ? 'Ya' : 'Tidak'} · Margin:{' '}
                  {spotGeneral.symbolInfo.isMarginTradingAllowed ? 'Ya' : 'Tidak'}
                </span>
              </div>
              <div className="py-2 flex justify-between">
                <span className="text-slate-500">PRICE_FILTER (Tick Size)</span>
                <span className="font-mono tabular-nums text-slate-900">
                  {spotGeneral.symbolInfo.tickSize}
                </span>
              </div>
              <div className="py-2 flex justify-between">
                <span className="text-slate-500">LOT_SIZE (Step Size / Min Qty)</span>
                <span className="font-mono tabular-nums text-slate-900">
                  {spotGeneral.symbolInfo.stepSize} / Min {spotGeneral.symbolInfo.minQty}
                </span>
              </div>
              <div className="py-2 flex justify-between">
                <span className="text-slate-500">NOTIONAL (Minimum Order)</span>
                <span className="font-mono tabular-nums text-slate-900">
                  ${spotGeneral.symbolInfo.minNotional} USDT
                </span>
              </div>
              <div className="py-2 flex justify-between gap-4">
                <span className="text-slate-500 shrink-0">Tipe Order Didukung</span>
                <span className="font-mono text-slate-700 text-right">
                  {spotGeneral.symbolInfo.orderTypes.join(', ')}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500 py-4">
              Memuat aturan exchange Spot untuk {symbol}...
            </p>
          )}
        </section>

        {/* Futures Market Metrics (Mark Price, Funding Rate, Open Interest) */}
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-900">
              USD-M Futures Market (/fapi/v1/premiumIndex & openInterest)
            </h2>
            <span className="text-xs font-mono text-slate-500">{symbol} PERPETUAL</span>
          </div>

          {futuresMeta ? (
            <div className="space-y-3">
              <div className="divide-y divide-slate-100 text-xs">
                <div className="py-2 flex justify-between">
                  <span className="text-slate-500">Mark Price / Index Price</span>
                  <span className="font-mono tabular-nums text-slate-900 font-semibold">
                    ${formatPrice(futuresMeta.markPrice)} / ${formatPrice(futuresMeta.indexPrice)}
                  </span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="text-slate-500">Funding Rate Terkini</span>
                  <span
                    className={`font-mono tabular-nums font-semibold ${
                      futuresMeta.lastFundingRate >= 0 ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                  >
                    {(futuresMeta.lastFundingRate * 100).toFixed(4)}%
                  </span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="text-slate-500">Open Interest</span>
                  <span className="font-mono tabular-nums text-slate-900">
                    {futuresMeta.openInterest.toLocaleString('en-US', { maximumFractionDigits: 2 })}{' '}
                    ({formatUsdCompact(futuresMeta.openInterestUsd)})
                  </span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="text-slate-500">Funding Berikutnya</span>
                  <span className="font-mono tabular-nums text-slate-700">
                    {new Date(futuresMeta.nextFundingTime).toLocaleTimeString('id-ID')}
                  </span>
                </div>
              </div>

              {futuresMeta.fundingHistory.length > 0 && (
                <div className="pt-2 border-t border-slate-200">
                  <div className="text-xs text-slate-500 mb-1.5">
                    Riwayat Funding Rate Terakhir
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-xs font-mono tabular-nums">
                    {futuresMeta.fundingHistory.slice(-4).map((fh) => (
                      <div
                        key={fh.fundingTime}
                        className="p-2 rounded bg-slate-50 border border-slate-200"
                      >
                        <div className="text-slate-400">
                          {new Date(fh.fundingTime).toLocaleTimeString('id-ID', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                        <div
                          className={`font-semibold mt-0.5 ${
                            fh.fundingRate >= 0 ? 'text-emerald-700' : 'text-rose-700'
                          }`}
                        >
                          {(fh.fundingRate * 100).toFixed(4)}%
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-500 py-4">
              Pilih mode USD-M Futures atau tunggu data kontrak perpetual dimuat.
            </p>
          )}
        </section>
      </div>

      {/* Section 2: Signed USD-M Futures Account & Spot Account */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              USD-S-M Futures Account API (/fapi/v2/account, /balance, /positionRisk, /income, /leverageBracket, /commissionRate)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Menggunakan autentikasi HMAC-SHA256 di server via environment variables <code className="font-mono text-slate-700">BINANCE_API_KEY</code> &amp; <code className="font-mono text-slate-700">BINANCE_SECRET_KEY</code>.
            </p>
          </div>
          {futuresAccount?.configured && !futuresAccount.error && (
            <div className="text-xs font-mono text-slate-600">
              Mode Posisi: <strong>{futuresAccount.dualSidePosition ? 'Hedge Mode' : 'One-Way'}</strong> · Multi-Asset:{' '}
              <strong>{futuresAccount.multiAssetsMargin ? 'Aktif' : 'Nonaktif'}</strong>
            </div>
          )}
        </div>

        {!futuresAccount ? (
          <p className="text-xs text-slate-500">Memeriksa status akun USD-M Futures...</p>
        ) : !futuresAccount.configured ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 space-y-2">
            <p className="font-semibold text-slate-800">
              Kunci API Akun Pribadi Belum Terpasang di Server Environment
            </p>
            <p className="leading-relaxed">{futuresAccount.note}</p>
            <p className="leading-relaxed">
              Semua grafik, harga, orderbook, dan scanner sudah berjalan <strong>100% live real-time</strong> via Binance Public API &amp; WebSocket. Untuk membaca saldo &amp; posisi akun pribadi secara aman, masukkan{' '}
              <code className="font-mono text-slate-900 bg-white px-1.5 py-0.5 rounded border border-slate-200">BINANCE_API_KEY</code> dan{' '}
              <code className="font-mono text-slate-900 bg-white px-1.5 py-0.5 rounded border border-slate-200">BINANCE_SECRET_KEY</code> di panel <strong>Secrets</strong> (atau file <code className="font-mono text-slate-900 bg-white px-1.5 py-0.5 rounded border border-slate-200">.env</code> pada localhost), lalu muat ulang server.
            </p>
          </div>
        ) : futuresAccount.error ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700">
            {futuresAccount.error}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Futures Account Overview */}
            {futuresAccount.account && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono tabular-nums">
                <div className="p-3 rounded border border-slate-200 bg-slate-50">
                  <div className="font-sans text-slate-500">Total Wallet Balance</div>
                  <div className="text-base font-bold text-slate-900 mt-1">
                    ${futuresAccount.account.totalWalletBalance.toFixed(2)}
                  </div>
                </div>
                <div className="p-3 rounded border border-slate-200 bg-slate-50">
                  <div className="font-sans text-slate-500">Available Balance</div>
                  <div className="text-base font-bold text-slate-900 mt-1">
                    ${futuresAccount.account.availableBalance.toFixed(2)}
                  </div>
                </div>
                <div className="p-3 rounded border border-slate-200 bg-slate-50">
                  <div className="font-sans text-slate-500">Margin Balance</div>
                  <div className="text-base font-bold text-slate-900 mt-1">
                    ${futuresAccount.account.totalMarginBalance.toFixed(2)}
                  </div>
                </div>
                <div className="p-3 rounded border border-slate-200 bg-slate-50">
                  <div className="font-sans text-slate-500">Unrealized PnL</div>
                  <div
                    className={`text-base font-bold mt-1 ${
                      futuresAccount.account.totalUnrealizedProfit >= 0
                        ? 'text-emerald-700'
                        : 'text-rose-700'
                    }`}
                  >
                    {futuresAccount.account.totalUnrealizedProfit >= 0 ? '+' : ''}$
                    {futuresAccount.account.totalUnrealizedProfit.toFixed(2)}
                  </div>
                </div>
              </div>
            )}

            {/* Active Positions & Leverage Brackets */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <h3 className="text-xs font-semibold text-slate-900 mb-2">
                  Posisi Futures Aktif (/fapi/v2/positionRisk)
                </h3>
                {(futuresAccount.positions ?? []).length === 0 ? (
                  <p className="text-xs text-slate-500 py-3">
                    Tidak ada posisi Futures yang sedang terbuka.
                  </p>
                ) : (
                  <div className="overflow-x-auto border border-slate-200 rounded">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                        <tr>
                          <th className="py-2 px-3">Simbol</th>
                          <th className="py-2 px-3 text-right">Size</th>
                          <th className="py-2 px-3 text-right">Entry / Liq</th>
                          <th className="py-2 px-3 text-right">uPnL</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                        {(futuresAccount.positions ?? []).map((pos) => (
                          <tr key={`${pos.symbol}-${pos.positionSide}`}>
                            <td className="py-2 px-3 font-sans font-semibold text-slate-900">
                              {pos.symbol} ({pos.leverage}x)
                            </td>
                            <td className="py-2 px-3 text-right">{pos.positionAmt}</td>
                            <td className="py-2 px-3 text-right">
                              {formatPrice(pos.entryPrice)} / {formatPrice(pos.liquidationPrice)}
                            </td>
                            <td
                              className={`py-2 px-3 text-right font-semibold ${
                                pos.unRealizedProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'
                              }`}
                            >
                              {pos.unRealizedProfit >= 0 ? '+' : ''}
                              {pos.unRealizedProfit.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-xs font-semibold text-slate-900 mb-2">
                  Leverage Brackets & Komisi ({symbol})
                </h3>
                {futuresAccount.commissionRate && (
                  <p className="text-xs font-mono text-slate-600 mb-2">
                    Maker Fee: {(futuresAccount.commissionRate.makerCommissionRate * 100).toFixed(3)}% ·
                    Taker Fee: {(futuresAccount.commissionRate.takerCommissionRate * 100).toFixed(3)}%
                  </p>
                )}
                {(futuresAccount.leverageBrackets ?? []).length > 0 ? (
                  <div className="overflow-x-auto border border-slate-200 rounded max-h-48 overflow-y-auto">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                        <tr>
                          <th className="py-2 px-3">Tier</th>
                          <th className="py-2 px-3 text-right">Max Leverage</th>
                          <th className="py-2 px-3 text-right">Max Notional</th>
                          <th className="py-2 px-3 text-right">Maint. Margin</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                        {(futuresAccount.leverageBrackets ?? []).slice(0, 6).map((b) => (
                          <tr key={b.bracket}>
                            <td className="py-1.5 px-3">#{b.bracket}</td>
                            <td className="py-1.5 px-3 text-right font-semibold">
                              {b.initialLeverage}x
                            </td>
                            <td className="py-1.5 px-3 text-right">
                              {formatUsdCompact(b.notionalCap)}
                            </td>
                            <td className="py-1.5 px-3 text-right">
                              {(b.maintMarginRatio * 100).toFixed(2)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">Data leverage bracket tidak tersedia.</p>
                )}
              </div>
            </div>

            {/* Futures Income History */}
            {(futuresAccount.incomes ?? []).length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-slate-900 mb-2">
                  Riwayat Income Terbaru (/fapi/v1/income)
                </h3>
                <div className="overflow-x-auto border border-slate-200 rounded">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="py-2 px-3">Simbol</th>
                        <th className="py-2 px-3">Tipe Income</th>
                        <th className="py-2 px-3 text-right">Nominal</th>
                        <th className="py-2 px-3 text-right">Waktu</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                      {(futuresAccount.incomes ?? []).slice(0, 8).map((inc, idx) => (
                        <tr key={`${inc.time}-${idx}`}>
                          <td className="py-1.5 px-3 font-sans font-medium text-slate-900">
                            {inc.symbol || '—'}
                          </td>
                          <td className="py-1.5 px-3 font-sans text-slate-600">
                            {inc.incomeType}
                          </td>
                          <td
                            className={`py-1.5 px-3 text-right font-semibold ${
                              inc.income >= 0 ? 'text-emerald-700' : 'text-rose-700'
                            }`}
                          >
                            {inc.income >= 0 ? '+' : ''}
                            {inc.income.toFixed(4)} {inc.asset}
                          </td>
                          <td className="py-1.5 px-3 text-right text-slate-500">
                            {new Date(inc.time).toLocaleString('id-ID')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Section 3: Spot Account Balances & Open Orders */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900 mb-2">
          Saldo Akun Spot & Order Terbuka (/api/v3/account &amp; /api/v3/openOrders)
        </h2>
        {!spotAccount ? (
          <p className="text-xs text-slate-500">Memeriksa saldo akun Spot...</p>
        ) : !spotAccount.configured ? (
          <p className="text-xs text-slate-500">{spotAccount.note}</p>
        ) : spotAccount.error ? (
          <p className="text-xs text-rose-700">{spotAccount.error}</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-3">
            <div>
              <div className="text-xs font-medium text-slate-700 mb-2">
                Aset Spot ({spotAccount.accountType})
              </div>
              <div className="border border-slate-200 rounded divide-y divide-slate-100 max-h-44 overflow-y-auto text-xs font-mono tabular-nums">
                {(spotAccount.balances ?? []).length === 0 ? (
                  <div className="p-3 font-sans text-slate-500">Tidak ada saldo non-nol.</div>
                ) : (
                  (spotAccount.balances ?? []).map((b) => (
                    <div key={b.asset} className="px-3 py-2 flex justify-between">
                      <span className="font-semibold text-slate-900">{b.asset}</span>
                      <span className="text-slate-700">
                        Free: {formatPrice(b.free)} · Locked: {formatPrice(b.locked)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-700 mb-2">
                Open Orders Spot ({(spotAccount.openOrders ?? []).length})
              </div>
              <div className="border border-slate-200 rounded divide-y divide-slate-100 max-h-44 overflow-y-auto text-xs font-mono tabular-nums">
                {(spotAccount.openOrders ?? []).length === 0 ? (
                  <div className="p-3 font-sans text-slate-500">Tidak ada limit order Spot terbuka.</div>
                ) : (
                  (spotAccount.openOrders ?? []).map((o) => (
                    <div key={o.orderId} className="px-3 py-2 flex justify-between">
                      <span className="font-semibold text-slate-900">
                        {o.symbol} {o.side}
                      </span>
                      <span className="text-slate-700">
                        {o.origQty} @ {formatPrice(o.price)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
