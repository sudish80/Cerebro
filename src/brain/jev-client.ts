/* ═══════════════════════════════════════════════════════════════════════════
   Cerebro Trader — TypeSafe Jev Client (Production)
   POST https://api.typesafe.ai/v1/systemone
   Auth: Authorization: Bearer <TYPESAFE_API_KEY>
   ═══════════════════════════════════════════════════════════════════════════ */

import { JEV_CONFIG } from "../config";
import { createRateLimiter } from "../observability/rate-limiter";
import type {
  JevDecision,
  JevSystemOneRequest,
  JevSystemOneResponse,
  JevChoiceQuestion,
} from "../types";

// ── Configuration ───────────────────────────────────────────────────────────

const API_URL: string = JEV_CONFIG.apiUrl;
const API_KEY: string = process.env.TYPESAFE_API_KEY || "";
const MODEL: string = JEV_CONFIG.model;
const TIMEOUT_MS: number = JEV_CONFIG.circuitBreakerTimeoutMs;
const MAX_RETRIES: number = JEV_CONFIG.maxRetries;
const RETRY_BACKOFF_MS: number = JEV_CONFIG.retryBackoffMs;
const CACHE_TTL_MS: number = JEV_CONFIG.decisionCacheTtlMs;
const SHADOW_MODE: boolean = JEV_CONFIG.shadowMode;

// ── Cost constants ──────────────────────────────────────────────────────────

const COST_PER_INPUT_TOKEN = 0.042 / 1_000_000;

// ── Module-level state ──────────────────────────────────────────────────────

let totalInputTokens = 0;
let totalOutputTokens = 0;
let decisionCache: Map<string, { decision: JevDecision; timestamp: number }> =
  new Map();

const MAX_CACHE_ENTRIES = 500;

// ── Rate limiter ─────────────────────────────────────────────────────────────

export const apiRateLimiter = createRateLimiter({
  maxTokens: 10,
  refillRatePerMs: 0.05,
});

function evictStaleCache(): void {
  const now = performance.now();
  for (const [key, entry] of decisionCache) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      decisionCache.delete(key);
    }
  }
  if (decisionCache.size > MAX_CACHE_ENTRIES) {
    const keys = [...decisionCache.keys()];
    for (let i = 0; i < keys.length - MAX_CACHE_ENTRIES; i++) {
      decisionCache.delete(keys[i]!);
    }
  }
}

// ── The single question we ask Jev every tick ───────────────────────────────

const TRADING_SIGNAL_QUESTION: JevChoiceQuestion = {
  type: "choice",
  instructions:
    "Given the current market state, order book, and technical indicators, " +
    "what is the optimal trading action? Consider momentum, trend, volatility, " +
    "volume, support/resistance levels, and risk/reward ratio.",
  criteria: {
    BUY: "Strong bullish signal — price likely to rise. High-confidence entry opportunity.",
    SELL: "Strong bearish signal — price likely to fall. High-confidence exit or short opportunity.",
    HOLD: "Ambiguous, choppy, or low-conviction market. No clear edge — stay flat.",
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function createFallback(
  rawResponse: string,
  latencyMs = TIMEOUT_MS,
): JevDecision {
  return {
    choice: "HOLD",
    probability: 0,
    confidence: 0,
    probabilities: { BUY: 0, SELL: 0, HOLD: 1 },
    rawResponse,
    latencyMs,
    inputTokens: 0,
    outputTokens: 0,
    shadow: SHADOW_MODE,
  };
}

function validateChoice(value: string): value is "BUY" | "SELL" | "HOLD" {
  return value === "BUY" || value === "SELL" || value === "HOLD";
}

function isValidResponse(data: unknown): data is JevSystemOneResponse {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (typeof obj.model !== "string") return false;
  if (typeof obj.answers !== "object" || obj.answers === null) return false;
  const answers = obj.answers as Record<string, unknown>;
  const answer = answers["trading_signal"];
  if (typeof answer !== "object" || answer === null) return false;
  const ans = answer as Record<string, unknown>;
  if (ans.type !== "choice") return false;
  if (typeof ans.choice !== "string") return false;
  if (typeof ans.probabilities !== "object" || ans.probabilities === null)
    return false;
  if (typeof ans.confidence !== "number") return false;
  if (typeof obj.usage !== "object" || obj.usage === null) return false;
  const usage = obj.usage as Record<string, unknown>;
  if (typeof usage.input_tokens !== "number") return false;
  if (typeof usage.output_tokens !== "number") return false;
  return true;
}

// ── Fetch with retry for 5xx ────────────────────────────────────────────────

async function fetchWithRetry(
  payload: JevSystemOneRequest,
  signal: AbortSignal,
): Promise<JevSystemOneResponse> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoff = RETRY_BACKOFF_MS * 2 ** (attempt - 1);
      console.log(
        `[JEV] Retry ${attempt}/${MAX_RETRIES} after ${backoff}ms backoff`,
      );
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }

    await apiRateLimiter.acquire();

    let response: Response;
    try {
      response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify(payload),
        signal,
      });
    } catch (err) {
      apiRateLimiter.release();
      throw err;
    }

    if (response.ok) {
      apiRateLimiter.release();
      const data: unknown = await response.json();
      if (!isValidResponse(data)) {
        throw new Error("Invalid response schema");
      }
      return data;
    }

    // Handle 429 Too Many Requests — apply Retry-After, then fail
    if (response.status === 429) {
      apiRateLimiter.handle429(response.headers.get("Retry-After"));
      const retryAfter = apiRateLimiter.getRetryAfterMs();
      throw new Error(
        `[JEV] 429 Too Many Requests — rate limited. Retry-After: ${Math.round(retryAfter)}ms`,
      );
    }

    apiRateLimiter.release();

    // Only retry on 5xx, not 4xx
    if (response.status >= 500 && response.status < 600) {
      lastError = new Error(`HTTP ${response.status}`);
      continue;
    }

    throw new Error(`HTTP ${response.status}`);
  }

  throw lastError ?? new Error("Max retries exceeded");
}

