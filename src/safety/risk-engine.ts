/* ═══════════════════════════════════════════════════════════════════════════
   Cerebro Trader — Production Risk Engine
   ATR-based stops, trailing stop, consecutive-loss cooldown, frequency gate.
   ═══════════════════════════════════════════════════════════════════════════ */

import { RISK } from "../config";
import type { JevDecision, PortfolioState, RiskEngineState, RiskVerdict } from "../types";

// ── Module-level state ─────────────────────────────────────────────────────

let consecutiveLosses = 0;
let lastTradeTimestamp = 0;
let haltUntilTimestamp = 0;
let tradeTimestamps: number[] = [];
let trailingStopPrice: number | null = null;
let trailingStopActive = false;
let highestProfitSinceEntry = 0;

// ── Getter / Setter for persistence ────────────────────────────────────────

export function getRiskState(): RiskEngineState {
  return {
    consecutiveLosses,
    lastTradeTimestamp,
    haltUntilTimestamp,
    trailingStopPrice,
    trailingStopActive,
    highestProfitSinceEntry,
    tradeTimestampsJson: JSON.stringify(tradeTimestamps),
  };
}

export function setRiskState(state: RiskEngineState): void {
  consecutiveLosses = state.consecutiveLosses;
  lastTradeTimestamp = state.lastTradeTimestamp;
  haltUntilTimestamp = state.haltUntilTimestamp;
  trailingStopPrice = state.trailingStopPrice;
  trailingStopActive = state.trailingStopActive;
  highestProfitSinceEntry = state.highestProfitSinceEntry;
  tradeTimestamps = JSON.parse(state.tradeTimestampsJson) as number[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function log(msg: string): void {
  console.log(`[RISK] ${msg}`);
}

function reject(action: RiskVerdict["action"], reason: string): RiskVerdict {
  log(`❌ REJECTED: ${reason}`);
  return { approved: false, action, reason, signalProbability: 0, size: 0 };
}

// ── Core evaluation ────────────────────────────────────────────────────────

export function evaluateRisk(
  decision: JevDecision,
  portfolio: PortfolioState,
  currentPrice: number,
  atr14: number,
): RiskVerdict {
  const { choice, probability } = decision;
  const { position, balance, dailyPnL, avgEntryPrice } = portfolio;

  log(
    `Evaluating: ${choice} prob=${probability} price=${currentPrice} ATR=${atr14}`,
  );

  // Rule 0 — Cooldown (reset state after it expires)
  const now = Date.now();
  if (now < haltUntilTimestamp) {
    const remaining = haltUntilTimestamp - now;
    log(`Cooldown active, ${remaining}ms remaining`);
    return reject(choice, "COOLDOWN_ACTIVE");
  }
  if (haltUntilTimestamp > 0 && consecutiveLosses >= RISK.maxConsecutiveLosses) {
    log(`Cooldown expired — resetting consecutiveLosses from ${consecutiveLosses} to 0`);
    consecutiveLosses = 0;
    haltUntilTimestamp = 0;
  }

  // Rule B1 — Max Daily Drawdown
  if (balance > 0 && dailyPnL / balance < -RISK.maxDailyDrawdownPct) {
    return reject(choice, "MAX_DRAWDOWN");
  }

  // Rule B2 — Stop-Loss (ATR-based)
  if (
    position > 0 &&
    currentPrice < avgEntryPrice - RISK.stopLossAtrMultiple * atr14
  ) {
    return reject(choice, "STOP_LOSS");
  }

  // Rule B3 — Take-Profit (ATR-based)
  if (
    position > 0 &&
    currentPrice > avgEntryPrice + RISK.takeProfitAtrMultiple * atr14
  ) {
    log(`Take-profit hit at ${currentPrice}`);
    return {
      approved: true,
      action: "SELL",
      reason: "TAKE_PROFIT_HIT",
      signalProbability: probability,
      size: position,
    };
  }

  // Rule B4 — Trailing Stop
  if (position > 0 && atr14 > 0) {
    const profit = currentPrice - avgEntryPrice;
    const activationThreshold = RISK.trailingStopActivationAtrMultiple * atr14;

    if (!trailingStopActive && profit > activationThreshold) {
      trailingStopActive = true;
      trailingStopPrice = currentPrice - RISK.trailingStopStepAtrMultiple * atr14;
      log(`Trailing stop activated at ${trailingStopPrice}`);
    }

    if (trailingStopActive && trailingStopPrice !== null) {
      if (currentPrice < trailingStopPrice) {
        return reject(choice, "TRAILING_STOP");
      }
      const newStop = currentPrice - RISK.trailingStopStepAtrMultiple * atr14;
      if (newStop > trailingStopPrice) {
        trailingStopPrice = newStop;
        log(`Trailing stop ratcheted to ${trailingStopPrice}`);
      }
    }
  }

  // Rule B5 — Consecutive Losses
  if (consecutiveLosses >= RISK.maxConsecutiveLosses) {
    haltUntilTimestamp = now + RISK.cooldownTicks * 200;
    log(`Cooldown activated until ${haltUntilTimestamp}`);
    return reject(choice, "MAX_CONSECUTIVE_LOSSES");
  }

  // Rule B6 — Trade Frequency
  const cutoff = now - 60_000;
  tradeTimestamps = tradeTimestamps.filter((ts) => ts > cutoff);
  if (tradeTimestamps.length >= RISK.maxTradeFrequencyPerMinute) {
    return reject(choice, "FREQUENCY_LIMIT");
  }

  // Rule C — Position Size
  if (choice === "BUY" && position >= RISK.maxPositionSize) {
    return reject(choice, "MAX_POSITION_REACHED");
  }

  // Rule A — Probability Threshold
  if (choice !== "HOLD" && probability <= RISK.probabilityThreshold) {
    return reject(choice, "PROBABILITY_BELOW_THRESHOLD");
  }

  // ── Position sizing for approved BUY ───────────────────────────────────

  let size = 0;
  if (choice === "BUY") {
    size = Math.floor((balance * RISK.positionSizeFraction) / currentPrice);
    size = Math.max(size, RISK.minPositionSize);
    size = Math.min(size, RISK.maxPositionSize - position);
    log(
      `Position sizing: size=${size} (balance=${balance} × ${RISK.positionSizeFraction})`,
    );
  } else if (choice === "SELL") {
    size = position;
  }

  // Rule B7 — Max Leverage enforcement
  const totalExposure = (position + size) * currentPrice;
  const leverage = totalExposure / balance;
  if (leverage > RISK.maxLeverage) {
    return reject(choice, `MAX_LEVERAGE_EXCEEDED (${leverage.toFixed(2)}x > ${RISK.maxLeverage}x)`);
  }

  log(`✅ APPROVED: ${choice} size=${size}`);

  return {
    approved: true,
    action: choice,
    reason: "APPROVED",
    signalProbability: probability,
    size,
  };
}

// ── Trade outcome recording ────────────────────────────────────────────────

export function recordTradeOutcome(pnl: number): void {
  tradeTimestamps.push(Date.now());
  lastTradeTimestamp = Date.now();

  if (pnl < 0) {
    consecutiveLosses++;
  } else {
    consecutiveLosses = 0;
    trailingStopActive = false;
    trailingStopPrice = null;
    highestProfitSinceEntry = 0;
  }
}
