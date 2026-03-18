# arcade-mcp-ts Implementation Plan

## Context

The Python `arcade-mcp` framework (at `../arcade-mcp`) provides a high-level abstraction over the MCP protocol for building secure tool servers with secret injection, OAuth auth providers, multi-user support, worker routes, and middleware. This plan ports that framework to TypeScript, wrapping the official `@modelcontextprotocol/sdk` rather than forking it. The goal is feature parity with the Python version using idiomatic TypeScript patterns.

**Runtime**: Bun for development/testing, but all library code uses only Node.js-compatible APIs (no `Bun.*` imports in `src/`). Ship as ESM with CJS compatibility. This ensures consumers can use Bun, Node.js, or any compatible runtime.

---

## Package Structure

Single package to start (`arcade-mcp`), split later if needed.

```
arcade-mcp-ts/
├── package.json              # type: "module", exports map for ESM+CJS
├── tsconfig.json             # target: ES2022, module: NodeNext
├── biome.json
├── .env.example
├── src/
│   ├── index.ts              # Public barrel export
│   ├── mcp-app.ts            # MCPApp — high-level builder API
│   ├── server.ts             # ArcadeMCPServer wrapping SDK's McpServer
│   ├── context.ts            # Context with namespaced facades
│   ├── catalog.ts            # ToolCatalog + MaterializedTool
│   ├── executor.ts           # Tool execution pipeline
│   ├── errors.ts             # Error hierarchy
│   ├── settings.ts           # Env-based settings
│   ├── types.ts              # Shared interfaces
│   ├── auth/
│   │   ├── index.ts
│   │   ├── types.ts          # ToolAuthorization interface
│   │   └── providers.ts      # GitHub, Google, Slack, etc. factory fns
│   ├── middleware/
│   │   ├── index.ts
│   │   ├── base.ts           # Abstract Middleware + compose()
│   │   ├── error-handling.ts
│   │   └── logging.ts
│   ├── resource-server/
│   │   ├── index.ts
│   │   ├── types.ts          # ResourceOwner, AuthorizationServerEntry
│   │   ├── validator.ts      # Abstract ResourceServerValidator
│   │   └── jwt-validator.ts  # JWT validation via jose
│   ├── worker/
│   │   ├── index.ts
│   │   └── routes.ts         # Elysia routes for /worker/v1/*
│   └── transports/
│       ├── index.ts
│       ├── stdio.ts          # Stdio runner
│       └── http.ts           # HTTP runner (Elysia + StreamableHTTP)
├── tests/                    # Mirrors src/ structure
│   ├── mcp-app.test.ts
│   ├── context.test.ts
│   ├── catalog.test.ts
│   ├── executor.test.ts
│   ├── middleware/
│   ├── resource-server/
│   ├── worker/
│   └── integration/
│       ├── stdio.test.ts
│       └── http.test.ts
└── examples/
    ├── echo/server.ts
    └── github-tools/server.ts
```

## Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.27.1",
    "zod": "^3.23.0",
    "jose": "^5.0.0",
    "elysia": "^1.2.0",
    "pino": "^9.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "@types/node": "^22.0.0",
    "vitest": "^2.0.0",
    "@biomejs/biome": "^1.9.0",
    "dotenv": "^16.0.0"
  }
}
```

- **elysia**: Bun-native web framework, excellent DX, type-safe, also runs on Node.js via adapter
- **jose**: Pure JS JWT library, no native bindings, works everywhere
- **pino**: Fast structured logging, stderr-friendly for stdio mode
- **zod**: Already required by MCP SDK
- **dotenv**: Dev dependency only (Bun loads .env natively; Node users import it)
- **@types/node**: Used for type-checking (not @types/bun) — ensures library code only uses Node.js-compatible APIs that Bun also implements

---

## Public API Design

### MCPApp — Builder Pattern

TypeScript decorators (TC39 stage 3) can't decorate standalone functions, so we use a builder pattern that mirrors `McpServer.registerTool()`:

```typescript
import { MCPApp, Context, auth } from "arcade-mcp";
import { z } from "zod";

const app = new MCPApp({
  name: "MyServer",
  version: "1.0.0",
  instructions: "A helpful server",
});

// Simple tool
app.tool("echo", {
  description: "Echo a message",
  parameters: z.object({
    message: z.string().describe("Message to echo"),
  }),
}, async (args, context) => {
  return args.message;
});

