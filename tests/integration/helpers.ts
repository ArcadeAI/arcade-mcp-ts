import { type ChildProcess, spawn } from "node:child_process";
import { resolve } from "node:path";

/**
 * Poll an HTTP endpoint until the server responds (any status).
 */
export async function waitForServer(
  url: string,
  timeoutMs = 10_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`Server did not start within ${timeoutMs}ms`);
}

/** Return a random port in 10000–14999 to avoid collisions. */
export function randomPort(): number {
  return 10_000 + Math.floor(Math.random() * 5000);
}

/** Resolve an example server path relative to the repo root. */
export function examplePath(example: string): string {
  return resolve(import.meta.dirname, `../../examples/${example}/server.ts`);
}

/** Build the command + args to run a .ts file under a given runtime. */
export function runtimeCommand(
  runtime: "bun" | "node",
  serverPath: string,
): { command: string; args: string[] } {
  if (runtime === "bun") {
    return { command: "bun", args: ["run", serverPath] };
  }
  return { command: "npx", args: ["tsx", serverPath] };
}

/** Spawn an HTTP server and wait for it to be ready. Returns the process and port. */
export async function startHttpServer(
  runtime: "bun" | "node",
  serverPath: string,
  port: number,
  extraEnv?: Record<string, string>,
): Promise<ChildProcess> {
  const { command, args } = runtimeCommand(runtime, serverPath);
  const proc = spawn(command, args, {
    env: {
      ...process.env,
      ARCADE_SERVER_TRANSPORT: "http",
      ARCADE_SERVER_PORT: String(port),
      ...extraEnv,
    },
    stdio: "pipe",
  });
  await waitForServer(`http://127.0.0.1:${port}/mcp`);
  return proc;
}
