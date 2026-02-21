import { executeHeartbeat } from "./agent-loop.js";
import { logger } from "./lib/logger.js";
import { LOOP_LIMITS, COST_LIMITS } from "./config.js";

// Track restart failures per instance
const restartFailures = new Map<string, number>();
const MAX_RESTART_FAILURES = 3;

// Track daily cost
let dailyCost = 0;
let lastDayReset = new Date().toDateString();

function resetDailyCostIfNeeded(): void {
  const today = new Date().toDateString();
  if (today !== lastDayReset) {
    logger.info({ previousDayCost: dailyCost }, "Resetting daily cost counter");
    dailyCost = 0;
    lastDayReset = today;
  }
}

export async function heartbeatLoop(): Promise<void> {
  logger.info({ intervalMs: LOOP_LIMITS.heartbeatIntervalMs }, "Heartbeat loop starting");

  while (true) {
    try {
      resetDailyCostIfNeeded();

      // Skip if daily cost limit reached
      if (dailyCost >= COST_LIMITS.maxCostPerDay) {
        logger.warn({ dailyCost, limit: COST_LIMITS.maxCostPerDay }, "Daily cost limit reached, skipping heartbeat");
        await sleep(LOOP_LIMITS.heartbeatIntervalMs);
        continue;
      }

      logger.debug("Starting heartbeat cycle");

      const result = await executeHeartbeat();

      dailyCost += result.cost;

      logger.info(
        {
          traceId: result.traceId,
          success: result.success,
          cost: result.cost,
          turns: result.turns,
          dailyCost,
        },
        "Heartbeat cycle completed",
      );

      // Process report data to update failure tracking
      if (result.reportData?.details?.data) {
        const data = result.reportData.details.data as {
          restartedInstances?: string[];
          failedRestarts?: string[];
        };

        // If any instances were restarted, track failures
        if (data.restartedInstances) {
          for (const id of data.restartedInstances) {
            restartFailures.delete(id); // Successful restart clears counter
          }
        }
        if (data.failedRestarts) {
          for (const id of data.failedRestarts) {
            const count = (restartFailures.get(id) ?? 0) + 1;
            restartFailures.set(id, count);
            if (count >= MAX_RESTART_FAILURES) {
              logger.error({ instanceId: id, failures: count }, "Instance exceeded max restart failures - giving up");
            }
          }
        }
      }
    } catch (err) {
      logger.error({ err }, "Heartbeat cycle error");
    }

    await sleep(LOOP_LIMITS.heartbeatIntervalMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
