export type AgentErrorClass =
  | "llm_api_error"
  | "llm_context_overflow"
  | "llm_refusal"
  | "tool_execution_error"
  | "tool_timeout"
  | "budget_exceeded"
  | "user_abort"
  | "agent_stuck"
  | "prompt_injection"
  | "unknown";

export function classifyError(
  event: any,
  context?: { turnCount?: number; lastNTools?: string[] }
): AgentErrorClass {
  // Retry events indicate LLM API issues
  if (event.type === "auto_retry_start") {
    const msg = (event.errorMessage ?? "").toLowerCase();
    if (/overloaded|rate.limit|429|503|502/.test(msg)) {
      return "llm_api_error";
    }
    if (/context|overflow|too.long|token/.test(msg)) {
      return "llm_context_overflow";
    }
    if (/refus|cannot|will not|inappropriate/.test(msg)) {
      return "llm_refusal";
    }
    return "llm_api_error";
  }

  // Tool execution errors
  if (event.type === "tool_execution_end" && event.isError) {
    return "tool_execution_error";
  }

  // Stuck loop detection: same tool called 3+ times in a row
  if (context?.lastNTools && context.lastNTools.length >= 3) {
    const last3 = context.lastNTools.slice(-3);
    if (new Set(last3).size === 1) {
      return "agent_stuck";
    }
  }

  return "unknown";
}
