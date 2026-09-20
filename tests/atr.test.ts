import { describe, expect, test } from "bun:test";
import { trueRange, calcATR } from "../src/engine/atr";
import type { OHLCVBar } from "../src/types";

function bar(o: number, h: number, l: number, c: number): OHLCVBar {
  return { timestamp: 0, open: o, high: h, low: l, close: c, volume: 100 };
}

describe("trueRange", () => {
  test("high-low range dominates when within prev close", () => {
    const b = bar(10, 15, 5, 12);
    expect(trueRange(b, 12)).toBe(10);
  });

  test("gap up: high - prevClose dominates", () => {
    const b = bar(20, 25, 18, 22);
    expect(trueRange(b, 10)).toBe(15);
  });

  test("gap down: prevClose - low dominates", () => {
    const b = bar(5, 8, 2, 4);
    expect(trueRange(b, 15)).toBe(13);
  });

  test("bar with zero range, prev close at close", () => {
    const b = bar(10, 10, 10, 10);
    expect(trueRange(b, 10)).toBe(0);
  });
});

describe("calcATR", () => {
  test("returns NaN when fewer bars than period + 1", () => {
    const bars = [bar(100, 105, 95, 102), bar(102, 108, 98, 106)];
    expect(calcATR(bars, 14)).toBeNaN();
  });

  test("returns NaN for empty array", () => {
    expect(calcATR([], 14)).toBeNaN();
  });

  test("returns NaN for single bar", () => {
    expect(calcATR([bar(100, 105, 95, 102)], 14)).toBeNaN();
  });

  test("returns correct ATR for known bars (period=2, 3 bars)", () => {
    const bars = [
      bar(100, 105, 95, 100),
      bar(100, 110, 98, 108),
      bar(108, 115, 105, 112),
    ];
    const tr1 = Math.max(110 - 98, Math.abs(110 - 100), Math.abs(98 - 100));
    const tr2 = Math.max(115 - 105, Math.abs(115 - 108), Math.abs(105 - 108));
    const expected = (tr1 + tr2) / 2;
    expect(calcATR(bars, 2)).toBeCloseTo(expected, 6);
  });

  test("ATR with many bars stabilizes via exponential smoothing", () => {
    const bars: OHLCVBar[] = [];
    let price = 100;
    for (let i = 0; i < 30; i++) {
      const o = price;
      const h = price + 2;
      const l = price - 2;
      const c = price + 0.5;
      bars.push(bar(o, h, l, c));
      price = c;
    }
    const atr = calcATR(bars, 14);
    expect(atr).not.toBeNaN();
    expect(atr).toBeGreaterThan(0);
    expect(atr).toBeLessThan(5);
  });
});
