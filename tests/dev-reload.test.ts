import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shouldReload, watchForChanges } from "../src/transports/dev-reload.js";

describe("shouldReload", () => {
  it("returns true for .ts files", () => {
    expect(shouldReload("tools/greet.ts")).toBe(true);
  });

  it("returns true for .js files", () => {
    expect(shouldReload("src/index.js")).toBe(true);
  });

  it("returns true for .mts files", () => {
    expect(shouldReload("tools/greet.mts")).toBe(true);
  });

  it("returns true for .mjs files", () => {
    expect(shouldReload("tools/greet.mjs")).toBe(true);
  });

  it("returns false for non-source files", () => {
    expect(shouldReload("README.md")).toBe(false);
    expect(shouldReload("data.json")).toBe(false);
    expect(shouldReload("image.png")).toBe(false);
  });

  it("returns false for files in node_modules", () => {
    expect(shouldReload("node_modules/zod/index.js")).toBe(false);
  });

  it("returns false for files in dist", () => {
    expect(shouldReload("dist/index.js")).toBe(false);
  });

  it("returns false for files in hidden directories", () => {
    expect(shouldReload(".git/config")).toBe(false);
    expect(shouldReload(".cache/module.js")).toBe(false);
  });

  it("returns false for files with no extension", () => {
    expect(shouldReload("Makefile")).toBe(false);
  });
});

describe("watchForChanges", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dev-reload-test-"));
    // Create a source file so there's something to watch
    await writeFile(join(tmpDir, "tool.ts"), "export const x = 1;");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("calls onChange when a .ts file changes", async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn() };

    const handle = watchForChanges({
      dir: tmpDir,
      onChange,
      logger,
    });

    // Give the watcher time to initialize
    await new Promise((r) => setTimeout(r, 100));

    // Trigger a change
    await writeFile(join(tmpDir, "tool.ts"), "export const x = 2;");

    // Wait for debounce (300ms) + some buffer
    await new Promise((r) => setTimeout(r, 600));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining(["tool.ts"]));

    handle.close();
  });

  it("does not call onChange for non-source files", async () => {
    // Use a fresh directory with no .ts files to avoid stale events
    const freshDir = await mkdtemp(join(tmpdir(), "dev-reload-nosrc-"));

    const onChange = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn() };

    const handle = watchForChanges({
      dir: freshDir,
      onChange,
      logger,
    });

    await new Promise((r) => setTimeout(r, 200));

    await writeFile(join(freshDir, "data.json"), '{"a": 1}');

    await new Promise((r) => setTimeout(r, 600));

    expect(onChange).not.toHaveBeenCalled();

    handle.close();
    await rm(freshDir, { recursive: true, force: true });
  });

  it("debounces rapid changes into a single call", async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn() };

    const handle = watchForChanges({
      dir: tmpDir,
      onChange,
      logger,
    });

    await new Promise((r) => setTimeout(r, 100));

    // Rapid-fire changes
    await writeFile(join(tmpDir, "tool.ts"), "export const x = 2;");
    await writeFile(join(tmpDir, "tool.ts"), "export const x = 3;");
    await writeFile(join(tmpDir, "tool.ts"), "export const x = 4;");

    await new Promise((r) => setTimeout(r, 600));

    expect(onChange).toHaveBeenCalledTimes(1);

    handle.close();
  });

  it("watches subdirectories", async () => {
    const subDir = join(tmpDir, "tools");
    await mkdir(subDir);

    const onChange = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn() };

    const handle = watchForChanges({
      dir: tmpDir,
      onChange,
      logger,
    });

    await new Promise((r) => setTimeout(r, 100));

    await writeFile(join(subDir, "greet.ts"), "export const greet = {};");

    await new Promise((r) => setTimeout(r, 600));

    expect(onChange).toHaveBeenCalledTimes(1);

    handle.close();
  });

  it("logs reload failure without crashing", async () => {
    const onChange = vi.fn().mockRejectedValue(new Error("Reload failed!"));
    const logger = { info: vi.fn() };

    const handle = watchForChanges({
      dir: tmpDir,
      onChange,
      logger,
    });

    await new Promise((r) => setTimeout(r, 100));

    await writeFile(join(tmpDir, "tool.ts"), "export const x = 2;");

    await new Promise((r) => setTimeout(r, 600));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Reload failed"),
    );

    handle.close();
  });

  it("close() stops the watcher", async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn() };

    const handle = watchForChanges({
      dir: tmpDir,
      onChange,
      logger,
    });

    handle.close();

    await new Promise((r) => setTimeout(r, 100));

    await writeFile(join(tmpDir, "tool.ts"), "export const x = 2;");

    await new Promise((r) => setTimeout(r, 600));

    expect(onChange).not.toHaveBeenCalled();
  });
});
