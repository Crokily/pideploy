import { logger } from "./lib/logger.js";
import { pollAndProcessTasks } from "./task-queue.js";
import { heartbeatLoop } from "./heartbeat.js";
import { prisma } from "./lib/prisma.js";

async function main() {
  logger.info("piDeploy Orchestrator starting...");

  // Start task queue consumer (async, runs forever)
  pollAndProcessTasks().catch((err) => {
    logger.error({ err }, "Task queue fatal error");
  });

  // Start heartbeat loop (async, runs forever)
  heartbeatLoop().catch((err) => {
    logger.error({ err }, "Heartbeat fatal error");
  });

  logger.info("piDeploy Orchestrator started - task queue + heartbeat active");

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
