import {
  describe,
  expect,
  test,
  beforeEach,
} from "bun:test";
import { evaluateRisk, recordTradeOutcome } from "../src/safety/risk-engine";
import { RISK } from "../src/config";
import type { JevDecision, PortfolioState } from "../src/types";

function makeDecision(
  choice: "BUY" | "SELL" | "HOLD" = "BUY",
  probability = 0.95,
): JevDecision {
  return {
    choice,
    probability,
    confidence: probability,
    probabilities: { BUY: probability, SELL: 0.03, HOLD: 0.02 },
    rawResponse: choice,
    latencyMs: 10,
    inputTokens: 100,
    outputTokens: 10,
    shadow: false,
  };
}

function makePortfolio(overrides: Partial<PortfolioState> = {}): PortfolioState {
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

let mockTime = 1_000_000;
const originalDateNow = Date.now;

beforeEach(() => {
  Date.now = () => mockTime;

  // Phase 1: Jump far into the future to bypass any leftover haltUntilTimestamp
  mockTime = 10_000_000;

  // Phase 2: Accumulate consecutiveLosses past max so B5 can fire
  for (let i = 0; i <= RISK.maxConsecutiveLosses; i++) {
    recordTradeOutcome(-100);
  }

  // Phase 3: evaluateRisk triggers B5 → sets haltUntilTimestamp = 10_006_000
  evaluateRisk(makeDecision("BUY"), makePortfolio(), 100, 2);

  // Phase 4: Advance past cooldown AND past the 60s frequency window
  // so the B6 filter flushes all stale tradeTimestamps
  mockTime = 10_070_000;
  evaluateRisk(makeDecision("BUY"), makePortfolio(), 100, 2);
  // Now: consecutiveLosses=0, haltUntilTimestamp=0, tradeTimestamps=[]

  // Phase 5: Set starting time for tests
  mockTime = 1_000_000;
});

describe("Rule 0 - Cooldown", () => {
  test("trade rejected when haltUntilTimestamp is in the future", () => {
    for (let i = 0; i < 5; i++) recordTradeOutcome(-100);

    const verdict1 = evaluateRisk(
      makeDecision("BUY"),
      makePortfolio(),
      100,
      2,
    );
    expect(verdict1.approved).toBe(false);
    expect(verdict1.reason).toBe("MAX_CONSECUTIVE_LOSSES");

    const verdict2 = evaluateRisk(
      makeDecision("BUY"),
      makePortfolio(),
      100,
      2,
    );
    expect(verdict2.approved).toBe(false);
    expect(verdict2.reason).toBe("COOLDOWN_ACTIVE");
  });
});

describe("Rule B1 - Max Daily Drawdown", () => {
  test("trade rejected when drawdown exceeds threshold", () => {
    const dailyPnL = -4000;
    const balance = 100_000;
    const verdict = evaluateRisk(
      makeDecision("BUY"),
      makePortfolio({ dailyPnL, balance }),
      100,
      2,
    );
    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toBe("MAX_DRAWDOWN");
  });

  test("trade approved when drawdown within threshold", () => {
    const verdict = evaluateRisk(
      makeDecision("BUY"),
      makePortfolio({ dailyPnL: -1000, balance: 100_000 }),
      100,
      2,
    );
    expect(verdict.approved).toBe(true);
  });
});

describe("Rule B2 - Stop-Loss", () => {
  test("trade rejected when price below entry - ATR * multiple", () => {
    const avgEntry = 100;
    const atr = 5;
    const price = avgEntry - RISK.stopLossAtrMultiple * atr - 1;
    const verdict = evaluateRisk(
      makeDecision("BUY"),
      makePortfolio({ position: 10, avgEntryPrice: avgEntry }),
      price,
      atr,
    );
    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toBe("STOP_LOSS");
  });

  test("trade not rejected when price above stop", () => {
    const verdict = evaluateRisk(
      makeDecision("BUY"),
      makePortfolio({ position: 10, avgEntryPrice: 100 }),
      95,
      5,
    );
    expect(verdict.reason).not.toBe("STOP_LOSS");
  });
});

describe("Rule B3 - Take-Profit", () => {
  test("returns SELL when price above entry + ATR * multiple", () => {
    const avgEntry = 100;
    const atr = 5;
    const price = avgEntry + RISK.takeProfitAtrMultiple * atr + 1;
    const verdict = evaluateRisk(
      makeDecision("BUY"),
      makePortfolio({ position: 10, avgEntryPrice: avgEntry }),
      price,
      atr,
    );
    expect(verdict.approved).toBe(true);
    expect(verdict.action).toBe("SELL");
    expect(verdict.reason).toBe("TAKE_PROFIT_HIT");
    expect(verdict.size).toBe(10);
  });

  test("no take-profit when price below threshold", () => {
    const verdict = evaluateRisk(
      makeDecision("BUY"),
      makePortfolio({ position: 10, avgEntryPrice: 100 }),
      110,
      5,
    );
    expect(verdict.reason).not.toBe("TAKE_PROFIT_HIT");
  });
});

describe("Rule B5 - Consecutive Losses", () => {
  test("after maxConsecutiveLosses losses, trade rejected with COOLDOWN", () => {
    for (let i = 0; i < RISK.maxConsecutiveLosses; i++) {
      recordTradeOutcome(-100);
    }
    const verdict = evaluateRisk(
      makeDecision("BUY"),
      makePortfolio(),
      100,
      2,
    );
    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toBe("MAX_CONSECUTIVE_LOSSES");
  });
});

describe("Rule B5 FIX (C5) - Permanent Halt Reset", () => {
  test("after cooldown expires, consecutiveLosses resets and bot can trade again", () => {
    for (let i = 0; i < RISK.maxConsecutiveLosses; i++) {
      recordTradeOutcome(-100);
    }

    const verdict1 = evaluateRisk(
      makeDecision("BUY"),
      makePortfolio(),
      100,
      2,
    );
    expect(verdict1.approved).toBe(false);
    expect(verdict1.reason).toBe("MAX_CONSECUTIVE_LOSSES");

    const verdict2 = evaluateRisk(
      makeDecision("BUY"),
      makePortfolio(),
      100,
      2,
    );
    expect(verdict2.approved).toBe(false);
    expect(verdict2.reason).toBe("COOLDOWN_ACTIVE");

    const cooldownMs = RISK.cooldownTicks * 200;
    mockTime += cooldownMs + 1000;

    const verdict3 = evaluateRisk(
      makeDecision("BUY"),
      makePortfolio(),
      100,
      2,
    );
    expect(verdict3.approved).toBe(true);
    expect(verdict3.reason).toBe("APPROVED");
  });
});

describe("Rule B6 - Trade Frequency", () => {
  test("trade rejected when too many trades in 1 minute", () => {
    for (let i = 0; i < RISK.maxTradeFrequencyPerMinute; i++) {
      recordTradeOutcome(1);
    }
    const verdict = evaluateRisk(
      makeDecision("BUY"),
      makePortfolio(),
      100,
      2,
    );
    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toBe("FREQUENCY_LIMIT");
  });

  test("trade approved after old timestamps expire", () => {
    for (let i = 0; i < RISK.maxTradeFrequencyPerMinute; i++) {
      recordTradeOutcome(1);
    }
    mockTime += 61_000;
    const verdict = evaluateRisk(
      makeDecision("BUY"),
      makePortfolio(),
      100,
      2,
    );
    expect(verdict.reason).not.toBe("FREQUENCY_LIMIT");
  });
});

describe("Rule B7 - Max Leverage", () => {
  test("trade rejected when leverage exceeds max", () => {
    const verdict = evaluateRisk(
      makeDecision("BUY"),
      makePortfolio({ balance: 90 }),
      100,
      2,
    );
    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toContain("MAX_LEVERAGE");
  });
});

describe("Rule C - Position Size", () => {
  test("BUY rejected when position already at max", () => {
    const verdict = evaluateRisk(
      makeDecision("BUY"),
      makePortfolio({ position: RISK.maxPositionSize, avgEntryPrice: 100 }),
      100,
      2,
    );
    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toBe("MAX_POSITION_REACHED");
  });
});

describe("Rule A - Probability Threshold", () => {
  test("trade rejected when probability below threshold", () => {
    const verdict = evaluateRisk(
      makeDecision("BUY", RISK.probabilityThreshold - 0.01),
      makePortfolio(),
      100,
      2,
    );
    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toBe("PROBABILITY_BELOW_THRESHOLD");
  });

  test("trade approved when probability above threshold", () => {
    const verdict = evaluateRisk(
      makeDecision("BUY", RISK.probabilityThreshold + 0.01),
      makePortfolio(),
      100,
      2,
    );
    expect(verdict.approved).toBe(true);
  });

  test("HOLD is not rejected by probability rule", () => {
    const verdict = evaluateRisk(
      makeDecision("HOLD", 0.1),
      makePortfolio(),
      100,
      2,
    );
    expect(verdict.reason).not.toBe("PROBABILITY_BELOW_THRESHOLD");
  });
});

describe("Position Sizing", () => {
  test("BUY returns correct size based on balance and fraction", () => {
    const verdict = evaluateRisk(
      makeDecision("BUY", 0.95),
      makePortfolio({ balance: 100_000 }),
      100,
      2,
    );
    expect(verdict.approved).toBe(true);
    expect(verdict.action).toBe("BUY");
    expect(verdict.size).toBe(20);
  });

  test("SELL with position returns position as size", () => {
    const verdict = evaluateRisk(
      makeDecision("SELL", 0.95),
      makePortfolio({ position: 50, avgEntryPrice: 100 }),
      100,
      2,
    );
    expect(verdict.approved).toBe(true);
    expect(verdict.action).toBe("SELL");
    expect(verdict.size).toBe(50);
  });
});
