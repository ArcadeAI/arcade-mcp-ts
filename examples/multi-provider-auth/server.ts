import { z } from "zod";
import { auth, MCPApp } from "../../src/index.js";

const app = new MCPApp({
  name: "ProductivityHub",
  version: "1.0.0",
  instructions:
    "Productivity tools using multiple OAuth providers — each tool authenticates with a different service",
});

// Google Calendar — list upcoming events
app.tool(
  "list_google_events",
  {
    description: "List upcoming Google Calendar events",
    parameters: z.object({
      max_results: z.coerce
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Maximum number of events to return"),
    }),
    auth: auth.Google({
      scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    }),
  },
  async (args, context) => {
    const token = context.getAuthToken();
    const now = new Date().toISOString();

    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=${args.max_results}&timeMin=${encodeURIComponent(now)}&orderBy=startTime&singleEvents=true`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Google Calendar API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.items.map(
      (event: {
        summary: string;
        start: { dateTime?: string; date?: string };
        end: { dateTime?: string; date?: string };
      }) => ({
        summary: event.summary,
        start: event.start.dateTime ?? event.start.date,
        end: event.end.dateTime ?? event.end.date,
      }),
    );
  },
);

// Slack — send a message to a channel
app.tool(
  "send_slack_message",
  {
    description: "Send a message to a Slack channel",
    parameters: z.object({
      channel: z.string().describe("Channel ID (e.g. C01234ABCDE)"),
      text: z.string().describe("Message text"),
    }),
    auth: auth.Slack({ scopes: ["chat:write"] }),
  },
  async (args, context) => {
    const token = context.getAuthToken();

    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel: args.channel, text: args.text }),
    });

    const data = await response.json();
    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error}`);
    }

    return { sent: true, channel: args.channel, ts: data.ts };
  },
);

// Linear — create an issue
app.tool(
  "create_linear_issue",
  {
    description: "Create a new issue in Linear",
    parameters: z.object({
      title: z.string().describe("Issue title"),
      description: z
        .string()
        .optional()
        .describe("Issue description (markdown)"),
      team_id: z.string().describe("Linear team ID"),
    }),
    auth: auth.Linear(),
  },
  async (args, context) => {
    const token = context.getAuthToken();

    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `mutation CreateIssue($input: IssueCreateInput!) {
					issueCreate(input: $input) {
						issue { id identifier title url }
					}
				}`,
        variables: {
          input: {
            title: args.title,
            description: args.description,
            teamId: args.team_id,
          },
        },
      }),
    });

    const data = await response.json();
    if (data.errors) {
      throw new Error(`Linear API error: ${data.errors[0].message}`);
    }

    return data.data.issueCreate.issue;
  },
);

// Notion — get a page
app.tool(
  "get_notion_page",
  {
    description: "Get a Notion page by ID",
    parameters: z.object({
      page_id: z.string().describe("Notion page ID"),
    }),
    auth: auth.Notion(),
  },
  async (args, context) => {
    const token = context.getAuthToken();

    const response = await fetch(
      `https://api.notion.com/v1/pages/${args.page_id}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2022-06-28",
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Notion API error: ${response.statusText}`);
    }

    const page = await response.json();
    return {
      id: page.id,
      url: page.url,
      created_time: page.created_time,
      last_edited_time: page.last_edited_time,
    };
  },
);

app.run();
