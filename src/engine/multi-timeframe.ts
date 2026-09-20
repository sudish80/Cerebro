import { computeAllIndicators } from "./indicators";
import type { OHLCVBar, NamedIndicators, MultiTimeframeState } from "../types";

export type { MultiTimeframeState };

const TF_LABELS: Record<number, string> = {
  1: "1m", 5: "5m", 15: "15m", 30: "30m", 60: "1h", 240: "4h", 1440: "1d",
};

function downsample(bars: readonly OHLCVBar[], factor: number): readonly OHLCVBar[] {
  if (factor <= 1) return bars;
  const result: OHLCVBar[] = [];
  for (let i = 0; i < bars.length; i += factor) {
    const chunk = bars.slice(i, i + factor);
    const first = chunk[0]!;
    const last = chunk[chunk.length - 1]!;
    let high = -Infinity;
    let low = Infinity;
    let vol = 0;
    for (const b of chunk) {
      if (b.high > high) high = b.high;
      if (b.low < low) low = b.low;
      vol += b.volume;
    }
    result.push({
      timestamp: first.timestamp,
      open: first.open,
      high,
      low,
      close: last.close,
      volume: vol,
    });
  }
  return result;
}

function formatIndicatorValue(name: string, value: number): string {
  const v = Number.isNaN(value) ? "NaN" : value.toFixed(2).replace(/\.?0+$/, "");
  return `${name}=${v}`;
}

function formatTimeframe(tf: number, ind: NamedIndicators): string {
  const label = TF_LABELS[tf] ?? `${tf}m`;
  const parts = [
    formatIndicatorValue("RSI", ind.RSI_14),
    formatIndicatorValue("MACD_H", ind.MACD_A_hist),
    formatIndicatorValue("BB_W", ind.BB_A_width),
    formatIndicatorValue("ATR", ind.ATR_14),
    formatIndicatorValue("ADX", ind.ADX_14),
    formatIndicatorValue("STOCH", ind.STOCH_K),
    formatIndicatorValue("MFI", ind.MFI_14),
  ];
  return `TF${label}:${parts.join(":")}`;
}

export function computeMultiTimeframe(
  bars: readonly OHLCVBar[],
  baseIndex: number,
  timeframes: readonly number[],
): MultiTimeframeState {
  const timeframesRecord: Record<string, NamedIndicators> = {};

  let current: NamedIndicators | null = null;

  for (const tf of timeframes) {
    const downsampled = downsample(bars, tf);
    const dsIdx = Math.min(Math.floor(baseIndex / tf), downsampled.length - 1);
    const ind = computeAllIndicators(downsampled, Math.max(0, dsIdx));
    const label = TF_LABELS[tf] ?? `${tf}m`;
    timeframesRecord[label] = ind;

    if (tf === 1) {
      current = ind;
    }
  }

  if (!current) {
    current = computeAllIndicators(bars, baseIndex);
  }

  const formattedParts: string[] = [];
  for (const tf of timeframes) {
    const label = TF_LABELS[tf] ?? `${tf}m`;
    const ind = timeframesRecord[label]!;
    formattedParts.push(formatTimeframe(tf, ind));
  }

  return {
    timeframes: timeframesRecord,
    current,
    formatted: formattedParts.join("|"),
  };
}
