export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume: number;
  trades: number;
}

export interface OrderbookLevel {
  price: number;
  quantity: number;
  usdValue: number;
  cumulativeUsd: number;
}

export interface OrderbookData {
  symbol: string;
  lastUpdateId: number;
  bids: [number, number][];
  asks: [number, number][];
  source: 'binance-live' | 'fallback-sim';
}

export interface Ticker24h {
  symbol: string;
  lastPrice: number;
  priceChange: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  quoteVolume: number;
  weightedAvgPrice: number;
  count: number;
  source: 'binance-live' | 'fallback-sim';
}

export interface LiquidityWall {
  side: 'BID' | 'ASK';
  price: number;
  quantity: number;
  usdValue: number;
  distancePercent: number;
}

export interface LiquiditySweepEvent {
  type: 'BSL_SWEEP' | 'SSL_SWEEP';
  levelPrice: number;
  sweepTime: number;
  description: string;
}

export interface SwingLevel {
  type: 'BSL' | 'SSL';
  price: number;
  strength: number;
  time: number;
}

export interface OrderbookLiquidityMetrics {
  midPrice: number;
  bestBid: number;
  bestAsk: number;
  spreadUsd: number;
  spreadPercent: number;
  bidLiquidity2PctUsd: number;
  askLiquidity2PctUsd: number;
  imbalanceRatio: number; // 0 to 1 (>0.55 bullish bid dominance, <0.45 bearish ask dominance)
  bias: 'BID_DOMINANT' | 'ASK_DOMINANT' | 'BALANCED';
  topBidWalls: LiquidityWall[];
  topAskWalls: LiquidityWall[];
  cumulativeBids: OrderbookLevel[];
  cumulativeAsks: OrderbookLevel[];
}

export interface IndicatorSeries {
  sma20: (number | null)[];
  sma50: (number | null)[];
  sma200: (number | null)[];
  ema9: (number | null)[];
  ema20: (number | null)[];
  ema21: (number | null)[];
  ema50: (number | null)[];
  ema55: (number | null)[];
  ema200: (number | null)[];
  rsi14: (number | null)[];
  macdLine: (number | null)[];
  macdSignal: (number | null)[];
  macdHist: (number | null)[];
  bbUpper: (number | null)[];
  bbMiddle: (number | null)[];
  bbLower: (number | null)[];
  atr14: (number | null)[];
  vwap: (number | null)[];
  ichimokuTenkan: (number | null)[];
  ichimokuKijun: (number | null)[];
  ichimokuSpanA: (number | null)[];
  ichimokuSpanB: (number | null)[];
  adx14: (number | null)[];
  stochK: (number | null)[];
  stochD: (number | null)[];
  cci20: (number | null)[];
  williamsR14: (number | null)[];
  obv: (number | null)[];
}

export type FactorBias = 'bullish' | 'bearish' | 'neutral';

export type FactorCategory =
  | 'Pola & Price Action'
  | 'Trend'
  | 'Momentum'
  | 'Volatilitas'
  | 'Volume'
  | 'Fibonacci & Pivot'
  | 'Likuiditas';

export interface DecisionFactor {
  id: string;
  name: string;
  category: FactorCategory;
  bias: FactorBias;
  weight: number;
  valueText: string;
  explanation: string;
}

export type DecisionVerdict = 'STRONG_BUY' | 'BUY' | 'WAIT' | 'SELL' | 'STRONG_SELL';

export interface ManualExecutionPlan {
  bias: 'LONG' | 'SHORT' | 'NEUTRAL';
  entryLow: number;
  entryHigh: number;
  optimalEntry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  riskPercentToSl: number;
  rewardToRiskTp1: number;
  rewardToRiskTp2: number;
  atr14: number;
  invalidationNote: string;
}

export type AllowedTimeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '1d' | '1w';

export type TimeframeRole = 'ANALYSIS' | 'ENTRY';

export interface TimeframeAnalysisDigest {
  timeframe: AllowedTimeframe;
  role: TimeframeRole;
  verdict: DecisionVerdict;
  movementLabel: string;
  bias: 'LONG' | 'SHORT' | 'NEUTRAL';
  confidencePercent: number;
  rsi14: number | null;
  entryLow: number;
  entryHigh: number;
  optimalEntry: number;
  stopLoss: number;
  takeProfit1: number;
  rewardToRiskTp1: number;
  closedCandleOpenTime: number;
  closedCandleCloseTime: number;
  nextCandleCloseTime: number | null;
}

