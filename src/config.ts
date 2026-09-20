export const CONFIG = {
  // ── Risk Engine ──
  risk: {
    stopLossAtrMultiple: 2.0,          // per-trade stop = entry ± 2×ATR
    takeProfitAtrMultiple: 3.0,        // per-trade TP = entry ± 3×ATR
    trailingStopActivationAtrMultiple: 1.5,  // activate trailing stop after 1.5×ATR profit
    trailingStopStepAtrMultiple: 0.5,   // trail by 0.5×ATR steps
    maxDailyDrawdownPct: 0.03,         // 3% max daily drawdown
    maxPositionSize: 10_000,           // fixed max units per trade
    probabilityThreshold: 0.88,        // Jev confidence gate
    maxConsecutiveLosses: 5,           // halt after 5 consecutive losses
    cooldownTicks: 30,                 // 30-tick cooldown after halt (6 seconds at 200ms)
    maxTradeFrequencyPerMinute: 10,    // max 10 trades per minute
    slippageTolerancePct: 0.005,       // 0.5% max slippage from mid
    positionSizeFraction: 0.02,        // risk 2% of equity per trade (Kelly-derived)
    minPositionSize: 1,                // minimum trade size
    maxLeverage: 1.0,                  // no leverage by default
  },

  // ── Event Loop ──
  loop: {
    tickIntervalMs: 200,
    rollingWindowBars: 200,
    basePrice: 100.0,
    orderBookLevels: 10,
    multiTimeframes: (process.env.MULTI_TIMEFRAMES || "1,5,15,60").split(",").map(Number),
  },

  // ── Jev Client ──
  jev: {
    apiUrl: process.env.JEV_API_URL || "https://api.typesafe.ai/v1/systemone",
    model: "jev-latest",
    circuitBreakerTimeoutMs: 150,
    decisionCacheTtlMs: 5000,          // cache decisions for 5s if state unchanged
    shadowMode: process.env.SHADOW_MODE === "true",
    maxRetries: 2,
    retryBackoffMs: 100,
    ensembleQueryCount: parseInt(process.env.ENSEMBLE_QUERY_COUNT || "1", 10),
    ensembleMethod: (process.env.ENSEMBLE_METHOD || "majority") as "majority" | "weighted" | "consensus",
    ensembleConfidenceThreshold: parseFloat(process.env.ENSEMBLE_CONFIDENCE_THRESHOLD || "0.3"),
  },

  // ── Backtest ──
  backtest: {
    warmupBars: 60,
    initialBalance: 100_000,
    feeRateBps: 10,                    // 10 bps taker fee
    slippageBps: 5,                    // 5 bps average slippage
    monteCarloRuns: 1000,              // number of Monte Carlo resamples
    walkForwardTrainBars: 200,         // train window for walk-forward
    walkForwardTestBars: 50,           // test window for walk-forward
  },

  // ── Execution ──
  execution: {
    dryRun: process.env.DRY_RUN !== "false",  // paper trading by default, DRY_RUN=false to go live
    gasLimit: 250_000,
    chainId: parseInt(process.env.CHAIN_ID || "10143", 10),  // Monad testnet
    maxGasPriceGwei: 100,
    nonceManagerEnabled: true,
    simulationEnabled: true,           // eth_call before broadcast
  },

  // ── Logging ──
  logging: {
    level: (process.env.LOG_LEVEL || "info") as "debug" | "info" | "warn" | "error",
    jsonFormat: process.env.LOG_JSON === "true",
    correlationIdEnabled: true,
    redactSecrets: true,
    metricsPort: parseInt(process.env.METRICS_PORT || "9090", 10),
    alertWebhookUrl: process.env.ALERT_WEBHOOK_URL || "",
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
    telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
  },
} as const;

export type Config = typeof CONFIG;

export const RISK = CONFIG.risk;
export const LOOP = CONFIG.loop;
export const JEV_CONFIG = CONFIG.jev;
export const BT = CONFIG.backtest;
export const EXEC = CONFIG.execution;
export const LOG = CONFIG.logging;
