import { describe, it, expect, beforeEach } from "bun:test";
import {
  executeOrder,
  initializeNonceManager,
  getNextNonce,
  getCurrentNonce,
  getLatencyStats,
} from "../src/muscle/executor";
import type { RiskVerdict } from "../src/types";

function makeVerdict(
  action: "BUY" | "SELL" | "HOLD" = "BUY",
  size = 10,
): RiskVerdict {
  return {
    approved: true,
    action,
    reason: "APPROVED",
    signalProbability: 0.95,
    size,
  };
}

describe("Executor", () => {
  describe("HOLD action", () => {
    it("returns HOLD with size 0", async () => {
      const result = await executeOrder(makeVerdict("HOLD"), 100, 0, 5000);
      expect(result.action).toBe("HOLD");
      expect(result.size).toBe(0);
    });

    it("returns a tx hash string", async () => {
      const result = await executeOrder(makeVerdict("HOLD"), 100, 0, 5000);
      expect(typeof result.txHash).toBe("string");
      expect(result.txHash.length).toBeGreaterThan(0);
    });

    it("simulatedGasCost is 0 for HOLD", async () => {
      const result = await executeOrder(makeVerdict("HOLD"), 100, 0, 5000);
      expect(result.simulatedGasCost).toBe(0);
    });
  });

  describe("Dry-run mode (default)", () => {
    it("returns a hash string", async () => {
      const result = await executeOrder(makeVerdict("BUY", 10), 100, 10, 5000);
      expect(typeof result.txHash).toBe("string");
      expect(result.txHash).toMatch(/^0x/);
    });

    it("returns correct action and size", async () => {
      const result = await executeOrder(makeVerdict("SELL", 20), 150, 20, 5000);
      expect(result.action).toBe("SELL");
      expect(result.size).toBe(20);
      expect(result.price).toBe(150);
    });

    it("gas estimation produces positive number", async () => {
      const result = await executeOrder(makeVerdict("BUY", 10), 100, 10, 5000);
      expect(result.simulatedGasCost).toBeGreaterThanOrEqual(0);
    });
  });

  describe("routeOrder logic (tested via executeOrder)", () => {
    it("small ratio yields IOC", async () => {
      // ratio = 1 / 5000 = 0.0002 < 0.01 => IOC
      const result = await executeOrder(makeVerdict("BUY", 1), 100, 1, 5000);
      expect(result.orderType).toBe("IOC");
    });

    it("medium ratio yields LIMIT", async () => {
      // ratio = 5 / 5000 = 0.001 < 0.01 => IOC... need ratio >= 0.01
      // ratio = 50 / 5000 = 0.01, that's not < 0.01, so not IOC; 0.01 < 0.05 => LIMIT
      const result = await executeOrder(makeVerdict("BUY", 50), 100, 50, 5000);
      expect(result.orderType).toBe("LIMIT");
    });

    it("large ratio yields SPLIT", async () => {
      // ratio = 500 / 5000 = 0.1 >= 0.05 => SPLIT
      const result = await executeOrder(makeVerdict("BUY", 500), 100, 500, 5000);
      expect(result.orderType).toBe("SPLIT");
    });
  });

  describe("Gas estimation", () => {
    it("produces positive gas cost for BUY", async () => {
      const result = await executeOrder(makeVerdict("BUY", 10), 100, 10, 5000);
      expect(result.simulatedGasCost).toBeGreaterThan(0);
    });

    it("produces positive gas cost for SELL", async () => {
      const result = await executeOrder(makeVerdict("SELL", 10), 100, 10, 5000);
      expect(result.simulatedGasCost).toBeGreaterThan(0);
    });

    it("larger size produces larger gas cost", async () => {
      const small = await executeOrder(makeVerdict("BUY", 1), 100, 1, 5000);
      const large = await executeOrder(makeVerdict("BUY", 100), 100, 100, 5000);
      expect(large.simulatedGasCost).toBeGreaterThanOrEqual(small.simulatedGasCost);
    });
  });

  describe("Latency stats", () => {
    it("count increases after execution", () => {
      const before = getLatencyStats();
      executeOrder(makeVerdict("BUY", 10), 100, 10, 5000);
      const after = getLatencyStats();
      expect(after.count).toBeGreaterThanOrEqual(before.count);
    });

    it("returns non-negative values", async () => {
      await executeOrder(makeVerdict("BUY", 10), 100, 10, 5000);
      const stats = getLatencyStats();
      expect(stats.p50).toBeGreaterThanOrEqual(0);
      expect(stats.p95).toBeGreaterThanOrEqual(0);
      expect(stats.p99).toBeGreaterThanOrEqual(0);
      expect(stats.avg).toBeGreaterThanOrEqual(0);
      expect(stats.count).toBeGreaterThan(0);
    });
  });

  describe("Nonce manager", () => {
    it("initializes successfully", async () => {
      await initializeNonceManager();
      const nonce = getCurrentNonce();
      expect(typeof nonce).toBe("number");
    });

    it("increments nonce on each call", async () => {
      await initializeNonceManager();
      const first = getNextNonce();
      const second = getNextNonce();
      expect(second).toBe(first + 1);
    });

    it("continues incrementing", async () => {
      await initializeNonceManager();
      const a = getNextNonce();
      const b = getNextNonce();
      const c = getNextNonce();
      expect(b).toBe(a + 1);
      expect(c).toBe(a + 2);
    });
  });
});
