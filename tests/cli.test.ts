import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	discoverToolModules,
	isToolExport,
	loadToolModules,
	parseArgs,
} from "../src/cli.js";

describe("parseArgs", () => {
	it("returns defaults with no arguments", () => {
		const args = parseArgs([]);
		expect(args.transport).toBe("stdio");
		expect(args.host).toBe("127.0.0.1");
		expect(args.port).toBe(8000);
		expect(args.help).toBe(false);
		expect(args.version).toBe(false);
	});

	it("parses --http flag", () => {
		const args = parseArgs(["--http"]);
		expect(args.transport).toBe("http");
	});

	it("parses --host and --port", () => {
		const args = parseArgs(["--host", "0.0.0.0", "--port", "3000"]);
		expect(args.host).toBe("0.0.0.0");
		expect(args.port).toBe(3000);
	});

	it("parses --name", () => {
		const args = parseArgs(["--name", "MyServer"]);
		expect(args.name).toBe("MyServer");
	});

	it("parses --dir", () => {
		const args = parseArgs(["--dir", "/tmp/tools"]);
		expect(args.dir).toBe("/tmp/tools");
	});

	it("parses --help and -h", () => {
		expect(parseArgs(["--help"]).help).toBe(true);
		expect(parseArgs(["-h"]).help).toBe(true);
	});

	it("parses --version and -v", () => {
		expect(parseArgs(["--version"]).version).toBe(true);
		expect(parseArgs(["-v"]).version).toBe(true);
	});

	it("parses multiple flags together", () => {
		const args = parseArgs(["--http", "--port", "9000", "--name", "Test"]);
		expect(args.transport).toBe("http");
		expect(args.port).toBe(9000);
		expect(args.name).toBe("Test");
	});
});

describe("isToolExport", () => {
	it("returns true for valid tool export", () => {
		expect(
			isToolExport({
				options: { description: "A tool", parameters: {} },
				handler: async () => {},
			}),
		).toBe(true);
	});

	it("returns false for null", () => {
		expect(isToolExport(null)).toBe(false);
	});

	it("returns false for non-object", () => {
		expect(isToolExport("string")).toBe(false);
		expect(isToolExport(42)).toBe(false);
	});

	it("returns false without handler", () => {
		expect(
			isToolExport({
				options: { description: "A tool", parameters: {} },
			}),
		).toBe(false);
	});

	it("returns false without options", () => {
		expect(isToolExport({ handler: async () => {} })).toBe(false);
	});

	it("returns false without description", () => {
		expect(
			isToolExport({
				options: { parameters: {} },
				handler: async () => {},
			}),
		).toBe(false);
	});

	it("returns false without parameters", () => {
		expect(
			isToolExport({
				options: { description: "A tool" },
				handler: async () => {},
			}),
		).toBe(false);
	});
});

describe("discoverToolModules", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "arcade-cli-test-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("finds *.tools.ts files", async () => {
		await writeFile(join(tempDir, "math.tools.ts"), "export const x = 1;");
		await writeFile(join(tempDir, "string.tools.js"), "export const x = 1;");

		const files = await discoverToolModules(tempDir);
		expect(files).toHaveLength(2);
		expect(files[0]).toContain("math.tools.ts");
		expect(files[1]).toContain("string.tools.js");
	});

	it("finds files inside tools/ directory", async () => {
		await mkdir(join(tempDir, "tools"));
		await writeFile(join(tempDir, "tools", "greet.ts"), "export const x = 1;");
		await writeFile(join(tempDir, "tools", "calc.js"), "export const x = 1;");

		const files = await discoverToolModules(tempDir);
		expect(files).toHaveLength(2);
		expect(files[0]).toContain("tools/calc.js");
		expect(files[1]).toContain("tools/greet.ts");
	});

	it("ignores non-matching files", async () => {
		await writeFile(join(tempDir, "server.ts"), "export const x = 1;");
		await writeFile(join(tempDir, "index.js"), "export const x = 1;");
		await writeFile(join(tempDir, "README.md"), "# hi");

		const files = await discoverToolModules(tempDir);
		expect(files).toHaveLength(0);
	});

	it("ignores test files", async () => {
		await mkdir(join(tempDir, "tools"));
		await writeFile(
			join(tempDir, "tools", "greet.test.ts"),
			"export const x = 1;",
		);
		await writeFile(
			join(tempDir, "tools", "greet.spec.ts"),
			"export const x = 1;",
		);
		await writeFile(join(tempDir, "math.tools.test.ts"), "export const x = 1;");

		const files = await discoverToolModules(tempDir);
		expect(files).toHaveLength(0);
	});

	it("ignores node_modules and dist", async () => {
		await mkdir(join(tempDir, "node_modules", "tools"), { recursive: true });
		await mkdir(join(tempDir, "dist", "tools"), { recursive: true });
		await writeFile(
			join(tempDir, "node_modules", "tools", "bad.ts"),
			"export const x = 1;",
		);
		await writeFile(
			join(tempDir, "dist", "tools", "bad.js"),
			"export const x = 1;",
		);

		const files = await discoverToolModules(tempDir);
		expect(files).toHaveLength(0);
	});

	it("returns empty array for non-existent directory", async () => {
		const files = await discoverToolModules("/nonexistent/path");
		expect(files).toHaveLength(0);
	});

	it("finds nested tools in tools/ subdirectories", async () => {
		await mkdir(join(tempDir, "tools", "math"), { recursive: true });
		await writeFile(
			join(tempDir, "tools", "math", "add.ts"),
			"export const x = 1;",
		);

		const files = await discoverToolModules(tempDir);
		expect(files).toHaveLength(1);
		expect(files[0]).toContain("tools/math/add.ts");
	});
});

describe("loadToolModules", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "arcade-cli-load-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("loads a valid tool module with record export", async () => {
		const content = `
			export const myTools = {
				hello: {
					options: { description: "Say hello", parameters: {} },
					handler: async () => "hello"
				}
			};
		`;
		const file = join(tempDir, "my.tools.mjs");
		await writeFile(file, content);

		const loaded = await loadToolModules([file]);
		expect(loaded).toHaveLength(1);
		expect(loaded[0].tools).toHaveProperty("hello");
	});

	it("loads a valid tool module with direct export", async () => {
		const content = `
			export const greet = {
				options: { description: "Greet", parameters: {} },
				handler: async () => "hi"
			};
		`;
		const file = join(tempDir, "direct.tools.mjs");
		await writeFile(file, content);

		const loaded = await loadToolModules([file]);
		expect(loaded).toHaveLength(1);
		expect(loaded[0].tools).toHaveProperty("greet");
	});

	it("skips files that fail to import", async () => {
		const loaded = await loadToolModules(["/nonexistent/file.mjs"]);
		expect(loaded).toHaveLength(0);
	});

	it("skips modules with no valid tool exports", async () => {
		const content = `export const x = 42;`;
		const file = join(tempDir, "notools.mjs");
		await writeFile(file, content);

		const loaded = await loadToolModules([file]);
		expect(loaded).toHaveLength(0);
	});
});
