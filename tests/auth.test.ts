import { describe, expect, it } from "vitest";
import * as auth from "../src/auth/index.js";

describe("auth providers", () => {
	it("GitHub creates correct authorization", () => {
		const result = auth.GitHub({ scopes: ["repo", "user"] });
		expect(result.providerId).toBe("github");
		expect(result.providerType).toBe("oauth2");
		expect(result.scopes).toEqual(["repo", "user"]);
	});

	it("Google creates correct authorization", () => {
		const result = auth.Google({
			scopes: ["https://www.googleapis.com/auth/calendar"],
		});
		expect(result.providerId).toBe("google");
		expect(result.providerType).toBe("oauth2");
	});

	it("Slack creates correct authorization with id", () => {
		const result = auth.Slack({ id: "my-slack", scopes: ["chat:write"] });
		expect(result.providerId).toBe("slack");
		expect(result.id).toBe("my-slack");
		expect(result.scopes).toEqual(["chat:write"]);
	});

	it("all providers return valid ToolAuthorization", () => {
		const providers = [
			auth.Asana,
			auth.Atlassian,
			auth.Attio,
			auth.ClickUp,
			auth.Discord,
			auth.Dropbox,
			auth.Figma,
			auth.GitHub,
			auth.Google,
			auth.Hubspot,
			auth.Linear,
			auth.LinkedIn,
			auth.Microsoft,
			auth.Notion,
			auth.PagerDuty,
			auth.Reddit,
			auth.Slack,
			auth.Spotify,
			auth.Twitch,
			auth.X,
			auth.Zoom,
		];

		for (const provider of providers) {
			const result = provider();
			expect(result.providerType).toBe("oauth2");
			expect(typeof result.providerId).toBe("string");
			expect(result.providerId.length).toBeGreaterThan(0);
		}
	});

	it("providers work without options", () => {
		const result = auth.GitHub();
		expect(result.providerId).toBe("github");
		expect(result.scopes).toBeUndefined();
		expect(result.id).toBeUndefined();
	});
});
