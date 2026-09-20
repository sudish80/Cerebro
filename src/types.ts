/* ═══════════════════════════════════════════════════════════════════════════
   Cerebro Trader — Core Type Definitions
   ═══════════════════════════════════════════════════════════════════════════ */

/** A single OHLCV bar from exchange or CSV */
export interface OHLCVBar {
  readonly timestamp: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

/** Live order book snapshot */
export interface OrderBookSnapshot {
  readonly bids: ReadonlyArray<readonly [price: number, size: number]>;
  readonly asks: ReadonlyArray<readonly [price: number, size: number]>;
  readonly bestBid: number;
  readonly bestAsk: number;
  readonly spread: number;
  readonly mid: number;
  readonly timestamp: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
   TypeSafe Jev API — Official Request / Response Types
   Endpoint: POST https://api.typesafe.ai/v1/systemone
   ═══════════════════════════════════════════════════════════════════════════ */

/** Choice question sent to Jev */
export interface JevChoiceQuestion {
  readonly type: "choice";
  readonly instructions: string;
  readonly criteria: Record<string, string | null>;
}

/** Noul question sent to Jev */
export interface JevNoulQuestion {
  readonly type: "noul";
  readonly instructions: string;
}

/** Score question sent to Jev */
export interface JevScoreQuestion {
  readonly type: "score";
  readonly instructions: string;
  readonly criteria: readonly string[];
}

export type JevQuestion = JevChoiceQuestion | JevNoulQuestion | JevScoreQuestion;

/** Official TypeSafe API request body */
export interface JevSystemOneRequest {
  readonly state: string | Record<string, unknown>;
  readonly model: string;
  readonly questions: Record<string, JevQuestion>;
}

/** Official TypeSafe API choice answer */
export interface JevChoiceAnswer {
  readonly type: "choice";
  readonly choice: string;
  readonly probabilities: Record<string, number>;
  readonly confidence: number;
}

/** Official TypeSafe API noul answer */
export interface JevNoulAnswer {
  readonly type: "noul";
  readonly noul: number;
}

/** Official TypeSafe API score answer */
export interface JevScoreAnswer {
  readonly type: "score";
  readonly score: number;
  readonly probabilities: Record<string, number>;
  readonly confidence: number;
}

export type JevAnswer = JevChoiceAnswer | JevNoulAnswer | JevScoreAnswer;

/** Official TypeSafe API response body */
export interface JevSystemOneResponse {
  readonly model: string;
  readonly answers: Record<string, JevAnswer>;
  readonly usage: {
    readonly input_tokens: number;
    readonly output_tokens: number;
  };
}

/** Jev AI decision output (normalized from API response) */
export interface JevDecision {
  readonly choice: "BUY" | "SELL" | "HOLD";
  readonly probability: number;
  readonly confidence: number;
  readonly probabilities: Record<string, number>;
  readonly rawResponse: string;
  readonly latencyMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly shadow: boolean;
}

/** Risk-engine verdict */
export interface RiskVerdict {
  readonly approved: boolean;
  readonly action: "BUY" | "SELL" | "HOLD";
  readonly reason: string;
  readonly signalProbability: number;
  readonly size: number;
}

/** Execution result */
export interface ExecutionResult {
  readonly txHash: string;
  readonly action: "BUY" | "SELL" | "HOLD";
  readonly size: number;
  readonly price: number;
  readonly latencyMs: number;
  readonly timestamp: number;
  readonly orderType: "IOC" | "LIMIT" | "SPLIT";
  readonly simulatedGasCost: number;
  readonly nonce?: number;
}

/** Portfolio state */
export interface PortfolioState {
  readonly balance: number;
  readonly position: number;
  readonly avgEntryPrice: number;
  readonly dailyPnL: number;
  readonly maxDailyDrawdown: number;
  readonly totalTrades: number;
}

/** Risk engine state (for persistence) */
export interface RiskEngineState {
  consecutiveLosses: number;
  lastTradeTimestamp: number;
  haltUntilTimestamp: number;
  trailingStopPrice: number | null;
  trailingStopActive: boolean;
  highestProfitSinceEntry: number;
  tradeTimestampsJson: string;
}

/** Full engine state block fed to Jev */
export interface StateBlock {
  readonly bar: OHLCVBar;
  readonly orderbook: OrderBookSnapshot;
  readonly indicators: NamedIndicators;
  readonly portfolio: PortfolioState;
  readonly blockHeight: number;
  readonly multiTimeframe?: MultiTimeframeState;
}

/** Multi-timeframe computed indicators */
export interface MultiTimeframeState {
  readonly timeframes: Record<string, NamedIndicators>;
  readonly current: NamedIndicators;
  readonly formatted: string;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Named Indicators — 130+ computed values
   ═══════════════════════════════════════════════════════════════════════════ */

export interface NamedIndicators {
  // SMA swept across 30 periods: SMA_5..SMA_34 (step 1)
  readonly SMA_5: number;  readonly SMA_6: number;  readonly SMA_7: number;
  readonly SMA_8: number;  readonly SMA_9: number;  readonly SMA_10: number;
  readonly SMA_11: number; readonly SMA_12: number; readonly SMA_13: number;
  readonly SMA_14: number; readonly SMA_15: number; readonly SMA_16: number;
  readonly SMA_17: number; readonly SMA_18: number; readonly SMA_19: number;
  readonly SMA_20: number; readonly SMA_21: number; readonly SMA_22: number;
  readonly SMA_23: number; readonly SMA_24: number; readonly SMA_25: number;
  readonly SMA_26: number; readonly SMA_27: number; readonly SMA_28: number;
  readonly SMA_29: number; readonly SMA_30: number; readonly SMA_31: number;
  readonly SMA_32: number; readonly SMA_33: number; readonly SMA_34: number;

