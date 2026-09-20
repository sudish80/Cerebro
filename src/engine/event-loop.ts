import { LOOP, RISK, EXEC, BT } from "../config";
import { Logger, generateCorrelationId } from "../observability/logger";
import { computeAllIndicators } from "./indicators";
import { formatStateBlock } from "./state-formatter";
import {
  queryJev,
  getTotalTokens,
  getTotalCostEstimate,
} from "../brain/jev-client";
import {
  evaluateRisk,
  recordTradeOutcome,
  getRiskState,
  setRiskState,
} from "../safety/risk-engine";
import { executeOrder, getLatencyStats } from "../muscle/executor";
import { calcATR } from "./atr";
import {
  initializeStore,
  savePortfolio,
  loadPortfolio,
  saveRiskState,
  loadRiskState,
  saveTrade,
  closeStore,
} from "../persistence/store";
import { createComplianceEngine } from "../compliance/compliance-engine";
import type { ComplianceEngine } from "../compliance/compliance-engine";
import { SimulatedFeed } from "../market-data/sim-feed";
import { WsFeed } from "../market-data/ws-feed";
import type {
  OHLCVBar,
  OrderBookSnapshot,
  PortfolioState,
  StateBlock,
  MarketDataFeed,
  TradeRecord,
} from "../types";

const log = new Logger("LOOP");

const STALE_BAR_THRESHOLD_MS = 10_000;

// ── Portfolio state ────────────────────────────────────────────────────────

let portfolio: PortfolioState = {
  balance: 100_000,
  position: 0,
  avgEntryPrice: 0,
  dailyPnL: 0,
  maxDailyDrawdown: 0,
  totalTrades: 0,
};

function updatePortfolio(
  action: "BUY" | "SELL" | "HOLD",
  price: number,
  size: number,
): number {
  if (action === "HOLD" || size === 0) return 0;

  const feeRateBps = BT.feeRateBps;
  let pnl = 0;

  if (action === "BUY") {
    const cost = price * size;
    if (cost > portfolio.balance) return 0;
    const fee = (cost * feeRateBps) / 10_000;
    const totalCost = portfolio.avgEntryPrice * portfolio.position + cost;
    portfolio = {
      ...portfolio,
      position: portfolio.position + size,
      avgEntryPrice:
        portfolio.position + size > 0
          ? totalCost / (portfolio.position + size)
          : 0,
      balance: portfolio.balance - cost - fee,
      totalTrades: portfolio.totalTrades + 1,
    };
  } else if (action === "SELL") {
    const sellSize = Math.min(size, portfolio.position);
    const proceeds = price * sellSize;
    const fee = (proceeds * feeRateBps) / 10_000;
    pnl = (price - portfolio.avgEntryPrice) * sellSize;
    portfolio = {
      ...portfolio,
      position: portfolio.position - sellSize,
      avgEntryPrice:
        portfolio.position - sellSize > 0 ? portfolio.avgEntryPrice : 0,
      balance: portfolio.balance + proceeds - fee,
      dailyPnL: portfolio.dailyPnL + pnl,
      totalTrades: portfolio.totalTrades + 1,
    };
  }

  return pnl;
}

// ── Rolling state ──────────────────────────────────────────────────────────

let bars: OHLCVBar[] = [];
let blockHeight = 0;
let tickCount = 0;
let running = true;
let compliance: ComplianceEngine;
let feed: MarketDataFeed;
let openTradeEntryBar = 0;

