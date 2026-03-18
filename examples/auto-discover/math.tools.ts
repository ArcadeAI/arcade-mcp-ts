import { z } from "zod";
import type { ToolHandler, ToolOptions } from "../../src/index.js";

export const mathTools: Record<
	string,
	{ options: ToolOptions; handler: ToolHandler }
> = {
	add: {
		options: {
			description: "Add two numbers",
			parameters: z.object({
				a: z.number().describe("First number"),
				b: z.number().describe("Second number"),
			}),
		},
		handler: async (args: { a: number; b: number }) => ({
			result: args.a + args.b,
		}),
	},
};
