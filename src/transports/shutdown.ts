/**
 * Shared graceful shutdown helper for all transports.
 *
 * - First SIGINT/SIGTERM → graceful shutdown via onShutdown callback
 * - Second signal → immediate process.exit(1)
 */
export function setupGracefulShutdown(options: {
  logger: { info: (msg: string) => void };
  onShutdown: () => Promise<void>;
}): Promise<void> {
  return new Promise<void>((resolve) => {
    let shuttingDown = false;

    const handler = (signal: string) => {
      if (shuttingDown) {
        options.logger.info("Force quitting...");
        process.exit(1);
      }
      shuttingDown = true;
      options.logger.info(
        `Received ${signal}, shutting down gracefully... (press Ctrl+C again to force quit)`,
      );
      options
        .onShutdown()
        .catch(() => {})
        .finally(() => resolve());
    };

    process.on("SIGINT", () => handler("SIGINT"));
    process.on("SIGTERM", () => handler("SIGTERM"));
  });
}
