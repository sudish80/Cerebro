import { describe, expect, test } from "bun:test";
import { formatStateBlock } from "../src/engine/state-formatter";
import { computeAllIndicators } from "../src/engine/indicators";
import type { OHLCVBar, StateBlock, NamedIndicators } from "../src/types";

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

function generateBars(n: number): OHLCVBar[] {
  const bars: OHLCVBar[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const o = price;
    const c = price + Math.sin(i * 0.3) * 2;
    const h = Math.max(o, c) + 1;
    const l = Math.min(o, c) - 1;
    bars.push(makeBar(o, h, l, c, 1000 + i * 10, i));
    price = c;
  }
  return bars;
}

function makeStateBlock(overrides: Partial<StateBlock> = {}): StateBlock {
  const bars = generateBars(60);
  const indicators = computeAllIndicators(bars, bars.length - 1);
  return {
    bar: {
      timestamp: 1700000000000,
      open: 100,
      high: 105,
      low: 95,
      close: 102,
      volume: 5000,
    },
    orderbook: {
      bids: [[101, 100]],
      asks: [[102, 100]],
      bestBid: 101,
      bestAsk: 102,
      spread: 1,
      mid: 101.5,
      timestamp: 1700000000000,
    },
    indicators,
    portfolio: {
      balance: 100_000,
      position: 0,
      avgEntryPrice: 0,
      dailyPnL: 0,
      maxDailyDrawdown: 0,
      totalTrades: 0,
    },
    blockHeight: 1,
    ...overrides,
  };
}

describe("formatStateBlock", () => {
  test("output starts with BLK:", () => {
    const output = formatStateBlock(makeStateBlock());
    expect(output.startsWith("BLK:")).toBe(true);
  });

  test("output contains T: for timestamp", () => {
    const output = formatStateBlock(makeStateBlock());
    expect(output).toContain("T:");
  });

  test("output contains O:, H:, L:, C:, V: for OHLCV", () => {
    const output = formatStateBlock(makeStateBlock());
    expect(output).toContain("O:100");
    expect(output).toContain("H:105");
    expect(output).toContain("L:95");
    expect(output).toContain("C:102");
    expect(output).toContain("V:5000");
  });

  test("output contains BB: for orderbook", () => {
    const output = formatStateBlock(makeStateBlock());
    expect(output).toContain("BB:101:102");
  });

  test("output contains POS: for position", () => {
    const output = formatStateBlock(makeStateBlock());
    expect(output).toContain("POS:");
  });

  test("output contains indicator abbreviations", () => {
    const output = formatStateBlock(makeStateBlock());
    expect(output).toContain("SMA5:");
    expect(output).toContain("EMA14:");
    expect(output).toContain("RSI14:");
    expect(output).toContain("ATR7:");
    expect(output).toContain("ATR14:");
    expect(output).toContain("MACD_A_L:");
    expect(output).toContain("BB_A_U:");
    expect(output).toContain("STOCH_K:");
    expect(output).toContain("ADX:");
    expect(output).toContain("OBV:");
    expect(output).toContain("VWAP:");
    expect(output).toContain("MFI:");
    expect(output).toContain("CMF:");
    expect(output).toContain("TRIX:");
    expect(output).toContain("UO:");
    expect(output).toContain("ARU:");
    expect(output).toContain("VP:");
    expect(output).toContain("ICT:");
    expect(output).toContain("DCH:");
    expect(output).toContain("KCU:");
    expect(output).toContain("PPP:");
    expect(output).toContain("R1:");
    expect(output).toContain("S1:");
    expect(output).toContain("PCP:");
    expect(output).toContain("MOM1:");
    expect(output).toContain("ROC10:");
    expect(output).toContain("RNG_PCT:");
    expect(output).toContain("BODY:");
  });

  test("NaN values are formatted as NaN", () => {
    const bars = generateBars(3);
    const indicators = computeAllIndicators(bars, 2);
    const output = formatStateBlock(makeStateBlock({ indicators }));
    expect(output).toContain("SMA20:NaN");
    expect(output).toContain("RSI14:NaN");
  });

  test("numeric values are formatted without trailing zeros", () => {
    const output = formatStateBlock(makeStateBlock());
    expect(output).toContain("O:100");
    expect(output).toContain("H:105");
    expect(output).toContain("L:95");
  });
});