// Tool with auth + secrets
app.tool("star_repo", {
  description: "Star a GitHub repo",
  parameters: z.object({ owner: z.string(), repo: z.string() }),
  auth: auth.GitHub({ scopes: ["repo"] }),
  secrets: ["GITHUB_BACKUP_TOKEN"],
}, async (args, context) => {
  const token = context.getAuthToken();
  const backup = context.getSecret("GITHUB_BACKUP_TOKEN");
  // ... call GitHub API
  return { starred: true };
});

app.run(); // stdio by default
app.run({ transport: "http", port: 8000 }); // or HTTP
```

### Auth Providers — Factory Functions

```typescript
// Simple factory functions, not classes
export function GitHub(opts?: { id?: string; scopes?: string[] }): ToolAuthorization {
  return { providerId: "github", providerType: "oauth2", ...opts };
}
// 20+ providers: Google, Slack, Microsoft, Linear, Notion, etc.
```

### Context

Tool handlers receive `(args, context: Context)` instead of the SDK's `(args, extra)`. Context wraps the MCP session and adds Arcade features:

```typescript
class Context {
  // Namespaced facades (mirrors Python exactly)
  readonly log: Logs;           // .info(), .debug(), .warning(), .error()
  readonly progress: Progress;  // .report(progress, total, message)
  readonly resources: Resources; // .read(), .list()
  readonly tools: Tools;        // .call(name, params)
  readonly sampling: Sampling;  // .createMessage(messages, ...)
  readonly ui: UI;              // .elicit(message, schema)

  // Arcade-specific
  getSecret(name: string): string;      // throws if missing
  getAuthToken(): string;               // throws if missing
  getAuthTokenOrEmpty(): string;        // returns "" if missing

  // From MCP session
  readonly signal: AbortSignal;
  readonly sessionId?: string;
  readonly requestId: string;
}
```

### Resource Server Auth (Multi-User HTTP)

```typescript
import { MCPApp, JWTResourceServerValidator } from "arcade-mcp";

const app = new MCPApp({
  name: "MyServer",
  version: "1.0.0",
  auth: new JWTResourceServerValidator({
    canonicalUrl: "https://mcp.example.com/mcp",
    authorizationServers: [{
      url: "https://auth.example.com",
      issuer: "https://auth.example.com",
      jwksUri: "https://auth.example.com/.well-known/jwks.json",
      algorithm: "RS256",
      expectedAudiences: ["my-client-id"],
    }],
  }),
});
```

### Middleware

```typescript
import { Middleware, composeMiddleware } from "arcade-mcp";

class RateLimitMiddleware extends Middleware {
  async onCallTool(ctx, next) {
    // before
    const result = await next(ctx);
    // after
    return result;
  }
}

