import type { Elysia } from "elysia";
import type { ResourceServerValidatorInterface } from "../types.js";

const WELL_KNOWN_BASE = "/.well-known/oauth-protected-resource";

const CORS_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * Register RFC 9728 OAuth Protected Resource Metadata discovery endpoints.
 *
 * When the canonical URL has a non-root path (e.g. `https://example.com/mcp`),
 * a path-suffixed endpoint is registered alongside the base well-known path
 * for backward compatibility.
 */
export function registerAuthDiscoveryRoutes(
  app: Elysia,
  auth: ResourceServerValidatorInterface,
): void {
  if (!auth.supportsOAuthDiscovery?.()) return;

  const metadata = auth.getResourceMetadata?.();
  if (!metadata) return;

  const handler = () => {
    const current = auth.getResourceMetadata?.();
    if (current) {
      return new Response(JSON.stringify(current), { headers: CORS_HEADERS });
    }
    return new Response(null, { status: 404 });
  };

  // Always register the base well-known path
  app.get(WELL_KNOWN_BASE, handler);

  // RFC 9728: derive path suffix from canonical URL
  const pathSuffix = new URL(metadata.resource as string).pathname;
  if (pathSuffix && pathSuffix !== "/") {
    app.get(`${WELL_KNOWN_BASE}${pathSuffix}`, handler);
  }
}