// ── Main Loop ──────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  tickCount++;
  blockHeight++;
  const corrId = generateCorrelationId();
  const tickLog = log.child(corrId);

  tickLog.info(`Tick #${tickCount}`, { blockHeight });

  // 1. Get latest bar and order book from feed
  const bar = feed.getLatestBar();
  const orderbook = feed.getOrderBook();

  if (!bar) {
    tickLog.warn("No bar available from feed, skipping tick");
    return;
  }

  if (!orderbook) {
    tickLog.warn("No order book available from feed, skipping tick");
    return;
  }

  // 2. Check data freshness — stale data forces HOLD
  if (Date.now() - bar.timestamp > STALE_BAR_THRESHOLD_MS) {
    tickLog.warn(
      `Stale data detected: last bar is ${Date.now() - bar.timestamp}ms old (threshold ${STALE_BAR_THRESHOLD_MS}ms). Skipping tick, forcing HOLD.`,
    );
    return;
  }

  // 3. Update rolling window
  bars.push(bar);
  if (bars.length > LOOP.rollingWindowBars) {
    bars = bars.slice(-LOOP.rollingWindowBars);
  }

  tickLog.info(
    `Order book: bid=${orderbook.bestBid.toFixed(4)} ask=${orderbook.bestAsk.toFixed(4)} spread=${orderbook.spread.toFixed(6)}`,
  );

  // 4. Compute indicators
  const indicators = computeAllIndicators(bars, bars.length - 1);
  const indicatorCount = Object.keys(indicators).length;
  tickLog.info(`Indicators computed: ${indicatorCount} values`);

  // 5. Compute ATR(14) for risk engine
  const atr14 = calcATR(bars, 14);
  tickLog.info(`ATR(14)=${isNaN(atr14) ? "NaN" : atr14.toFixed(6)}`);

  // 6. Build state block and format string
  const stateBlock: StateBlock = {
    bar,
    orderbook,
    indicators,
    portfolio,
    blockHeight,
  };
  const stateString = formatStateBlock(stateBlock);
  tickLog.info(`State string: ${stateString.length} chars`);

  // 7. Query Jev
  const jevDecision = await queryJev(stateString);
  tickLog.info(
    `Jev decision: ${jevDecision.choice} prob=${jevDecision.probability.toFixed(4)} conf=${jevDecision.confidence.toFixed(4)} latency=${jevDecision.latencyMs}ms`,
    {
      inputTokens: jevDecision.inputTokens,
      outputTokens: jevDecision.outputTokens,
      shadow: jevDecision.shadow,
    },
  );

  // 8. Evaluate risk with ATR(14)
  const riskVerdict = evaluateRisk(
    jevDecision,
    portfolio,
    orderbook.mid,
    atr14,
  );
  tickLog.info(
    `Risk verdict: approved=${riskVerdict.approved} action=${riskVerdict.action} reason=${riskVerdict.reason} size=${riskVerdict.size}`,
  );

  // 9. Compliance check
  if (riskVerdict.approved && riskVerdict.action !== "HOLD") {
    const walletAddress = "0x0000000000000000000000000000000000000000";
    const clobContract = "0x0000000000000000000000000000000000000001";
    const complianceResult = await compliance.checkTransaction({
      from: walletAddress,
      to: clobContract,
      value: BigInt(Math.round(riskVerdict.size * orderbook.mid * 1e18)),
      timestamp: Date.now(),
    });
    tickLog.info(
      `Compliance check: allowed=${complianceResult.allowed} riskScore=${complianceResult.riskScore} flags=[${complianceResult.flags.join(",")}]`,
    );
    if (!complianceResult.allowed) {
      tickLog.warn(`Compliance REJECTED: ${complianceResult.reason}`, { flags: complianceResult.flags });
      return;
    }
  }

  // 10. Execute if approved
  let execResult = null;
  if (riskVerdict.approved && riskVerdict.action !== "HOLD") {
    const bookDepth = orderbook.bids.reduce((s, b) => s + b[1], 0);
    execResult = await executeOrder(
      riskVerdict,
      orderbook.mid,
      riskVerdict.size,
      bookDepth,
    );
    tickLog.info(
      `Execution: ${execResult.action} size=${execResult.size} price=${execResult.price} type=${execResult.orderType} latency=${execResult.latencyMs}ms hash=${execResult.txHash}`,
      { gasCost: execResult.simulatedGasCost },
    );

    if (EXEC.dryRun) {
      tickLog.info(`Dry-run mode: order simulated, not broadcast`);
    }

    // 11. Update portfolio (with fees)
    const pnl = updatePortfolio(
      execResult.action,
      execResult.price,
      execResult.size,
    );
    if (execResult.action !== "HOLD") {
      recordTradeOutcome(pnl);
      tickLog.info(`Trade PnL: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`);
    }
  }

  // 12. Record trade outcome and save to persistence
  if (execResult && execResult.action !== "HOLD") {
    const now = Date.now();
    const entryBar = openTradeEntryBar;
    const holdDurationBars = execResult.action === "SELL" ? tickCount - entryBar : 0;
    const grossPnl = execResult.action === "SELL"
      ? (execResult.price - portfolio.avgEntryPrice) * execResult.size
      : 0;
    const feeRateBps = BT.feeRateBps;
    const fees = execResult.action === "BUY"
      ? (execResult.price * execResult.size * feeRateBps) / 10_000
      : (execResult.price * execResult.size * feeRateBps) / 10_000;
    const netPnl = grossPnl - fees;

    if (execResult.action === "BUY") {
      openTradeEntryBar = tickCount;
    }

    const tradeRecord: TradeRecord = {
      timestamp: now,
      action: execResult.action as "BUY" | "SELL",
      entryPrice: execResult.price,
      exitPrice: execResult.action === "SELL" ? execResult.price : null,
      size: execResult.size,
      grossPnl,
      fees,
      netPnl,
      holdDurationBars,
      jevConfidence: jevDecision.confidence,
      jevProbabilities: JSON.stringify(jevDecision.probabilities),
      riskReason: riskVerdict.reason,
      executionLatencyMs: execResult.latencyMs,
      txHash: execResult.txHash,
      gasCost: execResult.simulatedGasCost,
      indicatorsSnapshot: stateString.slice(0, 500),
    };

    saveTrade(tradeRecord);
    tickLog.info(`Trade saved to persistence: ${execResult.action} size=${execResult.size}`);
  }

  // 13. Log portfolio status
  tickLog.info(
    `Portfolio: pos=${portfolio.position} bal=${portfolio.balance.toFixed(2)} pnl=${portfolio.dailyPnL.toFixed(2)} trades=${portfolio.totalTrades}`,
  );

  // 14. Every 50 ticks: log token/cost stats and latency stats
  if (tickCount % 50 === 0) {
    const tokens = getTotalTokens();
    const cost = getTotalCostEstimate();
    tickLog.info(
      `Token stats: input=${tokens.input} output=${tokens.output} costEst=$${cost.toFixed(6)}`,
    );

    const latency = getLatencyStats();
    tickLog.info(
      `Latency stats: count=${latency.count} avg=${latency.avg.toFixed(1)}ms p50=${latency.p50}ms p95=${latency.p95}ms p99=${latency.p99}ms`,
    );
  }
}