  // EMA swept across 30 periods: EMA_5..EMA_34
  readonly EMA_5: number;  readonly EMA_6: number;  readonly EMA_7: number;
  readonly EMA_8: number;  readonly EMA_9: number;  readonly EMA_10: number;
  readonly EMA_11: number; readonly EMA_12: number; readonly EMA_13: number;
  readonly EMA_14: number; readonly EMA_15: number; readonly EMA_16: number;
  readonly EMA_17: number; readonly EMA_18: number; readonly EMA_19: number;
  readonly EMA_20: number; readonly EMA_21: number; readonly EMA_22: number;
  readonly EMA_23: number; readonly EMA_24: number; readonly EMA_25: number;
  readonly EMA_26: number; readonly EMA_27: number; readonly EMA_28: number;
  readonly EMA_29: number; readonly EMA_30: number; readonly EMA_31: number;
  readonly EMA_32: number; readonly EMA_33: number; readonly EMA_34: number;

  // RSI (Wilder)
  readonly RSI_14: number;

  // WMA (Weighted Moving Average)
  readonly WMA_10: number;
  readonly WMA_20: number;
  readonly WMA_30: number;

  // ATR (Average True Range)
  readonly ATR_14: number;
  readonly ATR_7: number;
  readonly ATR_21: number;

  // MACD Config A (12, 26, 9)
  readonly MACD_A_line: number;
  readonly MACD_A_signal: number;
  readonly MACD_A_hist: number;

  // MACD Config B (8, 21, 5)
  readonly MACD_B_line: number;
  readonly MACD_B_signal: number;
  readonly MACD_B_hist: number;

  // Bollinger Bands Config A (20, 2)
  readonly BB_A_upper: number;
  readonly BB_A_mid: number;
  readonly BB_A_lower: number;
  readonly BB_A_width: number;
  readonly BB_A_pctB: number;

  // Bollinger Bands Config B (20, 2.5)
  readonly BB_B_upper: number;
  readonly BB_B_mid: number;
  readonly BB_B_lower: number;
  readonly BB_B_width: number;
  readonly BB_B_pctB: number;

