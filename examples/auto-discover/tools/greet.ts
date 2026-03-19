import { z } from "zod";
import type { ToolHandler, ToolOptions } from "../../../src/index.js";

export const greetTools: Record<
  string,
  { options: ToolOptions; handler: ToolHandler }
> = {
  greet: {
    options: {
      description: "Greet someone by name",
      parameters: z.object({
        name: z.string().describe("Name to greet"),
      }),
    },
    handler: async (args: { name: string }) => `Hello, ${args.name}!`,
  },

  farewell: {
    options: {
      description: "Say goodbye to someone",
      parameters: z.object({
        name: z.string().describe("Name to say goodbye to"),
      }),
    },
    handler: async (args: { name: string }) => `Goodbye, ${args.name}!`,
  },
};
