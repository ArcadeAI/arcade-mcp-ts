import { z } from "zod";
import { MCPApp } from "../../src/index.js";
import { mathTools } from "./tools/math.js";
import { stringTools } from "./tools/string.js";

const app = new MCPApp({
  name: "ModularTools",
  version: "1.0.0",
  instructions:
    "Demonstrates loading tools from separate modules via addToolsFrom()",
});

// Load tool modules — each module exports a record of { options, handler }
app.addToolsFrom(mathTools);
app.addToolsFrom(stringTools);

// You can also mix in inline tools alongside module-loaded ones
app.tool(
  "echo_with_logging",
  {
    description:
      "Echo a message while demonstrating context.log and context.progress",
    parameters: z.object({
      message: z.string().describe("Message to echo"),
      steps: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(3)
        .describe("Simulated processing steps"),
    }),
  },
  async (args, context) => {
    context.log.info("Starting echo with logging", { message: args.message });

    for (let i = 1; i <= args.steps; i++) {
      await context.progress.report(
        i,
        args.steps,
        `Processing step ${i}/${args.steps}`,
      );
      // Simulate some work
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    context.log.info("Echo complete");
    return { message: args.message, steps_completed: args.steps };
  },
);

app.run();
