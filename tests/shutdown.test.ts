import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupGracefulShutdown } from "../src/transports/shutdown.js";

describe("setupGracefulShutdown", () => {
  const listeners: Map<string, ((...args: unknown[]) => void)[]> = new Map();

  beforeEach(() => {
    listeners.clear();
    vi.spyOn(process, "on").mockImplementation(
      (event: string, fn: (...args: unknown[]) => void) => {
        const list = listeners.get(event) ?? [];
        list.push(fn);
        listeners.set(event, list);
        return process;
      },
    );
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function emit(signal: string) {
    for (const fn of listeners.get(signal) ?? []) {
      fn();
    }
  }

  it("calls onShutdown and resolves on first SIGINT", async () => {
    const onShutdown = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn() };

    const promise = setupGracefulShutdown({ logger, onShutdown });

    emit("SIGINT");

    await promise;

    expect(onShutdown).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("shutting down gracefully"),
    );
    expect(process.exit).not.toHaveBeenCalled();
  });

  it("calls onShutdown and resolves on first SIGTERM", async () => {
    const onShutdown = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn() };

    const promise = setupGracefulShutdown({ logger, onShutdown });

    emit("SIGTERM");

    await promise;

    expect(onShutdown).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("SIGTERM"),
    );
  });

  it("force quits on second signal", async () => {
    const onShutdown = vi.fn().mockImplementation(
      () => new Promise(() => {}), // never resolves
    );
    const logger = { info: vi.fn() };

    setupGracefulShutdown({ logger, onShutdown });

    // First signal starts graceful shutdown
    emit("SIGINT");
    expect(onShutdown).toHaveBeenCalledOnce();

    // Second signal should force quit
    emit("SIGINT");
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(logger.info).toHaveBeenCalledWith("Force quitting...");
  });

  it("resolves even if onShutdown throws", async () => {
    const onShutdown = vi.fn().mockRejectedValue(new Error("cleanup failed"));
    const logger = { info: vi.fn() };

    const promise = setupGracefulShutdown({ logger, onShutdown });

    emit("SIGINT");

    await promise;

    expect(onShutdown).toHaveBeenCalledOnce();
  });

  it("force quits on SIGTERM after SIGINT started shutdown", async () => {
    const onShutdown = vi.fn().mockImplementation(() => new Promise(() => {}));
    const logger = { info: vi.fn() };

    setupGracefulShutdown({ logger, onShutdown });

    emit("SIGINT");
    emit("SIGTERM");

    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
