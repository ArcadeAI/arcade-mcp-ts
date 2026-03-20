import { z } from "zod";
import type { ToolHandler, ToolOptions } from "../../../src/index.js";
import { ToolExecutionError } from "../../../src/index.js";

const addSchema = z.object({
  a: z.coerce.number().describe("First number"),
  b: z.coerce.number().describe("Second number"),
});

const divideSchema = z.object({
  numerator: z.coerce.number().describe("Numerator"),
  denominator: z.coerce.number().describe("Denominator (must not be zero)"),
});

export const mathTools: Record<
  string,
  { options: ToolOptions; handler: ToolHandler }
> = {
  add: {
    options: {
      description: "Add two numbers",
      parameters: addSchema,
    },
    handler: async (args: z.infer<typeof addSchema>) => ({
      result: args.a + args.b,
    }),
  },

  multiply: {
    options: {
      description: "Multiply two numbers",
      parameters: addSchema, // same shape: a, b
    },
    handler: async (args: z.infer<typeof addSchema>) => ({
      result: args.a * args.b,
    }),
  },

  divide: {
    options: {
      description: "Divide two numbers",
      parameters: divideSchema,
    },
    handler: async (args: z.infer<typeof divideSchema>) => {
      if (args.denominator === 0) {
        throw new ToolExecutionError("Division by zero");
      }
      return { result: args.numerator / args.denominator };
    },
  },
};
