# @arcadeai/arcade-mcp

TypeScript MCP framework with secret injection, OAuth auth providers, multi-user support, worker routes, and middleware. Wraps the official [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) — never forks or patches it.

## Quick Start

```bash
bun add @arcadeai/arcade-mcp
```

```typescript
import { MCPApp } from "@arcadeai/arcade-mcp";
import { z } from "zod";

const app = new MCPApp({
  name: "MyServer",
  version: "1.0.0",
  instructions: "A helpful tool server",
});

app.tool(
  "greet",
  {
    description: "Greet someone by name",
    parameters: z.object({
      name: z.string().describe("Name to greet"),
    }),
  },
  async (args) => `Hello, ${args.name}!`,
);

app.run(); // stdio by default
```

Run it:

```bash
bun run server.ts
```

Or over HTTP:

```typescript
app.run({ transport: "http", port: 8000 });
```

## CLI Auto-Discovery

Run an MCP server without writing a server file. The CLI auto-discovers tool modules in the current directory:

```bash
npx @arcadeai/arcade-mcp          # auto-discover tools, run stdio
npx @arcadeai/arcade-mcp --http   # auto-discover tools, run HTTP
```

Tool modules are discovered from:
- `*.tools.ts` / `*.tools.js` files (e.g., `math.tools.ts`)
- Any file inside a `tools/` directory (e.g., `tools/greet.ts`)

Each file should export tool definitions:

```typescript
// tools/greet.ts
import { z } from "zod";

export const greetTools = {
  greet: {
    options: {
      description: "Greet someone",
      parameters: z.object({ name: z.string() }),
    },
    handler: async (args) => `Hello, ${args.name}!`,
  },
};
```

CLI options:

| Flag | Default | Description |
|---|---|---|
| `--http` | — | Use HTTP transport (default: stdio) |
| `--host <addr>` | `127.0.0.1` | HTTP host |
| `--port <n>` | `8000` | HTTP port |
| `--name <name>` | directory name | App name |
| `--dir <path>` | cwd | Directory to scan |
| `--dev` | — | Auto-reload on file changes (HTTP only) |

> **Node.js + TypeScript**: Use `npx tsx arcade-mcp` or Bun to import `.ts` tool files directly.

### Dev Mode (Auto-Reload)

Watch source files and automatically restart the server on changes:

```bash
npx @arcadeai/arcade-mcp --http --dev
```

Or programmatically:

```typescript
app.run({ transport: "http", dev: true });
```

When a `.ts`, `.js`, `.mts`, or `.mjs` file changes, the server stops, re-imports tool modules with fresh copies, and restarts. Files in `node_modules/`, `dist/`, and hidden directories are ignored.

> **Note**: Dev mode only works with HTTP transport. Stdio sessions cannot be restarted.

You can also enable dev mode via the `ARCADE_SERVER_RELOAD=1` environment variable.

## Features

- **Builder API** — `app.tool(name, options, handler)` with method chaining
- **Secret injection** — env vars auto-captured and injected into tool context
- **OAuth auth providers** — 21 providers: GitHub, Google, Slack, Microsoft, Linear, Notion, etc.
- **Context object** — namespaced facades for logging, progress, sampling, resources, tools, UI
- **Middleware** — composable onion-model middleware with method-specific hooks
- **Multi-user HTTP auth** — JWT Bearer token validation via JWKS
- **Worker routes** — `/worker/tools`, `/worker/tools/invoke`, `/worker/health`
- **Error hierarchy** — structured errors with retry support, upstream error mapping
- **Prompts** — `app.prompt(name, options, handler)` with argument validation and runtime management
- **Resources** — `app.resource(uri, options, handler)` with MIME types and runtime management
- **Dev mode** — auto-reload on file changes with `--dev` flag (HTTP only)
- **Resumable streams** — optional event store for HTTP stream resumability via `Last-Event-ID`
- **Evals** — evaluate LLM tool-calling accuracy with critics, rubrics, and Hungarian-optimal matching
- **Dual transport** — stdio and HTTP (Elysia + StreamableHTTP)
- **Runtime compatible** — Bun and Node.js (no `Bun.*` APIs in library code)