export interface MultiTimeframeRecommendation {
  symbol: string;
  isClosedCandleBasis: boolean;
  analysisTimeframesBias: {
    tf30m: 'LONG' | 'SHORT' | 'NEUTRAL';
    tf1h: 'LONG' | 'SHORT' | 'NEUTRAL';
    tf1d: 'LONG' | 'SHORT' | 'NEUTRAL';
    tf1w: 'LONG' | 'SHORT' | 'NEUTRAL';
    combinedBias: 'LONG' | 'SHORT' | 'NEUTRAL';
    summary: string;
  };
  recommendedTimeframe: '1m' | '5m' | '15m';
  recommendedBias: 'LONG' | 'SHORT' | 'NEUTRAL';
  recommendedMovementLabel: string;
  recommendedEntryLow: number;
  recommendedEntryHigh: number;
  recommendedOptimalEntry: number;
  recommendedStopLoss: number;
  recommendedTakeProfit1: number;
  recommendedRiskReward: string;
  alignmentSummary: string;
  recommendationReason: string;
  timeframes: TimeframeAnalysisDigest[];
}

export interface DetectedPatternItem {
  name: string;
  bias: FactorBias;
  description: string;
}

export interface TrendlineChannelInfo {
  direction: 'UP' | 'DOWN' | 'SIDEWAYS';
  slopePercentPerBar: number;
  upperStart: number;
  upperEnd: number;
  lowerStart: number;
  lowerEnd: number;
  startIndex: number;
  endIndex: number;
  positionRatio: number;
  summary: string;
}

export interface AdvancedTechnicalAnalysis {
  supportLevels: number[];
  resistanceLevels: number[];
  trendlineChannel: TrendlineChannelInfo;
  candlestickPatterns: DetectedPatternItem[];
  chartPatterns: DetectedPatternItem[];
  maCross: {
    goldenCross: boolean;
    deathCross: boolean;
    ema2050200Status: string;
  };
  divergences: {
    rsiDivergence: 'BULLISH' | 'BEARISH' | 'NONE';
    macdDivergence: 'BULLISH' | 'BEARISH' | 'NONE';
  };
  ichimoku: {
    tenkan: number | null;
    kijun: number | null;
    spanA: number | null;
    spanB: number | null;
    cloudStatus: 'ABOVE_CLOUD' | 'BELOW_CLOUD' | 'IN_CLOUD';
  };
  adx: {
    adx14: number | null;
    plusDi: number | null;
    minusDi: number | null;
    trendStrengthLabel: string;
  };
  momentumOscillators: {
    stochK: number | null;
    stochD: number | null;
    cci20: number | null;
    williamsR14: number | null;
  };
  bollingerSqueeze: {
    isSqueeze: boolean;
    bandwidthPct: number;
  };
  volumeAnalysis: {
    obvTrend: 'UP' | 'DOWN' | 'FLAT';
    vwap: number | null;
    priceVsVwapPct: number;
  };
  fibonacci: {
    direction: 'UPTREND' | 'DOWNTREND';
    swingHigh: number;
    swingLow: number;
    ret382: number;
    ret500: number;
    ret618: number;
    ext1272: number;
    ext1618: number;
    activeZoneNote: string;
  };
  pivotPoints: {
    pp: number;
    r1: number;
    r2: number;
    s1: number;
    s2: number;
  };
  cycleAndPriceAction: {
    dowStructure: 'UPTREND_HH_HL' | 'DOWNTREND_LH_LL' | 'KONSOLIDASI';
    elliottWavePhase: string;
    priceActionNote: string;
  };
}

export interface MarketAnalysisResult {
  symbol: string;
  timeframe: string;
  isClosedCandleBasis: boolean;
  analyzedCandleOpenTime: number;
  analyzedCandleCloseTime: number;
  nextCandleCloseTime: number | null;
  currentPrice: number;
  verdict: DecisionVerdict;
  verdictLabel: string;
  confidencePercent: number;
  bullishScore: number;
  bearishScore: number;
  summary: string;
  factors: DecisionFactor[];
  executionPlan: ManualExecutionPlan;
  liquidityMetrics: OrderbookLiquidityMetrics;
  swingLevels: SwingLevel[];
  recentSweep: LiquiditySweepEvent | null;
  volumeRatio20: number;
  series: IndicatorSeries;
  advanced: AdvancedTechnicalAnalysis;
}

export interface ScannerRow {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  lastPrice: number;
  priceChangePercent: number;
  quoteVolume24h: number;
  sma20: number | null;
  ema21: number | null;
  rsi14: number | null;
  imbalanceRatio: number;
  verdict: DecisionVerdict;
  verdictLabel: string;
  confidencePercent: number;
  optimalEntry: number;
  stopLoss: number;
  takeProfit1: number;
}

