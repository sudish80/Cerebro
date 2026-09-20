import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  initializeStore,
  savePortfolio,
  loadPortfolio,
  saveRiskState,
  loadRiskState,
  closeStore,
} from "../src/persistence/store";
import type { PortfolioState, RiskEngineState } from "../src/types";
import { existsSync, rmSync } from "node:fs";

const DB_PATH = "./data/cerebro.db";

function cleanup() {
  closeStore();
  if (existsSync(DB_PATH)) {
    rmSync(DB_PATH);
  }
}

beforeEach(() => {
  cleanup();
});

afterEach(() => {
  cleanup();
});

describe("Trade Persistence", () => {
  it("initializeStore creates the database", () => {
    initializeStore();
    expect(existsSync(DB_PATH)).toBe(true);
    closeStore();
  });

  it("savePortfolio and loadPortfolio round-trips correctly", () => {
    initializeStore();

    const state: PortfolioState = {
      balance: 50_000.5,
      position: 42,
      avgEntryPrice: 123.45,
      dailyPnL: -250.0,
      maxDailyDrawdown: -500.0,
      totalTrades: 17,
    };

    savePortfolio(state);
    const loaded = loadPortfolio();

    expect(loaded).not.toBeNull();
    expect(loaded!.balance).toBe(state.balance);
    expect(loaded!.position).toBe(state.position);
    expect(loaded!.avgEntryPrice).toBe(state.avgEntryPrice);
    expect(loaded!.dailyPnL).toBe(state.dailyPnL);
    expect(loaded!.maxDailyDrawdown).toBe(state.maxDailyDrawdown);
    expect(loaded!.totalTrades).toBe(state.totalTrades);

    closeStore();
  });

  it("savePortfolio overwrites existing data", () => {
    initializeStore();

    const first: PortfolioState = {
      balance: 100_000,
      position: 0,
      avgEntryPrice: 0,
      dailyPnL: 0,
      maxDailyDrawdown: 0,
      totalTrades: 5,
    };

    const second: PortfolioState = {
      balance: 75_000,
      position: 10,
      avgEntryPrice: 200,
      dailyPnL: -1000,
      maxDailyDrawdown: -2000,
      totalTrades: 20,
    };

    savePortfolio(first);
    savePortfolio(second);
    const loaded = loadPortfolio();

    expect(loaded!.balance).toBe(75_000);
    expect(loaded!.totalTrades).toBe(20);

    closeStore();
  });

  it("loadPortfolio returns null when empty", () => {
    initializeStore();
    const loaded = loadPortfolio();
    expect(loaded).toBeNull();
    closeStore();
  });

  it("saveRiskState and loadRiskState round-trips correctly", () => {
    initializeStore();

    const riskState: RiskEngineState = {
      consecutiveLosses: 3,
      lastTradeTimestamp: 1700000000000,
      haltUntilTimestamp: 1700000060000,
      trailingStopPrice: 99.5,
      trailingStopActive: true,
      highestProfitSinceEntry: 500,
      tradeTimestampsJson: JSON.stringify([1700000000000, 1700000030000]),
    };

    saveRiskState(riskState);
    const loaded = loadRiskState();

    expect(loaded).not.toBeNull();
    expect(loaded!.consecutiveLosses).toBe(3);
    expect(loaded!.lastTradeTimestamp).toBe(1700000000000);
    expect(loaded!.haltUntilTimestamp).toBe(1700000060000);
    expect(loaded!.trailingStopPrice).toBe(99.5);
    expect(loaded!.trailingStopActive).toBe(true);
    expect(loaded!.highestProfitSinceEntry).toBe(500);
    expect(loaded!.tradeTimestampsJson).toBe(
      JSON.stringify([1700000000000, 1700000030000]),
    );

    closeStore();
  });

  it("loadRiskState returns null when empty", () => {
    initializeStore();
    const loaded = loadRiskState();
    expect(loaded).toBeNull();
    closeStore();
  });

  it("saveRiskState with null trailingStopPrice", () => {
    initializeStore();

    const riskState: RiskEngineState = {
      consecutiveLosses: 0,
      lastTradeTimestamp: 0,
      haltUntilTimestamp: 0,
      trailingStopPrice: null,
      trailingStopActive: false,
      highestProfitSinceEntry: 0,
      tradeTimestampsJson: "[]",
    };

    saveRiskState(riskState);
    const loaded = loadRiskState();

    expect(loaded).not.toBeNull();
    expect(loaded!.trailingStopPrice).toBeNull();
    expect(loaded!.trailingStopActive).toBe(false);

    closeStore();
  });
});
