/**
 * Shared logger factory. All modules should use createLogger() instead of
 * calling pino() directly, so log format is controlled in one place.
 *
 * Set MCP_LOG_FORMAT=pretty for colored, human-readable terminal output.
 * Default is JSON (suitable for production / structured logging).
 */
import pino from "pino";

export type LogFormat = "json" | "pretty";

function getLogFormat(): LogFormat {
	const v = process.env.MCP_LOG_FORMAT?.toLowerCase();
	if (v === "pretty") return "pretty";
	return "json";
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
