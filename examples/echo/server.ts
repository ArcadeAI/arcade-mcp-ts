import { z } from "zod";
import { MCPApp } from "../../src/index.js";

const app = new MCPApp({
	name: "EchoServer",
	version: "1.0.0",
	instructions: "A simple echo server for testing",
});

// Simple echo tool
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

// Echo with uppercase
app.tool(
	"echo_upper",
	{
		description: "Echo the input message in uppercase",
		parameters: z.object({
			message: z.string().describe("The message to echo"),
		}),
	},
	async (args) => {
		return args.message.toUpperCase();
	},
);

// Reverse text
app.tool(
	"reverse",
	{
		description: "Reverse the input text",
		parameters: z.object({
			text: z.string().describe("The text to reverse"),
		}),
	},
	async (args) => {
		return args.text.split("").reverse().join("");
	},
);

app.run();