export interface ScannerApiResponse {
  interval: string;
  market: MarketType;
  quote: string;
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  source: 'binance-live';
  updatedAt: number;
  rows: ScannerRow[];
}

export interface ManualJournalEntry {
  id: string;
  createdAt: string;
  symbol: string;
  timeframe: string;
  side: 'LONG' | 'SHORT';
  capitalUsdt: number;
  riskPercent: number;
  quantity: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  verdictAtEntry: string;
  status: 'OPEN' | 'WIN' | 'LOSS' | 'BE';
  pnlUsdt: number;
  notes: string;
}

export type MarketType = 'spot' | 'futures';

export interface FuturesMarketMeta {
  symbol: string;
  markPrice: number;
  indexPrice: number;
  estimatedSettlePrice: number;
  lastFundingRate: number;
  nextFundingTime: number;
  openInterest: number;
  openInterestUsd: number;
  fundingHistory: {
    fundingTime: number;
    fundingRate: number;
    markPrice: number;
  }[];
  source: 'binance-live' | 'fallback-sim';
}

export interface SpotGeneralInfo {
  pingOk: boolean;
  pingLatencyMs: number;
  serverTime: number;
  timeOffsetMs: number;
  symbolInfo: {
    symbol: string;
    status: string;
    baseAsset: string;
    quoteAsset: string;
    baseAssetPrecision: number;
    quotePrecision: number;
    orderTypes: string[];
    isSpotTradingAllowed: boolean;
    isMarginTradingAllowed: boolean;
    tickSize: string;
    stepSize: string;
    minQty: string;
    minNotional: string;
  } | null;
  source: 'binance-live' | 'fallback-sim';
}

export interface FuturesAccountSummary {
  configured: boolean;
  note?: string;
  error?: string;
  dualSidePosition?: boolean;
  multiAssetsMargin?: boolean;
  account?: {
    totalWalletBalance: number;
    totalUnrealizedProfit: number;
    totalMarginBalance: number;
    availableBalance: number;
    maxWithdrawAmount: number;
    canTrade: boolean;
    canDeposit: boolean;
    canWithdraw: boolean;
  };
  balances?: {
    asset: string;
    balance: number;
    availableBalance: number;
    crossWalletBalance: number;
    crossUnPnl: number;
  }[];
  positions?: {
    symbol: string;
    positionAmt: number;
    entryPrice: number;
    markPrice: number;
    unRealizedProfit: number;
    liquidationPrice: number;
    leverage: number;
    marginType: string;
    positionSide: string;
    notional: number;
  }[];
  incomes?: {
    symbol: string;
    incomeType: string;
    income: number;
    asset: string;
    time: number;
  }[];
  commissionRate?: {
    symbol: string;
    makerCommissionRate: number;
    takerCommissionRate: number;
  } | null;
  leverageBrackets?: {
    bracket: number;
    initialLeverage: number;
    notionalCap: number;
    notionalFloor: number;
    maintMarginRatio: number;
  }[];
}

export type SimulatedTradeStatus = 'OPEN' | 'WIN' | 'LOSS';
export type SimulatedTradeSource =
  | 'AUTO_LIVE'
  | 'REENTRY_TP_SL'
  | 'MANUAL_RUN'
  | 'AUTO_30M'
  | 'REPLAY_30M';

export interface TradeTechnicalSnapshot {
  capturedAt: number;
  price: number;
  verdict: DecisionVerdict;
  verdictLabel: string;
  confidencePercent: number;
  bullishScore: number;
  bearishScore: number;
  rsi14: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  macdHist: number | null;
  adx14: number | null;
  atr14: number;
  stochK: number | null;
  cci20: number | null;
  williamsR14: number | null;
  bbBandwidthPct: number;
  bbSqueeze: boolean;
  ichimokuCloud: 'ABOVE_CLOUD' | 'BELOW_CLOUD' | 'IN_CLOUD';
  obvTrend: 'UP' | 'DOWN' | 'FLAT';
  vwap: number | null;
  priceVsVwapPct: number;
  imbalanceRatio: number;
  orderbookBias: 'BID_DOMINANT' | 'ASK_DOMINANT' | 'BALANCED';
  dowStructure: 'UPTREND_HH_HL' | 'DOWNTREND_LH_LL' | 'KONSOLIDASI';
  elliottWavePhase: string;
  candlestickPatterns: string[];
  chartPatterns: string[];
  supportLevels: number[];
  resistanceLevels: number[];
  fibonacciZone: string;
  pivotPp: number;
  pivotS1: number;
  pivotR1: number;
  volumeRatio20: number;
}

