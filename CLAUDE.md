# CLAUDE.md — arcade-mcp-ts

TypeScript port of the Python `arcade-mcp` framework. Wraps `@modelcontextprotocol/sdk` to add secret injection, OAuth auth providers, multi-user support, worker routes, and middleware.

## Quick Reference

- **Runtime**: Bun (primary), Node.js (compatible). No `Bun.*` APIs in `src/`.
- **Package manager**: `bun`
- **Test runner**: `bun test` (vitest)
- **Linter/formatter**: `bunx biome check --write .`
- **Type check**: `bunx tsc --noEmit`
- **Build**: `bun run build`

## Architecture

- **`src/mcp-app.ts`** — `MCPApp` high-level builder API (entry point for users)
- **`src/server.ts`** — `ArcadeMCPServer` wrapping SDK's `McpServer`
- **`src/context.ts`** — `Context` with namespaced facades (log, progress, sampling, ui, etc.)
- **`src/catalog.ts`** — `ToolCatalog` + `MaterializedTool` storage
- **`src/executor.ts`** — Tool execution pipeline (Zod validation, context injection, error handling)
- **`src/errors.ts`** — Error hierarchy (`ToolkitError`, `RetryableToolError`, etc.)
- **`src/settings.ts`** — Env-based settings, auto-captures non-prefixed env vars as tool secrets
- **`src/auth/`** — `ToolAuthorization` type + 20+ OAuth provider factory functions
- **`src/middleware/`** — Composable middleware with method-specific hooks
- **`src/resource-server/`** — JWT Bearer token validation for multi-user HTTP auth
- **`src/worker/`** — Elysia routes for `/worker/v1/*` (Arcade Cloud integration)
- **`src/transports/`** — Stdio and HTTP (Elysia + StreamableHTTP) runners

## Conventions

- Use `@types/node` (not `@types/bun`) for type-checking — ensures Node.js compatibility
- Auth providers are factory functions, not classes: `auth.GitHub({ scopes: ["repo"] })`
- Tool handlers receive `(args, context: Context)` — Context wraps MCP SDK's `RequestHandlerExtra`
- Builder pattern for tool registration: `app.tool(name, opts, handler)`
- Secrets come from env vars, matched to tool's `secrets` array, injected into Context
- Middleware uses abstract class pattern with `onCallTool`, `onListTools`, etc.

## Python Reference

The Python source of truth lives at `../arcade-mcp`. Key files:
- `libs/arcade-mcp-server/arcade_mcp_server/mcp_app.py` — MCPApp API
- `libs/arcade-mcp-server/arcade_mcp_server/server.py` — Server core
- `libs/arcade-mcp-server/arcade_mcp_server/context.py` — Context facades
- `libs/arcade-core/arcade_core/errors.py` — Error hierarchy
- `libs/arcade-core/arcade_core/auth.py` — Auth providers
- `libs/arcade-mcp-server/arcade_mcp_server/middleware/base.py` — Middleware
- `libs/arcade-serve/arcade_serve/fastapi/worker.py` — Worker routes

See `PLAN.md` for the full implementation plan.
