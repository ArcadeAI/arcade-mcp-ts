import * as jose from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolCatalog } from "../../src/catalog.js";
import { ServerError } from "../../src/exceptions.js";
import { createWorkerRoutes } from "../../src/worker/routes.js";

const BASE = "http://localhost";
const WORKER_SECRET = "test-worker-secret";
const SECRET_KEY = new TextEncoder().encode(WORKER_SECRET);

async function createWorkerJWT(
  secret = SECRET_KEY,
  claims: Record<string, unknown> = {},
): Promise<string> {
  return new jose.SignJWT({ ver: "1", ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("worker")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret);
}

function makeCatalog(): ToolCatalog {
  const catalog = new ToolCatalog();
  catalog.addTool(
    "echo",
    {
      description: "Echo a message",
      parameters: z.object({ message: z.string() }),
    },
    async (args) => args.message,
  );
  return catalog;
}

function makeApp(options?: { secret?: string; catalog?: ToolCatalog }) {
  const catalog = options?.catalog ?? makeCatalog();
  return createWorkerRoutes({
    catalog,
    secret: options?.secret ?? WORKER_SECRET,
  });
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

// ── Health check ────────────────────────────────────────

describe("GET /worker/health", () => {
  it("returns status and tool count", async () => {
    const app = makeApp();
    const res = await app.handle(new Request(`${BASE}/worker/health`));
    const body = await res.json();

    expect(body.status).toBe("ok");
    expect(body.tool_count).toBe("1");
  });

  it("does not require auth", async () => {
    const app = makeApp();
    // No auth header — should still succeed
    const res = await app.handle(new Request(`${BASE}/worker/health`));
    expect(res.status).toBe(200);
  });
});

// ── Auth middleware ──────────────────────────────────────

describe("worker auth", () => {
  it("rejects requests without Bearer token", async () => {
    const app = makeApp();
    const res = await app.handle(new Request(`${BASE}/worker/tools`));
    expect(res.status).toBe(401);
  });

  it("rejects requests with wrong signing key", async () => {
    const app = makeApp();
    const wrongKey = new TextEncoder().encode("wrong-secret");
    const jwt = await createWorkerJWT(wrongKey);
    const res = await app.handle(
      new Request(`${BASE}/worker/tools`, {
        headers: authHeaders(jwt),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects requests with raw secret instead of JWT", async () => {
    const app = makeApp();
    const res = await app.handle(
      new Request(`${BASE}/worker/tools`, {
        headers: authHeaders(WORKER_SECRET),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects JWT with wrong audience", async () => {
    const app = makeApp();
    const jwt = await new jose.SignJWT({ ver: "1" })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("not-worker")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(SECRET_KEY);
    const res = await app.handle(
      new Request(`${BASE}/worker/tools`, {
        headers: authHeaders(jwt),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects JWT with wrong ver claim", async () => {
    const app = makeApp();
    const jwt = await new jose.SignJWT({ ver: "999" })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("worker")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(SECRET_KEY);
    const res = await app.handle(
      new Request(`${BASE}/worker/tools`, {
        headers: authHeaders(jwt),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("allows requests with valid JWT", async () => {
    const app = makeApp();
    const jwt = await createWorkerJWT();
    const res = await app.handle(
      new Request(`${BASE}/worker/tools`, {
        headers: authHeaders(jwt),
      }),
    );
    expect(res.status).toBe(200);
  });

  it("throws when no secret configured", () => {
    expect(() => makeApp({ secret: "" })).toThrow(ServerError);
    expect(() => makeApp({ secret: "" })).toThrow(/ARCADE_WORKER_SECRET/);
  });
});

// ── List tools ──────────────────────────────────────────

describe("GET /worker/tools", () => {
  it("returns registered tools", async () => {
    const app = makeApp();
    const jwt = await createWorkerJWT();
    const res = await app.handle(
      new Request(`${BASE}/worker/tools`, { headers: authHeaders(jwt) }),
    );
    const body = await res.json();

    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].name).toBe("echo");
    expect(body.tools[0].description).toBe("Echo a message");
    expect(body.tools[0].inputSchema).toHaveProperty("type", "object");
  });

  it("returns empty array when no tools registered", async () => {
    const app = makeApp({ catalog: new ToolCatalog() });
    const jwt = await createWorkerJWT();
    const res = await app.handle(
      new Request(`${BASE}/worker/tools`, { headers: authHeaders(jwt) }),
    );
    const body = await res.json();

    expect(body.tools).toEqual([]);
  });
});

// ── Invoke tool ─────────────────────────────────────────

describe("POST /worker/tools/invoke", () => {
  const envSnapshot: Record<string, string | undefined> = {};

  let validJWT: string;

  beforeEach(async () => {
    envSnapshot.TEST_WORKER_API_KEY = process.env.TEST_WORKER_API_KEY;
    validJWT = await createWorkerJWT();
  });

  afterEach(() => {
    if (envSnapshot.TEST_WORKER_API_KEY === undefined) {
      delete process.env.TEST_WORKER_API_KEY;
    } else {
      process.env.TEST_WORKER_API_KEY = envSnapshot.TEST_WORKER_API_KEY;
    }
  });

  function invokeRequest(
    body: Record<string, unknown>,
    token?: string,
  ): Request {
    return new Request(`${BASE}/worker/tools/invoke`, {
      method: "POST",
      headers: {
        ...authHeaders(token ?? validJWT),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  it("successfully invokes a tool and returns result", async () => {
    const app = makeApp();
    const res = await app.handle(
      invokeRequest({ name: "echo", inputs: { message: "hello" } }),
    );
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.output.value).toBe("hello");
    expect(body.executionId).toBeDefined();
    expect(body.duration).toBeGreaterThan(0);
    expect(body.finishedAt).toBeDefined();
  });

  it("returns 404 for unknown tool", async () => {
    const app = makeApp();
    const res = await app.handle(
      invokeRequest({ name: "nonexistent", inputs: {} }),
    );
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toContain("nonexistent");
  });

  it("returns structured error for tool that throws", async () => {
    const catalog = new ToolCatalog();
    catalog.addTool(
      "fail",
      {
        description: "Always fails",
        parameters: z.object({}),
      },
      async () => {
        throw new Error("kaboom");
      },
    );

    const app = makeApp({ catalog });
    const res = await app.handle(invokeRequest({ name: "fail", inputs: {} }));
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.output.error).toBe("kaboom");
  });

  it("passes userId from request body into context", async () => {
    const catalog = new ToolCatalog();
    catalog.addTool(
      "whoami",
      {
        description: "Returns userId",
        parameters: z.object({}),
      },
      async (_args, ctx) => ctx.userId,
    );

    const app = makeApp({ catalog });
    const res = await app.handle(
      invokeRequest({ name: "whoami", inputs: {}, userId: "user-42" }),
    );
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.output.value).toBe("user-42");
  });

  it("injects auth token from request context", async () => {
    const catalog = new ToolCatalog();
    catalog.addTool(
      "authed_tool",
      {
        description: "Returns auth token",
        parameters: z.object({}),
      },
      async (_args, ctx) => ctx.getAuthToken(),
    );

    const app = makeApp({ catalog });
    const res = await app.handle(
      invokeRequest({
        name: "authed_tool",
        inputs: {},
        context: {
          authorization: { token: "oauth-access-token-123" },
        },
      }),
    );
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.output.value).toBe("oauth-access-token-123");
  });

  it("getAuthToken throws when no token provided", async () => {
    const catalog = new ToolCatalog();
    catalog.addTool(
      "authed_tool",
      {
        description: "Returns auth token",
        parameters: z.object({}),
      },
      async (_args, ctx) => ctx.getAuthToken(),
    );

    const app = makeApp({ catalog });
    const res = await app.handle(
      invokeRequest({ name: "authed_tool", inputs: {} }),
    );
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.output.error).toContain("Auth token not found");
  });

  it("injects secrets declared by the tool from process.env", async () => {
    process.env.TEST_WORKER_API_KEY = "super-secret-value";

    const catalog = new ToolCatalog();
    catalog.addTool(
      "secret_reader",
      {
        description: "Reads a secret",
        parameters: z.object({}),
        secrets: ["TEST_WORKER_API_KEY"],
      },
      async (_args, ctx) => ctx.getSecret("TEST_WORKER_API_KEY"),
    );

    const app = makeApp({ catalog });
    const res = await app.handle(
      invokeRequest({ name: "secret_reader", inputs: {} }),
    );
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.output.value).toBe("super-secret-value");
  });

  it("injects secrets provided in request context", async () => {
    const catalog = new ToolCatalog();
    catalog.addTool(
      "secret_reader",
      {
        description: "Reads a secret",
        parameters: z.object({}),
        secrets: ["CALLER_SECRET"],
      },
      async (_args, ctx) => ctx.getSecret("CALLER_SECRET"),
    );

    const app = makeApp({ catalog });
    const res = await app.handle(
      invokeRequest({
        name: "secret_reader",
        inputs: {},
        context: {
          secrets: [{ key: "CALLER_SECRET", value: "from-request" }],
        },
      }),
    );
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.output.value).toBe("from-request");
  });

  it("request context secrets override env secrets", async () => {
    process.env.TEST_WORKER_API_KEY = "from-env";

    const catalog = new ToolCatalog();
    catalog.addTool(
      "secret_reader",
      {
        description: "Reads a secret",
        parameters: z.object({}),
        secrets: ["TEST_WORKER_API_KEY"],
      },
      async (_args, ctx) => ctx.getSecret("TEST_WORKER_API_KEY"),
    );

    const app = makeApp({ catalog });
    const res = await app.handle(
      invokeRequest({
        name: "secret_reader",
        inputs: {},
        context: {
          secrets: [{ key: "TEST_WORKER_API_KEY", value: "from-request" }],
        },
      }),
    );
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.output.value).toBe("from-request");
  });

  it("does not inject secrets not declared by the tool", async () => {
    process.env.TEST_WORKER_API_KEY = "should-not-leak";

    const catalog = new ToolCatalog();
    catalog.addTool(
      "no_secrets",
      {
        description: "No secrets declared",
        parameters: z.object({}),
      },
      async (_args, ctx) => {
        try {
          return ctx.getSecret("TEST_WORKER_API_KEY");
        } catch {
          return "no-secret";
        }
      },
    );

    const app = makeApp({ catalog });
    const res = await app.handle(
      invokeRequest({ name: "no_secrets", inputs: {} }),
    );
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.output.value).toBe("no-secret");
  });

  it("returns validation error for invalid inputs", async () => {
    const app = makeApp();
    const res = await app.handle(
      invokeRequest({ name: "echo", inputs: { message: 42 } }),
    );
    const body = await res.json();

    expect(body.success).toBe(false);
  });

  it("response shape matches ToolCallResponse", async () => {
    const app = makeApp();
    const res = await app.handle(
      invokeRequest({ name: "echo", inputs: { message: "test" } }),
    );
    const body = await res.json();

    expect(body).toHaveProperty("executionId");
    expect(body).toHaveProperty("duration");
    expect(body).toHaveProperty("finishedAt");
    expect(body).toHaveProperty("success");
    expect(body).toHaveProperty("output");
    expect(typeof body.executionId).toBe("string");
    expect(typeof body.duration).toBe("number");
    expect(typeof body.finishedAt).toBe("string");
  });
});
