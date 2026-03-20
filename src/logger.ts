/**
 * Shared logger factory. All modules should use createLogger() instead of
 * calling pino() directly, so log format is controlled in one place.
 *
 * Set MCP_LOG_FORMAT=pretty|json to override. When unset, defaults to
 * pretty in TTY (interactive terminal) and JSON otherwise.
 */
import pino from "pino";

export type LogFormat = "json" | "pretty";

function getLogFormat(): LogFormat {
  const v = process.env.MCP_LOG_FORMAT?.toLowerCase();
  if (v === "pretty") return "pretty";
  if (v === "json") return "json";
  // Auto-detect: pretty for interactive terminals, JSON for pipes/CI
  return process.stderr.isTTY ? "pretty" : "json";
}

export function createLogger(name: string): pino.Logger {
  const format = getLogFormat();

  if (format === "pretty") {
    return pino({
      name,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
        },
      },
    });
  }

  return pino({ name });
}