// ── Entry Point ────────────────────────────────────────────────────────────

export async function startEventLoop(): Promise<void> {
  log.info("═══ Cerebro Trader — Event Loop ═══");
  log.info(`Rolling window: ${LOOP.rollingWindowBars} bars`);
  log.info(`Base price: ${LOOP.basePrice}`);
  log.info(`Order book levels: ${LOOP.orderBookLevels}`);
  log.info(`Dry run: ${EXEC.dryRun}`);
  log.info(`Fee rate: ${BT.feeRateBps} bps`);

  // ── Persistence: initialize and restore state ────────────────────────────
  initializeStore();
  const savedPortfolio = loadPortfolio();
  if (savedPortfolio) {
    portfolio = savedPortfolio;
    log.info("Restored portfolio from disk", { balance: portfolio.balance, position: portfolio.position });
  }
  const savedRisk = loadRiskState();
  if (savedRisk) {
    setRiskState(savedRisk);
    log.info("Restored risk state from disk", { consecutiveLosses: savedRisk.consecutiveLosses });
  }

  compliance = createComplianceEngine();
  log.info("Compliance engine initialized", { blockedCount: compliance.getBlockedAddresses().length });

  // ── Create market data feed based on mode ──────────────────────────────
  if (EXEC.dryRun) {
    feed = new SimulatedFeed();
    log.info("Using SimulatedFeed (dry-run mode)");
  } else {
    feed = new WsFeed();
    log.info("Using WsFeed (live mode)");
  }

  // ── Connect feed and wire callbacks ────────────────────────────────────
  await feed.connect();
  log.info("Feed connected", { connected: feed.isConnected() });

  feed.onBar((bar: OHLCVBar) => {
    if (!running) return;
    tick().catch((err) => {
      log.error("Tick error", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });

  feed.onOrderBook((book: OrderBookSnapshot) => {
    // Order book updates don't trigger a new tick — bar callbacks drive the loop.
    // This callback exists for future extensions (e.g. order book driven strategies).
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────
  const shutdown = (): void => {
    running = false;
    log.info("Shutting down...");

    feed.disconnect();

    savePortfolio(portfolio);
    saveRiskState(getRiskState());
    closeStore();
    log.info("State persisted to disk");

    log.info("Final stats:", {
      totalTicks: tickCount,
      blocksMined: blockHeight,
      position: portfolio.position,
      balance: portfolio.balance,
      dailyPnL: portfolio.dailyPnL,
      totalTrades: portfolio.totalTrades,
    });

    const tokens = getTotalTokens();
    const cost = getTotalCostEstimate();
    log.info(
      `Total tokens: input=${tokens.input} output=${tokens.output} cost=$${cost.toFixed(6)}`,
    );

    const latency = getLatencyStats();
    log.info(
      `Latency stats: count=${latency.count} avg=${latency.avg.toFixed(1)}ms p50=${latency.p50}ms p95=${latency.p95}ms p99=${latency.p99}ms`,
    );

    log.info("═══ Cerebro Trader — Stopped ═══");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // ── Periodic persistence save ──────────────────────────────────────────
  setInterval(() => {
    if (!running) return;
    savePortfolio(portfolio);
    saveRiskState(getRiskState());
    log.info("State persisted at tick #" + tickCount);
  }, 60_000);
}
