# Changelog

All notable changes to Cerebro Trader will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Multi-timeframe indicator computation (1m, 5m, 15m, 60m)
- Ensemble decision maker with 4 instruction angles
- Jev decision cache for backtest replay
- Config validation at startup
- Comprehensive test suite (119 tests, 383 assertions)
- Alerting system (Console, Webhook, Telegram)
- Prometheus metrics + health endpoint
- Trade history persistence
- Fee deduction in live portfolio tracking
- Stale data detection in event loop
- Chain reorg monitor
- Compliance/KYC screening

### Fixed
- Permanent halt bug (consecutive losses counter reset after cooldown)
- Dual timeout race condition crashing process
- Decision cache memory leak
- 8 missing indicators in state formatter
- Hardcoded dryRun, shadowMode, chainId (now env-configurable)
- Duplicate MarketDataFeed interface (DRY)

### Changed
- Event loop rewritten to use callback-driven feeds (WS + Simulated)
- Project renamed from "forgetrade-bot" to "cerebro-trader"

## [1.0.0] - 2025-09-20

### Added
- Initial release
- TypeSafe Jev API integration
- 136 technical indicators
- ATR-based risk engine with trailing stops
- viem wallet management
- SQLite persistence (portfolio, risk state)
- Simulated market data feed
- Backtest engine with walk-forward + Monte Carlo
- GitHub Actions CI/CD pipeline
- Structured logging with correlation IDs
- Rate limiting with 429 handling
- Docker multi-stage build
- Architecture Decision Records