import { z } from "zod";
import { auth, MCPApp } from "../../src/index.js";

const app = new MCPApp({
	name: "GitHubTools",
	version: "1.0.0",
	instructions: "GitHub tools with OAuth authentication",
});

// Star a repository — requires GitHub OAuth
app.tool(
	"star_repo",
	{
		description: "Star a GitHub repository",
		parameters: z.object({
			owner: z.string().describe("Repository owner"),
			repo: z.string().describe("Repository name"),
		}),
		auth: auth.GitHub({ scopes: ["repo"] }),
	},
	async (args, context) => {
		const token = context.getAuthToken();

		const response = await fetch(
			`https://api.github.com/user/starred/${args.owner}/${args.repo}`,
			{
				method: "PUT",
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: "application/vnd.github.v3+json",
					"User-Agent": "arcade-mcp-github-tools",
				},
			},
		);

		if (!response.ok) {
			throw new Error(
				`Failed to star ${args.owner}/${args.repo}: ${response.statusText}`,
			);
		}

		return { starred: true, repo: `${args.owner}/${args.repo}` };
	},
);

// Get repository info — uses backup token from env
app.tool(
	"get_repo",
	{
		description: "Get information about a GitHub repository",
		parameters: z.object({
			owner: z.string().describe("Repository owner"),
			repo: z.string().describe("Repository name"),
		}),
		secrets: ["GITHUB_TOKEN"],
	},
	async (args, context) => {
		const token = context.getSecret("GITHUB_TOKEN");

		const response = await fetch(
			`https://api.github.com/repos/${args.owner}/${args.repo}`,
			{
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: "application/vnd.github.v3+json",
					"User-Agent": "arcade-mcp-github-tools",
				},
			},
		);

		if (!response.ok) {
			throw new Error(
				`Failed to get ${args.owner}/${args.repo}: ${response.statusText}`,
			);
		}

		const data = await response.json();
		return {
			name: data.full_name,
			description: data.description,
			stars: data.stargazers_count,
			forks: data.forks_count,
			language: data.language,
			url: data.html_url,
		};
	},
);

app.run({ transport: "http", port: 8000 });
