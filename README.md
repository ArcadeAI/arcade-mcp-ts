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
- **LoggingMiddleware** — logs request/response timing

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

Supports RFC 9728 OAuth Protected Resource Metadata discovery.

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
| `/worker/tools` | GET | Bearer | List available tools |
| `/worker/tools/invoke` | POST | Bearer | Execute a tool |
| `/worker/health` | GET | None | Health check |

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
| `MCP_MIDDLEWARE_MASK_ERROR_DETAILS` | `false` | Hide error details from clients |
| `ARCADE_MCP_OTEL_ENABLE` | `false` | Enable OpenTelemetry telemetry |
| `OTEL_SERVICE_NAME` | `arcade-mcp-worker` | OTEL service name |
| `ARCADE_WORKER_SECRET` | — | Bearer token for worker routes |
| `ARCADE_API_KEY` | — | Arcade API key |
| `ARCADE_API_URL` | `https://api.arcade.dev` | Arcade API URL |
| `ARCADE_USER_ID` | — | Default user ID |

See [`.env.example`](.env.example) for the full list.

## License

MIT
