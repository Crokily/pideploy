import { COST_LIMITS } from "../config.js";
import { logger } from "../lib/logger.js";

export interface CostPolicy {
  maxCost: number;
  warnAtPercent: number;
  onWarn?: (current: number, max: number) => void;
  onExceed?: (current: number, max: number) => void;
}

export interface CostMonitor {
  processEvent(event: any): void;
  getCurrentCost(): number;
  isExceeded(): boolean;
  getToolCosts(): Map<string, ToolCostTracker>;
}

export interface ToolCostTracker {
  toolName: string;
  invocationCount: number;
  totalDurationMs: number;
  errors: number;
}

export function createCostMonitor(policy?: Partial<CostPolicy>): CostMonitor {
  const effectivePolicy: CostPolicy = {
    maxCost: policy?.maxCost ?? COST_LIMITS.maxCostPerTask,
    warnAtPercent: policy?.warnAtPercent ?? COST_LIMITS.warnAtPercent,
    onWarn: policy?.onWarn,
    onExceed: policy?.onExceed,
  };

  let requestCost = 0;
  let warned = false;
  let exceeded = false;
  const toolTrackers = new Map<string, ToolCostTracker>();
  const toolStarts = new Map<string, number>();

  function processEvent(event: any): void {
    // Track LLM cost
    if (event.type === "message_end" && event.message?.role === "assistant") {
      const usage = event.message.usage;
      if (usage?.cost?.total) {
        requestCost += usage.cost.total;

        if (
          !warned &&
          requestCost >= effectivePolicy.maxCost * (effectivePolicy.warnAtPercent / 100)
        ) {
          warned = true;
          logger.warn({ cost: requestCost, max: effectivePolicy.maxCost }, "Cost approaching limit");
          effectivePolicy.onWarn?.(requestCost, effectivePolicy.maxCost);
        }

        if (!exceeded && requestCost >= effectivePolicy.maxCost) {
          exceeded = true;
          logger.error({ cost: requestCost, max: effectivePolicy.maxCost }, "Cost limit exceeded");
          effectivePolicy.onExceed?.(requestCost, effectivePolicy.maxCost);
        }
      }
    }

    // Track tool costs
    if (event.type === "tool_execution_start") {
      toolStarts.set(event.toolCallId, Date.now());
    }
    if (event.type === "tool_execution_end") {
      const start = toolStarts.get(event.toolCallId);
      const duration = start ? Date.now() - start : 0;
      const tracker = toolTrackers.get(event.toolName) ?? {
        toolName: event.toolName,
        invocationCount: 0,
        totalDurationMs: 0,
        errors: 0,
      };
      tracker.invocationCount++;
      tracker.totalDurationMs += duration;
      if (event.isError) {
        tracker.errors++;
      }
      toolTrackers.set(event.toolName, tracker);
      toolStarts.delete(event.toolCallId);
    }
  }

  return {
    processEvent,
    getCurrentCost: () => requestCost,
    isExceeded: () => exceeded,
    getToolCosts: () => toolTrackers,
  };
}
