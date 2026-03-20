/**
 * Arcade credential loading, token refresh, and expiry management.
 * Extracted from settings.ts to separate credential I/O from env-based config.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { createLogger } from "./logger.js";

const logger = createLogger("arcade-mcp-settings");

/**
 * Parsed contents of ~/.arcade/credentials.yaml.
 */
export interface ArcadeCredentials {
  apiKey?: string;
  userId?: string;
  refreshToken?: string;
  expiresAt?: string;
  orgId?: string;
  projectId?: string;
  coordinatorUrl?: string;
}

/**
 * Get the path to the credentials file directory.
 */
function getArcadeConfigDir(): string {
  return process.env.ARCADE_WORK_DIR
    ? join(process.env.ARCADE_WORK_DIR, ".arcade")
    : join(homedir(), ".arcade");
}

/**
 * Load credentials from ~/.arcade/credentials.yaml (or $ARCADE_WORK_DIR/.arcade/credentials.yaml).
 * Returns the access token as apiKey, user email as userId, plus refresh token,
 * expiry, org/project context, and coordinator URL.
 * Silently returns empty object on any error.
 */
export function loadArcadeCredentials(): ArcadeCredentials {
  try {
    const filePath = join(getArcadeConfigDir(), "credentials.yaml");
    const content = readFileSync(filePath, "utf-8");
    const doc = YAML.parse(content) as {
      cloud?: {
        auth?: {
          access_token?: string;
          refresh_token?: string;
          expires_at?: string;
        };
        user?: { email?: string };
        context?: { org_id?: string; project_id?: string };
        coordinator_url?: string;
      };
    };

    const cloud = doc?.cloud;
    return {
      apiKey: cloud?.auth?.access_token,
      userId: cloud?.user?.email,
      refreshToken: cloud?.auth?.refresh_token,
      expiresAt: cloud?.auth?.expires_at,
      orgId: cloud?.context?.org_id,
      projectId: cloud?.context?.project_id,
      coordinatorUrl: cloud?.coordinator_url,
    };
  } catch {
    return {};
  }
}

const PROD_COORDINATOR_HOST = "cloud.arcade.dev";
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Check if a token is expired (with 5-minute buffer, matching Python).
 */
export function isTokenExpired(expiresAt: string | undefined): boolean {
  if (!expiresAt) return false; // Can't tell — assume valid
  const expiry = new Date(expiresAt).getTime();
  return Date.now() > expiry - TOKEN_EXPIRY_BUFFER_MS;
}

/**
 * Refresh the access token using the coordinator's OAuth token endpoint.
 * Updates the credentials file on success. Returns the new access token,
 * or undefined if refresh fails.
 */
export async function refreshAccessToken(
  creds: ArcadeCredentials,
): Promise<string | undefined> {
  if (!creds.refreshToken) return undefined;

  const coordinatorUrl =
    creds.coordinatorUrl ?? `https://${PROD_COORDINATOR_HOST}`;
  try {
    // Fetch CLI config to get the token endpoint
    const configResp = await fetch(`${coordinatorUrl}/api/v1/auth/cli_config`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!configResp.ok) {
      logger.warn(
        `Failed to fetch CLI config from ${coordinatorUrl}: ${configResp.status}`,
      );
      return undefined;
    }
    const cliConfig = (await configResp.json()) as {
      client_id: string;
      token_endpoint: string;
    };

    // Refresh the token
    const tokenResp = await fetch(cliConfig.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: creds.refreshToken,
        client_id: cliConfig.client_id,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!tokenResp.ok) {
      logger.warn(`Token refresh failed: ${tokenResp.status}`);
      return undefined;
    }
    const tokens = (await tokenResp.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    // Update credentials file
    try {
      const filePath = join(getArcadeConfigDir(), "credentials.yaml");
      const content = readFileSync(filePath, "utf-8");
      const doc = YAML.parse(content) as Record<string, unknown>;
      const cloud = (doc.cloud ?? {}) as Record<string, unknown>;
      const auth = (cloud.auth ?? {}) as Record<string, unknown>;
      auth.access_token = tokens.access_token;
      auth.refresh_token = tokens.refresh_token;
      auth.expires_at = new Date(
        Date.now() + tokens.expires_in * 1000,
      ).toISOString();
      cloud.auth = auth;
      doc.cloud = cloud;
      const { writeFileSync } = await import("node:fs");
      writeFileSync(filePath, YAML.stringify(doc), "utf-8");
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "Failed to update credentials file after token refresh",
      );
    }

    logger.debug("Successfully refreshed Arcade access token");
    return tokens.access_token;
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      "Failed to refresh Arcade access token",
    );
    return undefined;
  }
}

/**
 * Get a valid access token, refreshing if expired.
 * Returns the token and updated credentials, or undefined if unavailable.
 */
export async function getValidAccessToken(
  creds: ArcadeCredentials,
): Promise<{ apiKey: string; creds: ArcadeCredentials } | undefined> {
  if (!creds.apiKey) return undefined;

  if (!isTokenExpired(creds.expiresAt)) {
    return { apiKey: creds.apiKey, creds };
  }

  logger.debug("Arcade access token expired, attempting refresh...");
  const newToken = await refreshAccessToken(creds);
  if (!newToken) return undefined;

  // Return updated credentials
  return {
    apiKey: newToken,
    creds: { ...creds, apiKey: newToken },
  };
}