// ── Main entry point ────────────────────────────────────────────────────────

export async function queryJev(stateString: string): Promise<JevDecision> {
  evictStaleCache();
  console.log(`[JEV] Querying TypeSafe Jev API... model=${MODEL}`);

  if (!API_KEY) {
    console.log("[JEV] No TYPESAFE_API_KEY set — circuit breaker fallback to HOLD");
    return createFallback("NO_API_KEY");
  }

  // ── Decision cache check ────────────────────────────────────────────────
  const cached = decisionCache.get(stateString);
  if (cached && performance.now() - cached.timestamp < CACHE_TTL_MS) {
    const age = Math.round(performance.now() - cached.timestamp);
    console.log(`[JEV] Cache hit: returning cached decision (${age}ms old)`);
    return cached.decision;
  }

  // ── Build payload ───────────────────────────────────────────────────────
  const payload: JevSystemOneRequest = {
    state: stateString,
    model: MODEL,
    questions: {
      trading_signal: TRADING_SIGNAL_QUESTION,
    },
  };

  // ── Circuit breaker: 150ms timeout ──────────────────────────────────────
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start = performance.now();

  try {
    const data = await fetchWithRetry(payload, controller.signal);

    clearTimeout(timeoutId);
    const latencyMs = Math.round(performance.now() - start);

    // ── Extract trading_signal answer ─────────────────────────────────────
    const answer = data.answers["trading_signal"];
    if (!answer || answer.type !== "choice") {
      console.log("[JEV] Invalid response shape — circuit breaker fallback to HOLD");
      return createFallback(JSON.stringify(data), latencyMs);
    }

    const choice = answer.choice;
    if (!validateChoice(choice)) {
      console.log(`[JEV] Unknown choice "${choice}" — circuit breaker fallback to HOLD`);
      return createFallback(JSON.stringify(data), latencyMs);
    }

    const probability = answer.probabilities[choice] ?? 0;
    const confidence = answer.confidence;
    const inputTokens = data.usage.input_tokens;
    const outputTokens = data.usage.output_tokens;

    // ── Token/cost accounting ─────────────────────────────────────────────
    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;

    const decision: JevDecision = {
      choice,
      probability,
      confidence,
      probabilities: answer.probabilities,
      rawResponse: JSON.stringify(data),
      latencyMs,
      inputTokens,
      outputTokens,
      shadow: SHADOW_MODE,
    };

    // ── Cache the decision ────────────────────────────────────────────────
    decisionCache.set(stateString, {
      decision,
      timestamp: performance.now(),
    });

    console.log(
      `[JEV] Response: ${choice} prob=${probability.toFixed(4)} conf=${confidence.toFixed(4)} latency=${latencyMs}ms tokens=${inputTokens}/${outputTokens}`,
    );

    if (SHADOW_MODE) {
      console.log("[JEV] Shadow mode: decision logged, not executed");
    }

    return decision;
  } catch (err) {
    clearTimeout(timeoutId);
    const latencyMs = Math.round(performance.now() - start);
    console.log("[JEV] Circuit breaker triggered — fallback to HOLD");
    return createFallback(
      err instanceof Error ? err.message : "UNKNOWN_ERROR",
      latencyMs,
    );
  }
}

// ── Token / cost exports ────────────────────────────────────────────────────

export function getTotalTokens(): { input: number; output: number } {
  return { input: totalInputTokens, output: totalOutputTokens };
}

export function getTotalCostEstimate(): number {
  return totalInputTokens * COST_PER_INPUT_TOKEN;
}

// ── Cache management ────────────────────────────────────────────────────────

export function clearDecisionCache(): void {
  decisionCache.clear();
}

// ── Raw query with custom question (for ensemble) ──────────────────────────

export async function queryJevWithQuestion(
  stateString: string,
  question: JevChoiceQuestion,
): Promise<JevDecision> {
  evictStaleCache();

  if (!API_KEY) {
    return createFallback("NO_API_KEY");
  }

  const cacheKey = stateString + "::" + question.instructions;
  const cached = decisionCache.get(cacheKey);
  if (cached && performance.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.decision;
  }

  const payload: JevSystemOneRequest = {
    state: stateString,
    model: MODEL,
    questions: { trading_signal: question },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start = performance.now();

  try {
    const data = await fetchWithRetry(payload, controller.signal);
    clearTimeout(timeoutId);
    const latencyMs = Math.round(performance.now() - start);

    const answer = data.answers["trading_signal"];
    if (!answer || answer.type !== "choice") {
      return createFallback(JSON.stringify(data), latencyMs);
    }

    const choice = answer.choice;
    if (!validateChoice(choice)) {
      return createFallback(JSON.stringify(data), latencyMs);
    }

    const probability = answer.probabilities[choice] ?? 0;
    const confidence = answer.confidence;
    const inputTokens = data.usage.input_tokens;
    const outputTokens = data.usage.output_tokens;

    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;

    const decision: JevDecision = {
      choice,
      probability,
      confidence,
      probabilities: answer.probabilities,
      rawResponse: JSON.stringify(data),
      latencyMs,
      inputTokens,
      outputTokens,
      shadow: SHADOW_MODE,
    };

    decisionCache.set(cacheKey, { decision, timestamp: performance.now() });
    return decision;
  } catch (err) {
    clearTimeout(timeoutId);
    const latencyMs = Math.round(performance.now() - start);
    return createFallback(err instanceof Error ? err.message : "UNKNOWN_ERROR", latencyMs);
  }
}
