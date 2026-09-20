import { describe, it, expect, beforeEach } from "bun:test";
import { createRateLimiter } from "../src/observability/rate-limiter";

let limiter: ReturnType<typeof createRateLimiter>;

beforeEach(() => {
  limiter = createRateLimiter({
    maxTokens: 3,
    refillRatePerMs: 0.1,
  });
});

describe("RateLimiter", () => {
  describe("acquire()", () => {
    it("resolves immediately when tokens are available", async () => {
      const start = performance.now();
      await limiter.acquire();
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(50);
    });

    it("consumes a token on each acquire", async () => {
      await limiter.acquire();
      await limiter.acquire();
      await limiter.acquire();
      // 4th acquire should take time (no tokens left)
      const start = performance.now();
      const promise = limiter.acquire();
      // Let some refill happen
      await new Promise((r) => setTimeout(r, 100));
      await promise;
      const elapsed = performance.now() - start;
      expect(elapsed).toBeGreaterThan(50);
    });
  });

  describe("isThrottled()", () => {
    it("returns false initially", () => {
      expect(limiter.isThrottled()).toBe(false);
    });

    it("returns true after handle429", () => {
      limiter.handle429("5");
      expect(limiter.isThrottled()).toBe(true);
    });

    it("returns false after throttle window expires", async () => {
      limiter.handle429("1");
      expect(limiter.isThrottled()).toBe(true);
      // Wait for throttle to expire (1 second)
      await new Promise((r) => setTimeout(r, 1200));
      expect(limiter.isThrottled()).toBe(false);
    });
  });

  describe("handle429()", () => {
    it("sets throttled state", () => {
      limiter.handle429(null);
      expect(limiter.isThrottled()).toBe(true);
    });

    it("parses Retry-After header in seconds (<=500)", () => {
      limiter.handle429("2");
      const retryAfter = limiter.getRetryAfterMs();
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(2100);
    });

    it("parses Retry-After header in milliseconds (>500)", () => {
      limiter.handle429("5000");
      const retryAfter = limiter.getRetryAfterMs();
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(5100);
    });

    it("defaults to 1000ms when header is null", () => {
      limiter.handle429(null);
      const retryAfter = limiter.getRetryAfterMs();
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(1100);
    });

    it("caps at maxRetryAfterMs", () => {
      const smallLimiter = createRateLimiter({
        maxTokens: 5,
        refillRatePerMs: 1,
        maxRetryAfterMs: 500,
      });
      smallLimiter.handle429("999");
      const retryAfter = smallLimiter.getRetryAfterMs();
      expect(retryAfter).toBeLessThanOrEqual(600);
    });
  });

  describe("getRetryAfterMs()", () => {
    it("returns 0 when not throttled", () => {
      expect(limiter.getRetryAfterMs()).toBe(0);
    });

    it("returns positive number after 429", () => {
      limiter.handle429("5");
      const ms = limiter.getRetryAfterMs();
      expect(ms).toBeGreaterThan(0);
    });
  });

  describe("release()", () => {
    it("returns a token to the bucket", async () => {
      await limiter.acquire();
      await limiter.acquire();
      await limiter.acquire();
      limiter.release();
      // Now there should be a token available
      const start = performance.now();
      await limiter.acquire();
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(50);
    });
  });
});
