import { randomBytes } from "crypto";
import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";

const DATA_ROOT = "/data/clawdeploy";

export interface OpenClawConfigParams {
  instanceId: string;
  gatewayToken: string;
  channel?: "telegram" | "discord" | "";
  botToken?: string;
  aiProvider?: string;
  apiKey?: string;
}

export interface OpenClawConfig {
  agents: {
    defaults: {
      workspace: string;
    };
  };
  gateway: {
    mode: string;
    port: number;
    bind: string;
    auth: {
      mode: string;
      token: string;
    };
    tailscale: {
      mode: string;
    };
  };
  wizard?: {
    completed: boolean;
  };
  channels?: Record<string, unknown>;
}

/**
 * Generate a random gateway token (64-char hex string)
 */
export function generateGatewayToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Get the data directory paths for an instance
 */
export function getInstancePaths(instanceId: string) {
  const base = path.join(DATA_ROOT, instanceId);
  return {
    base,
    config: path.join(base, "config"),
    workspace: path.join(base, "workspace"),
    configFile: path.join(base, "config", "openclaw.json"),
    envFile: path.join(base, "config", ".env"),
  };
}

/**
 * Create persistent storage directories for an instance.
 * Directories are owned by UID 1000 (node user in container).
 */
export async function createInstanceStorage(instanceId: string): Promise<void> {
  const paths = getInstancePaths(instanceId);

  await mkdir(paths.config, { recursive: true, mode: 0o755 });
  await mkdir(paths.workspace, { recursive: true, mode: 0o755 });

  // Ensure directories are writable by container's node user (UID 1000)
  const { execSync } = await import("child_process");
  execSync(`chown -R 1000:1000 ${paths.base}`);
}

/**
 * Generate a valid openclaw.json configuration
 */
export function generateOpenClawConfig(params: OpenClawConfigParams): OpenClawConfig {
  const config: OpenClawConfig = {
    agents: {
      defaults: {
        workspace: "/home/node/.openclaw/workspace",
      },
    },
    gateway: {
      mode: "local",
      port: 18789,
      bind: "lan",
      auth: {
        mode: "token",
        token: params.gatewayToken,
      },
      tailscale: {
        mode: "off",
      },
    },
    wizard: {
      completed: true,
    },
  };

  // Add channel configuration if provided
  if (params.channel && params.botToken) {
    config.channels = {};

    if (params.channel === "telegram") {
      config.channels.telegram = {
        enabled: true,
        botToken: params.botToken,
      };
    } else if (params.channel === "discord") {
      config.channels.discord = {
        enabled: true,
        token: params.botToken,
      };
    }
  }

  return config;
}

/**
 * Generate .env file content with optional API key variables
 */
export function generateEnvFile(params: OpenClawConfigParams): string {
  const lines: string[] = [];

  if (params.apiKey && params.aiProvider) {
    const providerEnvMap: Record<string, string> = {
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
      gemini: "GEMINI_API_KEY",
      openrouter: "OPENROUTER_API_KEY",
    };

    const envVar = providerEnvMap[params.aiProvider.toLowerCase()];
    if (envVar) {
      lines.push(`${envVar}=${params.apiKey}`);
    }
  }

  // Add channel tokens as env vars too (some OpenClaw features read from env)
  if (params.botToken && params.channel === "telegram") {
    lines.push(`TELEGRAM_BOT_TOKEN=${params.botToken}`);
  } else if (params.botToken && params.channel === "discord") {
    lines.push(`DISCORD_BOT_TOKEN=${params.botToken}`);
  }

  return lines.join("\n") + (lines.length > 0 ? "\n" : "");
}

/**
 * Write openclaw.json and .env to the instance config directory
 */
export async function writeInstanceConfig(
  instanceId: string,
  config: OpenClawConfig,
  envContent: string,
): Promise<void> {
  const paths = getInstancePaths(instanceId);

  await writeFile(paths.configFile, JSON.stringify(config, null, 2), "utf-8");

  if (envContent.trim().length > 0) {
    await writeFile(paths.envFile, envContent, "utf-8");
  }

  // Ensure files are owned by container user
  const { execSync } = await import("child_process");
  execSync(`chown -R 1000:1000 ${paths.base}`);
}

/**
 * Remove all storage for an instance
 */
export async function removeInstanceStorage(instanceId: string): Promise<void> {
  const paths = getInstancePaths(instanceId);

  try {
    await rm(paths.base, { recursive: true, force: true });
  } catch {
    // Ignore errors during cleanup
  }
}
