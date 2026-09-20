import { describe, it, expect, beforeEach } from "bun:test";
import {
  createComplianceEngine,
  type ComplianceEngine,
  type TransactionRecord,
} from "../src/compliance/compliance-engine";

let engine: ComplianceEngine;

const SANCTIONED = "0x098b716b8aaf21512996dc57eb0615e2383e2f96";
const SANCTIONED_2 = "0xa5c61c6ca7b1e1a55d0850d5cbf18ceb74955768";
const SAFE = "0x1111111111111111111111111111111111111111";

beforeEach(() => {
  engine = createComplianceEngine();
});

describe("ComplianceEngine", () => {
  describe("Known sanctioned addresses are blocked", () => {
    it("Lazarus Group address is blocked", () => {
      expect(engine.isAddressBlocked(SANCTIONED)).toBe(true);
    });

    it("second sanctioned address is blocked", () => {
      expect(engine.isAddressBlocked(SANCTIONED_2)).toBe(true);
    });

    it("address check is case-insensitive", () => {
      expect(engine.isAddressBlocked(SANCTIONED.toUpperCase())).toBe(true);
    });
  });

  describe("Unknown addresses return low risk score", () => {
    it("unknown address has risk score 10", () => {
      expect(engine.getRiskScore(SAFE)).toBe(10);
    });

    it("another unknown address also has risk score 10", () => {
      const addr = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
      expect(engine.getRiskScore(addr)).toBe(10);
    });
  });

  describe("checkAddress", () => {
    it("sanctioned address returns allowed=false", async () => {
      const result = await engine.checkAddress(SANCTIONED);
      expect(result.allowed).toBe(false);
      expect(result.riskScore).toBe(100);
      expect(result.flags).toContain("SANCTIONS_MATCH");
    });

    it("safe address returns allowed=true with low risk", async () => {
      const result = await engine.checkAddress(SAFE);
      expect(result.allowed).toBe(true);
      expect(result.riskScore).toBe(10);
      expect(result.flags).toHaveLength(0);
    });
  });

  describe("checkTransaction", () => {
    it("sanctioned sender returns allowed=false", async () => {
      const tx: TransactionRecord = {
        from: SANCTIONED,
        to: SAFE,
        value: BigInt(1e18),
        timestamp: Date.now(),
      };
      const result = await engine.checkTransaction(tx);
      expect(result.allowed).toBe(false);
      expect(result.riskScore).toBe(100);
      expect(result.flags).toContain("SANCTIONS_MATCH");
      expect(result.reason).toContain("Sender");
    });

    it("sanctioned recipient returns allowed=false", async () => {
      const tx: TransactionRecord = {
        from: SAFE,
        to: SANCTIONED,
        value: BigInt(1e18),
        timestamp: Date.now(),
      };
      const result = await engine.checkTransaction(tx);
      expect(result.allowed).toBe(false);
      expect(result.riskScore).toBe(100);
      expect(result.flags).toContain("SANCTIONS_MATCH");
      expect(result.reason).toContain("Recipient");
    });

    it("both sanctioned returns allowed=false", async () => {
      const tx: TransactionRecord = {
        from: SANCTIONED,
        to: SANCTIONED_2,
        value: BigInt(1e18),
        timestamp: Date.now(),
      };
      const result = await engine.checkTransaction(tx);
      expect(result.allowed).toBe(false);
      expect(result.riskScore).toBe(100);
    });

    it("safe addresses with small value returns allowed=true", async () => {
      const tx: TransactionRecord = {
        from: SAFE,
        to: "0x2222222222222222222222222222222222222222",
        value: BigInt(1e18),
        timestamp: Date.now(),
      };
      const result = await engine.checkTransaction(tx);
      expect(result.allowed).toBe(true);
    });

    it("high value transaction is flagged as UNUSUAL_VOLUME", async () => {
      const highValue = BigInt("1000000000000000000001"); // > 1000 tokens
      const tx: TransactionRecord = {
        from: SAFE,
        to: "0x2222222222222222222222222222222222222222",
        value: highValue,
        timestamp: Date.now(),
      };
      const result = await engine.checkTransaction(tx);
      expect(result.allowed).toBe(false);
      expect(result.flags).toContain("UNUSUAL_VOLUME");
    });
  });

  describe("getBlockedAddresses", () => {
    it("returns a list of blocked addresses", () => {
      const blocked = engine.getBlockedAddresses();
      expect(blocked.length).toBeGreaterThan(0);
      expect(blocked).toContain(SANCTIONED.toLowerCase());
    });

    it("includes all hardcoded sanctioned addresses", () => {
      const blocked = engine.getBlockedAddresses();
      const expected = [
        "0x098b716b8aaf21512996dc57eb0615e2383e2f96",
        "0xa5c61c6ca7b1e1a55d0850d5cbf18ceb74955768",
        "0xd90e2f925da726b50c4ed8d0fb96ad0678ce5afb",
      ];
      for (const addr of expected) {
        expect(blocked).toContain(addr.toLowerCase());
      }
    });
  });

  describe("Risk scoring", () => {
    it("sanctioned address has risk score 100", () => {
      expect(engine.getRiskScore(SANCTIONED)).toBe(100);
    });

    it("unknown address has risk score 10", () => {
      expect(engine.getRiskScore(SAFE)).toBe(10);
    });

    it("risk score is case-insensitive", () => {
      expect(engine.getRiskScore(SANCTIONED.toUpperCase())).toBe(100);
    });
  });

  describe("Custom blocked addresses", () => {
    it("custom blocked address is detected", () => {
      const custom = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
      const customEngine = createComplianceEngine({
        blockedAddresses: [custom],
      });
      expect(customEngine.isAddressBlocked(custom)).toBe(true);
      expect(customEngine.getRiskScore(custom)).toBe(100);
    });

    it("custom sanctioned address is detected", () => {
      const custom = "0xaaaabbbbccccddddeeee00001111222233334444";
      const customEngine = createComplianceEngine({
        sanctionedAddresses: [custom],
      });
      expect(customEngine.isAddressBlocked(custom)).toBe(true);
    });
  });
});
