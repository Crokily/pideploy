import { logger } from "./lib/logger.js";
import { pollAndProcessTasks } from "./task-queue.js";
import { heartbeatLoop } from "./heartbeat.js";
import { prisma } from "./lib/prisma.js";

let isShuttingDown = false;

function registerProcessErrorHandlers(): void {
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "Unhandled promise rejection");
  });

  process.on("uncaughtException", (err) => {
    logger.error({ err }, "Uncaught exception");
  });
}

function startBackgroundLoops(): void {
  pollAndProcessTasks().catch((err) => {
    logger.error({ err }, "Task queue fatal error");
  });

  heartbeatLoop().catch((err) => {
    logger.error({ err }, "Heartbeat fatal error");
  });
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  logger.info({ signal }, "Shutting down...");

  try {
    await prisma.$disconnect();
  } catch (err) {
    logger.error({ err }, "Prisma disconnect failed during shutdown");
  } finally {
    process.exit(0);
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    logger.warn("DATABASE_URL is not set. Database operations will fail until it is configured.");
  }

  // Ensure Prisma client module initializes at service startup.
  void prisma;

  registerProcessErrorHandlers();
  startBackgroundLoops();

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });

  logger.info("piDeploy Orchestrator started");
}

main().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});
