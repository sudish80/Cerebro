/* ═══════════════════════════════════════════════════════════════════════════
   Cerebro Trader — Compliance Engine (KYC / AML / Sanctions Screening)
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Types ────────────────────────────────────────────────────────────────

export interface ComplianceEngine {
  checkAddress(address: string): Promise<ComplianceResult>;
  checkTransaction(tx: TransactionRecord): Promise<ComplianceResult>;
  getRiskScore(address: string): number;
  isAddressBlocked(address: string): boolean;
  getBlockedAddresses(): readonly string[];
}

export interface ComplianceResult {
  readonly allowed: boolean;
  readonly riskScore: number;
  readonly flags: ComplianceFlag[];
  readonly reason?: string;
}

export type ComplianceFlag =
  | "SANCTIONS_MATCH"
  | "PEP_MATCH"
  | "HIGH_RISK_JURISDICTION"
  | "UNUSUAL_VOLUME"
  | "MIXER_TOLERANCE"
  | "KNOWN_EXPLOIT";

export interface TransactionRecord {
  readonly from: string;
  readonly to: string;
  readonly value: bigint;
  readonly timestamp: number;
}

// ── Known malicious / sanctioned addresses (hex strings) ──────────────────

const DEFAULT_SANCTIONED: readonly string[] = [
  "0x098b716b8aaf21512996dc57eb0615e2383e2f96", // Lazarus Group
  "0xa5c61c6ca7b1e1a55d0850d5cbf18ceb74955768", // Lazarus Group
  "0xd90e2f925da726b50c4ed8d0fb96ad0678ce5afb", // Tornado Cash
  "0x722122df350e47944ca6c40027372c9ab0cdd373", // Tornado Cash
  "0x0d0707963952f2fba59dd06f2b425ace40b492fe", // Harmony Bridge Exploiter
  "0xe8d09d6bb29210316d82e0f4bf55275e49e45893", // Euler Finance Exploiter
  "0x94a3213112c2f9394db9e670015e15456701568c", // Nomad Bridge Exploiter
  "0x74de5d4fcbcace0f0e2230d9115aa838a2e5ec63", // Curve Exploiter
  "0x8589427373d6d84e98730d7795d8f6f8731ada16", // Mixer variant
];

const HIGH_VALUE_THRESHOLD = BigInt("1000000000000000000000"); // 1000 tokens (18 decimals)

// ── Factory ──────────────────────────────────────────────────────────────

export function createComplianceEngine(
  opts?: {
    blockedAddresses?: string[];
    sanctionedAddresses?: string[];
    maxRiskScore?: number;
  },
): ComplianceEngine {
  const threshold = opts?.maxRiskScore ?? 75;

  const blocked = new Set<string>(
    [
      ...DEFAULT_SANCTIONED,
      ...(opts?.blockedAddresses ?? []),
      ...(opts?.sanctionedAddresses ?? []),
    ].map((a) => a.toLowerCase()),
  );

  const riskCache = new Map<string, number>();

  function computeRiskScore(address: string): number {
    const lower = address.toLowerCase();
    if (blocked.has(lower)) return 100;
    if (riskCache.has(lower)) return riskCache.get(lower)!;

    let score = 10; // unknown = baseline 10
    const flags = scoreAddressFlags(lower);
    for (const f of flags) {
      if (f === "SANCTIONS_MATCH" || f === "KNOWN_EXPLOIT") score = 100;
      else if (f === "MIXER_TOLERANCE") score = Math.max(score, 50);
      else if (f === "HIGH_RISK_JURISDICTION") score = Math.max(score, 40);
      else if (f === "UNUSUAL_VOLUME") score = Math.max(score, 30);
    }

    riskCache.set(lower, score);
    return score;
  }

  function scoreAddressFlags(address: string): ComplianceFlag[] {
    const flags: ComplianceFlag[] = [];
    if (blocked.has(address)) {
      flags.push("SANCTIONS_MATCH");
      flags.push("KNOWN_EXPLOIT");
    }
    return flags;
  }

  function getTransactionFlags(tx: TransactionRecord): ComplianceFlag[] {
    const flags: ComplianceFlag[] = [];

    const fromScore = computeRiskScore(tx.from);
    const toScore = computeRiskScore(tx.to);

    if (fromScore >= 100 || toScore >= 100) {
      flags.push("SANCTIONS_MATCH");
      flags.push("KNOWN_EXPLOIT");
    }

    if (tx.value > HIGH_VALUE_THRESHOLD) {
      flags.push("UNUSUAL_VOLUME");
    }

    return flags;
  }

  const engine: ComplianceEngine = {
    async checkAddress(address: string): Promise<ComplianceResult> {
      const lower = address.toLowerCase();
      const isBlocked = blocked.has(lower);
      const riskScore = computeRiskScore(lower);
      const flags = scoreAddressFlags(lower);

      if (isBlocked) {
        return {
          allowed: false,
          riskScore,
          flags,
          reason: "Address is on the sanctions/exploit blocklist",
        };
      }

      if (riskScore >= threshold) {
        return {
          allowed: false,
          riskScore,
          flags,
          reason: `Risk score ${riskScore} exceeds threshold ${threshold}`,
        };
      }

      return { allowed: true, riskScore, flags };
    },

    async checkTransaction(tx: TransactionRecord): Promise<ComplianceResult> {
      const fromLower = tx.from.toLowerCase();
      const toLower = tx.to.toLowerCase();

      if (blocked.has(fromLower)) {
        return {
          allowed: false,
          riskScore: 100,
          flags: ["SANCTIONS_MATCH", "KNOWN_EXPLOIT"],
          reason: "Sender is on the blocklist",
        };
      }

      if (blocked.has(toLower)) {
        return {
          allowed: false,
          riskScore: 100,
          flags: ["SANCTIONS_MATCH", "KNOWN_EXPLOIT"],
          reason: "Recipient is on the blocklist",
        };
      }

      const fromRisk = computeRiskScore(fromLower);
      const toRisk = computeRiskScore(toLower);
      const combinedRisk = Math.max(fromRisk, toRisk);
      const txFlags = getTransactionFlags(tx);

      const uniqueFlags = [...new Set(txFlags)];

      if (combinedRisk >= threshold) {
        return {
          allowed: false,
          riskScore: combinedRisk,
          flags: uniqueFlags,
          reason: `Combined risk score ${combinedRisk} exceeds threshold ${threshold}`,
        };
      }

      if (tx.value > HIGH_VALUE_THRESHOLD) {
        return {
          allowed: false,
          riskScore: combinedRisk,
          flags: [...uniqueFlags, "UNUSUAL_VOLUME"],
          reason: `Transaction value exceeds high-value threshold`,
        };
      }

      return {
        allowed: true,
        riskScore: combinedRisk,
        flags: uniqueFlags,
      };
    },

    getRiskScore(address: string): number {
      return computeRiskScore(address);
    },

    isAddressBlocked(address: string): boolean {
      return blocked.has(address.toLowerCase());
    },

    getBlockedAddresses(): readonly string[] {
      return [...blocked];
    },
  };

  return engine;
}
