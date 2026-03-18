# Auto-Discover Example

Demonstrates the CLI auto-discovery feature. Run from this directory:

```bash
# With Bun (handles .ts natively)
bun ../../dist/cli.js

# With Node.js (needs tsx for .ts files)
npx tsx ../../dist/cli.js

# HTTP mode
bun ../../dist/cli.js --http --port 3000

# After npm install / npx
npx @arcadeai/arcade-mcp
npx @arcadeai/arcade-mcp --http
```

## Tool files

- `math.tools.ts` - discovered via `*.tools.ts` pattern
- `tools/greet.ts` - discovered via `tools/` directory pattern
