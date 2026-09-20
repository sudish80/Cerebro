import { loadCSV } from "./csv-loader";
import { computeAllIndicators } from "../engine/indicators";
import { formatStateBlock } from "../engine/state-formatter";
import { queryJev } from "../brain/jev-client";
import {
  initializeDecisionCache,
  getDecision,
  setDecision,
  getCacheSize,
  clearDecisionCache,
  closeDecisionCache,
} from "../brain/decision-cache";
import { evaluateRisk, recordTradeOutcome } from "../safety/risk-engine";
import { BT, RISK } from "../config";
import { calcATR } from "../engine/atr";
import type {
  OHLCVBar,
  PortfolioState,
  OrderBookSnapshot,
  StateBlock,
  JevDecision,
  RiskVerdict,
} from "../types";

/* ═══════════════════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════════════════ */

interface Portfolio {
  balance: number;
  position: number;
  avgEntryPrice: number;
  dailyPnL: number;
  maxDailyDrawdown: number;
  totalTrades: number;
}

interface TradeRecord {
  index: number;
  date: string;
  action: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number;
  size: number;
  grossPnl: number;
  fees: number;
  netPnl: number;
  holdingBars: number;
  rsiAtEntry: number;
  macdHistAtEntry: number;
}

interface Metrics {
  totalReturnPct: number;
  annualizedReturnPct: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  winRate: number;
  maxDrawdownPct: number;
  maxDrawdownBars: number;
  totalTrades: number;
  totalFees: number;
  netPnl: number;
  grossPnl: number;
}

interface MonteCarloResult {
  median: number;
  p5: number;
  p95: number;
  runs: number;
}

