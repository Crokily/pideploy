import { randomUUID } from "crypto";
import { writeFile, mkdir } from "fs/promises";
import { logger } from "../lib/logger.js";

const TRACE_DIR = "/var/log/pideploy/traces";

export interface AgentSpan {
  spanId: string;
  parentSpanId?: string;
  type: "generation" | "tool_execution" | "compaction" | "retry";
  name: string;
  startedAt: number;
  endedAt?: number;
  attributes: Record<string, any>;
}

export interface AgentTrace {
  traceId: string;
  sessionId: string;
  userId?: string;
  taskType?: string;
  startedAt: number;
  endedAt?: number;
  spans: AgentSpan[];
  totalCost: number;
  totalTokens: { input: number; output: number; cacheRead: number };
  success: boolean;
  error?: string;
}

// Helper to generate short IDs
function spanId(): string {
  return `span_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

// The tracer subscribes to an event callback pattern
// Since agentLoop yields events as an async iterator, we provide a processEvent function
export interface Tracer {
  processEvent(event: any): void;
  getTrace(): AgentTrace;
  finalize(): AgentTrace;
  save(): Promise<string>; // returns file path
}

export function createTracer(opts: {
  sessionId?: string;
  userId?: string;
  taskType?: string;
}): Tracer {
  const trace: AgentTrace = {
    traceId: `trace_${randomUUID().replace(/-/g, "")}`,
    sessionId: opts.sessionId ?? `session_${Date.now()}`,
    userId: opts.userId,
    taskType: opts.taskType,
    startedAt: Date.now(),
    spans: [],
    totalCost: 0,
    totalTokens: { input: 0, output: 0, cacheRead: 0 },
    success: true,
  };

  let currentTurnSpanId: string | undefined;
  const toolStartTimes = new Map<string, { spanId: string; startedAt: number }>();

  function processEvent(event: any): void {
    switch (event.type) {
      case "turn_start": {
        currentTurnSpanId = spanId();
        trace.spans.push({
          spanId: currentTurnSpanId,
          type: "generation",
          name: "agent_turn",
          startedAt: Date.now(),
          attributes: {},
        });
        break;
      }
      case "turn_end": {
        const turnSpan = trace.spans.find((s) => s.spanId === currentTurnSpanId);
        if (turnSpan) {
          turnSpan.endedAt = Date.now();
        }
        break;
      }
      case "message_end": {
        if (event.message?.role === "assistant") {
          const msg = event.message;
          const usage = msg.usage;
          if (usage) {
            trace.totalCost += usage.cost?.total ?? 0;
            trace.totalTokens.input += usage.input ?? 0;
            trace.totalTokens.output += usage.output ?? 0;
            trace.totalTokens.cacheRead += usage.cacheRead ?? 0;
          }
          const turnSpan = trace.spans.find((s) => s.spanId === currentTurnSpanId);
          if (turnSpan) {
            turnSpan.attributes = {
              ...turnSpan.attributes,
              model: msg.model,
              provider: msg.provider,
              stopReason: msg.stopReason,
              inputTokens: usage?.input,
              outputTokens: usage?.output,
              cacheReadTokens: usage?.cacheRead,
              cost: usage?.cost?.total,
              errorMessage: (msg as any).errorMessage,
            };
          }

          if (msg.stopReason === "error") {
            trace.success = false;
            trace.error = (msg as any).errorMessage ?? "Assistant generation failed";
          }
        }
        break;
      }
      case "tool_execution_start": {
        const sid = spanId();
        const startedAt = Date.now();
        toolStartTimes.set(event.toolCallId, { spanId: sid, startedAt });
        trace.spans.push({
          spanId: sid,
          parentSpanId: currentTurnSpanId,
          type: "tool_execution",
          name: event.toolName,
          startedAt,
          attributes: { args: event.args },
        });
        break;
      }
      case "tool_execution_end": {
        const startInfo = toolStartTimes.get(event.toolCallId);
        if (startInfo) {
          const now = Date.now();
          const span = trace.spans.find((s) => s.spanId === startInfo.spanId);
          if (span) {
            span.endedAt = now;
            span.attributes.durationMs = now - startInfo.startedAt;
            span.attributes.isError = event.isError;
            if (event.isError) {
              trace.success = false;
            }
          }
          toolStartTimes.delete(event.toolCallId);
        }
        break;
      }
      case "auto_retry_start": {
        trace.spans.push({
          spanId: `span_retry_${event.attempt ?? Date.now()}`,
          type: "retry",
          name: `retry_attempt_${event.attempt ?? "unknown"}`,
          startedAt: Date.now(),
          attributes: {
            attempt: event.attempt,
            maxAttempts: event.maxAttempts,
            errorMessage: event.errorMessage,
          },
        });
        break;
      }
      case "auto_compaction_start": {
        trace.spans.push({
          spanId: spanId(),
          type: "compaction",
          name: "auto_compaction",
          startedAt: Date.now(),
          attributes: {},
        });
        break;
      }
      case "agent_end": {
        trace.endedAt = Date.now();
        break;
      }
    }
  }

  return {
    processEvent,
    getTrace: () => trace,
    finalize: () => {
      trace.endedAt = trace.endedAt ?? Date.now();
      return trace;
    },
    save: async () => {
      trace.endedAt = trace.endedAt ?? Date.now();
      await mkdir(TRACE_DIR, { recursive: true });
      const filename = `${trace.traceId}.json`;
      const filepath = `${TRACE_DIR}/${filename}`;
      await writeFile(filepath, JSON.stringify(trace, null, 2));
      logger.info({ traceId: trace.traceId, filepath }, "Trace saved");
      return filepath;
    },
  };
}
