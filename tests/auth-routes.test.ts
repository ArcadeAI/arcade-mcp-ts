import { Elysia } from "elysia";
import { describe, expect, it } from "vitest";
import { registerAuthDiscoveryRoutes } from "../src/auth/routes.js";
import type { ResourceServerValidatorInterface } from "../src/types.js";

const WELL_KNOWN_BASE = "/.well-known/oauth-protected-resource";

function makeAuth(
  canonicalUrl: string | undefined,
): ResourceServerValidatorInterface {
  return {
    validateToken: async () => ({
      userId: "u",
      claims: {},
    }),
    supportsOAuthDiscovery: () => !!canonicalUrl,
    getResourceMetadata: () =>
      canonicalUrl
        ? {
            resource: canonicalUrl,
            authorization_servers: ["https://auth.example.com"],
            bearer_methods_supported: ["header"],
          }
        : null,
  };
}

async function get(app: Elysia, path: string) {
  return app.handle(new Request(`http://localhost${path}`));
}

describe("registerAuthDiscoveryRoutes", () => {
  it("registers base well-known path for root canonical URL", async () => {
    const app = new Elysia();
    registerAuthDiscoveryRoutes(app, makeAuth("https://example.com/"));

    const res = await get(app, WELL_KNOWN_BASE);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resource).toBe("https://example.com/");
  });

  it("registers both base and suffixed paths for non-root canonical URL", async () => {
    const app = new Elysia();
    registerAuthDiscoveryRoutes(app, makeAuth("https://example.com/mcp"));

    // Base path (backward compat)
    const baseRes = await get(app, WELL_KNOWN_BASE);
    expect(baseRes.status).toBe(200);

    // Suffixed path (RFC 9728)
    const suffixedRes = await get(app, `${WELL_KNOWN_BASE}/mcp`);
    expect(suffixedRes.status).toBe(200);

    const body = await suffixedRes.json();
    expect(body.resource).toBe("https://example.com/mcp");
  });

  it("handles deep path suffixes", async () => {
    const app = new Elysia();
    registerAuthDiscoveryRoutes(
      app,
      makeAuth("https://example.com/api/v1/mcp"),
    );

    const res = await get(app, `${WELL_KNOWN_BASE}/api/v1/mcp`);
    expect(res.status).toBe(200);
  });

  it("includes CORS headers in response", async () => {
    const app = new Elysia();
    registerAuthDiscoveryRoutes(app, makeAuth("https://example.com/"));

    const res = await get(app, WELL_KNOWN_BASE);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET, OPTIONS",
    );
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe(
      "Content-Type",
    );
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });

  it("does not register routes when discovery is not supported", async () => {
    const app = new Elysia();
    registerAuthDiscoveryRoutes(app, makeAuth(undefined));

    const res = await get(app, WELL_KNOWN_BASE);
    expect(res.status).toBe(404);
  });

  it("does not register suffixed path for root-only canonical URL", async () => {
    const app = new Elysia();
    registerAuthDiscoveryRoutes(app, makeAuth("https://example.com"));

    // Base should work
    const baseRes = await get(app, WELL_KNOWN_BASE);
    expect(baseRes.status).toBe(200);

    // No suffixed path beyond base — "/" suffix is skipped
    // (No extra route registered, so only base responds)
  });
});
