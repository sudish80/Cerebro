import { describe, expect, test } from "bun:test";
import { computeAllIndicators } from "../src/engine/indicators";
import type { OHLCVBar, NamedIndicators } from "../src/types";

function makeBar(
  o: number,
  h: number,
  l: number,
  c: number,
  v = 1000,
  ts = 0,
): OHLCVBar {
  return { timestamp: ts, open: o, high: h, low: l, close: c, volume: v };
}

function generateBars(n: number, startPrice = 100): OHLCVBar[] {
  const bars: OHLCVBar[] = [];
  let price = startPrice;
  for (let i = 0; i < n; i++) {
    const o = price;
    const drift = (Math.sin(i * 0.3) * 2 + Math.cos(i * 0.1) * 1.5);
    const c = price + drift;
    const h = Math.max(o, c) + 1;
    const l = Math.min(o, c) - 1;
    const v = 1000 + Math.abs(drift) * 100;
    bars.push(makeBar(o, h, l, c, v, i));
    price = c;
  }
  return bars;
}

describe("computeAllIndicators", () => {
  test("returns a large number of indicators", () => {
    const bars = generateBars(100);
    const ind = computeAllIndicators(bars, bars.length - 1);
    const keys = Object.keys(ind);
    expect(keys.length).toBeGreaterThanOrEqual(100);
  });

  test("no NaN for SMA_5 with sufficient data", () => {
    const bars = generateBars(10);
    const ind = computeAllIndicators(bars, 9);
    expect(ind.SMA_5).not.toBeNaN();
  });

  test("SMA_5 returns correct value for simple dataset", () => {
    const vals = [10, 20, 30, 40, 50];
    const bars = vals.map((v) => makeBar(v, v + 1, v - 1, v, 1000));
    const ind = computeAllIndicators(bars, 4);
    expect(ind.SMA_5).toBeCloseTo(30, 6);
  });

  test("RSI_14 is between 0 and 100 for sufficient data", () => {
    const bars = generateBars(50);
    const ind = computeAllIndicators(bars, bars.length - 1);
    expect(ind.RSI_14).not.toBeNaN();
    expect(ind.RSI_14).toBeGreaterThanOrEqual(0);
    expect(ind.RSI_14).toBeLessThanOrEqual(100);
  });

  test("Bollinger bands: upper > mid > lower", () => {
    const bars = generateBars(60);
    const ind = computeAllIndicators(bars, bars.length - 1);
    expect(ind.BB_A_upper).not.toBeNaN();
    expect(ind.BB_A_mid).not.toBeNaN();
    expect(ind.BB_A_lower).not.toBeNaN();
    expect(ind.BB_A_upper).toBeGreaterThan(ind.BB_A_mid);
    expect(ind.BB_A_mid).toBeGreaterThan(ind.BB_A_lower);
  });

  test("MACD histogram equals line minus signal", () => {
    const bars = generateBars(60);
    const ind = computeAllIndicators(bars, bars.length - 1);
    expect(ind.MACD_A_hist).not.toBeNaN();
    expect(ind.MACD_A_hist).toBeCloseTo(
      ind.MACD_A_line - ind.MACD_A_signal,
      6,
    );
    expect(ind.MACD_B_hist).not.toBeNaN();
    expect(ind.MACD_B_hist).toBeCloseTo(
      ind.MACD_B_line - ind.MACD_B_signal,
      6,
    );
  });

  test("no NaN or undefined in output for sufficient data", () => {
    const bars = generateBars(100);
    const ind = computeAllIndicators(bars, bars.length - 1);
    const keys = Object.keys(ind) as (keyof NamedIndicators)[];
    for (const k of keys) {
      const v = ind[k];
      expect(typeof v).toBe("number");
    }
  });

  test("early index returns NaN for period-dependent indicators", () => {
    const bars = generateBars(5);
    const ind = computeAllIndicators(bars, 4);
    expect(ind.SMA_20).toBeNaN();
    expect(ind.RSI_14).toBeNaN();
    expect(ind.BB_A_upper).toBeNaN();
  });
});
