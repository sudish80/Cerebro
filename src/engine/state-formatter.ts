import type { StateBlock, MultiTimeframeState, NamedIndicators } from "../types";

function n(v: number): string {
  if (Number.isNaN(v)) return "NaN";
  return v.toFixed(6).replace(/\.?0+$/, "");
}

function formatMultiTimeframeSection(mtf: MultiTimeframeState): string {
  const parts: string[] = [];
  const labels = Object.keys(mtf.timeframes) as string[];
  for (const label of labels) {
    const ind = mtf.timeframes[label] as NamedIndicators;
    parts.push(`TF:${label}:RSI=${n(ind.RSI_14)}:MACD_H=${n(ind.MACD_A_hist)}:BB_W=${n(ind.BB_A_width)}:ATR=${n(ind.ATR_14)}:ADX=${n(ind.ADX_14)}:STOCH=${n(ind.STOCH_K)}:MFI=${n(ind.MFI_14)}`);
  }
  return parts.join("|");
}

export function formatStateBlock(state: StateBlock): string {
  const { bar, orderbook, indicators: ind, portfolio: p, blockHeight, multiTimeframe } = state;

  const barSec = `O:${n(bar.open)}:H:${n(bar.high)}:L:${n(bar.low)}:C:${n(bar.close)}:V:${n(bar.volume)}`;
  const obSec = `BB:${n(orderbook.bestBid)}:${n(orderbook.bestAsk)}:${n(orderbook.spread)}:${n(orderbook.mid)}`;
  const posSec = `POS:${n(p.position)}:${n(p.avgEntryPrice)}:${n(p.balance)}:${n(p.dailyPnL)}:${n(p.maxDailyDrawdown)}:${n(p.totalTrades)}`;

  const sma = [];
  for (let i = 5; i <= 34; i++) sma.push(`SMA${i}:${n(ind[`SMA_${i}` as keyof typeof ind] as number)}`);

  const ema = [];
  for (let i = 5; i <= 34; i++) ema.push(`EMA${i}:${n(ind[`EMA_${i}` as keyof typeof ind] as number)}`);

  const indSec = [
    ...sma,
    ...ema,
    `RSI14:${n(ind.RSI_14)}`,
    `WMA10:${n(ind.WMA_10)}`,
    `WMA20:${n(ind.WMA_20)}`,
    `WMA30:${n(ind.WMA_30)}`,
    `ATR7:${n(ind.ATR_7)}`,
    `ATR14:${n(ind.ATR_14)}`,
    `ATR21:${n(ind.ATR_21)}`,
    `MACD_A_L:${n(ind.MACD_A_line)}`,
    `MACD_A_S:${n(ind.MACD_A_signal)}`,
    `MACD_A_H:${n(ind.MACD_A_hist)}`,
    `MACD_B_L:${n(ind.MACD_B_line)}`,
    `MACD_B_S:${n(ind.MACD_B_signal)}`,
    `MACD_B_H:${n(ind.MACD_B_hist)}`,
    `BB_A_U:${n(ind.BB_A_upper)}`,
    `BB_A_M:${n(ind.BB_A_mid)}`,
    `BB_A_L:${n(ind.BB_A_lower)}`,
    `BB_A_W:${n(ind.BB_A_width)}`,
    `BB_A_P:${n(ind.BB_A_pctB)}`,
    `BB_B_U:${n(ind.BB_B_upper)}`,
    `BB_B_M:${n(ind.BB_B_mid)}`,
    `BB_B_L:${n(ind.BB_B_lower)}`,
    `BB_B_W:${n(ind.BB_B_width)}`,
    `BB_B_P:${n(ind.BB_B_pctB)}`,
    `BB_C_U:${n(ind.BB_C_upper)}`,
    `BB_C_M:${n(ind.BB_C_mid)}`,
    `BB_C_L:${n(ind.BB_C_lower)}`,
    `BB_C_W:${n(ind.BB_C_width)}`,
    `BB_C_P:${n(ind.BB_C_pctB)}`,
    `STOCH_K:${n(ind.STOCH_K)}`,
    `STOCH_D:${n(ind.STOCH_D)}`,
    `ADX:${n(ind.ADX_14)}`,
    `DIP:${n(ind.DI_plus_14)}`,
    `DIM:${n(ind.DI_minus_14)}`,
    `OBV:${n(ind.OBV)}`,
    `OBV_EMA:${n(ind.OBV_EMA_20)}`,
    `VWAP:${n(ind.VWAP)}`,
    `MFI:${n(ind.MFI_14)}`,
    `CMF:${n(ind.CMF_20)}`,
    `TRIX:${n(ind.TRIX_15)}`,
    `UO:${n(ind.UO)}`,
    `ARU:${n(ind.Aroon_Up_25)}`,
    `ARD:${n(ind.Aroon_Down_25)}`,
    `ARO:${n(ind.Aroon_Oscillator)}`,
    `VP:${n(ind.Vortex_Plus_14)}`,
    `VM:${n(ind.Vortex_Minus_14)}`,
    `ICT:${n(ind.ICH_Tenkan)}`,
    `ICK:${n(ind.ICH_Kijun)}`,
    `ICSA:${n(ind.ICH_SenkouA)}`,
    `ICSB:${n(ind.ICH_SenkouB)}`,
    `ICCH:${n(ind.ICH_Chikou)}`,
    `DCH:${n(ind.DC_High_20)}`,
    `DCL:${n(ind.DC_Low_20)}`,
    `DCM:${n(ind.DC_Mid_20)}`,
    `KCU:${n(ind.KC_Upper_20)}`,
    `KCM:${n(ind.KC_Mid_20)}`,
    `KCL:${n(ind.KC_Lower_20)}`,
    `PPP:${n(ind.Pivot_PP)}`,
    `R1:${n(ind.Pivot_R1)}`,
    `R2:${n(ind.Pivot_R2)}`,
    `R3:${n(ind.Pivot_R3)}`,
    `S1:${n(ind.Pivot_S1)}`,
    `S2:${n(ind.Pivot_S2)}`,
    `S3:${n(ind.Pivot_S3)}`,
    `PCP:${n(ind.price_change_pct)}`,
    `VSMA20:${n(ind.volume_sma_20)}`,
    `VRATIO:${n(ind.volume_ratio)}`,
    `MOM1:${n(ind.momentum_1)}`,
    `MOM5:${n(ind.momentum_5)}`,
    `MOM10:${n(ind.momentum_10)}`,
    `ROC10:${n(ind.roc_10)}`,
    `ROC20:${n(ind.roc_20)}`,
    `RNG_PCT:${n(ind.range_pct)}`,
    `C2H_PCT:${n(ind.close_to_high_pct)}`,
    `C2L_PCT:${n(ind.close_to_low_pct)}`,
    `USHADOW:${n(ind.upper_shadow_pct)}`,
    `LSHADOW:${n(ind.lower_shadow_pct)}`,
    `BODY:${n(ind.body_pct)}`,
    `PVSMA20:${n(ind.price_vs_sma20_pct)}`,
    `PVEMA20:${n(ind.price_vs_ema20_pct)}`,
  ].join(":");

  const base = `BLK:${blockHeight}|T:${bar.timestamp}|${barSec}|${obSec}|${posSec}|${indSec}`;

  if (multiTimeframe) {
    return `${base}|${formatMultiTimeframeSection(multiTimeframe)}`;
  }

  return base;
}
