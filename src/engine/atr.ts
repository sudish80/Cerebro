import type { OHLCVBar } from "../types";

export function trueRange(bar: OHLCVBar, prevClose: number): number {
  return Math.max(
    bar.high - bar.low,
    Math.abs(bar.high - prevClose),
    Math.abs(bar.low - prevClose),
  );
}

export function calcATR(bars: readonly OHLCVBar[], period: number): number {
  if (bars.length < period + 1) return NaN;
  let atr = 0;
  for (let i = 1; i <= period; i++) {
    atr += trueRange(bars[i]!, bars[i - 1]!.close);
  }
  atr /= period;
  for (let i = period + 1; i < bars.length; i++) {
    atr = (atr * (period - 1) + trueRange(bars[i]!, bars[i - 1]!.close)) / period;
  }
  return atr;
}
