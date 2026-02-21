export interface PerformanceMetrics {
  totalDurationMs: number;
  timeToFirstToken: number | null;
  llmGenerationMs: number;
  toolExecutionMs: number;
  turnCount: number;
  avgTurnDurationMs: number;
  slowestTool: { name: string; durationMs: number } | null;
}

export interface PerformanceTracker {
  processEvent(event: any): void;
  getMetrics(): PerformanceMetrics;
}

export function createPerformanceTracker(): PerformanceTracker {
  const metrics: PerformanceMetrics = {
    totalDurationMs: 0,
    timeToFirstToken: null,
    llmGenerationMs: 0,
    toolExecutionMs: 0,
    turnCount: 0,
    avgTurnDurationMs: 0,
    slowestTool: null,
  };

  let agentStartTime: number | null = null;
  let turnStartTime: number | null = null;
  let firstTokenReceived = false;
  const toolDurations: Array<{ name: string; ms: number }> = [];
  const toolStarts = new Map<string, number>();

  function processEvent(event: any): void {
    switch (event.type) {
      case "agent_start":
        agentStartTime = Date.now();
        firstTokenReceived = false;
        break;
      case "message_update":
        if (!firstTokenReceived && agentStartTime) {
          metrics.timeToFirstToken = Date.now() - agentStartTime;
          firstTokenReceived = true;
        }
        break;
      case "turn_start":
        turnStartTime = Date.now();
        metrics.turnCount++;
        break;
      case "turn_end":
        if (turnStartTime) {
          metrics.llmGenerationMs += Date.now() - turnStartTime;
        }
        break;
      case "tool_execution_start":
        toolStarts.set(event.toolCallId, Date.now());
        break;
      case "tool_execution_end": {
        const start = toolStarts.get(event.toolCallId);
        if (start) {
          const ms = Date.now() - start;
          metrics.toolExecutionMs += ms;
          toolDurations.push({ name: event.toolName, ms });
          toolStarts.delete(event.toolCallId);
        }
        break;
      }
      case "agent_end":
        if (agentStartTime) {
          metrics.totalDurationMs = Date.now() - agentStartTime;
        }
        metrics.avgTurnDurationMs = metrics.turnCount > 0 ? metrics.totalDurationMs / metrics.turnCount : 0;
        const sorted = [...toolDurations].sort((a, b) => b.ms - a.ms);
        if (sorted.length > 0) {
          metrics.slowestTool = { name: sorted[0].name, durationMs: sorted[0].ms };
        }
        break;
    }
  }

  return {
    processEvent,
    getMetrics: () => ({ ...metrics }),
  };
}
