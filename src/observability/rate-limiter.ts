/* ═══════════════════════════════════════════════════════════════════════════
   Cerebro Trader — Token-Bucket Rate Limiter with 429 Retry-After Support
   ═══════════════════════════════════════════════════════════════════════════ */

export interface RateLimiter {
  acquire(): Promise<void>;
  release(): void;
  isThrottled(): boolean;
  getRetryAfterMs(): number;
  handle429(retryAfterHeader: string | null): void;
}

export function createRateLimiter(opts: {
  maxTokens: number;
  refillRatePerMs: number;
  maxRetryAfterMs?: number;
}): RateLimiter {
  const { maxTokens, refillRatePerMs, maxRetryAfterMs = 60_000 } = opts;

  let tokens = maxTokens;
  let lastRefillTime = performance.now();
  let throttledUntil = 0;

  function refill(): void {
    const now = performance.now();
    const elapsed = now - lastRefillTime;
    tokens = Math.min(maxTokens, tokens + elapsed * refillRatePerMs);
    lastRefillTime = now;
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  return {
    async acquire(): Promise<void> {
      // Wait out any active throttle window
      const now = performance.now();
      if (now < throttledUntil) {
        await delay(throttledUntil - now);
      }

      // Refill tokens based on elapsed time
      refill();

      // If no tokens available, wait until at least one is
      if (tokens < 1) {
        const waitMs = Math.ceil((1 - tokens) / refillRatePerMs);
        await delay(waitMs);
        refill();
      }

      // Take one token
      tokens = Math.max(0, tokens - 1);
    },

    release(): void {
      refill();
      tokens = Math.min(maxTokens, tokens + 1);
    },

    isThrottled(): boolean {
      return performance.now() < throttledUntil;
    },

    getRetryAfterMs(): number {
      const remaining = throttledUntil - performance.now();
      return remaining > 0 ? remaining : 0;
    },

    handle429(retryAfterHeader: string | null): void {
      let retryMs = 1000;

      if (retryAfterHeader) {
        const parsed = Number(retryAfterHeader);
        if (!isNaN(parsed)) {
          // If the value is <= 500, treat it as seconds (standard Retry-After)
          retryMs = parsed <= 500 ? parsed * 1000 : parsed;
        }
      }

      retryMs = Math.min(retryMs, maxRetryAfterMs);
      throttledUntil = performance.now() + retryMs;
    },
  };
}
