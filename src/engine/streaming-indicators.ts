import type { OHLCVBar, NamedIndicators } from "../types";
import { computeAllIndicators } from "./indicators";

const MAX_WINDOW = 500;
const WARMUP_BARS = 60;

interface WelfordState {
  mean: number;
  m2: number;
  count: number;
}

function welfordUpdate(state: WelfordState, value: number): WelfordState {
  const count = state.count + 1;
  const delta = value - state.mean;
  const mean = state.mean + delta / count;
  const delta2 = value - mean;
  const m2 = state.m2 + delta * delta2;
  return { mean, m2, count };
}

function welfordStd(state: WelfordState): number {
  return state.count > 1 ? Math.sqrt(state.m2 / (state.count - 1)) : 0;
}

export class StreamingIndicatorEngine {
  private bars: OHLCVBar[] = [];
  private lastIndicators: NamedIndicators | null = null;
  private totalBarCount = 0;
  private normState = new Map<string, WelfordState>();

  reset(): void {
    this.bars = [];
    this.lastIndicators = null;
    this.totalBarCount = 0;
    this.normState.clear();
  }

  warmupRequirement(): number {
    return WARMUP_BARS;
  }

  update(bar: OHLCVBar): NamedIndicators {
    this.bars.push(bar);
    if (this.bars.length > MAX_WINDOW) {
      this.bars.shift();
    }
    this.totalBarCount++;
    this.lastIndicators = computeAllIndicators(this.bars, this.bars.length - 1);
    return this.lastIndicators;
  }

  normalize(indicators: NamedIndicators): Record<string, number> {
    const result: Record<string, number> = {};
    const raw = indicators as unknown as Record<string, number>;
    const keys = Object.keys(raw);
    for (const key of keys) {
      const value = raw[key];
      if (value === undefined || Number.isNaN(value)) {
        result[key + "_norm"] = 0;
        continue;
      }
      let state = this.normState.get(key);
      if (!state) {
        state = { mean: 0, m2: 0, count: 0 };
      }
      state = welfordUpdate(state, value);
      this.normState.set(key, state);
      const std = welfordStd(state);
      result[key + "_norm"] = std !== 0 ? (value - state.mean) / std : 0;
    }
    return result;
  }

  lastBar(): OHLCVBar | null {
    return this.bars.length > 0 ? this.bars[this.bars.length - 1]! : null;
  }

  barCount(): number {
    return this.totalBarCount;
  }

  isReady(): boolean {
    return this.totalBarCount >= WARMUP_BARS;
  }

  getWarmupMap(): Record<string, number> {
    return {
      SMA_5: 5, SMA_6: 6, SMA_7: 7, SMA_8: 8, SMA_9: 9,
      SMA_10: 10, SMA_11: 11, SMA_12: 12, SMA_13: 13, SMA_14: 14,
      SMA_15: 15, SMA_16: 16, SMA_17: 17, SMA_18: 18, SMA_19: 19,
      SMA_20: 20, SMA_21: 21, SMA_22: 22, SMA_23: 23, SMA_24: 24,
      SMA_25: 25, SMA_26: 26, SMA_27: 27, SMA_28: 28, SMA_29: 29,
      SMA_30: 30, SMA_31: 31, SMA_32: 32, SMA_33: 33, SMA_34: 34,
      EMA_5: 5, EMA_6: 6, EMA_7: 7, EMA_8: 8, EMA_9: 9,
      EMA_10: 10, EMA_11: 11, EMA_12: 12, EMA_13: 13, EMA_14: 14,
      EMA_15: 15, EMA_16: 16, EMA_17: 17, EMA_18: 18, EMA_19: 19,
      EMA_20: 20, EMA_21: 21, EMA_22: 22, EMA_23: 23, EMA_24: 24,
      EMA_25: 25, EMA_26: 26, EMA_27: 27, EMA_28: 28, EMA_29: 29,
      EMA_30: 30, EMA_31: 31, EMA_32: 32, EMA_33: 33, EMA_34: 34,
      RSI_14: 15,
      WMA_10: 10, WMA_20: 20, WMA_30: 30,
      ATR_7: 8, ATR_14: 15, ATR_21: 22,
      MACD_A_line: 35, MACD_A_signal: 44, MACD_A_hist: 44,
      MACD_B_line: 26, MACD_B_signal: 31, MACD_B_hist: 31,
      BB_A_upper: 20, BB_A_mid: 20, BB_A_lower: 20, BB_A_width: 20, BB_A_pctB: 20,
      BB_B_upper: 20, BB_B_mid: 20, BB_B_lower: 20, BB_B_width: 20, BB_B_pctB: 20,
      BB_C_upper: 50, BB_C_mid: 50, BB_C_lower: 50, BB_C_width: 50, BB_C_pctB: 50,
      STOCH_K: 17, STOCH_D: 20,
      ADX_14: 28, DI_plus_14: 15, DI_minus_14: 15,
      OBV: 1, OBV_EMA_20: 20,
      VWAP: 1,
      MFI_14: 15,
      CMF_20: 20,
      TRIX_15: 46,
      UO: 28,
      Aroon_Up_25: 25, Aroon_Down_25: 25, Aroon_Oscillator: 25,
      Vortex_Plus_14: 15, Vortex_Minus_14: 15,
      ICH_Tenkan: 9, ICH_Kijun: 26, ICH_SenkouA: 26, ICH_SenkouB: 52, ICH_Chikou: 1,
      DC_High_20: 20, DC_Low_20: 20, DC_Mid_20: 20,
      KC_Upper_20: 20, KC_Mid_20: 20, KC_Lower_20: 20,
      Pivot_PP: 2, Pivot_R1: 2, Pivot_R2: 2, Pivot_R3: 2,
      Pivot_S1: 2, Pivot_S2: 2, Pivot_S3: 2,
      price_change_pct: 1, volume_sma_20: 20, volume_ratio: 20,
      range_pct: 1, close_to_high_pct: 1, close_to_low_pct: 1,
      upper_shadow_pct: 1, lower_shadow_pct: 1, body_pct: 1,
      price_vs_sma20_pct: 20, price_vs_ema20_pct: 20,
      momentum_1: 1, momentum_5: 5, momentum_10: 10,
      roc_10: 10, roc_20: 20,
    };
  }
}
