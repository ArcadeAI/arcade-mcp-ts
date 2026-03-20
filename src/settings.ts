/**
 * Environment-based settings, mirroring Python's MCPSettings.
 * Auto-captures non-prefixed env vars as tool secrets.
 */

import { loadArcadeCredentials } from "./credentials.js";
import type { LogFormat } from "./logger.js";
import { createLogger } from "./logger.js";

const logger = createLogger("arcade-mcp-settings");

export interface NotificationSettings {
  rateLimitPerMinute: number;
  defaultDebounceMs: number;
  maxQueuedNotifications: number;
}

export interface TransportSettings {
  sessionTimeoutSeconds: number;
  cleanupIntervalSeconds: number;
  maxSessions: number;
  maxQueueSize: number;
}

export interface ServerSettings {
  name: string;
  version: string;
  title?: string;
  instructions?: string;
}

export interface ResourceServerSettings {
  canonicalUrl?: string;
  authorizationServers?: AuthorizationServerConfig[];
}

export interface AuthorizationServerConfig {
  url: string;
  issuer: string;
  jwksUri: string;
  algorithm?: string;
  expectedAudiences?: string[];
}

export interface MiddlewareSettings {
  enableLogging: boolean;
  logLevel: string;
  logFormat: LogFormat;
  enableErrorHandling: boolean;
  maskErrorDetails: boolean;
}

export interface TelemetrySettings {
  enable: boolean;
  serviceName: string;
}

export interface ArcadeSettings {
  apiKey?: string;
  apiUrl: string;
  authDisabled: boolean;
  serverSecret?: string;
  environment: string;
  userId?: string;
  orgId?: string;
  projectId?: string;
  coordinatorUrl?: string;
  refreshToken?: string;
  expiresAt?: string;
}

export interface MCPSettings {
  debug: boolean;
  notification: NotificationSettings;
  transport: TransportSettings;
  server: ServerSettings;
  resourceServer: ResourceServerSettings;
  middleware: MiddlewareSettings;
  telemetry: TelemetrySettings;
  arcade: ArcadeSettings;
  toolSecrets: Record<string, string>;
}

function envStr(key: string, defaultValue?: string): string | undefined {
  return process.env[key] ?? defaultValue;
}

function envInt(key: string, defaultValue: number): number {
  const v = process.env[key];
  return v ? Number.parseInt(v, 10) : defaultValue;
}

function envBool(key: string, defaultValue: boolean): boolean {
  const v = process.env[key];
  if (!v) return defaultValue;
  return v === "true" || v === "1" || v === "yes";
}

/**
 * Collect all env vars that don't start with MCP_ or _ as tool secrets.
 */
/** Env vars that are never tool secrets (system/shell variables). */
const SECRET_BLOCKLIST = new Set([
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "TERM",
  "LANG",
  "LOGNAME",
  "HOSTNAME",
  "TMPDIR",
  "PWD",
  "OLDPWD",
  "EDITOR",
  "VISUAL",
  "PAGER",
  "SHLVL",
  "COLORTERM",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  "NODE_OPTIONS",
  "NODE_ENV",
  "NODE_PATH",
  "NODE_EXTRA_CA_CERTS",
  "npm_config_prefix",
  "npm_config_cache",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "XDG_RUNTIME_DIR",
]);

function collectToolSecrets(): Record<string, string> {
  const secrets: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      value !== undefined &&
      !key.startsWith("MCP_") &&
      !key.startsWith("_") &&
      !SECRET_BLOCKLIST.has(key)
    ) {
      secrets[key] = value;
    }
  }
  return secrets;
}

/**
 * Parse authorization servers from JSON env var.
 */
function parseAuthorizationServers(): AuthorizationServerConfig[] | undefined {
  const raw = process.env.MCP_RESOURCE_SERVER_AUTHORIZATION_SERVERS;
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as AuthorizationServerConfig[];
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      "Failed to parse MCP_RESOURCE_SERVER_AUTHORIZATION_SERVERS JSON — ignoring",
    );
    return undefined;
  }
}

/**
 * Load settings from environment variables.
 */
export function loadSettings(): MCPSettings {
  return {
    debug: envBool("MCP_DEBUG", false),
    notification: {
      rateLimitPerMinute: envInt("MCP_NOTIFICATION_RATE_LIMIT_PER_MINUTE", 60),
      defaultDebounceMs: envInt("MCP_NOTIFICATION_DEFAULT_DEBOUNCE_MS", 100),
      maxQueuedNotifications: envInt(
        "MCP_NOTIFICATION_MAX_QUEUED_NOTIFICATIONS",
        1000,
      ),
    },
    transport: {
      sessionTimeoutSeconds: envInt(
        "MCP_TRANSPORT_SESSION_TIMEOUT_SECONDS",
        300,
      ),
      cleanupIntervalSeconds: envInt(
        "MCP_TRANSPORT_CLEANUP_INTERVAL_SECONDS",
        10,
      ),
      maxSessions: envInt("MCP_TRANSPORT_MAX_SESSIONS", 1000),
      maxQueueSize: envInt("MCP_TRANSPORT_MAX_QUEUE_SIZE", 1000),
    },
    server: {
      name: envStr("MCP_SERVER_NAME", "ArcadeMCP")!,
      version: envStr("MCP_SERVER_VERSION", "0.1.0")!,
      title: envStr("MCP_SERVER_TITLE"),
      instructions: envStr("MCP_SERVER_INSTRUCTIONS"),
    },
    resourceServer: {
      canonicalUrl: envStr("MCP_RESOURCE_SERVER_CANONICAL_URL"),
      authorizationServers: parseAuthorizationServers(),
    },
    middleware: {
      enableLogging: envBool("MCP_MIDDLEWARE_ENABLE_LOGGING", true),
      logLevel: envStr("MCP_MIDDLEWARE_LOG_LEVEL", "INFO")!,
      logFormat: (envStr("MCP_LOG_FORMAT", "json") as LogFormat)!,
      enableErrorHandling: envBool(
        "MCP_MIDDLEWARE_ENABLE_ERROR_HANDLING",
        true,
      ),
      maskErrorDetails: envBool("MCP_MIDDLEWARE_MASK_ERROR_DETAILS", true),
    },
    telemetry: {
      enable: envBool("ARCADE_MCP_OTEL_ENABLE", false),
      serviceName: envStr("OTEL_SERVICE_NAME", "arcade-mcp-worker")!,
    },
    arcade: (() => {
      const creds = loadArcadeCredentials();
      return {
        apiKey: envStr("ARCADE_API_KEY") ?? creds.apiKey,
        apiUrl: envStr("ARCADE_API_URL", "https://api.arcade.dev")!,
        authDisabled: envBool("ARCADE_AUTH_DISABLED", false),
        serverSecret:
          envStr("ARCADE_WORKER_SECRET") ?? envStr("ARCADE_SERVER_SECRET"),
        environment: envStr("ARCADE_ENVIRONMENT", "dev")!,
        userId: envStr("ARCADE_USER_ID") ?? creds.userId,
        orgId: creds.orgId,
        projectId: creds.projectId,
        coordinatorUrl: creds.coordinatorUrl,
        refreshToken: creds.refreshToken,
        expiresAt: creds.expiresAt,
      };
    })(),
    toolSecrets: collectToolSecrets(),
  };
}