export interface TradeEntryAnalysisSnapshot {
  snapshot: TradeTechnicalSnapshot;
  predictionSummary: string;
  supportingReasons: string[];
  cautionRisks: string[];
  invalidationNote: string;
}

export type ExitTriggerType =
  | 'HIT_TP_CANDLE'
  | 'HIT_SL_CANDLE'
  | 'HIT_TP_LIVE'
  | 'HIT_SL_LIVE'
  | 'EARLY_TP_REVERSAL'
  | 'MANUAL_CLOSE';

export type ReversalStatus = 'AMAN' | 'WASPADA_PEMBALIKAN' | 'TAKE_PROFIT_REVERSAL';

export interface TradeReversalMonitor {
  checkedAt: number;
  livePrice: number;
  bullishScore: number;
  bearishScore: number;
  reversalScore: number;
  status: ReversalStatus;
  shouldAutoTakeProfit: boolean;
  signals: string[];
  summary: string;
}

export interface TradeExitAnalysisSnapshot {
  evaluatedAt: number;
  triggerType: ExitTriggerType;
  outcome: 'WIN' | 'LOSS';
  durationMs: number;
  priceChangePct: number;
  exitTechnical: TradeTechnicalSnapshot | null;
  responseTitle: string;
  responseSummary: string;
  reasons: string[];
  lessonLearned: string;
}

export interface SimulatedTrade {
  id: string;
  symbol: string;
  market: MarketType;
  timeframe: AllowedTimeframe;
  side: 'LONG' | 'SHORT';
  verdictLabel: string;
  confidencePercent: number;
  sourceMode: SimulatedTradeSource;
  cycleSlotTime: number;
  executedAt: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  rewardToRisk: number;
  riskUsd: number;
  status: SimulatedTradeStatus;
  exitPrice: number | null;
  closedAt: number | null;
  pnlR: number;
  pnlUsd: number;
  entryAnalysis?: TradeEntryAnalysisSnapshot;
  exitAnalysis?: TradeExitAnalysisSnapshot;
  reversalMonitor?: TradeReversalMonitor;
}

export interface TimeframeWinrateStat {
  timeframe: AllowedTimeframe;
  role: TimeframeRole;
  startingBalanceUsd: number;
  realizedBalanceUsd: number;
  floatingPnlUsd: number;
  realtimeBalanceUsd: number;
  returnPercent: number;
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  wins: number;
  losses: number;
  winratePercent: number;
  netR: number;
  netPnlUsd: number;
  profitFactor: number | null;
  avgConfidence: number;
}

export interface SimulationOverallStats {
  startingCapitalUsd: number;
  currentEquityUsd: number;
  totalPnlUsd: number;
  returnPercent: number;
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  wins: number;
  losses: number;
  winratePercent: number;
  netR: number;
  expectancyR: number;
  profitFactor: number | null;
}

export interface TimeframeSimScanStatus {
  symbol: string;
  timeframe: AllowedTimeframe;
  analyzedAt: number;
  bullishScore: number;
  bearishScore: number;
  confidencePercent: number;
  verdict: DecisionVerdict;
  verdictLabel: string;
  qualifiedSide: 'LONG' | 'SHORT' | null;
  actionStatus: 'OPEN_POSITION' | 'ENTERED' | 'SKIPPED_BELOW_70' | 'INSUFFICIENT_BALANCE';
  note: string;
}

export interface SymbolWinrateStat {
  symbol: string;
  livePrice: number | null;
  startingBalanceUsd: number;
  realizedBalanceUsd: number;
  realtimeBalanceUsd: number;
  returnPercent: number;
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  wins: number;
  losses: number;
  earlyTpWins: number;
  winratePercent: number;
  realizedPnlUsd: number;
  floatingPnlUsd: number;
  realtimePnlUsd: number;
  reversalAlertCount: number;
}

export interface SimulationStatePayload {
  enabled: boolean;
  autoTakeProfitOnReversal: boolean;
  symbol: string;
  symbols: string[];
  market: MarketType;
  startingBalancePerTfUsd: number;
  startingBalancePerCoinUsd: number;
  riskPercentPerTrade: number;
  minEntryScorePercent: number;
  rewardToRiskRatio: string;
  dataSource: 'binance-live';
  livePrice: number | null;
  livePrices: Record<string, number>;
  liveUpdatedAt: number;
  lastExecutionAt: number | null;
  stats: SimulationOverallStats;
  byTimeframe: TimeframeWinrateStat[];
  bySymbol: SymbolWinrateStat[];
  tfScanStatuses: TimeframeSimScanStatus[];
  trades: SimulatedTrade[];
}


