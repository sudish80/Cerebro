# ADR-001: Jev Circuit Breaker Design

## Status
Accepted

## Date
2025-09-20

## Context
The trading bot must make decisions within a 200ms tick window. The Jev API has a typical latency of 70-500ms. If Jev is slow or down, the bot must not stall or execute on stale data.

## Decision
Implement a 150ms hard timeout on the Jev API call using `Promise.race` with an `AbortController`. If the API does not respond within 150ms, abort the request and return a safe "HOLD" fallback.

### Why 150ms?
- The tick interval is 200ms
- Indicator computation + state formatting takes ~5-10ms
- Risk evaluation + execution takes ~5-10ms
- Budget for Jev = 200 - 20 = 180ms
- 150ms provides a 30ms safety margin for I/O overhead

### Why Promise.race?
- Bun's fetch supports AbortController natively
- No external timeout library needed
- The AbortController physically cancels the HTTP request, not just ignores the response
- Cleaner than setTimeout-based approaches

## Consequences
- Jev calls that complete after 150ms are wasted compute (the model still runs, we just ignore the result)
- The fallback HOLD is always safe: no position is opened or closed
- In backtest mode, every Jev call is a network request; this may slow down backtests if Jev is slow
- The 150ms value is hardcoded in the config but can be overridden via `JEV_CONFIG.circuitBreakerTimeoutMs`

## Alternatives Considered
1. **No timeout**: Risk of blocking the entire event loop on a slow Jev response. Rejected.
2. **Softer timeout (return partial)**: Jev doesn't support streaming partial results. Rejected.
3. **Retry within the tick**: Would exceed the 200ms budget. Rejected.
4. **Dedicated worker thread**: Adds complexity; the 150ms timeout is sufficient for now. Deferred.