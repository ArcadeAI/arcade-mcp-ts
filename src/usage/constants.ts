import { homedir } from "node:os";
import { join } from "node:path";

export const POSTHOG_API_KEY =
  "phc_hIqUQyJpf2TP4COePO5jEpkGeUXipa7KqTEyDeRsTmB";
export const POSTHOG_HOST = "https://us.i.posthog.com";

export const EVENT_MCP_SERVER_STARTED = "mcp_server_started";
export const EVENT_MCP_TOOL_CALLED = "mcp_tool_called";

export const USAGE_TRACKING_ENV_VAR = "ARCADE_USAGE_TRACKING";

/**
 * Path to the usage identity file.
 * Respects ARCADE_WORK_DIR for custom config directories.
 */
export function getUsageFilePath(): string {
  const configDir = process.env.ARCADE_WORK_DIR
    ? join(process.env.ARCADE_WORK_DIR, ".arcade")
    : join(homedir(), ".arcade");
  return join(configDir, "usage.json");
}

/**
 * Check if usage tracking is enabled.
 * Returns false if ARCADE_USAGE_TRACKING is set to "0", "false", "no", or "off".
 */
export function isTrackingEnabled(): boolean {
  const value = process.env[USAGE_TRACKING_ENV_VAR];
  if (!value) return true;
  return !["0", "false", "no", "off"].includes(value.toLowerCase());
}
