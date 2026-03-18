#!/usr/bin/env node

import { readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MCPApp } from "./mcp-app.js";

/** Parsed CLI arguments. */
export interface CLIArgs {
	transport: "stdio" | "http";
	host: string;
	port: number;
	name: string;
	dir: string;
	help: boolean;
	version: boolean;
}

/** Parse process.argv into CLIArgs. */
export function parseArgs(argv: string[]): CLIArgs {
	const args: CLIArgs = {
		transport: "stdio",
		host: "127.0.0.1",
		port: 8000,
		name: basename(process.cwd()),
		dir: process.cwd(),
		help: false,
		version: false,
	};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		switch (arg) {
			case "--http":
				args.transport = "http";
				break;
			case "--host":
				args.host = argv[++i] ?? args.host;
				break;
			case "--port":
				args.port = Number.parseInt(argv[++i] ?? "8000", 10);
				break;
			case "--name":
				args.name = argv[++i] ?? args.name;
				break;
			case "--dir":
				args.dir = resolve(argv[++i] ?? ".");
				break;
			case "--help":
			case "-h":
				args.help = true;
				break;
			case "--version":
			case "-v":
				args.version = true;
				break;
		}
	}

	return args;
}

/**
 * Check if a value looks like a tool export: `{ options: { description, parameters }, handler }`.
 */
export function isToolExport(value: unknown): boolean {
	if (typeof value !== "object" || value === null) return false;
	const obj = value as Record<string, unknown>;
	if (typeof obj.handler !== "function") return false;
	if (typeof obj.options !== "object" || obj.options === null) return false;
	const opts = obj.options as Record<string, unknown>;
	return typeof opts.description === "string" && opts.parameters != null;
}

/**
 * Recursively scan a directory for tool module files.
 * Matches: `*.tools.{ts,js,mts,mjs}` anywhere, and any `{ts,js,mts,mjs}` file inside a `tools/` directory.
 */
export async function discoverToolModules(dir: string): Promise<string[]> {
	const toolExtensions = new Set([".ts", ".js", ".mts", ".mjs"]);
	const results: string[] = [];

	async function scan(current: string, inToolsDir: boolean): Promise<void> {
		let entries: import("node:fs").Dirent[];
		try {
			entries = await readdir(current, { withFileTypes: true });
		} catch {
			return; // directory doesn't exist or isn't readable
		}

		for (const entry of entries) {
			const name = String(entry.name);
			const fullPath = join(current, name);

			if (entry.isDirectory()) {
				// Recurse into tools/ directories; skip node_modules, hidden dirs, dist
				if (
					name === "node_modules" ||
					name === "dist" ||
					name.startsWith(".")
				) {
					continue;
				}
				await scan(fullPath, inToolsDir || name === "tools");
				continue;
			}

			if (!entry.isFile()) continue;

			// Check file extension
			const extIndex = name.lastIndexOf(".");
			if (extIndex === -1) continue;

			// Handle double extensions like .tools.ts
			const parts = name.split(".");
			const ext = `.${parts[parts.length - 1]}`;
			if (!toolExtensions.has(ext)) continue;

			// Skip test files
			if (
				name.includes(".test.") ||
				name.includes(".spec.") ||
				name.startsWith("test_")
			) {
				continue;
			}

			// Match *.tools.{ext} or any file inside a tools/ directory
			const isToolsFile =
				parts.length >= 3 && parts[parts.length - 2] === "tools";
			if (isToolsFile || inToolsDir) {
				results.push(fullPath);
			}
		}
	}

	await scan(dir, false);
	return results.sort();
}

/**
 * Dynamically import tool module files and extract tool records.
 * Returns an array of `Record<string, { options, handler }>` suitable for `addToolsFrom()`.
 */
export async function loadToolModules(files: string[]): Promise<
	{
		file: string;
		tools: Record<string, { options: unknown; handler: unknown }>;
	}[]
> {
	const results: {
		file: string;
		tools: Record<string, { options: unknown; handler: unknown }>;
	}[] = [];

	for (const file of files) {
		let mod: Record<string, unknown>;
		try {
			mod = await import(pathToFileURL(file).href);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (
				file.endsWith(".ts") &&
				(message.includes("Unknown file extension") ||
					message.includes("Cannot use import statement"))
			) {
				console.error(
					`Warning: Cannot import TypeScript file "${file}" under Node.js.\n` +
						"  Use Bun, or run with: npx tsx --import tsx node_modules/.bin/arcade-mcp\n",
				);
			} else {
				console.error(`Warning: Failed to import "${file}": ${message}`);
			}
			continue;
		}

		// Collect tool records from all exports
		const tools: Record<string, { options: unknown; handler: unknown }> = {};

		for (const [exportName, exportValue] of Object.entries(mod)) {
			if (exportName === "__esModule") continue;

			// Direct tool export: export const myTool = { options, handler }
			if (isToolExport(exportValue)) {
				tools[exportName] = exportValue as {
					options: unknown;
					handler: unknown;
				};
				continue;
			}

			// Record of tools: export const mathTools = { add: { options, handler }, ... }
			if (typeof exportValue === "object" && exportValue !== null) {
				for (const [toolName, toolDef] of Object.entries(
					exportValue as Record<string, unknown>,
				)) {
					if (isToolExport(toolDef)) {
						tools[toolName] = toolDef as {
							options: unknown;
							handler: unknown;
						};
					}
				}
			}
		}

		if (Object.keys(tools).length > 0) {
			results.push({ file, tools });
		}
	}

	return results;
}

