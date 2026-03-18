import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import type { PromptArgument, PromptHandler, PromptOptions } from "../types.js";
import { ComponentRegistry } from "./base.js";

/**
 * A prompt stored in the registry with its handler.
 */
export interface StoredPrompt {
	name: string;
	description?: string;
	arguments?: PromptArgument[];
	handler: PromptHandler;
}

/**
 * Manages MCP prompt registration and execution.
 */
export class PromptManager {
	readonly registry = new ComponentRegistry<string, StoredPrompt>();

	addPrompt(
		name: string,
		options: PromptOptions,
		handler?: PromptHandler,
	): void {
		const stored: StoredPrompt = {
			name,
			description: options.description,
			arguments: options.arguments,
			handler: handler ?? defaultPromptHandler(options.description ?? name),
		};
		this.registry.upsert(name, stored);
	}

	removePrompt(name: string): StoredPrompt {
		return this.registry.remove(name);
	}

	listPrompts(): StoredPrompt[] {
		return this.registry.values();
	}

	getPromptNames(): string[] {
		return this.registry.keys();
	}

	async getPrompt(
		name: string,
		args?: Record<string, string>,
	): Promise<GetPromptResult> {
		const stored = this.registry.get(name);
		if (!stored) {
			throw new Error(`Prompt '${name}' not found`);
		}

		// Validate required arguments
		if (stored.arguments) {
			for (const arg of stored.arguments) {
				if (arg.required && (!args || !(arg.name in args))) {
					throw new Error(
						`Missing required argument '${arg.name}' for prompt '${name}'`,
					);
				}
			}
		}

		return stored.handler(args ?? {});
	}
}

function defaultPromptHandler(description: string): PromptHandler {
	return () => ({
		messages: [
			{
				role: "user",
				content: { type: "text", text: description },
			},
		],
	});
}