## Tool Options

### Basic Tool

```typescript
app.tool(
  "echo",
  {
    description: "Echo a message",
    parameters: z.object({
      message: z.string(),
    }),
  },
  async (args) => args.message,
);
```

### Tool with OAuth

```typescript
import { auth } from "@arcadeai/arcade-mcp";

app.tool(
  "star_repo",
  {
    description: "Star a GitHub repository",
    parameters: z.object({
      owner: z.string(),
      repo: z.string(),
    }),
    auth: auth.GitHub({ scopes: ["repo"] }),
  },
  async (args, context) => {
    const token = context.getAuthToken();
    // ... use token to call GitHub API
    return { starred: true };
  },
);
```

### Tool with Secrets

```typescript
app.tool(
  "get_repo",
  {
    description: "Get repo info",
    parameters: z.object({ repo: z.string() }),
    secrets: ["GITHUB_TOKEN"],
  },
  async (args, context) => {
    const token = context.getSecret("GITHUB_TOKEN");
    // ... use token
  },
);
```

Any env var not prefixed with `MCP_` or `_` is available as a tool secret.

### Tool with Behavior Hints

Annotate tools with behavioral hints that map to MCP `ToolAnnotations`:

```typescript
app.tool(
  "delete_file",
  {
    description: "Delete a file from the workspace",
    parameters: z.object({ path: z.string() }),
    behavior: {
      readOnly: false,
      destructive: true,
      idempotent: true,
      openWorld: false,
    },
  },
  async (args) => {
    // ...
  },
);
```

These hints are exposed as `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint` in the MCP tool listing.

### Deprecated Tools

Mark tools as deprecated — the message is prepended to the description:

```typescript
app.tool(
  "old_search",
  {
    description: "Search for items",
    parameters: z.object({ query: z.string() }),
    deprecationMessage: "Use search_v2 instead",
  },
  async (args) => {
    // ...
  },
);
// Description seen by clients: "[DEPRECATED: Use search_v2 instead] Search for items"
```

### Tool Title

Provide a human-readable display name:

```typescript
app.tool(
  "gh_star",
  {
    description: "Star a GitHub repository",
    parameters: z.object({ repo: z.string() }),
    title: "Star Repository",
  },
  async (args) => {
    // ...
  },
);
```

### Toolkit Versioning

The app's `name`, `version`, and `title` are automatically attached to every tool as toolkit metadata. You can also override toolkit info per-tool:

```typescript
app.tool(
  "myTool",
  {
    description: "A tool with custom toolkit info",
    parameters: z.object({}),
    toolkit: { name: "my-toolkit", version: "1.2.0" },
  },
  async () => {},
);
```

Versions are normalized to semver — `"1"` becomes `"1.0.0"`, `"v1.2"` becomes `"1.2.0"`.

## Prompts

Register prompts with `app.prompt(name, options, handler?)`:

```typescript
app.prompt(
  "greeting",
  {
    description: "Generate a greeting",
    arguments: [{ name: "name", description: "Name to greet", required: true }],
  },
  (args) => ({
    messages: [
      {
        role: "user",
        content: { type: "text", text: `Please greet ${args.name} warmly.` },
      },
    ],
  }),
);
```

Options: `description?` and `arguments?` (array of `{ name, description?, required? }`). If no handler is provided, a default handler returns the description as a user message.

Runtime management (after `app.run()`):

```typescript
app.prompts.add("new-prompt", { description: "Added at runtime" }, handler);
app.prompts.remove("new-prompt");
app.prompts.list(); // returns registered prompt names
```

## Resources

Register resources with `app.resource(uri, options, handler?)`:

