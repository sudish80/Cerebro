import { runBacktest } from "./run";

async function main(): Promise<void> {
  console.log(`
╔══════════════════════════════════════════════════════╗
║       CEREBRO TRADER — BACKTEST MODE                  ║
║   Historical replay with Jev AI decision engine      ║
╚══════════════════════════════════════════════════════╝
`);

  const csvPath = process.argv[2] || "./data/btc_daily.csv";
  console.log(`[BACKTEST] CSV path: ${csvPath}`);

  await runBacktest(csvPath);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[BACKTEST] Fatal error:", err);
    process.exit(1);
  });
