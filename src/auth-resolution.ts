/**
 * Arcade Cloud auth token resolution.
 * Extracted from server.ts to isolate the Arcade SDK client lifecycle,
 * token refresh, and org-scoped URL rewriting.
 */

import Arcade from "@arcadeai/arcadejs";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolAuthorization } from "./auth/types.js";
import { getValidAccessToken, loadArcadeCredentials } from "./credentials.js";
import { createLogger } from "./logger.js";
import type { ArcadeSettings } from "./settings.js";

const _logger = createLogger("arcade-mcp-server");

/** Build a standardized auth error response for the client. */
function authError(text: string): { error: CallToolResult } {
  return {
    error: {
      content: [{ type: "text" as const, text }],
      isError: true,
    },
  };
}

/**
 * Resolves auth tokens from Arcade Cloud for tools with auth requirements.
 * Manages the Arcade SDK client lifecycle, token refresh, and org-scoped URL rewriting.
 */
export class ArcadeAuthResolver {
  private arcadeClient?: Arcade;
  private arcadeSettings?: ArcadeSettings;

  constructor(arcadeSettings?: ArcadeSettings) {
    this.arcadeSettings = arcadeSettings;
  }

  /**
   * Resolve an auth token from Arcade Cloud for a tool with an auth requirement.
   * Returns the token on success, or a CallToolResult error to return to the client.
   */
  async resolveAuthToken(
    toolAuth: ToolAuthorization,
    userId: string | undefined,
  ): Promise<{ token?: string; error?: CallToolResult }> {
    if (this.arcadeSettings?.authDisabled) {
      _logger.debug("Auth resolution skipped: ARCADE_AUTH_DISABLED is set");
      return {};
    }

    const client = await this.getArcadeClient();
    if (!client) {
      _logger.warn(
        "Tool requires auth but no Arcade API key is configured. " +
          "Set ARCADE_API_KEY env var or ensure ~/.arcade/credentials.yaml has a valid access_token.",
      );
      return authError(
        "Tool requires authentication but no Arcade API key is configured. " +
          "Set the ARCADE_API_KEY environment variable or run `arcade login`.",
      );
    }

    if (!userId) {
      _logger.warn("Tool requires auth but no userId is available");
      return authError(
        "This tool requires authentication but no user ID is available. " +
          "Set the ARCADE_USER_ID environment variable or run `arcade login`.",
      );
    }

    const authRequest = {
      user_id: userId,
      auth_requirement: {
        provider_id: toolAuth.providerId,
        provider_type: toolAuth.providerType,
        oauth2: { scopes: toolAuth.scopes ?? [] },
      },
    };
    _logger.debug(
      `Requesting auth token from Arcade Cloud: provider=${toolAuth.providerId}, type=${toolAuth.providerType}, userId=${userId}, scopes=${toolAuth.scopes?.join(",") ?? "none"}`,
    );

    let response: Awaited<ReturnType<typeof client.auth.authorize>>;
    try {
      response = await client.auth.authorize(authRequest);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = (err as { status?: number }).status;
      _logger.error(
        `Arcade Cloud auth request failed: ${message}${status ? ` (HTTP ${status})` : ""}`,
      );
      return authError(
        `Arcade Cloud auth request failed${status ? ` (HTTP ${status})` : ""}: ${message}\n\n` +
          "Check that ARCADE_API_KEY is valid and not expired. " +
          "If using ~/.arcade/credentials.yaml, the access_token may need refreshing via `arcade login`.",
      );
    }

    _logger.debug(
      `Arcade Cloud auth response: status=${response.status}, hasToken=${!!response.context?.token}, hasUrl=${!!response.url}`,
    );

    if (response.status === "completed") {
      return { token: response.context?.token ?? undefined };
    }

    if (response.status === "pending" || response.status === "not_started") {
      return authError(
        response.url
          ? `Authorization required. Please visit the following URL to authorize, then retry:\n\n${response.url}`
          : "Authorization is pending. Please complete the authorization flow, then retry.",
      );
    }

    // status === "failed" or unknown
    _logger.warn(
      `Authorization failed for provider "${toolAuth.providerId}": status=${response.status}`,
    );
    return authError(
      `Authorization failed for provider "${toolAuth.providerId}" (status: ${response.status}). Please try again.`,
    );
  }

  /**
   * Get or create the Arcade Cloud client. Returns undefined if no API key is configured.
   * Handles token refresh for expired credentials and org/project URL rewriting
   * for non-service keys (JWTs from `arcade login`).
   */
  private async getArcadeClient(): Promise<Arcade | undefined> {
    if (this.arcadeClient) return this.arcadeClient;

    const arcade = this.arcadeSettings;
    let apiKey = arcade?.apiKey;

    if (!apiKey) {
      _logger.debug(
        "No Arcade API key found (checked ARCADE_API_KEY env var and ~/.arcade/credentials.yaml)",
      );
      return undefined;
    }

    // For non-service keys (JWTs from credentials.yaml), check expiry and refresh
    const isServiceKey = apiKey.startsWith("arc_");
    if (!isServiceKey && arcade) {
      const creds = loadArcadeCredentials();
      const result = await getValidAccessToken({
        apiKey,
        refreshToken: arcade.refreshToken ?? creds.refreshToken,
        expiresAt: arcade.expiresAt ?? creds.expiresAt,
        coordinatorUrl: arcade.coordinatorUrl ?? creds.coordinatorUrl,
      });
      if (result) {
        apiKey = result.apiKey;
        arcade.apiKey = apiKey;
      } else if (arcade.expiresAt || creds.expiresAt) {
        _logger.warn(
          "Arcade access token is expired and refresh failed. Run `arcade login` to re-authenticate.",
        );
        return undefined;
      }
    }

    const masked =
      apiKey.length > 12
        ? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`
        : "***";
    const source = process.env.ARCADE_API_KEY
      ? "ARCADE_API_KEY env var"
      : "~/.arcade/credentials.yaml";
    _logger.debug(
      `Creating Arcade client (key: ${masked}, source: ${source}, baseURL: ${arcade?.apiUrl})`,
    );

    const clientOpts: ConstructorParameters<typeof Arcade>[0] = {
      apiKey,
      baseURL: arcade?.apiUrl,
    };

    // Non-service keys need org/project URL rewriting
    if (!isServiceKey && arcade?.orgId && arcade?.projectId) {
      const orgId = arcade.orgId;
      const projectId = arcade.projectId;
      const nativeFetch = globalThis.fetch;
      clientOpts.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        if (typeof input === "string" || input instanceof URL) {
          const url = new URL(input.toString());
          if (
            url.pathname.startsWith("/v1/") &&
            !url.pathname.includes("/v1/orgs/")
          ) {
            url.pathname = url.pathname.replace(
              "/v1/",
              `/v1/orgs/${orgId}/projects/${projectId}/`,
            );
          }
          return nativeFetch(url.toString(), init);
        }
        return nativeFetch(input, init);
      };
      _logger.info(
        `Configured org-scoped Arcade client for org '${orgId}' project '${projectId}'`,
      );
    } else if (!isServiceKey) {
      _logger.warn(
        "Expected to find org/project context in ~/.arcade/credentials.yaml but none was found; " +
          "using non-scoped Arcade client.",
      );
    }

    this.arcadeClient = new Arcade(clientOpts);
    return this.arcadeClient;
  }
}
