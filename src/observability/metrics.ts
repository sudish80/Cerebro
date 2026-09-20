import { Logger } from "./logger";

const log = new Logger("metrics");

/* ═══════════════════════════════════════════════════════════════════════════
   Prometheus-compatible Metric Primitives
   ═══════════════════════════════════════════════════════════════════════════ */

function labelKey(labels?: Record<string, string>): string {
  if (!labels) return "";
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}="${labels[k]}"`)
    .join(",");
}

// ── Counter ──

export function createCounter(
  name: string,
  help: string,
  labelNames?: string[],
) {
  const values = new Map<string, number>();
  let total = 0;

  return {
    inc(labels?: Record<string, string>, value = 1) {
      const key = labelKey(labels);
      values.set(key, (values.get(key) ?? 0) + value);
      total += value;
    },
    get(): number {
      return total;
    },
    reset() {
      values.clear();
      total = 0;
    },
    // internal: format for prometheus text exposition
    _format(): string {
      const lines: string[] = [`# HELP ${name} ${help}`, `# TYPE ${name} counter`];
      if (values.size === 0) {
        lines.push(`${name} ${total}`);
      } else {
        for (const [key, val] of values) {
          lines.push(`${name}{${key}} ${val}`);
        }
      }
      return lines.join("\n");
    },
    _labelNames: labelNames,
  };
}

// ── Gauge ──

export function createGauge(
  name: string,
  help: string,
  labelNames?: string[],
) {
  const values = new Map<string, number>();
  let current = 0;

  return {
    set(labels: Record<string, string> | undefined, value: number) {
      const key = labelKey(labels);
      if (!labels) {
        current = value;
      } else {
        values.set(key, value);
      }
    },
    inc(labels?: Record<string, string>, value = 1) {
      const key = labelKey(labels);
      if (!labels) {
        current += value;
      } else {
        values.set(key, (values.get(key) ?? 0) + value);
      }
    },
    dec(labels?: Record<string, string>, value = 1) {
      const key = labelKey(labels);
      if (!labels) {
        current -= value;
      } else {
        values.set(key, (values.get(key) ?? 0) - value);
      }
    },
    get(): number {
      return current;
    },
    reset() {
      values.clear();
      current = 0;
    },
    _format(): string {
      const lines: string[] = [`# HELP ${name} ${help}`, `# TYPE ${name} gauge`];
      if (values.size === 0) {
        lines.push(`${name} ${current}`);
      } else {
        for (const [key, val] of values) {
          lines.push(`${name}{${key}} ${val}`);
        }
      }
      return lines.join("\n");
    },
    _labelNames: labelNames,
  };
}

// ── Histogram ──

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, Infinity];

export function createHistogram(
  name: string,
  help: string,
  labelNames?: string[],
  buckets?: number[],
) {
  const bucketBounds = (buckets ?? DEFAULT_BUCKETS).slice().sort((a, b) => a - b);
  const bucketCounts = new Map<string, number[]>();
  const sums = new Map<string, number>();
  const counts = new Map<string, number>();

  function ensureBuckets(key: string) {
    if (!bucketCounts.has(key)) {
      bucketCounts.set(key, new Array(bucketBounds.length).fill(0));
      sums.set(key, 0);
      counts.set(key, 0);
    }
  }

  return {
    observe(labels: Record<string, string> | undefined, value: number) {
      const key = labelKey(labels);
      ensureBuckets(key);
      const buckets = bucketCounts.get(key)!;
      for (let i = 0; i < bucketBounds.length; i++) {
        const bound = bucketBounds[i]!;
        if (value <= bound) {
          buckets[i] = (buckets[i] ?? 0) + 1;
        }
      }
      sums.set(key, (sums.get(key) ?? 0) + value);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    },
    get(): { count: number; sum: number; buckets: Record<number, number> } {
      const key = "";
      ensureBuckets(key);
      const result: Record<number, number> = {};
      const bs = bucketCounts.get(key)!;
      for (let i = 0; i < bucketBounds.length; i++) {
        const bound = bucketBounds[i]!;
        result[bound === Infinity ? Infinity : bound] = bs[i]!;
      }
      return {
        count: counts.get(key) ?? 0,
        sum: sums.get(key) ?? 0,
        buckets: result,
      };
    },
    reset() {
      bucketCounts.clear();
      sums.clear();
      counts.clear();
    },
    _format(): string {
      const lines: string[] = [`# HELP ${name} ${help}`, `# TYPE ${name} histogram`];
      if (bucketCounts.size === 0) {
        for (const bound of bucketBounds) {
          const le = bound === Infinity ? "+Inf" : bound.toString();
          lines.push(`${name}_bucket{le="${le}"} 0`);
        }
        lines.push(`${name}_count 0`);
        lines.push(`${name}_sum 0`);
      } else {
        for (const [key, bs] of bucketCounts) {
          const sum = sums.get(key) ?? 0;
          const count = counts.get(key) ?? 0;
          for (let i = 0; i < bucketBounds.length; i++) {
            const bound = bucketBounds[i]!;
            const le = bound === Infinity ? "+Inf" : bound.toString();
            const labelStr = key ? `{${key},le="${le}"}` : `{le="${le}"}`;
            lines.push(`${name}_bucket${labelStr} ${bs[i]!}`);
          }
          if (key) {
            lines.push(`${name}_count{${key}} ${count}`);
            lines.push(`${name}_sum{${key}} ${sum}`);
          } else {
            lines.push(`${name}_count ${count}`);
            lines.push(`${name}_sum ${sum}`);
          }
        }
      }
      return lines.join("\n");
    },
    _labelNames: labelNames,
  };
}