function printUsage(): void {
	console.log(`Usage: arcade-mcp [options]

Auto-discover tool modules and start an MCP server.

Options:
  --http          Use HTTP transport (default: stdio)
  --host <addr>   HTTP host (default: 127.0.0.1)
  --port <n>      HTTP port (default: 8000)
  --name <name>   App name (default: current directory name)
  --dir <path>    Directory to scan for tools (default: cwd)
  -h, --help      Show this help message
  -v, --version   Show version

Tool Discovery:
  Scans for files matching these patterns:
  - *.tools.ts, *.tools.js    (e.g., math.tools.ts)
  - tools/**/*.ts, tools/**/*.js  (any file in a tools/ directory)

  Each file should export tool definitions as:
    export const myTools = {
      toolName: {
        options: { description: "...", parameters: z.object({...}) },
        handler: async (args) => { ... }
      }
    };

Environment Variables:
  ARCADE_SERVER_TRANSPORT   Override transport (stdio|http)
  ARCADE_SERVER_HOST        Override HTTP host
  ARCADE_SERVER_PORT        Override HTTP port`);
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	if (args.help) {
		printUsage();
		process.exit(0);
	}

	if (args.version) {
		// Read version from package.json at build time this is in the dist/ parent
		try {
			const pkgPath = new URL("../package.json", import.meta.url);
			const pkg = await import(pkgPath.href, { with: { type: "json" } });
			console.log(pkg.default?.version ?? "unknown");
		} catch {
			console.log("unknown");
		}
		process.exit(0);
	}

	// Sanitize app name: replace hyphens/spaces with underscores, ensure starts with letter
	let appName = args.name
		.replace(/[^a-zA-Z0-9_]/g, "_")
		.replace(/^[^a-zA-Z]/, "A");
	if (!appName || appName === "_") appName = "arcade_mcp";

	console.error(`Discovering tools in ${args.dir}...`);

	const files = await discoverToolModules(args.dir);
	if (files.length === 0) {
		console.error(
			"Error: No tool modules found.\n\n" +
				"Searched for:\n" +
				"  - *.tools.ts, *.tools.js  (e.g., math.tools.ts)\n" +
				"  - tools/**/*.ts, tools/**/*.js  (any file in a tools/ directory)\n\n" +
				`Scanned directory: ${args.dir}\n\n` +
				"Create a tool module to get started. Example:\n\n" +
				"  // tools/greet.ts\n" +
				'  import { z } from "zod";\n' +
				"  export const greetTools = {\n" +
				"    greet: {\n" +
				'      options: { description: "Greet someone", parameters: z.object({ name: z.string() }) },\n' +
				"      handler: async (args) => 'Hello, ' + args.name + '!'\n" +
				"    }\n" +
				"  };",
		);
		process.exit(1);
	}

	console.error(`Found ${files.length} tool module(s):`);
	for (const f of files) {
		console.error(`  ${f}`);
	}

	const loaded = await loadToolModules(files);
	if (loaded.length === 0) {
		console.error(
			"Error: Found tool files but no valid tool exports.\n" +
				"Each export should have { options: { description, parameters }, handler }.",
		);
		process.exit(1);
	}

	const app = new MCPApp({ name: appName });

	let totalTools = 0;
	for (const { tools } of loaded) {
		// Dynamic imports are duck-type validated by loadToolModules, safe to cast
		app.addToolsFrom(tools as Parameters<MCPApp["addToolsFrom"]>[0]);
		totalTools += Object.keys(tools).length;
	}

	console.error(
		`Registered ${totalTools} tool(s). Starting ${args.transport} server...`,
	);

	await app.run({
		transport: args.transport,
		host: args.host,
		port: args.port,
	});
}

// Only run main() when executed directly (not when imported for testing)
const isDirectExecution =
	process.argv[1] &&
	(process.argv[1].endsWith("/cli.js") || process.argv[1].endsWith("/cli.ts"));

if (isDirectExecution) {
	main().catch((err) => {
		console.error("Fatal error:", err);
		process.exit(1);
	});
}
