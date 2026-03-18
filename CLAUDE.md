# CLAUDE.md — @arcadeai/arcade-mcp

TypeScript port of the Python `arcade-mcp` framework, published as `@arcadeai/arcade-mcp`. Wraps `@modelcontextprotocol/sdk` to add secret injection, OAuth auth providers, multi-user support, worker routes, and middleware.

## Quick Reference

- **Runtime**: Bun (primary), Node.js (compatible). No `Bun.*` APIs in `src/`.
- **Package manager**: `bun`
- **Test runner**: `bun test` (vitest)
- **Linter/formatter**: `bunx biome check --write .`
- **Type check**: `bunx tsc --noEmit`
- **Build**: `bun run build`

## Architecture

- **`src/cli.ts`** — CLI entry point with auto-discovery (`npx @arcadeai/arcade-mcp`)
- **`src/mcp-app.ts`** — `MCPApp` high-level builder API (entry point for users)
- **`src/server.ts`** — `ArcadeMCPServer` wrapping SDK's `McpServer`
- **`src/context.ts`** — `Context` with namespaced facades (log, progress, sampling, ui, etc.)
- **`src/logger.ts`** — Shared `createLogger()` factory with JSON/pretty format support (`MCP_LOG_FORMAT`)
- **`src/catalog.ts`** — `ToolCatalog` + `MaterializedTool` storage
- **`src/executor.ts`** — Tool execution pipeline (Zod validation, context injection, error handling)
- **`src/errors.ts`** — Tool-level error hierarchy (`ToolkitError`, `RetryableToolError`, etc.)
- **`src/exceptions.ts`** — MCP-level exception hierarchy (`MCPError`, `ServerError`, `TransportError`, etc.)
- **`src/event-store.ts`** — `EventStore` interface re-export + `InMemoryEventStore` for stream resumability
- **`src/settings.ts`** — Env-based settings, auto-captures non-prefixed env vars as tool secrets
- **`src/telemetry.ts`** — `OTELHandler` for OpenTelemetry traces + metrics via OTLP HTTP
- **`src/auth/`** — `ToolAuthorization` type + 20+ OAuth provider factory functions
- **`src/middleware/`** — Composable middleware with method-specific hooks
- **`src/resource-server/`** — JWT Bearer token validation for multi-user HTTP auth
- **`src/worker/`** — Elysia routes for `/worker/v1/*` (Arcade Cloud integration)
- **`src/transports/`** — Stdio and HTTP (Elysia + StreamableHTTP) runners, dev-mode file watcher + auto-reload

## Conventions

- Use `@types/node` (not `@types/bun`) for type-checking — ensures Node.js compatibility
- Auth providers are factory functions, not classes: `auth.GitHub({ scopes: ["repo"] })`
- Tool handlers receive `(args, context: Context)` — Context wraps MCP SDK's `RequestHandlerExtra`
- Builder pattern for tool registration: `app.tool(name, opts, handler)`
- Secrets come from env vars, matched to tool's `secrets` array, injected into Context
- Middleware uses abstract class pattern with `onCallTool`, `onListTools`, etc.
- Never throw generic `Error` — always use a specific error class from `src/errors.ts` (tool errors) or `src/exceptions.ts` (MCP errors)
- New major features or API additions should include an example under `examples/`

## Post-Change Checklist

After any new feature, bug fix, refactor, or other code change:

- **Tests** — Add or update tests for any new or changed functionality. Unit tests go in `tests/`, integration tests in `tests/integration/`. Use vitest with `describe`/`it`/`expect` patterns. Use `vi.fn()` and `vi.spyOn()` for mocking.
- **Lint/format** — Run `bunx biome check --write .` before committing
- **README.md** — Check if the README needs updating (new features, changed APIs, new config options, updated examples)
- **CLAUDE.md** — Check if this file needs updating (new architecture components, changed conventions, new commands)
- **package.json `version`** — Bump the version for any code or documentation change (semver: patch for fixes/docs, minor for features, major for breaking changes)

## Python Reference

The Python source of truth lives at `../arcade-mcp`. Key files:
- `libs/arcade-mcp-server/arcade_mcp_server/mcp_app.py` — MCPApp API
- `libs/arcade-mcp-server/arcade_mcp_server/server.py` — Server core
- `libs/arcade-mcp-server/arcade_mcp_server/context.py` — Context facades
- `libs/arcade-core/arcade_core/errors.py` — Error hierarchy
- `libs/arcade-core/arcade_core/auth.py` — Auth providers
- `libs/arcade-mcp-server/arcade_mcp_server/middleware/base.py` — Middleware
- `libs/arcade-serve/arcade_serve/fastapi/worker.py` — Worker routes
- `libs/arcade-serve/arcade_serve/fastapi/telemetry.py` — OpenTelemetry handler
