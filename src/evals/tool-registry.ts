import { type ToolCatalog, toToolDefinition } from "../catalog.js";
import type { EvalToolDefinition, ProviderName } from "./types.js";

/**
 * Registry that stores tools for evaluation purposes.
 * Converts between MCP tool definitions and provider-specific formats.
 */
export class EvalToolRegistry {
	private tools = new Map<string, EvalToolDefinition>();
	/** Maps normalized name → original name */
	private normalizedToOriginal = new Map<string, string>();

	/**
	 * Add tool definitions to the registry.
	 */
	addTools(tools: EvalToolDefinition[]): void {
		for (const tool of tools) {
			this.tools.set(tool.name, tool);
			this.normalizedToOriginal.set(normalizeName(tool.name), tool.name);
		}
	}

	/**
	 * Add all tools from a ToolCatalog.
	 */
	addFromCatalog(catalog: ToolCatalog): void {
		const defs = catalog.toDefinitions();
		this.addTools(
			defs.map((d) => ({
				name: d.name,
				description: d.description,
				inputSchema: d.inputSchema,
			})),
		);
	}

	/**
	 * Convert all tools to the format expected by a specific provider.
	 */
	listToolsForModel(provider: ProviderName): Record<string, unknown>[] {
		const result: Record<string, unknown>[] = [];

		for (const tool of this.tools.values()) {
			if (provider === "openai") {
				result.push(toOpenAITool(tool));
			} else {
				result.push(toAnthropicTool(tool));
			}
		}

		return result;
	}

	/**
	 * Check if a tool is registered (supports normalized name lookup).
	 */
	hasTool(name: string): boolean {
		return (
			this.tools.has(name) || this.normalizedToOriginal.has(normalizeName(name))
		);
	}

	/**
	 * Resolve a tool name to its original registered name.
	 */
	resolveToolName(name: string): string | undefined {
		if (this.tools.has(name)) return name;
		return this.normalizedToOriginal.get(normalizeName(name));
	}

	/**
	 * Get all registered tool names.
	 */
	toolNames(): string[] {
		return Array.from(this.tools.keys());
	}

	/**
	 * Number of registered tools.
	 */
	toolCount(): number {
		return this.tools.size;
	}
}

// ── Provider conversions ────────────────────────────────

function toOpenAITool(tool: EvalToolDefinition): Record<string, unknown> {
	const normalized = normalizeName(tool.name);
	return {
		type: "function",
		function: {
			name: normalized,
			description: tool.description ?? "",
			parameters: tool.inputSchema ?? { type: "object", properties: {} },
		},
	};
}

function toAnthropicTool(tool: EvalToolDefinition): Record<string, unknown> {
	const normalized = normalizeName(tool.name);
	return {
		name: normalized,
		description: tool.description ?? "",
		input_schema: tool.inputSchema ?? { type: "object", properties: {} },
	};
}

/**
 * Normalize a tool name for provider compatibility.
 * Replaces dots and hyphens with underscores.
 */
function normalizeName(name: string): string {
	return name.replace(/[.-]/g, "_");
}
