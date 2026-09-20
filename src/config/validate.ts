import { CONFIG } from "../config";

export function validateConfig(): void {
  const failures: string[] = [];

  function check(condition: boolean, msg: string): void {
    if (!condition) failures.push(msg);
  }

  const { risk, loop, jev, backtest, execution } = CONFIG;

  // risk
  check(risk.stopLossAtrMultiple > 0,
    `risk.stopLossAtrMultiple must be > 0 (got ${risk.stopLossAtrMultiple})`);
  check(risk.takeProfitAtrMultiple > risk.stopLossAtrMultiple,
    `risk.takeProfitAtrMultiple must be > risk.stopLossAtrMultiple (got ${risk.takeProfitAtrMultiple} <= ${risk.stopLossAtrMultiple})`);
  check(risk.trailingStopActivationAtrMultiple > 0,
    `risk.trailingStopActivationAtrMultiple must be > 0 (got ${risk.trailingStopActivationAtrMultiple})`);
  check(risk.trailingStopStepAtrMultiple > 0,
    `risk.trailingStopStepAtrMultiple must be > 0 (got ${risk.trailingStopStepAtrMultiple})`);
  check(risk.maxDailyDrawdownPct > 0 && risk.maxDailyDrawdownPct < 1,
    `risk.maxDailyDrawdownPct must be between 0 and 1 (got ${risk.maxDailyDrawdownPct})`);
  check(risk.maxPositionSize > risk.minPositionSize,
    `risk.maxPositionSize must be > risk.minPositionSize (got ${risk.maxPositionSize} <= ${risk.minPositionSize})`);
  check(risk.probabilityThreshold > 0 && risk.probabilityThreshold < 1,
    `risk.probabilityThreshold must be between 0 and 1 (got ${risk.probabilityThreshold})`);
  check(risk.maxConsecutiveLosses > 0,
    `risk.maxConsecutiveLosses must be > 0 (got ${risk.maxConsecutiveLosses})`);
  check(risk.cooldownTicks > 0,
    `risk.cooldownTicks must be > 0 (got ${risk.cooldownTicks})`);
  check(risk.maxTradeFrequencyPerMinute > 0,
    `risk.maxTradeFrequencyPerMinute must be > 0 (got ${risk.maxTradeFrequencyPerMinute})`);
  check(risk.slippageTolerancePct > 0 && risk.slippageTolerancePct < 0.1,
    `risk.slippageTolerancePct must be between 0 and 0.1 (got ${risk.slippageTolerancePct})`);
  check(risk.positionSizeFraction > 0 && risk.positionSizeFraction < 1,
    `risk.positionSizeFraction must be between 0 and 1 (got ${risk.positionSizeFraction})`);
  check(risk.minPositionSize > 0,
    `risk.minPositionSize must be > 0 (got ${risk.minPositionSize})`);
  check(risk.maxLeverage > 0,
    `risk.maxLeverage must be > 0 (got ${risk.maxLeverage})`);

  // loop
  check(loop.tickIntervalMs >= 50,
    `loop.tickIntervalMs must be >= 50 (got ${loop.tickIntervalMs})`);
  check(loop.rollingWindowBars >= 60,
    `loop.rollingWindowBars must be >= 60 (got ${loop.rollingWindowBars})`);
  check(loop.basePrice > 0,
    `loop.basePrice must be > 0 (got ${loop.basePrice})`);
  check(loop.orderBookLevels > 0,
    `loop.orderBookLevels must be > 0 (got ${loop.orderBookLevels})`);

  // jev
  check(jev.circuitBreakerTimeoutMs > 0 && jev.circuitBreakerTimeoutMs < 10000,
    `jev.circuitBreakerTimeoutMs must be between 0 and 10000 (got ${jev.circuitBreakerTimeoutMs})`);
  check(jev.decisionCacheTtlMs > 0,
    `jev.decisionCacheTtlMs must be > 0 (got ${jev.decisionCacheTtlMs})`);
  check(jev.maxRetries >= 0,
    `jev.maxRetries must be >= 0 (got ${jev.maxRetries})`);
  check(jev.retryBackoffMs > 0,
    `jev.retryBackoffMs must be > 0 (got ${jev.retryBackoffMs})`);

  // backtest
  check(backtest.warmupBars > 0,
    `backtest.warmupBars must be > 0 (got ${backtest.warmupBars})`);
  check(backtest.initialBalance > 0,
    `backtest.initialBalance must be > 0 (got ${backtest.initialBalance})`);
  check(backtest.feeRateBps >= 0,
    `backtest.feeRateBps must be >= 0 (got ${backtest.feeRateBps})`);
  check(backtest.slippageBps >= 0,
    `backtest.slippageBps must be >= 0 (got ${backtest.slippageBps})`);
  check(backtest.monteCarloRuns > 0,
    `backtest.monteCarloRuns must be > 0 (got ${backtest.monteCarloRuns})`);

  // execution
  check(execution.gasLimit > 0,
    `execution.gasLimit must be > 0 (got ${execution.gasLimit})`);
  check(execution.chainId > 0,
    `execution.chainId must be > 0 (got ${execution.chainId})`);
  check(execution.maxGasPriceGwei > 0,
    `execution.maxGasPriceGwei must be > 0 (got ${execution.maxGasPriceGwei})`);

  // API URLs
  if (!jev.apiUrl.startsWith("http://") && !jev.apiUrl.startsWith("https://")) {
    failures.push(`jev.apiUrl must start with http:// or https:// (got ${jev.apiUrl})`);
  }

  // env checks
  if (!execution.dryRun && !process.env.PRIVATE_KEY) {
    console.warn("[CONFIG] WARNING: PRIVATE_KEY env var not set (required for live trading)");
  }

  if (!process.env.TYPESAFE_API_KEY) {
    console.warn("[CONFIG] WARNING: TYPESAFE_API_KEY env var not set — Jev AI will use fallback HOLD");
  }

  if (failures.length > 0) {
    throw new Error(
      `Config validation failed:\n  - ${failures.join("\n  - ")}`,
    );
  }
}
