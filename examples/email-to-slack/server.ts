/**
 * Example: Email-to-Slack compound tool using typed tool composition.
 *
 * This MCP server exposes a single tool that reads unread Gmail messages
 * and forwards them as Slack messages to a specified channel.
 *
 * It demonstrates:
 *   - `context.tools.execute()` for strongly-typed cross-tool calls
 *   - `OnMissing.ALLOW_NULL` for resilient field extraction
 *   - `requestScopesFrom` for cross-tool auth requirement resolution
 *   - Zod schemas as the "contract" between tools with different response shapes
 *
 * Usage:
 *   npx @arcadeai/arcade-mcp stdio
 *   npx @arcadeai/arcade-mcp http
 */

import { z } from "zod";
import { type ExecuteOptions, MCPApp, OnMissing } from "../../src/index.js";

const app = new MCPApp({
	name: "EmailToSlack",
	version: "1.0.0",
	instructions:
		"Compound tool that reads Gmail messages and forwards them to Slack",
});

// ── Response schemas ────────────────────────────────────────
// These define the shape we *want*, regardless of what Gmail or Slack
// actually return. The structuring layer handles the mapping.

const EmailSummary = z.object({
	subject: z.string(),
	sender: z.string(),
	snippet: z.string(),
});

const EmailList = z.object({
	emails: z.array(EmailSummary).default([]),
});

const SlackResponse = z.object({
	ok: z.boolean(),
	channel: z.string(),
	ts: z.string(),
});

const ForwardedEmail = z.object({
	sender: z.string(),
	snippet: z.string(),
	sentToSlack: z.boolean(),
});

const ForwardResult = z.object({
	forwarded: z.number(),
	total: z.number(),
	emails: z.array(ForwardedEmail),
});

// ── Default options — resilient to upstream response changes ─

const DEFAULT_OPTIONS: ExecuteOptions = {
	onMissing: OnMissing.ALLOW_NULL,
	timeoutSeconds: 30,
	maxRetries: 2,
};

// ── Compound tool ───────────────────────────────────────────

app.tool(
	"forward_emails_to_slack",
	{
		description:
			"Read recent emails from Gmail and forward them as Slack messages",
		parameters: z.object({
			channel_name: z
				.string()
				.describe("Slack channel to post emails to (e.g. '#general')"),
			max_emails: z
				.number()
				.int()
				.min(1)
				.max(50)
				.default(5)
				.describe("Maximum number of emails to forward"),
		}),
		// Cross-tool auth: this compound tool needs auth from both Gmail and Slack.
		// At startup, their scopes are fetched from Arcade Cloud and merged into
		// this tool's requirements, so MCP clients see the full auth needs at list time.
		requestScopesFrom: ["Gmail.ListEmails", "Slack.SendMessage"],
	},
	async (args, context) => {
		// Step 1: Fetch emails via Gmail tool
		const emailData = await context.tools.execute(
			EmailList,
			"Gmail.ListEmails",
			{ n_emails: args.max_emails },
			DEFAULT_OPTIONS,
		);

		if (!emailData.emails || emailData.emails.length === 0) {
			return { forwarded: 0, total: 0, emails: [] };
		}

		// Step 2: Send each email as a Slack message
		const results: z.infer<typeof ForwardedEmail>[] = [];
		for (const email of emailData.emails) {
			const message = `*From:* ${email.sender}\n*Subject:* ${email.subject}\n> ${email.snippet}`;

			const slackResult = await context.tools.execute(
				SlackResponse,
				"Slack.SendMessage",
				{
					message,
					channel_name: args.channel_name,
				},
				DEFAULT_OPTIONS,
			);

			results.push({
				sender: email.sender,
				snippet: email.snippet,
				sentToSlack: Boolean(slackResult.ok),
			});
		}

		const forwarded = results.filter((r) => r.sentToSlack).length;
		return {
			forwarded,
			total: results.length,
			emails: results,
		};
	},
);

app.run();