interface RegimeReport {
  label: string;
  trades: number;
  netPnl: number;
  avgPnl: number;
  winRate: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Metrics Functions
   ═══════════════════════════════════════════════════════════════════════════ */

const TRADING_DAYS_PER_YEAR = 365;

function sharpe(returns: readonly number[]): number {
  if (returns.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < returns.length; i++) sum += returns[i]!;
  const mean = sum / returns.length;
  let sumSq = 0;
  for (let i = 0; i < returns.length; i++) {
    const d = returns[i]! - mean;
    sumSq += d * d;
  }
  const std = Math.sqrt(sumSq / (returns.length - 1));
  if (std === 0) return 0;
  return (mean / std) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

function sortino(returns: readonly number[]): number {
  if (returns.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < returns.length; i++) sum += returns[i]!;
  const mean = sum / returns.length;
  let sumSq = 0;
  let count = 0;
  for (let i = 0; i < returns.length; i++) {
    if (returns[i]! < 0) {
      sumSq += returns[i]! * returns[i]!;
      count++;
    }
  }
  const downsideDev = count > 0 ? Math.sqrt(sumSq / count) : 0;
  if (downsideDev === 0) return 0;
  return (mean / downsideDev) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

function maxDrawdown(equity: readonly number[]): { pct: number; duration: number } {
  if (equity.length === 0) return { pct: 0, duration: 0 };
  let peak = equity[0]!;
  let maxPct = 0;
  let currentDuration = 0;
  let maxDuration = 0;
  for (let i = 1; i < equity.length; i++) {
    const val = equity[i]!;
    if (val >= peak) {
      peak = val;
      currentDuration = 0;
    } else {
      currentDuration++;
      const drawdown = (peak - val) / peak;
      if (drawdown > maxPct) maxPct = drawdown;
      if (currentDuration > maxDuration) maxDuration = currentDuration;
    }
  }
  return { pct: maxPct, duration: maxDuration };
}

function profitFactor(trades: readonly TradeRecord[]): number {
  let grossProfit = 0;
  let grossLoss = 0;
  for (const t of trades) {
    if (t.netPnl > 0) grossProfit += t.netPnl;
    else grossLoss += Math.abs(t.netPnl);
  }
  if (grossLoss === 0) return grossProfit > 0 ? Infinity : 0;
  return grossProfit / grossLoss;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Simulated Orderbook Builder
   ═══════════════════════════════════════════════════════════════════════════ */

function buildSimOrderbook(price: number, depth: number): OrderBookSnapshot {
  const spread = price * 0.0005;
  const bids: [number, number][] = [];
  const asks: [number, number][] = [];
  for (let i = 0; i < depth; i++) {
    bids.push([price - spread / 2 - i * spread, Math.random() * 10 + 1]);
    asks.push([price + spread / 2 + i * spread, Math.random() * 10 + 1]);
  }
  return {
    bids,
    asks,
    bestBid: bids[0]![0],
    bestAsk: asks[0]![0],
    spread,
    mid: price,
    timestamp: Date.now(),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Walk-Forward Window Runner
   ═══════════════════════════════════════════════════════════════════════════ */

interface WindowResult {
  trades: TradeRecord[];
  equity: number[];
  portfolio: Portfolio;
  cacheHits: number;
  cacheMisses: number;
}

async function runWindow(
  bars: readonly OHLCVBar[],
  windowStart: number,
  windowEnd: number,
  startBalance: number,
): Promise<WindowResult> {
  const portfolio: Portfolio = {
    balance: startBalance,
    position: 0,
    avgEntryPrice: 0,
    dailyPnL: 0,
    maxDailyDrawdown: 0,
    totalTrades: 0,
  };

  const trades: TradeRecord[] = [];
  const equity: number[] = [startBalance];
  let cacheHits = 0;
  let cacheMisses = 0;

  let entryRecord: {
    price: number;
    barIndex: number;
    size: number;
    rsi: number;
    macdHist: number;
  } | null = null;

  for (let i = windowStart; i < windowEnd; i++) {
    if (i >= bars.length - 1) break;

    const indicators = computeAllIndicators(bars, i);
    const atr14 = calcATR(bars.slice(0, i + 1), 14);

    const orderbook = buildSimOrderbook(bars[i]!.close, 10);

    const portfolioState: PortfolioState = {
      balance: portfolio.balance,
      position: portfolio.position,
      avgEntryPrice: portfolio.avgEntryPrice,
      dailyPnL: portfolio.dailyPnL,
      maxDailyDrawdown: portfolio.maxDailyDrawdown,
      totalTrades: portfolio.totalTrades,
    };

    const stateBlock: StateBlock = {
      bar: bars[i]!,
      orderbook,
      indicators,
      portfolio: portfolioState,
      blockHeight: i,
    };

    const stateString = formatStateBlock(stateBlock);

    let decision: JevDecision;
    try {
      const cached = getDecision(stateString);
      if (cached) {
        decision = cached;
        cacheHits++;
      } else {
        decision = await queryJev(stateString);
        setDecision(stateString, decision);
        cacheMisses++;
      }
    } catch {
      continue;
    }

    const atrVal = isNaN(atr14) ? 0 : atr14;
    const verdict: RiskVerdict = evaluateRisk(
      decision,
      portfolioState,
      bars[i]!.close,
      atrVal,
    );

    const nextBar = bars[i + 1]!;
    const nextDate = new Date(nextBar.timestamp).toISOString().slice(0, 10);

    if (verdict.approved && verdict.action !== "HOLD" && verdict.size > 0) {
      if (verdict.action === "BUY" && portfolio.position === 0) {
        const fillPrice = nextBar.open * (1 + BT.slippageBps / 10000);
        const size = verdict.size;
        const cost = fillPrice * size;
        const fee = cost * BT.feeRateBps / 10000;

        if (portfolio.balance >= cost + fee) {
          portfolio.balance -= cost + fee;
          portfolio.position = size;
          portfolio.avgEntryPrice = fillPrice;
          portfolio.totalTrades++;

          entryRecord = {
            price: fillPrice,
            barIndex: i + 1,
            size,
            rsi: indicators.RSI_14,
            macdHist: indicators.MACD_A_hist,
          };
        }
      } else if (verdict.action === "SELL" && portfolio.position > 0) {
        const fillPrice = nextBar.open * (1 - BT.slippageBps / 10000);
        const size = Math.min(verdict.size, portfolio.position);
        const proceeds = fillPrice * size;
        const fee = proceeds * BT.feeRateBps / 10000;

        const grossPnl = (fillPrice - entryRecord!.price) * size;
        const netPnl = grossPnl - fee - (entryRecord!.price * size * BT.feeRateBps / 10000);

        portfolio.balance += proceeds - fee;
        portfolio.position = 0;
        portfolio.dailyPnL += netPnl;
        portfolio.totalTrades++;

        if (portfolio.dailyPnL < portfolio.maxDailyDrawdown) {
          portfolio.maxDailyDrawdown = portfolio.dailyPnL;
        }

        recordTradeOutcome(netPnl);

        trades.push({
          index: i + 1,
          date: nextDate,
          action: "SELL",
          entryPrice: entryRecord!.price,
          exitPrice: fillPrice,
          size,
          grossPnl,
          fees: fee + entryRecord!.price * size * BT.feeRateBps / 10000,
          netPnl,
          holdingBars: (i + 1) - entryRecord!.barIndex,
          rsiAtEntry: entryRecord!.rsi,
          macdHistAtEntry: entryRecord!.macdHist,
        });

        entryRecord = null;
      }
    }

    equity.push(portfolio.balance + (portfolio.position > 0 ? portfolio.position * bars[i]!.close : 0));
  }

  if (portfolio.position > 0 && entryRecord !== null) {
    const lastBar = bars[Math.min(windowEnd, bars.length) - 1]!;
    const closePrice = lastBar.close;
    const size = portfolio.position;
    const grossPnl = (closePrice - entryRecord.price) * size;
    const fee = closePrice * size * BT.feeRateBps / 10000;
    const netPnl = grossPnl - fee - (entryRecord.price * size * BT.feeRateBps / 10000);

    portfolio.balance += closePrice * size - fee;
    portfolio.position = 0;

    recordTradeOutcome(netPnl);

    trades.push({
      index: Math.min(windowEnd, bars.length) - 1,
      date: new Date(lastBar.timestamp).toISOString().slice(0, 10),
      action: "SELL",
      entryPrice: entryRecord.price,
      exitPrice: closePrice,
      size,
      grossPnl,
      fees: fee + entryRecord.price * size * BT.feeRateBps / 10000,
      netPnl,
      holdingBars: (Math.min(windowEnd, bars.length) - 1) - entryRecord.barIndex,
      rsiAtEntry: entryRecord.rsi,
      macdHistAtEntry: entryRecord.macdHist,
    });

    equity.push(portfolio.balance);
  }

  return { trades, equity, portfolio, cacheHits, cacheMisses };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Metrics Computation
   ═══════════════════════════════════════════════════════════════════════════ */

function computeMetrics(
  trades: readonly TradeRecord[],
  equity: readonly number[],
  initialBalance: number,
): Metrics {
  const wins = trades.filter((t) => t.netPnl > 0);
  const losses = trades.filter((t) => t.netPnl <= 0);

  const netPnl = trades.reduce((s, t) => s + t.netPnl, 0);
  const grossPnl = trades.reduce((s, t) => s + t.grossPnl, 0);
  const totalFees = trades.reduce((s, t) => s + t.fees, 0);

  const totalReturnPct = initialBalance > 0 ? (netPnl / initialBalance) * 100 : 0;

  const dailyReturns: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    const prev = equity[i - 1]!;
    if (prev > 0) dailyReturns.push((equity[i]! - prev) / prev);
  }

  const annReturn = equity.length > 1
    ? Math.pow(equity[equity.length - 1]! / initialBalance, TRADING_DAYS_PER_YEAR / equity.length) - 1
    : 0;

  const { pct: maxDdPct, duration: maxDdBars } = maxDrawdown(equity);

  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.netPnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.netPnl, 0) / losses.length : 0;

  const sharpeVal = sharpe(dailyReturns);
  const sortinoVal = sortino(dailyReturns);
  const calmarVal = maxDdPct > 0 ? annReturn / maxDdPct : 0;

  return {
    totalReturnPct,
    annualizedReturnPct: annReturn * 100,
    sharpeRatio: sharpeVal,
    sortinoRatio: sortinoVal,
    calmarRatio: calmarVal,
    profitFactor: profitFactor(trades),
    avgWin,
    avgLoss,
    winRate: trades.length > 0 ? wins.length / trades.length : 0,
    maxDrawdownPct: maxDdPct * 100,
    maxDrawdownBars: maxDdBars,
    totalTrades: trades.length,
    totalFees,
    netPnl,
    grossPnl,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Buy-and-Hold Benchmark
   ═══════════════════════════════════════════════════════════════════════════ */

function runBuyAndHold(
  bars: readonly OHLCVBar[],
  initialBalance: number,
): Metrics {
  if (bars.length < 2) {
    return {
      totalReturnPct: 0, annualizedReturnPct: 0, sharpeRatio: 0,
      sortinoRatio: 0, calmarRatio: 0, profitFactor: 0,
      avgWin: 0, avgLoss: 0, winRate: 0, maxDrawdownPct: 0,
      maxDrawdownBars: 0, totalTrades: 1, totalFees: 0,
      netPnl: 0, grossPnl: 0,
    };
  }

  const entryPrice = bars[0]!.open * (1 + BT.slippageBps / 10000);
  const fee1 = initialBalance * BT.feeRateBps / 10000;
  const size = Math.floor((initialBalance - fee1) / entryPrice);
  const cost = size * entryPrice;
  const fee2 = bars[bars.length - 1]!.close * size * BT.feeRateBps / 10000;

  const equity: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    equity.push(initialBalance - cost - fee1 + bars[i]!.close * size);
  }

  const exitPrice = bars[bars.length - 1]!.open * (1 - BT.slippageBps / 10000);
  const grossPnl = (exitPrice - entryPrice) * size;
  const totalFees = fee1 + fee2;
  const netPnl = grossPnl - totalFees;

  const dailyReturns: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    const prev = equity[i - 1]!;
    if (prev > 0) dailyReturns.push((equity[i]! - prev) / prev);
  }

  const annReturn = Math.pow(
    equity[equity.length - 1]! / initialBalance,
    TRADING_DAYS_PER_YEAR / equity.length,
  ) - 1;

  const { pct: maxDdPct, duration: maxDdBars } = maxDrawdown(equity);

  return {
    totalReturnPct: (netPnl / initialBalance) * 100,
    annualizedReturnPct: annReturn * 100,
    sharpeRatio: sharpe(dailyReturns),
    sortinoRatio: sortino(dailyReturns),
    calmarRatio: maxDdPct > 0 ? annReturn / maxDdPct : 0,
    profitFactor: grossPnl > 0 ? (netPnl > 0 ? grossPnl / Math.abs(netPnl - grossPnl) : 0) : 0,
    avgWin: grossPnl > 0 ? grossPnl : 0,
    avgLoss: grossPnl < 0 ? grossPnl : 0,
    winRate: grossPnl > 0 ? 1 : 0,
    maxDrawdownPct: maxDdPct * 100,
    maxDrawdownBars: maxDdBars,
    totalTrades: 1,
    totalFees,
    netPnl,
    grossPnl,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Monte Carlo Simulation
   ═══════════════════════════════════════════════════════════════════════════ */

function runMonteCarlo(trades: readonly TradeRecord[], runs: number): MonteCarloResult {
  const pnls = trades.map((t) => t.netPnl);
  if (pnls.length === 0) return { median: 0, p5: 0, p95: 0, runs: 0 };

  const results: number[] = [];
  for (let r = 0; r < runs; r++) {
    let total = 0;
    for (let i = 0; i < pnls.length; i++) {
      const idx = Math.floor(Math.random() * pnls.length);
      total += pnls[idx]!;
    }
    results.push(total);
  }

  results.sort((a, b) => a - b);

  const median = results[Math.floor(results.length * 0.5)]!;
  const p5 = results[Math.floor(results.length * 0.05)]!;
  const p95 = results[Math.floor(results.length * 0.95)]!;

  return { median, p5, p95, runs };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Regime Classification
   ═══════════════════════════════════════════════════════════════════════════ */

function classifyRegimes(bars: readonly OHLCVBar[]): ("bull" | "bear" | "sideways")[] {
  const sma20: (number | undefined)[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (i < 19) { sma20.push(undefined); continue; }
    let sum = 0;
    for (let j = i - 19; j <= i; j++) sum += bars[j]!.close;
    sma20.push(sum / 20);
  }

  return bars.map((b, i) => {
    const sma = sma20[i];
    if (sma === undefined) return "sideways" as const;
    const pctAbove = (b.close - sma) / sma;
    if (pctAbove > 0.02) return "bull" as const;
    if (pctAbove < -0.02) return "bear" as const;
    return "sideways" as const;
  });
}

function computeRegimeReports(
  trades: readonly TradeRecord[],
  regimes: readonly ("bull" | "bear" | "sideways")[],
): RegimeReport[] {
  const labels: ("bull" | "bear" | "sideways")[] = ["bull", "bear", "sideways"];
  return labels.map((label) => {
    const filtered = trades.filter((t) => {
      const idx = Math.min(t.index, regimes.length - 1);
      return regimes[idx] === label;
    });
    const wins = filtered.filter((t) => t.netPnl > 0);
    return {
      label,
      trades: filtered.length,
      netPnl: filtered.reduce((s, t) => s + t.netPnl, 0),
      avgPnl: filtered.length > 0 ? filtered.reduce((s, t) => s + t.netPnl, 0) / filtered.length : 0,
      winRate: filtered.length > 0 ? wins.length / filtered.length : 0,
    };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Report Printer
   ═══════════════════════════════════════════════════════════════════════════ */

function printMetrics(label: string, m: Metrics): void {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${label}`);
  console.log(`${"═".repeat(60)}`);
  console.log(`  Total Return:       ${m.totalReturnPct.toFixed(2)}%`);
  console.log(`  Annualized Return:  ${m.annualizedReturnPct.toFixed(2)}%`);
  console.log(`  Sharpe Ratio:       ${m.sharpeRatio.toFixed(3)}`);
  console.log(`  Sortino Ratio:      ${m.sortinoRatio.toFixed(3)}`);
  console.log(`  Calmar Ratio:       ${m.calmarRatio.toFixed(3)}`);
  console.log(`  Profit Factor:      ${m.profitFactor.toFixed(3)}`);
  console.log(`  Avg Win:            ${m.avgWin.toFixed(2)}`);
  console.log(`  Avg Loss:           ${m.avgLoss.toFixed(2)}`);
  console.log(`  Win Rate:           ${(m.winRate * 100).toFixed(1)}%`);
  console.log(`  Max Drawdown:       ${m.maxDrawdownPct.toFixed(2)}% (${m.maxDrawdownBars} bars)`);
  console.log(`  Total Trades:       ${m.totalTrades}`);
  console.log(`  Total Fees:         ${m.totalFees.toFixed(2)}`);
  console.log(`  Net PnL:            ${m.netPnl.toFixed(2)}`);
  console.log(`  Gross PnL:          ${m.grossPnl.toFixed(2)}`);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Main Entry Point
   ═══════════════════════════════════════════════════════════════════════════ */

export async function runBacktest(csvPath: string): Promise<void> {
  const clearCache = process.argv.includes("--clear-cache");
  if (clearCache) {
    initializeDecisionCache();
    clearDecisionCache();
    console.log("[BT] Decision cache cleared.");
    closeDecisionCache();
  }

  initializeDecisionCache();

  if (clearCache) {
    console.log("[BT] Decision cache cleared. Re-run to populate.\n");
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Cerebro Trader — Backtest Engine`);
  console.log(`${"═".repeat(60)}`);
  console.log(`  CSV:               ${csvPath}`);
  console.log(`  Initial Balance:   ${BT.initialBalance}`);
  console.log(`  Fee Rate:          ${BT.feeRateBps} bps`);
  console.log(`  Slippage:          ${BT.slippageBps} bps`);
  console.log(`  Warmup Bars:       ${BT.warmupBars}`);
  console.log(`  Walk-Forward:      ${BT.walkForwardTrainBars} train / ${BT.walkForwardTestBars} test`);
  console.log(`  Monte Carlo Runs:  ${BT.monteCarloRuns}`);
  console.log(`${"═".repeat(60)}\n`);

  const bars = await loadCSV(csvPath);
  if (bars.length < BT.warmupBars + 10) {
    console.error(`[BT] Not enough bars (${bars.length}). Need at least ${BT.warmupBars + 10}.`);
    process.exit(1);
  }

  console.log(`[BT] Total bars: ${bars.length}`);

  const allTrades: TradeRecord[] = [];
  const allEquity: number[] = [];
  let currentBalance = BT.initialBalance;
  let totalCacheHits = 0;
  let totalCacheMisses = 0;

  const windowSize = BT.walkForwardTrainBars + BT.walkForwardTestBars;
  const numWindows = Math.floor((bars.length - BT.warmupBars) / windowSize);

  console.log(`[BT] Walk-forward windows: ${numWindows}\n`);

  for (let w = 0; w < numWindows; w++) {
    const windowStart = BT.warmupBars + w * windowSize;
    const windowEnd = windowStart + windowSize;

    console.log(`[BT] Window ${w + 1}/${numWindows}: bars ${windowStart}..${windowEnd} (balance: ${currentBalance.toFixed(2)})`);

    const result = await runWindow(bars, windowStart, windowEnd, currentBalance);

    allTrades.push(...result.trades);
    totalCacheHits += result.cacheHits;
    totalCacheMisses += result.cacheMisses;

    if (allEquity.length === 0) {
      allEquity.push(...result.equity);
    } else {
      const lastEq = allEquity[allEquity.length - 1]!;
      for (let i = 1; i < result.equity.length; i++) {
        allEquity.push(lastEq + (result.equity[i]! - result.equity[0]!));
      }
    }

    currentBalance = result.portfolio.balance + (result.portfolio.position > 0 ? result.portfolio.position * bars[Math.min(windowEnd, bars.length) - 1]!.close : 0);

    console.log(`[BT]   Trades: ${result.trades.length}, Net PnL: ${result.trades.reduce((s, t) => s + t.netPnl, 0).toFixed(2)}, End Balance: ${currentBalance.toFixed(2)}`);
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  DECISION CACHE STATS`);
  console.log(`${"═".repeat(60)}`);
  console.log(`  Hits:              ${totalCacheHits}`);
  console.log(`  Misses:            ${totalCacheMisses}`);
  console.log(`  Hit Rate:          ${totalCacheHits + totalCacheMisses > 0 ? ((totalCacheHits / (totalCacheHits + totalCacheMisses)) * 100).toFixed(1) : 0}%`);
  console.log(`  Cache Size:        ${getCacheSize()} entries`);

  closeDecisionCache();

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  STRATEGY PERFORMANCE`);
  console.log(`${"═".repeat(60)}`);

  const metrics = computeMetrics(allTrades, allEquity, BT.initialBalance);
  printMetrics("Jev Strategy", metrics);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  BUY-AND-HOLD BENCHMARK`);
  console.log(`${"═".repeat(60)}`);

  const bhMetrics = runBuyAndHold(bars, BT.initialBalance);
  printMetrics("Buy & Hold", bhMetrics);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  MONTE CARLO SIMULATION`);
  console.log(`${"═".repeat(60)}`);

  const mc = runMonteCarlo(allTrades, BT.monteCarloRuns);
  console.log(`  Runs:              ${mc.runs}`);
  console.log(`  Median PnL:        ${mc.median.toFixed(2)}`);
  console.log(`  5th Percentile:    ${mc.p5.toFixed(2)}`);
  console.log(`  95th Percentile:   ${mc.p95.toFixed(2)}`);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  REGIME PERFORMANCE`);
  console.log(`${"═".repeat(60)}`);

  const regimes = classifyRegimes(bars);
  const regimeReports = computeRegimeReports(allTrades, regimes);

  for (const r of regimeReports) {
    console.log(`  ${r.label.toUpperCase().padEnd(10)} | Trades: ${String(r.trades).padStart(4)} | Net PnL: ${r.netPnl.toFixed(2).padStart(12)} | Avg PnL: ${r.avgPnl.toFixed(2).padStart(10)} | Win Rate: ${(r.winRate * 100).toFixed(1)}%`);
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  TRADE LOG (last 20)`);
  console.log(`${"═".repeat(60)}`);

  const logTrades = allTrades.slice(-20);
  console.log(`  ${"Date".padEnd(12)} ${"Action".padEnd(6)} ${"Entry".padStart(10)} ${"Exit".padStart(10)} ${"Size".padStart(8)} ${"Gross".padStart(12)} ${"Fees".padStart(10)} ${"Net".padStart(12)} ${"Bars".padStart(5)} ${"RSI".padStart(7)} ${"MACD_H".padStart(8)}`);

  for (const t of logTrades) {
    console.log(`  ${t.date.padEnd(12)} ${t.action.padEnd(6)} ${t.entryPrice.toFixed(2).padStart(10)} ${t.exitPrice.toFixed(2).padStart(10)} ${String(t.size).padStart(8)} ${t.grossPnl.toFixed(2).padStart(12)} ${t.fees.toFixed(2).padStart(10)} ${t.netPnl.toFixed(2).padStart(12)} ${String(t.holdingBars).padStart(5)} ${t.rsiAtEntry.toFixed(1).padStart(7)} ${t.macdHistAtEntry.toFixed(4).padStart(8)}`);
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  COMPLETE`);
  console.log(`${"═".repeat(60)}\n`);
}