type Counter = ReturnType<typeof createCounter>;
type Gauge = ReturnType<typeof createGauge>;
type Histogram = ReturnType<typeof createHistogram>;

/* ═══════════════════════════════════════════════════════════════════════════
   Pre-defined Metrics
   ═══════════════════════════════════════════════════════════════════════════ */

export const tradesTotal: Counter = createCounter(
  "trades_total",
  "Total number of trades executed",
  ["action"],
);

export const tradePnl: Histogram = createHistogram(
  "trade_pnl",
  "Profit/loss per trade",
  ["action"],
  [-100, -50, -25, -10, -5, -1, 0, 1, 5, 10, 25, 50, 100, Infinity],
);

export const tradeFees: Counter = createCounter(
  "trade_fees",
  "Total trading fees paid",
);

export const jevLatencyMs: Histogram = createHistogram(
  "jev_latency_ms",
  "Jev AI decision latency in milliseconds",
);

export const jevTokensTotal: Counter = createCounter(
  "jev_tokens_total",
  "Total tokens consumed by Jev API",
  ["type"],
);

export const portfolioBalance: Gauge = createGauge(
  "portfolio_balance",
  "Current portfolio balance",
);

export const portfolioPosition: Gauge = createGauge(
  "portfolio_position",
  "Current position size",
);

export const portfolioDailyPnl: Gauge = createGauge(
  "portfolio_daily_pnl",
  "Current daily P&L",
);

export const portfolioDrawdown: Gauge = createGauge(
  "portfolio_drawdown",
  "Current drawdown percentage",
);

export const riskRejectionsTotal: Counter = createCounter(
  "risk_rejections_total",
  "Total risk engine rejections",
  ["reason"],
);

export const executionsTotal: Counter = createCounter(
  "executions_total",
  "Total order executions",
  ["action", "orderType"],
);

export const executionLatencyMs: Histogram = createHistogram(
  "execution_latency_ms",
  "Order execution latency in milliseconds",
);

export const wsReconnectsTotal: Counter = createCounter(
  "ws_reconnects_total",
  "Total WebSocket reconnections",
);

/* ═══════════════════════════════════════════════════════════════════════════
   Convenience Recording Functions
   ═══════════════════════════════════════════════════════════════════════════ */

export function recordTrade(action: string, pnl: number, fees: number): void {
  tradesTotal.inc({ action });
  tradePnl.observe({ action }, pnl);
  tradeFees.inc(undefined, fees);
}

export function recordJevDecision(
  latencyMs: number,
  inputTokens: number,
  outputTokens: number,
): void {
  jevLatencyMs.observe(undefined, latencyMs);
  jevTokensTotal.inc({ type: "input" }, inputTokens);
  jevTokensTotal.inc({ type: "output" }, outputTokens);
}

export function recordRejection(reason: string): void {
  riskRejectionsTotal.inc({ reason });
}

export function recordExecution(
  action: string,
  orderType: string,
  latencyMs: number,
): void {
  executionsTotal.inc({ action, orderType });
  executionLatencyMs.observe(undefined, latencyMs);
}

export function updatePortfolioMetrics(
  balance: number,
  position: number,
  dailyPnL: number,
  drawdown: number,
): void {
  portfolioBalance.set(undefined, balance);
  portfolioPosition.set(undefined, position);
  portfolioDailyPnl.set(undefined, dailyPnL);
  portfolioDrawdown.set(undefined, drawdown);
}

export function recordWsReconnect(): void {
  wsReconnectsTotal.inc();
}

/* ═══════════════════════════════════════════════════════════════════════════
   Prometheus Text Format Renderer
   ═══════════════════════════════════════════════════════════════════════════ */

function renderMetrics(): string {
  const parts: string[] = [];
  for (const metric of [
    tradesTotal,
    tradePnl,
    tradeFees,
    jevLatencyMs,
    jevTokensTotal,
    portfolioBalance,
    portfolioPosition,
    portfolioDailyPnl,
    portfolioDrawdown,
    riskRejectionsTotal,
    executionsTotal,
    executionLatencyMs,
    wsReconnectsTotal,
  ]) {
    parts.push((metric as { _format(): string })._format());
  }
  return parts.join("\n\n") + "\n";
}

/* ═══════════════════════════════════════════════════════════════════════════
   Metrics HTTP Server
   ═══════════════════════════════════════════════════════════════════════════ */

const START_TIME = Date.now();

export function startMetricsServer(port?: number): ReturnType<typeof Bun.serve> {
  const p = port ?? parseInt(process.env.METRICS_PORT || "9090", 10);

  const server = Bun.serve({
    port: p,
    fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/metrics") {
        const body = renderMetrics();
        return new Response(body, {
          headers: {
            "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
          },
        });
      }

      if (url.pathname === "/health") {
        return Response.json({
          status: "ok",
          uptime: Math.floor((Date.now() - START_TIME) / 1000),
          version: "1.0.0",
        });
      }

      // Root status page
      return new Response(
        `<!DOCTYPE html>
<html><head><title>Cerebro Trader</title></head>
<body>
  <h1>Cerebro Trader</h1>
  <p>Status: <strong>running</strong></p>
  <ul>
    <li><a href="/metrics">Metrics</a> (Prometheus)</li>
    <li><a href="/health">Health Check</a></li>
  </ul>
</body></html>`,
        { headers: { "Content-Type": "text/html" } },
      );
    },
  });

  log.info(`Metrics server listening on :${p}`);
  return server;
}
