import { logger } from "./lib/logger.js";

async function main() {
  logger.info("piDeploy Orchestrator starting...");

  // TODO: Initialize task queue consumer
  // TODO: Initialize heartbeat loop

  logger.info("piDeploy Orchestrator started");

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
