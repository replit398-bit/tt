import React from 'react';

interface MethodologyViewProps {
  dataSource: 'binance-live' | 'fallback-sim';
}

export const MethodologyView: React.FC<MethodologyViewProps> = ({ dataSource }) => {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h1 className="text-lg font-semibold text-slate-900">
          Metodologi Indikator, Multi-Timeframe &amp; Binance API
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          Kerangka kerja Top-Down berbasis candle close: Timeframe <strong>30m, 1h, 1d &amp; 1w</strong> digunakan untuk analisis arah tren dan struktur utama (intraday hingga makro), sedangkan chart <strong>1m, 5m &amp; 15m</strong> digunakan untuk menentukan area entry presisi dengan rasio tetap <strong>Risk : Reward 1 : 1</strong> — eksekusi order tetap manual di tangan trader.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">
            1. Alur Top-Down (30m/1h/1d/1w → 1m/5m/15m) &amp; 7 Pilar Teknikal
          </h2>
          <div className="divide-y divide-slate-100 text-xs">
            <div className="py-2.5">
              <div className="font-semibold text-slate-900">
                Pola Harga, Candlestick &amp; Pola Grafik
              </div>
              <p className="text-slate-600 mt-1 leading-relaxed">
                Support &amp; Resistance (BSL/SSL), Trendline &amp; Channel regresi, pola candlestick (Doji, Hammer, Shooting Star, Engulfing, Morning/Evening Star), serta pola grafik (Head &amp; Shoulders, Double Top/Bottom, Triangle, Flag, Wedge).
              </p>
            </div>
            <div className="py-2.5">
              <div className="font-semibold text-slate-900">
                Indikator Tren: SMA/EMA 20/50/200, MACD, ADX &amp; Ichimoku Cloud
              </div>
              <p className="text-slate-600 mt-1 leading-relaxed">
                Golden/Death Cross SMA &amp; EMA 20/50/200, MACD + divergensi, ADX(14) (+DI/-DI, tren kuat &gt; 25), serta Ichimoku Cloud (Tenkan, Kijun, Kumo Span A/B).
              </p>
            </div>
            <div className="py-2.5">
              <div className="font-semibold text-slate-900">
                Momentum &amp; Volatilitas: RSI, Stochastic, CCI, Williams %R, BB Squeeze &amp; ATR
              </div>
              <p className="text-slate-600 mt-1 leading-relaxed">
                Mendeteksi kondisi jenuh beli/jual beserta divergensi RSI/MACD, penyempitan pita Bollinger (Squeeze), serta jarak Stop Loss objektif berbasis ATR(14).
              </p>
            </div>
            <div className="py-2.5">
              <div className="font-semibold text-slate-900">
                Volume (OBV &amp; VWAP), Fibonacci, Pivot Points, Teori Dow &amp; Elliott Wave
              </div>
              <p className="text-slate-600 mt-1 leading-relaxed">
                Konfirmasi akumulasi OBV &amp; posisi VWAP harian, level Fibonacci Retracement (38.2%, 50%, 61.8%) dan Extension (1.272, 1.618), Pivot Points (PP, R1/R2, S1/S2), struktur HH/HL Teori Dow, fase gelombang Elliott, serta Price Action breakout/retest.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              2. Endpoint Binance Spot &amp; USD-M Futures API
            </h2>
            <p className="text-xs text-slate-600 mt-1">
              Status koneksi saat ini:{' '}
              <strong className={dataSource === 'binance-live' ? 'text-emerald-700' : 'text-amber-700'}>
                {dataSource === 'binance-live'
                  ? 'Terhubung Live ke Binance API'
                  : 'Mode Fallback Offline'}
              </strong>
            </p>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <div className="font-semibold text-slate-800 mb-1">
                Spot General &amp; Market Data (/api/v3/*)
              </div>
              <ul className="space-y-1 font-mono text-slate-600">
                <li>GET /api/v3/ping — Uji konektivitas &amp; latensi</li>
                <li>GET /api/v3/time — Sinkronisasi waktu server</li>
                <li>GET /api/v3/exchangeInfo — Aturan tickSize, stepSize, minNotional</li>
                <li>GET /api/v3/klines · /depth · /ticker/24hr · /account · /openOrders</li>
              </ul>
            </div>

            <div className="border-t border-slate-100 pt-3">
              <div className="font-semibold text-slate-800 mb-1">
                USD-S-M Futures Market &amp; Account (/fapi/v1/*, /fapi/v2/*)
              </div>
              <ul className="space-y-1 font-mono text-slate-600">
                <li>GET /fapi/v1/premiumIndex · /openInterest · /fundingRate</li>
                <li>GET /fapi/v1/klines · /depth · /ticker/24hr · /exchangeInfo</li>
                <li>GET /fapi/v2/account · /fapi/v2/balance · /fapi/v2/positionRisk</li>
                <li>GET /fapi/v1/income · /leverageBracket · /commissionRate</li>
                <li>GET /fapi/v1/positionSide/dual · /fapi/v1/multiAssetsMargin</li>
              </ul>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
