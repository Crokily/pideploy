import { getModel, type Api, type KnownProvider, type Model } from "@mariozechner/pi-ai";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { logger } from "./lib/logger.js";

// Auth configuration - share with main pi instance
const AUTH_PATH = join(homedir(), ".pi", "agent", "auth.json");

// Model fallback chain
const MODEL_CHAIN: Array<{ provider: KnownProvider; model: string }> = [
  { provider: "opencode", model: "minimax-m2.5-free" },
  { provider: "opencode", model: "glm-5-free" },
  { provider: "google-antigravity", model: "gemini-3-flash" }
];

const resolveModel = getModel as unknown as (
  provider: KnownProvider,
  modelId: string
) => Model<Api>;

// Cost limits
export const COST_LIMITS = {
  maxCostPerTask: 0.10, // USD per task execution
  maxCostPerHeartbeat: 0.05, // USD per heartbeat cycle
  maxCostPerDay: 3.00, // USD per 24h
  warnAtPercent: 80
};

// Agent loop limits
export const LOOP_LIMITS = {
  maxTurnsPerTask: 20,
  maxTurnsPerHeartbeat: 10,
  taskTimeoutMs: 5 * 60 * 1000, // 5 minutes
  heartbeatIntervalMs: 60 * 1000, // 60 seconds
  taskPollIntervalMs: 2 * 1000 // 2 seconds
};

export function loadAuth(): Record<string, any> {
  try {
    const raw = readFileSync(AUTH_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    logger.error({ err, path: AUTH_PATH }, "Failed to load auth.json");
    throw new Error(`Cannot load auth from ${AUTH_PATH}`);
  }
}

export function getConfiguredModel(): Model<Api> {
  for (const { provider, model } of MODEL_CHAIN) {
    try {
      const m = resolveModel(provider, model);
      logger.info({ provider, model }, "Using model");
      return m;
    } catch (err) {
      logger.warn({ provider, model, err }, "Model unavailable, trying next");
    }
  }
  throw new Error("No models available in fallback chain");
}
