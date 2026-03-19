import { z } from "zod";
import type { ToolHandler, ToolOptions } from "../../../src/index.js";

export const stringTools: Record<
  string,
  { options: ToolOptions; handler: ToolHandler }
> = {
  capitalize: {
    options: {
      description: "Capitalize the first letter of each word",
      parameters: z.object({
        text: z.string().describe("Text to capitalize"),
      }),
    },
    handler: async (args: { text: string }) =>
      args.text.replace(/\b\w/g, (c) => c.toUpperCase()),
  },

  slugify: {
    options: {
      description: "Convert text to a URL-friendly slug",
      parameters: z.object({
        text: z.string().describe("Text to slugify"),
      }),
    },
    handler: async (args: { text: string }) =>
      args.text
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, "")
        .replace(/[\s_]+/g, "-")
        .replace(/-+/g, "-"),
  },

  word_count: {
    options: {
      description: "Count the number of words in a text",
      parameters: z.object({
        text: z.string().describe("Text to count words in"),
      }),
    },
    handler: async (args: { text: string }) => ({
      count: args.text.trim().split(/\s+/).filter(Boolean).length,
    }),
  },
};
