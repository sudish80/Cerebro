import { startEventLoop } from "./engine/event-loop";
import { validateConfig } from "./config/validate";

process.on("unhandledRejection", (reason, promise) => {
  console.error("[FATAL] Unhandled rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err);
  process.exit(1);
});

async function main(): Promise<void> {
  console.log(`
╔══════════════════════════════════════════════════════╗
║              CEREBRO TRADER                          ║
║   AI-Powered On-Chain CLOB Trading Bot               ║
║   Brain: TypeSafe Jev | Chain: Monad                 ║
╚══════════════════════════════════════════════════════╝
`);

  try {
    validateConfig();
  } catch (err) {
    console.error("[FATAL]", err instanceof Error ? err.message : err);
    process.exit(1);
  }

  await startEventLoop();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[FATAL] main() failed:", err);
    process.exit(1);
  });
