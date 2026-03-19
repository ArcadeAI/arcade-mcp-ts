/**
 * Example: Resumable HTTP streams with InMemoryEventStore.
 *
 * When a client disconnects and reconnects with the `Last-Event-ID` header,
 * the server replays any events the client missed.
 *
 * Run:
 *   ARCADE_SERVER_TRANSPORT=http bun run examples/resumable/server.ts
 */
import { z } from "zod";
import { InMemoryEventStore, MCPApp } from "../../src/index.js";

const app = new MCPApp({
  name: "ResumableServer",
  version: "1.0.0",
  instructions: "Echo server with resumable HTTP streams",
});

app.tool(
  "echo",
  {
    description: "Echo the input message back",
    parameters: z.object({
      message: z.string().describe("The message to echo"),
    }),
  },
  async (args) => {
    return args.message;
  },
);

app.tool(
  "slow_echo",
  {
    description: "Echo after a delay (simulates a long-running tool)",
    parameters: z.object({
      message: z.string().describe("The message to echo"),
      delayMs: z.number().default(2000).describe("Delay in milliseconds"),
    }),
  },
  async (args) => {
    await new Promise((resolve) => setTimeout(resolve, args.delayMs));
    return args.message;
  },
);

app.run({ eventStore: new InMemoryEventStore() });