```typescript
app.resource(
  "config://app",
  { description: "Application configuration", mimeType: "application/json" },
  (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({ name: "EchoServer", version: "1.0.0" }),
      },
    ],
  }),
);
```

Options: `description?` and `mimeType?`. If no handler is provided, a default handler returns empty text content.

Runtime management (after `app.run()`):

```typescript
app.resources.add("data://users", { mimeType: "application/json" }, handler);
app.resources.remove("data://users");
app.resources.list(); // returns registered resource URIs
```

## Auth Providers

Factory functions for 21 OAuth2 providers:

```typescript
import { auth } from "@arcadeai/arcade-mcp";

auth.GitHub({ scopes: ["repo"] })
auth.Google({ scopes: ["https://www.googleapis.com/auth/calendar"] })
auth.Slack({ scopes: ["chat:write"], id: "my-slack" })
auth.Microsoft()
auth.Linear()
auth.Notion()
// ... Asana, Atlassian, Attio, ClickUp, Discord, Dropbox,
//     Figma, Hubspot, LinkedIn, PagerDuty, Reddit, Spotify,
//     Twitch, X, Zoom
```

## Arcade Cloud Auth (Local Development)

Tools with `auth` requirements automatically resolve OAuth tokens through [Arcade Cloud](https://arcade.dev). There are two ways to set up credentials:

### Option 1: Arcade CLI (recommended)

Install the Arcade CLI and sign in. This stores credentials in `~/.arcade/credentials.yaml` which the framework reads automatically:

```bash
pip install arcade-ai
arcade login
```

That's it — no environment variables needed. Run your server and tools will authenticate through your Arcade account:

```bash
bun run examples/github-tools/server.ts
```

### Option 2: Environment variables

Set `ARCADE_API_KEY` and `ARCADE_USER_ID` directly:

```bash
export ARCADE_API_KEY="your-arcade-api-key"
export ARCADE_USER_ID="your-user-id"
```

Environment variables take priority over the credentials file.

### How it works

When a tool with `auth` is called, the framework calls Arcade Cloud's authorization API:

1. **First call** — returns an authorization URL. Visit the URL in your browser to complete the OAuth flow.
2. **Retry the tool** — the token is now available and injected into `context.getAuthToken()`.

This is automatic — no code changes needed. The same tools work both locally (via Arcade Cloud auth) and deployed (via worker routes where Arcade Cloud injects tokens directly).

Set `ARCADE_AUTH_DISABLED=true` to skip auth resolution (useful for testing with mock tokens).

## Context

Tool handlers receive `(args, context)`. The context provides namespaced facades:

```typescript
app.tool("example", opts, async (args, context) => {
  // Secrets & auth
  context.getSecret("API_KEY");
  context.getAuthToken();
  context.getAuthTokenOrEmpty();

  // Logging
  context.log.info("Processing request");
  context.log.debug("Details", { extra: "data" });
  context.log.warning("Watch out");
  context.log.error("Something failed");

  // Progress
  await context.progress.report(50, 100, "Halfway done");

  // Notifications (deduplicated, flushed at end of request)
  await context.notifications.tools.listChanged();
  await context.notifications.resources.listChanged();
  await context.notifications.prompts.listChanged();

  // Metadata
  context.signal;      // AbortSignal
  context.sessionId;   // string | undefined
  context.requestId;   // string
  context.userId;      // string | undefined
});
```

## Middleware

Composable middleware with an onion model. Override any hook:

```typescript
import { Middleware, composeMiddleware } from "@arcadeai/arcade-mcp";

class RateLimitMiddleware extends Middleware {
  async onCallTool(context, next) {
    // before
    const result = await next(context);
    // after
    return result;
  }
}

const app = new MCPApp({
  name: "MyServer",
  version: "1.0.0",
  middleware: composeMiddleware(
    new RateLimitMiddleware(),
  ),
});
```

Available hooks: `onMessage`, `onRequest`, `onCallTool`, `onListTools`, `onReadResource`, `onListResources`, `onListResourceTemplates`, `onGetPrompt`, `onListPrompts`.

Built-in middleware (enabled by default):

- **ErrorHandlingMiddleware** — catches errors, returns structured MCP error responses
- **LoggingMiddleware** — logs request/response timing (set `MCP_LOG_FORMAT=pretty` for colored terminal output instead of JSON)

## Multi-User HTTP Auth

Validate JWT Bearer tokens against JWKS endpoints:

```typescript
import { MCPApp, JWTResourceServerValidator } from "@arcadeai/arcade-mcp";

const app = new MCPApp({
  name: "MyServer",
  version: "1.0.0",
  auth: new JWTResourceServerValidator({
    canonicalUrl: "https://mcp.example.com/mcp",
    authorizationServers: [{
      authorizationServerUrl: "https://auth.example.com",
      issuer: "https://auth.example.com",
      jwksUri: "https://auth.example.com/.well-known/jwks.json",
      algorithm: "RS256",
      expectedAudiences: ["my-client-id"],
    }],
  }),
});

app.run({ transport: "http", port: 8000 });
```

Supports RFC 9728 OAuth Protected Resource Metadata discovery. When `canonicalUrl` has a non-root path (e.g. `https://example.com/mcp`), both `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp` are registered for backward compatibility. Responses include CORS headers.

## Resumable Streams

Enable HTTP stream resumability so disconnected clients can resume from where they left off using the `Last-Event-ID` header:

```typescript
import { MCPApp, InMemoryEventStore } from "@arcadeai/arcade-mcp";

const app = new MCPApp({ name: "MyServer", version: "1.0.0" });

app.run({
  transport: "http",
  eventStore: new InMemoryEventStore(),
});
```

The `InMemoryEventStore` is suitable for single-process deployments. For distributed systems, implement the `EventStore` interface with a persistent backend:

```typescript
import type { EventStore, EventId, StreamId } from "@arcadeai/arcade-mcp";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

class RedisEventStore implements EventStore {
  async storeEvent(streamId: StreamId, message: JSONRPCMessage): Promise<EventId> {
    // Store in Redis...
  }
  async replayEventsAfter(
    lastEventId: EventId,
    { send }: { send: (eventId: EventId, message: JSONRPCMessage) => Promise<void> },
  ): Promise<StreamId> {
    // Replay from Redis...
  }
}
```

## Session Management

The HTTP transport uses an `HTTPSessionManager` that supports stateful (default) and stateless modes, TTL-based session eviction, and max session caps:

```typescript
app.run({
  transport: "http",
  stateless: false,       // true = fresh transport per request, no session reuse
  sessionTtlMs: 300_000,  // evict idle sessions after 5 minutes
  maxSessions: 100,       // reject new sessions with 503 when at capacity
});
```

In **stateful mode** (default), sessions are reused via the `mcp-session-id` header. Invalid session IDs receive a 400 response.

In **stateless mode**, every request gets a fresh transport and server — no sessions are tracked.

You can also use `HTTPSessionManager` directly for more control:

```typescript
import { HTTPSessionManager } from "@arcadeai/arcade-mcp";

const manager = new HTTPSessionManager({
  server: arcadeMcpServer,
  sessionTtlMs: 60_000,
  maxSessions: 50,
});

// In your HTTP handler:
const response = await manager.handleRequest(request, { authInfo });

// Graceful shutdown:
await manager.close();
```

## Worker Routes

When `ARCADE_WORKER_SECRET` is set, expose tool execution endpoints for Arcade Cloud integration:

```typescript
import { createWorkerRoutes } from "@arcadeai/arcade-mcp";

const workerApp = createWorkerRoutes({
  catalog: app.catalog,
  secret: process.env.ARCADE_WORKER_SECRET,
});
```

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/worker/tools` | GET | Bearer | List available tools (bare array) |
| `/worker/tools/invoke` | POST | Bearer | Execute a tool |
| `/worker/health` | GET | None | Health check |

The worker wire format matches the Python `arcade-mcp` framework exactly:

- **`GET /worker/tools`** returns a bare JSON array of tool definitions (not wrapped in `{ tools: [...] }`), using `input.parameters` with `value_schema` (not JSON Schema `inputSchema`), `fully_qualified_name`, `requirements`, and `output` fields.
- **`POST /worker/tools/invoke`** accepts `{ tool: { name, toolkit, version }, inputs, context: { user_id, authorization, secrets, metadata }, run_id, execution_id, created_at }`.
- **Responses** use `snake_case` field names (`execution_id`, `finished_at`) and structured `output: { value, error: { message, kind, can_retry, ... }, requires_authorization }`.
- **Tool name separator** defaults to `.` (e.g., `MyToolkit.echo`), configurable via `ARCADE_TOOL_NAME_SEPARATOR`.

## Error Handling

Structured error hierarchy for tool execution:

```typescript
import {
  RetryableToolError,
  FatalToolError,
  UpstreamError,
  ContextRequiredToolError,
} from "@arcadeai/arcade-mcp";

// Retryable error (LLM will retry)
throw new RetryableToolError("Rate limited, try again", {
  retryAfterMs: 5000,
  additionalPromptContent: "Wait a moment before retrying",
});

// Fatal error (no retry)
throw new FatalToolError("API key is invalid");

// Upstream service error (auto-maps status codes)
throw new UpstreamError("GitHub API failed", { statusCode: 503 });

// Needs more context from the user
throw new ContextRequiredToolError("Missing info", {
  additionalPromptContent: "Please specify the repository owner",
});
```

## Telemetry (OpenTelemetry)

Built-in OpenTelemetry support for traces and metrics, exported via OTLP HTTP.

Enable with an environment variable:

```bash
ARCADE_MCP_OTEL_ENABLE=true \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
bun run server.ts
```

When enabled, the framework automatically:

- Creates `RunTool` spans around every MCP tool execution (with `tool_name`, `toolkit_name`, `environment` attributes)
- Creates `CallTool` and `Catalog` spans in worker routes
- Increments a `tool_call` counter metric per tool invocation
- Exports traces and metrics via OTLP HTTP to the configured endpoint

OTLP endpoint, headers, and protocol are configured via standard `OTEL_EXPORTER_OTLP_*` env vars.

| Variable | Default | Description |
|---|---|---|
| `ARCADE_MCP_OTEL_ENABLE` | `false` | Enable OpenTelemetry |
| `OTEL_SERVICE_NAME` | `arcade-mcp-worker` | Service name in traces |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | OTLP collector endpoint |
| `ARCADE_ENVIRONMENT` | `dev` | Deployment environment name |

You can also use the `OTELHandler` directly for custom integration:

```typescript
import { OTELHandler } from "@arcadeai/arcade-mcp";

const telemetry = new OTELHandler({
  enable: true,
  serviceName: "my-service",
  environment: "production",
});
telemetry.initialize();
// ... use telemetry.getTracer(), telemetry.getMeter()
await telemetry.shutdown();
```

## Evals

Evaluate how well LLMs use your tools. Define expected tool calls and score the results with critics.

```typescript
import { EvalSuite, BinaryCritic, NumericCritic, SimilarityCritic } from "@arcadeai/arcade-mcp";
```

### Basic Eval

```typescript
const suite = new EvalSuite({
  name: "My Tool Eval",
  systemMessage: "You are a helpful assistant.",
  rubric: { failThreshold: 0.85, warnThreshold: 0.95 },
});

// Register tools (MCP-style definitions)
suite.addToolDefinitions([
  {
    name: "greet",
    description: "Greet someone by name",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
]);

// Add test cases
suite.addCase({
  name: "Greet Alice",
  userMessage: "Say hello to Alice",
  expectedToolCalls: [{ toolName: "greet", args: { name: "Alice" } }],
  critics: [new BinaryCritic({ field: "name" })],
});

// Run against an LLM
import Anthropic from "@anthropic-ai/sdk";

const results = await suite.run({
  client: new Anthropic(),
  model: "claude-sonnet-4-20250514",
  provider: "anthropic",
});

for (const c of results.cases) {
  console.log(`${c.evaluation.passed ? "PASS" : "FAIL"} ${c.name} (${c.evaluation.score})`);
}
```

OpenAI works too — pass an `OpenAI` client and the provider is auto-detected.

### Using a ToolCatalog

If you already have tools registered in an `MCPApp` or `ToolCatalog`, add them directly:

```typescript
suite.addFromCatalog(app.catalog);
```

### Critics

Critics score individual arguments of a tool call:

| Critic | Use case | Key options |
|---|---|---|
| `BinaryCritic` | Exact equality (with type coercion) | `field`, `weight?` |
| `NumericCritic` | Fuzzy numeric range matching | `field`, `valueRange`, `matchThreshold?`, `weight?` |
| `SimilarityCritic` | Word-frequency cosine similarity | `field`, `similarityThreshold?`, `weight?` |

```typescript
// Exact match
new BinaryCritic({ field: "city" })

// Numeric within range [1, 7], match if similarity >= 0.9
new NumericCritic({ field: "days", valueRange: [1, 7], matchThreshold: 0.9 })

// String similarity >= 0.75
new SimilarityCritic({ field: "description", similarityThreshold: 0.75 })
```

### Rubric

The `EvalRubric` controls pass/fail/warning thresholds:

| Option | Default | Description |
|---|---|---|
| `failThreshold` | `0.8` | Minimum score to pass |
| `warnThreshold` | `0.9` | Score below this triggers a warning |
| `failOnToolSelection` | `true` | Immediately fail if wrong tool is called |
| `failOnToolCallQuantity` | `true` | Immediately fail if wrong number of calls |
| `toolSelectionWeight` | `1.0` | Weight for tool name matching |

### Running Evals

```bash
# With Anthropic
ANTHROPIC_API_KEY=sk-ant-... bun run examples/evals/echo-eval.ts

# With OpenAI
OPENAI_API_KEY=sk-... bun run examples/evals/echo-eval.ts
```

See `examples/evals/` for complete examples.

## Examples

The `examples/` directory contains runnable servers demonstrating different features. Run any example with:

```bash
bun run examples/echo/server.ts
```

## Configuration

All settings load from environment variables:

| Variable | Default | Description |
|---|---|---|
| `MCP_SERVER_NAME` | `ArcadeMCP` | Server name |
| `MCP_SERVER_VERSION` | `0.1.0` | Server version |
| `MCP_SERVER_INSTRUCTIONS` | — | Server instructions |
| `MCP_MIDDLEWARE_ENABLE_LOGGING` | `true` | Enable logging middleware |
| `MCP_MIDDLEWARE_LOG_LEVEL` | `INFO` | Log level |
| `MCP_LOG_FORMAT` | `json` | Log format: `json` (structured) or `pretty` (colored, human-readable) |
| `MCP_MIDDLEWARE_MASK_ERROR_DETAILS` | `false` | Hide error details from clients |
| `ARCADE_MCP_OTEL_ENABLE` | `false` | Enable OpenTelemetry telemetry |
| `OTEL_SERVICE_NAME` | `arcade-mcp-worker` | OTEL service name |
| `ARCADE_WORKER_SECRET` | — | Bearer token for worker routes |
| `ARCADE_API_KEY` | — | Arcade API key |
| `ARCADE_API_URL` | `https://api.arcade.dev` | Arcade API URL |
| `ARCADE_USER_ID` | — | Default user ID |
| `ARCADE_TOOL_NAME_SEPARATOR` | `.` | Separator between toolkit and tool name in FQN |

See [`.env.example`](.env.example) for the full list.

## License

MIT
