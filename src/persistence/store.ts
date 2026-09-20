import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PortfolioState, RiskEngineState, TradeRecord } from "../types";

let db: Database | null = null;

const DB_PATH = "./data/cerebro.db";

function ensureDir(): void {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function initializeStore(): void {
  ensureDir();
  db = new Database(DB_PATH);

  db.run(`
    CREATE TABLE IF NOT EXISTS portfolio (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      balance REAL NOT NULL,
      position INTEGER NOT NULL,
      avgEntryPrice REAL NOT NULL,
      dailyPnL REAL NOT NULL,
      maxDailyDrawdown REAL NOT NULL,
      totalTrades INTEGER NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS risk_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      consecutiveLosses INTEGER NOT NULL,
      lastTradeTimestamp INTEGER NOT NULL,
      haltUntilTimestamp INTEGER NOT NULL,
      trailingStopPrice REAL,
      trailingStopActive INTEGER NOT NULL,
      highestProfitSinceEntry REAL NOT NULL,
      tradeTimestampsJson TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      action TEXT NOT NULL,
      entryPrice REAL NOT NULL,
      exitPrice REAL,
      size REAL NOT NULL,
      grossPnl REAL NOT NULL,
      fees REAL NOT NULL,
      netPnl REAL NOT NULL,
      holdDurationBars INTEGER NOT NULL,
      jevConfidence REAL NOT NULL,
      jevProbabilities TEXT NOT NULL,
      riskReason TEXT NOT NULL,
      executionLatencyMs INTEGER NOT NULL,
      txHash TEXT NOT NULL,
      gasCost REAL NOT NULL,
      indicatorsSnapshot TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);
}

export function savePortfolio(state: PortfolioState): void {
  if (!db) return;
  db.run(
    `INSERT INTO portfolio (id, balance, position, avgEntryPrice, dailyPnL, maxDailyDrawdown, totalTrades, updatedAt)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       balance = excluded.balance,
       position = excluded.position,
       avgEntryPrice = excluded.avgEntryPrice,
       dailyPnL = excluded.dailyPnL,
       maxDailyDrawdown = excluded.maxDailyDrawdown,
       totalTrades = excluded.totalTrades,
       updatedAt = excluded.updatedAt`,
    [
      state.balance,
      state.position,
      state.avgEntryPrice,
      state.dailyPnL,
      state.maxDailyDrawdown,
      state.totalTrades,
      new Date().toISOString(),
    ],
  );
}

export function loadPortfolio(): PortfolioState | null {
  if (!db) return null;
  const row = db
    .query(
      `SELECT balance, position, avgEntryPrice, dailyPnL, maxDailyDrawdown, totalTrades
       FROM portfolio WHERE id = 1`,
    )
    .get() as
    | {
        balance: number;
        position: number;
        avgEntryPrice: number;
        dailyPnL: number;
        maxDailyDrawdown: number;
        totalTrades: number;
      }
    | undefined;
  if (!row) return null;
  return {
    balance: row.balance,
    position: row.position,
    avgEntryPrice: row.avgEntryPrice,
    dailyPnL: row.dailyPnL,
    maxDailyDrawdown: row.maxDailyDrawdown,
    totalTrades: row.totalTrades,
  };
}

export function saveRiskState(state: RiskEngineState): void {
  if (!db) return;
  db.run(
    `INSERT INTO risk_state (id, consecutiveLosses, lastTradeTimestamp, haltUntilTimestamp, trailingStopPrice, trailingStopActive, highestProfitSinceEntry, tradeTimestampsJson, updatedAt)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       consecutiveLosses = excluded.consecutiveLosses,
       lastTradeTimestamp = excluded.lastTradeTimestamp,
       haltUntilTimestamp = excluded.haltUntilTimestamp,
       trailingStopPrice = excluded.trailingStopPrice,
       trailingStopActive = excluded.trailingStopActive,
       highestProfitSinceEntry = excluded.highestProfitSinceEntry,
       tradeTimestampsJson = excluded.tradeTimestampsJson,
       updatedAt = excluded.updatedAt`,
    [
      state.consecutiveLosses,
      state.lastTradeTimestamp,
      state.haltUntilTimestamp,
      state.trailingStopPrice,
      state.trailingStopActive ? 1 : 0,
      state.highestProfitSinceEntry,
      state.tradeTimestampsJson,
      new Date().toISOString(),
    ],
  );
}

export function loadRiskState(): RiskEngineState | null {
  if (!db) return null;
  const row = db
    .query(
      `SELECT consecutiveLosses, lastTradeTimestamp, haltUntilTimestamp, trailingStopPrice, trailingStopActive, highestProfitSinceEntry, tradeTimestampsJson
       FROM risk_state WHERE id = 1`,
    )
    .get() as
    | {
        consecutiveLosses: number;
        lastTradeTimestamp: number;
        haltUntilTimestamp: number;
        trailingStopPrice: number | null;
        trailingStopActive: number;
        highestProfitSinceEntry: number;
        tradeTimestampsJson: string;
      }
    | undefined;
  if (!row) return null;
  return {
    consecutiveLosses: row.consecutiveLosses,
    lastTradeTimestamp: row.lastTradeTimestamp,
    haltUntilTimestamp: row.haltUntilTimestamp,
    trailingStopPrice: row.trailingStopPrice,
    trailingStopActive: row.trailingStopActive === 1,
    highestProfitSinceEntry: row.highestProfitSinceEntry,
    tradeTimestampsJson: row.tradeTimestampsJson,
  };
}

export function saveTrade(trade: TradeRecord): void {
  if (!db) return;
  db.run(
    `INSERT INTO trades (timestamp, action, entryPrice, exitPrice, size, grossPnl, fees, netPnl, holdDurationBars, jevConfidence, jevProbabilities, riskReason, executionLatencyMs, txHash, gasCost, indicatorsSnapshot, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      new Date(trade.timestamp).toISOString(),
      trade.action,
      trade.entryPrice,
      trade.exitPrice,
      trade.size,
      trade.grossPnl,
      trade.fees,
      trade.netPnl,
      trade.holdDurationBars,
      trade.jevConfidence,
      trade.jevProbabilities,
      trade.riskReason,
      trade.executionLatencyMs,
      trade.txHash,
      trade.gasCost,
      trade.indicatorsSnapshot,
      new Date().toISOString(),
    ],
  );
}

export function closeStore(): void {
  if (db) {
    db.close();
    db = null;
  }
}
