import { describe, expect, test } from "bun:test";
import type { PortfolioState } from "../src/types";

interface Portfolio {
  balance: number;
  position: number;
  avgEntryPrice: number;
  dailyPnL: number;
  maxDailyDrawdown: number;
  totalTrades: number;
}

function clonePortfolio(p: PortfolioState): Portfolio {
  return {
    balance: p.balance,
    position: p.position,
    avgEntryPrice: p.avgEntryPrice,
    dailyPnL: p.dailyPnL,
    maxDailyDrawdown: p.maxDailyDrawdown,
    totalTrades: p.totalTrades,
  };
}

function updatePortfolio(
  portfolio: Portfolio,
  action: "BUY" | "SELL" | "HOLD",
  price: number,
  size: number,
): { portfolio: Portfolio; pnl: number } {
  const p = { ...portfolio };
  if (action === "HOLD" || size === 0) return { portfolio: p, pnl: 0 };

  let pnl = 0;

  if (action === "BUY") {
    const cost = price * size;
    if (cost > p.balance) return { portfolio: p, pnl: 0 };
    const totalCost = p.avgEntryPrice * p.position + cost;
    p.position = p.position + size;
    p.avgEntryPrice = p.position > 0 ? totalCost / p.position : 0;
    p.balance = p.balance - cost;
    p.totalTrades = p.totalTrades + 1;
  } else if (action === "SELL") {
    const sellSize = Math.min(size, p.position);
    const proceeds = price * sellSize;
    pnl = (price - p.avgEntryPrice) * sellSize;
    p.position = p.position - sellSize;
    p.avgEntryPrice = p.position > 0 ? p.avgEntryPrice : 0;
    p.balance = p.balance + proceeds;
    p.dailyPnL = p.dailyPnL + pnl;
    p.totalTrades = p.totalTrades + 1;
  }

  return { portfolio: p, pnl };
}

function makePortfolio(overrides: Partial<PortfolioState> = {}): Portfolio {
  return {
    balance: 100_000,
    position: 0,
    avgEntryPrice: 0,
    dailyPnL: 0,
    maxDailyDrawdown: 0,
    totalTrades: 0,
    ...overrides,
  };
}

describe("updatePortfolio", () => {
  test("HOLD returns pnl 0", () => {
    const p = makePortfolio();
    const { pnl } = updatePortfolio(p, "HOLD", 100, 10);
    expect(pnl).toBe(0);
  });

  test("BUY with zero size returns pnl 0", () => {
    const p = makePortfolio();
    const { pnl } = updatePortfolio(p, "BUY", 100, 0);
    expect(pnl).toBe(0);
  });

  test("BUY deducts cost from balance and increases position", () => {
    const p = makePortfolio();
    const { portfolio: updated } = updatePortfolio(p, "BUY", 100, 20);
    expect(updated.balance).toBe(98_000);
    expect(updated.position).toBe(20);
    expect(updated.avgEntryPrice).toBe(100);
    expect(updated.totalTrades).toBe(1);
  });

  test("BUY rejected when cost exceeds balance", () => {
    const p = makePortfolio({ balance: 500 });
    const { portfolio: updated } = updatePortfolio(p, "BUY", 100, 10);
    expect(updated.balance).toBe(500);
    expect(updated.position).toBe(0);
  });

  test("BUY averages entry price correctly", () => {
    let p = makePortfolio();
    const r1 = updatePortfolio(p, "BUY", 100, 10);
    p = r1.portfolio;
    expect(p.avgEntryPrice).toBe(100);

    const r2 = updatePortfolio(p, "BUY", 200, 10);
    p = r2.portfolio;
    expect(p.avgEntryPrice).toBeCloseTo(150, 6);
    expect(p.position).toBe(20);
  });

  test("SELL adds proceeds to balance", () => {
    let p = makePortfolio();
    p = updatePortfolio(p, "BUY", 100, 10).portfolio;
    const { portfolio: updated, pnl } = updatePortfolio(p, "SELL", 120, 10);
    expect(updated.balance).toBeCloseTo(100_200, 6);
    expect(updated.position).toBe(0);
    expect(pnl).toBeCloseTo(200, 6);
  });

  test("SELL caps at available position", () => {
    let p = makePortfolio();
    p = updatePortfolio(p, "BUY", 100, 5).portfolio;
    const { portfolio: updated } = updatePortfolio(p, "SELL", 120, 10);
    expect(updated.position).toBe(0);
  });

  test("SELL tracks dailyPnL", () => {
    let p = makePortfolio();
    p = updatePortfolio(p, "BUY", 100, 10).portfolio;
    const { portfolio: updated } = updatePortfolio(p, "SELL", 110, 10);
    expect(updated.dailyPnL).toBe(100);
  });

  test("multiple trades accumulate totalTrades", () => {
    let p = makePortfolio();
    p = updatePortfolio(p, "BUY", 100, 5).portfolio;
    p = updatePortfolio(p, "SELL", 110, 5).portfolio;
    p = updatePortfolio(p, "BUY", 105, 3).portfolio;
    expect(p.totalTrades).toBe(3);
  });

  test("SELL at loss decreases balance", () => {
    let p = makePortfolio();
    p = updatePortfolio(p, "BUY", 100, 10).portfolio;
    const { portfolio: updated, pnl } = updatePortfolio(p, "SELL", 90, 10);
    expect(pnl).toBeCloseTo(-100, 6);
    expect(updated.balance).toBeCloseTo(99_900, 6);
  });
});