  // Bollinger Bands Config C (50, 2)
  readonly BB_C_upper: number;
  readonly BB_C_mid: number;
  readonly BB_C_lower: number;
  readonly BB_C_width: number;
  readonly BB_C_pctB: number;

  // Stochastic Oscillator (14, 3, 3)
  readonly STOCH_K: number;
  readonly STOCH_D: number;

  // ADX / DI (14)
  readonly ADX_14: number;
  readonly DI_plus_14: number;
  readonly DI_minus_14: number;

  // OBV (On-Balance Volume)
  readonly OBV: number;
  readonly OBV_EMA_20: number;

  // VWAP (Volume Weighted Average Price)
  readonly VWAP: number;

  // MFI (Money Flow Index, 14)
  readonly MFI_14: number;

  // CMF (Chaikin Money Flow, 20)
  readonly CMF_20: number;

  // TRIX (15)
  readonly TRIX_15: number;

  // Ultimate Oscillator (7, 14, 28)
  readonly UO: number;

  // Aroon (25)
  readonly Aroon_Up_25: number;
  readonly Aroon_Down_25: number;
  readonly Aroon_Oscillator: number;

  // Vortex (14)
  readonly Vortex_Plus_14: number;
  readonly Vortex_Minus_14: number;

  // Ichimoku Cloud (9, 26, 52)
  readonly ICH_Tenkan: number;
  readonly ICH_Kijun: number;
  readonly ICH_SenkouA: number;
  readonly ICH_SenkouB: number;
  readonly ICH_Chikou: number;

  // Donchian Channel (20)
  readonly DC_High_20: number;
  readonly DC_Low_20: number;
  readonly DC_Mid_20: number;

  // Keltner Channel (20, 2)
  readonly KC_Upper_20: number;
  readonly KC_Mid_20: number;
  readonly KC_Lower_20: number;

  // Pivot Points (Standard)
  readonly Pivot_PP: number;
  readonly Pivot_R1: number;
  readonly Pivot_R2: number;
  readonly Pivot_R3: number;
  readonly Pivot_S1: number;
  readonly Pivot_S2: number;
  readonly Pivot_S3: number;

  // Derived / micro
  readonly price_change_pct: number;
  readonly volume_sma_20: number;
  readonly volume_ratio: number;
  readonly range_pct: number;
  readonly close_to_high_pct: number;
  readonly close_to_low_pct: number;
  readonly upper_shadow_pct: number;
  readonly lower_shadow_pct: number;
  readonly body_pct: number;
  readonly price_vs_sma20_pct: number;
  readonly price_vs_ema20_pct: number;
  readonly momentum_1: number;
  readonly momentum_5: number;
  readonly momentum_10: number;
  readonly roc_10: number;
  readonly roc_20: number;
}

/** Flattened indicator values array — for serialization / state string */
export type IndicatorValues = readonly number[];

/** Market data feed interface */
export interface MarketDataFeed {
  connect(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
  getOrderBook(): OrderBookSnapshot | null;
  getLatestBar(): OHLCVBar | null;
  getBarHistory(): readonly OHLCVBar[];
  onBar(callback: (bar: OHLCVBar) => void): void;
  onOrderBook(callback: (book: OrderBookSnapshot) => void): void;
}

/** Trade record for persistence */
export interface TradeRecord {
  readonly timestamp: number;
  readonly action: "BUY" | "SELL";
  readonly entryPrice: number;
  readonly exitPrice: number | null;
  readonly size: number;
  readonly grossPnl: number;
  readonly fees: number;
  readonly netPnl: number;
  readonly holdDurationBars: number;
  readonly jevConfidence: number;
  readonly jevProbabilities: string;
  readonly riskReason: string;
  readonly executionLatencyMs: number;
  readonly txHash: string;
  readonly gasCost: number;
  readonly indicatorsSnapshot: string;
}