const app = new MCPApp({
  name: "MyServer",
  version: "1.0.0",
  middleware: composeMiddleware(
    new LoggingMiddleware(),
    new RateLimitMiddleware(),
  ),
});
```

### Worker Routes

Enabled when `ARCADE_WORKER_SECRET` env var is set. Exposes:
- `GET /worker/v1/tools` — list available tools
- `POST /worker/v1/tools/call` — execute a tool (with user_id in body)
- `GET /worker/v1/metadata` — server metadata

---

## SDK Wrapping Strategy

| SDK Component | Strategy | Notes |
|---|---|---|
| `McpServer` | **Wrap** | `ArcadeMCPServer` owns a private `McpServer`, intercepts tool registration to add context/middleware |
| `StdioServerTransport` | **Use directly** | No changes needed |
| `StreamableHTTPServerTransport` | **Use directly** | Embedded in Elysia HTTP handler |
| `RequestHandlerExtra` | **Read from** | Extract signal, authInfo, sessionId → build Context |
| Zod tool schemas | **Use directly** | Users write Zod schemas as they would with raw SDK |
| Tool callbacks | **Wrap** | Intercept `(args, extra)` → inject `(args, context: Context)` |

We never fork or patch the SDK. Automatic protocol/transport updates for free.

---

## Implementation Phases

### Phase 1: Foundation
- Project scaffold (package.json, tsconfig, biome, vitest)
- `src/types.ts` — shared interfaces (MaterializedTool, ToolDefinition, ToolOptions)
- `src/errors.ts` — full error hierarchy (ErrorKind enum, ToolkitError, RetryableToolError, etc.)
- `src/auth/` — ToolAuthorization type + all 20+ provider factory functions
- `src/settings.ts` — load settings from env vars, auto-capture non-prefixed vars as tool secrets
- `src/catalog.ts` — ToolCatalog storing MaterializedTool objects

### Phase 2: Core Server
- `src/context.ts` — Context class with all namespaced facades
- `src/executor.ts` — Tool execution: Zod validation, context building, secret injection, error handling
- `src/server.ts` — ArcadeMCPServer wrapping McpServer
- `src/middleware/` — Middleware abstract class, compose(), ErrorHandlingMiddleware, LoggingMiddleware

### Phase 3: MCPApp + Transports
- `src/mcp-app.ts` — MCPApp builder API with `app.tool()`, `app.resource()`, `app.prompt()`, `app.run()`
- `src/transports/stdio.ts` — Stdio runner
- `src/transports/http.ts` — Elysia server + StreamableHTTPServerTransport
- `src/index.ts` — public barrel exports
- `examples/echo/server.ts` — first working example

### Phase 4: Auth + Worker
- `src/resource-server/` — JWTResourceServerValidator using jose, HTTP middleware for Bearer validation
- `src/worker/routes.ts` — Elysia routes for `/worker/v1/*` with ARCADE_WORKER_SECRET auth
- Runtime tool management: `app.tools.add()`, `.update()`, `.remove()`

### Phase 5: Tests + Polish
- Unit tests for each module
- Integration tests: stdio end-to-end, HTTP end-to-end
- Worker route tests using Elysia test client
- JWT validation tests with jose-generated tokens

---

## Python → TypeScript Mapping

| Python | TypeScript |
|---|---|
| `@app.tool` decorator | `app.tool(name, opts, handler)` builder |
| `@tool(requires_auth=GitHub(scopes=[...]))` | `{ auth: auth.GitHub({ scopes: [...] }) }` |
| `@tool(requires_secrets=["KEY"])` | `{ secrets: ["KEY"] }` |
| `Context` with facades | Same: `context.log.info()`, `context.sampling.createMessage()` |
| `context.get_secret("KEY")` | `context.getSecret("KEY")` |
| `context.get_auth_token_or_empty()` | `context.getAuthTokenOrEmpty()` |
| `ToolCatalog` / `MaterializedTool` | Same classes |
| `MCPSettings` (Pydantic) | `MCPSettings` interface + `loadSettings()` |
| `Middleware` with `on_call_tool` | Same abstract class pattern |
| `compose_middleware()` | `composeMiddleware()` |
| `ResourceServerValidator` (ABC) | Abstract class |
| `JWKSValidator` (PyJWT) | `JWTResourceServerValidator` (jose) |
| `FastAPIWorker` routes | Elysia routes at `/worker/v1/*` |
| Auth providers (classes) | Factory functions: `auth.GitHub()` |
| `ErrorKind` enum + exceptions | Same enum + Error subclasses |
| `add_tools_from_module()` | `app.addToolsFrom(module)` |

---

## Key Python Reference Files

- `libs/arcade-mcp-server/arcade_mcp_server/mcp_app.py` — MCPApp API design
- `libs/arcade-mcp-server/arcade_mcp_server/server.py` — Server orchestration, tool execution, auth flow
- `libs/arcade-mcp-server/arcade_mcp_server/context.py` — Context facades
- `libs/arcade-core/arcade_core/errors.py` — Error hierarchy
- `libs/arcade-core/arcade_core/auth.py` — Auth provider definitions
- `libs/arcade-mcp-server/arcade_mcp_server/middleware/base.py` — Middleware pattern
- `libs/arcade-mcp-server/arcade_mcp_server/resource_server/` — JWT validation
- `libs/arcade-serve/arcade_serve/fastapi/worker.py` — Worker routes

## Verification

1. **Unit tests**: `bun test` (vitest) — all modules
2. **Stdio integration**: Start echo server via stdio, connect MCP client, call tools, verify responses
3. **HTTP integration**: Start server on port, POST MCP messages, verify streaming responses
4. **Worker routes**: `curl -H "Authorization: Bearer $SECRET" localhost:8000/worker/v1/tools`
5. **Secret injection**: Define tool with `secrets: ["TEST_KEY"]`, set env var, verify `context.getSecret()` returns it
6. **Auth flow**: Define tool with `auth: auth.GitHub(...)`, verify auth requirement in tool listing
7. **Node.js compat**: Run `npx tsx examples/echo/server.ts` to verify no Bun-specific code leaks
