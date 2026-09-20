import { trueRange, calcATR } from "./atr";
import type { OHLCVBar, NamedIndicators } from "../types";

function sma(src: readonly number[], period: number, idx: number): number {
  const start = idx - period + 1;
  if (start < 0) return NaN;
  let sum = 0;
  for (let i = start; i <= idx; i++) sum += src[i]!;
  return sum / period;
}

function emaInit(src: readonly number[], period: number): number {
  return sma(src, period, period - 1);
}

function emaNext(prev: number, value: number, k: number): number {
  return value * k + prev * (1 - k);
}

function highest(src: readonly number[], period: number, idx: number): number {
  const start = idx - period + 1;
  if (start < 0) return NaN;
  let mx = src[start]!;
  for (let i = start + 1; i <= idx; i++) { const v = src[i]!; if (v > mx) mx = v; }
  return mx;
}

function lowest(src: readonly number[], period: number, idx: number): number {
  const start = idx - period + 1;
  if (start < 0) return NaN;
  let mn = src[start]!;
  for (let i = start + 1; i <= idx; i++) { const v = src[i]!; if (v < mn) mn = v; }
  return mn;
}

function calcRSI(closes: readonly number[], period: number, idx: number): number {
  if (idx < period) return NaN;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    if (diff > 0) avgGain += diff; else avgLoss -= diff;
  }
  avgGain /= period; avgLoss /= period;
  for (let i = period + 1; i <= idx; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function calcWMA(src: readonly number[], period: number, idx: number): number {
  const start = idx - period + 1;
  if (start < 0) return NaN;
  let sum = 0, wSum = 0;
  for (let i = 0; i < period; i++) { const w = i + 1; sum += src[start + i]! * w; wSum += w; }
  return sum / wSum;
}

function bollinger(closes: readonly number[], period: number, mult: number, idx: number): [number, number, number, number, number] {
  const mid = sma(closes, period, idx);
  const start = idx - period + 1;
  if (start < 0 || isNaN(mid)) return [NaN, NaN, NaN, NaN, NaN];
  let sumSq = 0;
  for (let i = start; i <= idx; i++) { const d = closes[i]! - mid; sumSq += d * d; }
  const std = Math.sqrt(sumSq / period);
  const upper = mid + mult * std, lower = mid - mult * std;
  const width = mid !== 0 ? (upper - lower) / mid : 0;
  const denom = upper - lower;
  return [upper, mid, lower, width, denom !== 0 ? (closes[idx]! - lower) / denom : 0.5];
}

function calcMACD(closes: readonly number[], fastP: number, slowP: number, sigP: number, idx: number): [number, number, number] {
  if (idx < slowP - 1) return [NaN, NaN, NaN];
  const kF = 2 / (fastP + 1), kS = 2 / (slowP + 1), kSig = 2 / (sigP + 1);
  let emaF = emaInit(closes, fastP);
  for (let i = fastP; i < slowP; i++) emaF = emaNext(emaF, closes[i]!, kF);
  let emaS = emaInit(closes, slowP);
  const lines: number[] = [];
  for (let i = slowP - 1; i <= idx; i++) {
    if (i > slowP - 1) { emaF = emaNext(emaF, closes[i]!, kF); emaS = emaNext(emaS, closes[i]!, kS); }
    lines.push(emaF - emaS);
  }
  if (lines.length < sigP) return [lines[lines.length - 1] ?? 0, NaN, NaN];
  let sig = 0;
  for (let i = 0; i < sigP; i++) sig += lines[i]!;
  sig /= sigP;
  for (let i = sigP; i < lines.length; i++) sig = emaNext(sig, lines[i]!, kSig);
  const last = lines[lines.length - 1]!;
  return [last, sig, last - sig];
}

function calcStochastic(highs: readonly number[], lows: readonly number[], closes: readonly number[], kP: number, kSm: number, dSm: number, idx: number): [number, number] {
  if (idx < kP - 1) return [NaN, NaN];
  const rawK: number[] = [];
  for (let i = kP - 1; i <= idx; i++) {
    const hh = highest(highs, kP, i), ll = lowest(lows, kP, i);
    const d = hh - ll;
    rawK.push(d !== 0 ? ((closes[i]! - ll) / d) * 100 : 50);
  }
  if (rawK.length < kSm) return [rawK[rawK.length - 1] ?? 50, NaN];
  const sK: number[] = [];
  for (let i = kSm - 1; i < rawK.length; i++) {
    let s = 0; for (let j = i - kSm + 1; j <= i; j++) s += rawK[j]!; sK.push(s / kSm);
  }
  if (sK.length < dSm) return [sK[sK.length - 1] ?? 50, NaN];
  let dS = 0;
  for (let i = sK.length - dSm; i < sK.length; i++) dS += sK[i]!;
  return [sK[sK.length - 1]!, dS / dSm];
}

export function computeAllIndicators(bars: readonly OHLCVBar[], idx: number): NamedIndicators {
  const n = idx + 1;
  const closes: number[] = [], highs: number[] = [], lows: number[] = [], volumes: number[] = [];
  for (let i = 0; i < n; i++) {
    const b = bars[i]!;
    closes.push(b.close); highs.push(b.high); lows.push(b.low); volumes.push(b.volume);
  }
  const r: Record<string, number> = {};

  for (let p = 5; p <= 34; p++) r[`SMA_${p}`] = sma(closes, p, idx);

  for (let p = 5; p <= 34; p++) {
    if (idx < p - 1) { r[`EMA_${p}`] = NaN; continue; }
    const k = 2 / (p + 1);
    let e = emaInit(closes, p);
    for (let i = p; i <= idx; i++) e = emaNext(e, closes[i]!, k);
    r[`EMA_${p}`] = e;
  }

  r["RSI_14"] = calcRSI(closes, 14, idx);

  r["WMA_10"] = calcWMA(closes, 10, idx);
  r["WMA_20"] = calcWMA(closes, 20, idx);
  r["WMA_30"] = calcWMA(closes, 30, idx);

  r["ATR_7"] = calcATR(bars.slice(0, idx + 1), 7);
  r["ATR_14"] = calcATR(bars.slice(0, idx + 1), 14);
  r["ATR_21"] = calcATR(bars.slice(0, idx + 1), 21);

  { const [l, s, h] = calcMACD(closes, 12, 26, 9, idx); r["MACD_A_line"] = l; r["MACD_A_signal"] = s; r["MACD_A_hist"] = h; }
  { const [l, s, h] = calcMACD(closes, 8, 21, 5, idx); r["MACD_B_line"] = l; r["MACD_B_signal"] = s; r["MACD_B_hist"] = h; }

  { const [u, m, lo, w, p] = bollinger(closes, 20, 2, idx); r["BB_A_upper"] = u; r["BB_A_mid"] = m; r["BB_A_lower"] = lo; r["BB_A_width"] = w; r["BB_A_pctB"] = p; }
  { const [u, m, lo, w, p] = bollinger(closes, 20, 2.5, idx); r["BB_B_upper"] = u; r["BB_B_mid"] = m; r["BB_B_lower"] = lo; r["BB_B_width"] = w; r["BB_B_pctB"] = p; }
  { const [u, m, lo, w, p] = bollinger(closes, 50, 2, idx); r["BB_C_upper"] = u; r["BB_C_mid"] = m; r["BB_C_lower"] = lo; r["BB_C_width"] = w; r["BB_C_pctB"] = p; }

  { const [k, d] = calcStochastic(highs, lows, closes, 14, 3, 3, idx); r["STOCH_K"] = k; r["STOCH_D"] = d; }

  {
    const P = 14;
    if (idx < P) { r["ADX_14"] = NaN; r["DI_plus_14"] = NaN; r["DI_minus_14"] = NaN; }
    else {
      const tArr: number[] = [], pDM: number[] = [], mDM: number[] = [];
      for (let i = 1; i <= idx; i++) {
        const h = highs[i]!, l = lows[i]!, ph = highs[i - 1]!, pl = lows[i - 1]!;
        tArr.push(trueRange(bars[i]!, closes[i - 1]!));
        const up = h - pl, dn = l - ph;
        pDM.push(up > dn && up > 0 ? up : 0);
        mDM.push(dn > up && dn > 0 ? dn : 0);
      }
      let sT = 0, sP = 0, sM = 0;
      for (let i = 0; i < P; i++) { sT += tArr[i]!; sP += pDM[i]!; sM += mDM[i]!; }
      let smTR = sT / P, smPD = sP / P, smMD = sM / P;
      const dxA: number[] = [];
      for (let i = P; i < tArr.length; i++) {
        smTR = (smTR * (P - 1) + tArr[i]!) / P;
        smPD = (smPD * (P - 1) + pDM[i]!) / P;
        smMD = (smMD * (P - 1) + mDM[i]!) / P;
        const diP = smTR !== 0 ? (smPD / smTR) * 100 : 0;
        const diM = smTR !== 0 ? (smMD / smTR) * 100 : 0;
        const sd = diP + diM;
        dxA.push(sd !== 0 ? (Math.abs(diP - diM) / sd) * 100 : 0);
      }
      if (dxA.length >= P) {
        let adx = 0; for (let i = 0; i < P; i++) adx += dxA[i]!;
        adx /= P;
        for (let i = P; i < dxA.length; i++) adx = (adx * (P - 1) + dxA[i]!) / P;
        r["ADX_14"] = adx;
      } else { r["ADX_14"] = NaN; }
      r["DI_plus_14"] = smTR !== 0 ? (smPD / smTR) * 100 : 0;
      r["DI_minus_14"] = smTR !== 0 ? (smMD / smTR) * 100 : 0;
    }
  }

  {
    let obv = 0;
    const obvA: number[] = [0];
    for (let i = 1; i < n; i++) {
      if (closes[i]! > closes[i - 1]!) obv += volumes[i]!;
      else if (closes[i]! < closes[i - 1]!) obv -= volumes[i]!;
      obvA.push(obv);
    }
    r["OBV"] = obvA[idx]!;
    if (idx >= 19) {
      const k20 = 2 / 21;
      let e = sma(obvA, 20, 19);
      for (let i = 20; i <= idx; i++) e = emaNext(e, obvA[i]!, k20);
      r["OBV_EMA_20"] = e;
    } else { r["OBV_EMA_20"] = NaN; }
  }

  {
    let cumTPV = 0, cumV = 0;
    for (let i = 0; i <= idx; i++) {
      const b = bars[i]!;
      const tp = (b.high + b.low + b.close) / 3;
      cumTPV += tp * b.volume; cumV += b.volume;
    }
    r["VWAP"] = cumV !== 0 ? cumTPV / cumV : bars[idx]!.close;
  }

  {
    const P = 14;
    if (idx < P) { r["MFI_14"] = NaN; }
    else {
      const tpA: number[] = [], mfA: number[] = [];
      for (let i = 0; i <= idx; i++) {
        const b = bars[i]!;
        const tp = (b.high + b.low + b.close) / 3;
        tpA.push(tp); mfA.push(tp * b.volume);
      }
      let posMF = 0, negMF = 0;
      for (let i = 1; i <= P; i++) {
        if (tpA[i]! > tpA[i - 1]!) posMF += mfA[i]!; else negMF += mfA[i]!;
      }
      for (let i = P + 1; i <= idx; i++) {
        if (tpA[i]! > tpA[i - 1]!) { posMF = posMF * (P - 1) / P + mfA[i]!; negMF = negMF * (P - 1) / P; }
        else { posMF = posMF * (P - 1) / P; negMF = negMF * (P - 1) / P + mfA[i]!; }
      }
      r["MFI_14"] = negMF === 0 ? 100 : 100 - 100 / (1 + posMF / negMF);
    }
  }

  {
    const P = 20;
    if (idx < P - 1) { r["CMF_20"] = NaN; }
    else {
      let mfvS = 0, vS = 0;
      for (let i = idx - P + 1; i <= idx; i++) {
        const h = bars[i]!.high, l = bars[i]!.low, c = bars[i]!.close;
        const d = h - l;
        mfvS += d !== 0 ? ((c - l) - (h - c)) / d * bars[i]!.volume : 0;
        vS += bars[i]!.volume;
      }
      r["CMF_20"] = vS !== 0 ? mfvS / vS : 0;
    }
  }

  {
    const P = 15;
    if (idx < 3 * P) { r["TRIX_15"] = NaN; }
    else {
      const k1 = 2 / (P + 1);
      const e1A: number[] = [];
      let e1 = emaInit(closes, P);
      for (let i = P; i <= idx; i++) { e1 = emaNext(e1, closes[i]!, k1); e1A.push(e1); }
      const e2A: number[] = [];
      let e2 = sma(e1A, P, P - 1);
      e2A.push(e2);
      for (let i = P; i < e1A.length; i++) { e2 = emaNext(e2, e1A[i]!, k1); e2A.push(e2); }
      const e3A: number[] = [];
      let e3 = sma(e2A, P, P - 1);
      e3A.push(e3);
      for (let i = P; i < e2A.length; i++) { e3 = emaNext(e3, e2A[i]!, k1); e3A.push(e3); }
      if (e3A.length >= 2) {
        const last = e3A[e3A.length - 1]!, prev = e3A[e3A.length - 2]!;
        r["TRIX_15"] = prev !== 0 ? (last - prev) / prev * 100 : 0;
      } else { r["TRIX_15"] = NaN; }
    }
  }

  {
    if (idx < 28) { r["UO"] = NaN; }
    else {
      const bpA: number[] = [], trA: number[] = [];
      for (let i = 1; i <= idx; i++) {
        bpA.push(closes[i]! - Math.min(lows[i]!, closes[i - 1]!));
        trA.push(trueRange(bars[i]!, closes[i - 1]!));
      }
      let sB7 = 0, sT7 = 0, sB14 = 0, sT14 = 0, sB28 = 0, sT28 = 0;
      for (let i = 0; i < 28; i++) {
        if (i < 7) { sB7 += bpA[i]!; sT7 += trA[i]!; }
        if (i < 14) { sB14 += bpA[i]!; sT14 += trA[i]!; }
        sB28 += bpA[i]!; sT28 += trA[i]!;
      }
      r["UO"] = 100 * (4 * (sT7 !== 0 ? sB7 / sT7 : 0) + 2 * (sT14 !== 0 ? sB14 / sT14 : 0) + (sT28 !== 0 ? sB28 / sT28 : 0)) / 7;
    }
  }

  {
    const P = 25;
    if (idx < P - 1) { r["Aroon_Up_25"] = NaN; r["Aroon_Down_25"] = NaN; r["Aroon_Oscillator"] = NaN; }
    else {
      const s = idx - P + 1;
      let hiI = s, loI = s;
      for (let i = s + 1; i <= idx; i++) {
        if (highs[i]! > highs[hiI]!) hiI = i;
        if (lows[i]! < lows[loI]!) loI = i;
      }
      const u = 100 * (P - 1 - (hiI - s)) / (P - 1);
      const d = 100 * (P - 1 - (loI - s)) / (P - 1);
      r["Aroon_Up_25"] = u; r["Aroon_Down_25"] = d; r["Aroon_Oscillator"] = u - d;
    }
  }

  {
    const P = 14;
    if (idx < P) { r["Vortex_Plus_14"] = NaN; r["Vortex_Minus_14"] = NaN; }
    else {
      let vP = 0, vM = 0, tS = 0;
      for (let i = 1; i <= P; i++) {
        vP += Math.abs(highs[i]! - lows[i - 1]!);
        vM += Math.abs(lows[i]! - highs[i - 1]!);
        tS += trueRange(bars[i]!, closes[i - 1]!);
      }
      for (let i = P + 1; i <= idx; i++) {
        vP = vP * (P - 1) / P + Math.abs(highs[i]! - lows[i - 1]!);
        vM = vM * (P - 1) / P + Math.abs(lows[i]! - highs[i - 1]!);
        tS = tS * (P - 1) / P + trueRange(bars[i]!, closes[i - 1]!);
      }
      r["Vortex_Plus_14"] = tS !== 0 ? vP / tS : 0;
      r["Vortex_Minus_14"] = tS !== 0 ? vM / tS : 0;
    }
  }

  {
    const h9  = idx >= 8  ? (highest(highs, 9, idx) + lowest(lows, 9, idx)) / 2 : NaN;
    const h26 = idx >= 25 ? (highest(highs, 26, idx) + lowest(lows, 26, idx)) / 2 : NaN;
    const h52 = idx >= 51 ? (highest(highs, 52, idx) + lowest(lows, 52, idx)) / 2 : NaN;
    r["ICH_Tenkan"] = h9;
    r["ICH_Kijun"] = h26;
    r["ICH_SenkouA"] = (!isNaN(h9) && !isNaN(h26)) ? (h9 + h26) / 2 : NaN;
    r["ICH_SenkouB"] = h52;
    r["ICH_Chikou"] = closes[idx]!;
  }

  {
    const dcH = highest(highs, 20, idx), dcL = lowest(lows, 20, idx);
    r["DC_High_20"] = dcH; r["DC_Low_20"] = dcL;
    r["DC_Mid_20"] = (!isNaN(dcH) && !isNaN(dcL)) ? (dcH + dcL) / 2 : NaN;
  }

  {
    const m = sma(closes, 20, idx), a = calcATR(bars.slice(0, idx + 1), 14);
    r["KC_Mid_20"] = m; r["KC_Upper_20"] = m + 2 * a; r["KC_Lower_20"] = m - 2 * a;
  }

  {
    if (idx < 1) {
      r["Pivot_PP"] = NaN; r["Pivot_R1"] = NaN; r["Pivot_R2"] = NaN; r["Pivot_R3"] = NaN;
      r["Pivot_S1"] = NaN; r["Pivot_S2"] = NaN; r["Pivot_S3"] = NaN;
    } else {
      const pH = bars[idx - 1]!.high, pL = bars[idx - 1]!.low, pC = bars[idx - 1]!.close;
      const pp = (pH + pL + pC) / 3;
      r["Pivot_PP"] = pp;
      r["Pivot_R1"] = 2 * pp - pL; r["Pivot_R2"] = pp + (pH - pL); r["Pivot_R3"] = pH + 2 * (pp - pL);
      r["Pivot_S1"] = 2 * pp - pH; r["Pivot_S2"] = pp - (pH - pL); r["Pivot_S3"] = pL - 2 * (pp - pH);
    }
  }

  {
    const c = closes[idx]!, pc = idx >= 1 ? closes[idx - 1]! : c;
    const h = highs[idx]!, l = lows[idx]!, o = bars[idx]!.open, v = volumes[idx]!;
    r["price_change_pct"] = pc !== 0 ? ((c - pc) / pc) * 100 : 0;
    r["volume_sma_20"] = sma(volumes, 20, idx);
    r["volume_ratio"] = r["volume_sma_20"] !== 0 ? v / r["volume_sma_20"] : 0;
    r["range_pct"] = h !== 0 ? ((h - l) / h) * 100 : 0;
    r["close_to_high_pct"] = h !== 0 ? ((h - c) / h) * 100 : 0;
    r["close_to_low_pct"] = l !== 0 ? ((c - l) / l) * 100 : 0;
    const us = h - Math.max(o, c), ls = Math.min(o, c) - l, body = Math.abs(c - o);
    r["upper_shadow_pct"] = h !== 0 ? (us / h) * 100 : 0;
    r["lower_shadow_pct"] = h !== 0 ? (ls / h) * 100 : 0;
    r["body_pct"] = h !== 0 ? (body / h) * 100 : 0;
    const sma20 = r["SMA_20"]!;
    r["price_vs_sma20_pct"] = sma20 !== 0 ? ((c - sma20) / sma20) * 100 : 0;
    const ema20 = r["EMA_20"]!;
    r["price_vs_ema20_pct"] = ema20 !== 0 ? ((c - ema20) / ema20) * 100 : 0;
    r["momentum_1"] = idx >= 1 ? c - closes[idx - 1]! : 0;
    r["momentum_5"] = idx >= 5 ? c - closes[idx - 5]! : 0;
    r["momentum_10"] = idx >= 10 ? c - closes[idx - 10]! : 0;
    r["roc_10"] = idx >= 10 && closes[idx - 10]! !== 0 ? ((c - closes[idx - 10]!) / closes[idx - 10]!) * 100 : 0;
    r["roc_20"] = idx >= 20 && closes[idx - 20]! !== 0 ? ((c - closes[idx - 20]!) / closes[idx - 20]!) * 100 : 0;
  }

  return r as unknown as NamedIndicators;
}
