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
 *   bunx @arcadeai/arcade-mcp stdio
 *   bunx @arcadeai/arcade-mcp http
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
  subject: z.string().nullable(),
  sender: z.string().nullable(),
  snippet: z.string().nullable(),
});

const EmailList = z.object({
  emails: z.array(EmailSummary).default([]),
});

const SlackResponse = z.object({
  ok: z.boolean().nullable(),
  channel: z.string().nullable(),
  ts: z.string().nullable(),
});

const ForwardedEmail = z.object({
  sender: z.string().nullable(),
  snippet: z.string().nullable(),
  sentToSlack: z.boolean(),
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
      max_emails: z.coerce
        .number()
        .int()
        .min(1)
        .max(50)
        .default(5)
        .describe("Maximum number of emails to forward"),
    }),
    requestScopesFrom: ["Gmail.ListEmails", "Slack.SendMessage"],
  },
  async (args, context) => {
    const log = (...msg: unknown[]) =>
      console.log(`[forward_emails_to_slack]`, ...msg);

    log(
      "Starting — channel=%s max_emails=%d",
      args.channel_name,
      args.max_emails,
    );

    log("Calling Gmail.ListEmails...");
    let emailData: z.infer<typeof EmailList>;
    try {
      emailData = await context.tools.execute(
        EmailList,
        "Gmail.ListEmails",
        { n_emails: args.max_emails },
        DEFAULT_OPTIONS,
      );
      log("Gmail returned %d emails", emailData.emails?.length ?? 0);
    } catch (err) {
      log("Gmail.ListEmails FAILED:", err);
      throw err;
    }

    if (!emailData.emails || emailData.emails.length === 0) {
      log("No emails to forward");
      return { forwarded: 0, total: 0, emails: [] };
    }

    const results: z.infer<typeof ForwardedEmail>[] = [];
    for (let i = 0; i < emailData.emails.length; i++) {
      const email = emailData.emails[i];
      const message = `*From:* ${email.sender ?? "unknown"}\n*Subject:* ${email.subject ?? "(no subject)"}\n> ${email.snippet ?? ""}`;

      log(
        "Sending email %d/%d to Slack (from: %s)...",
        i + 1,
        emailData.emails.length,
        email.sender,
      );
      try {
        const slackResult = await context.tools.execute(
          SlackResponse,
          "Slack.SendMessage",
          {
            message,
            channel_name: args.channel_name,
          },
          DEFAULT_OPTIONS,
        );
        log(
          "Slack response: ok=%s channel=%s ts=%s",
          slackResult.ok,
          slackResult.channel,
          slackResult.ts,
        );

        results.push({
          sender: email.sender,
          snippet: email.snippet,
          sentToSlack: Boolean(slackResult.ok),
        });
      } catch (err) {
        log("Slack.SendMessage FAILED for email %d:", i + 1, err);
        results.push({
          sender: email.sender,
          snippet: email.snippet,
          sentToSlack: false,
        });
      }
    }

    const forwarded = results.filter((r) => r.sentToSlack).length;
    log("Done — forwarded %d/%d emails", forwarded, results.length);
    return {
      forwarded,
      total: results.length,
      emails: results,
    };
  },
);

app.run({ transport: "http", port: 8080, host: "0.0.0.0" });
