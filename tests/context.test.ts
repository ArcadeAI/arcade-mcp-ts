import { describe, expect, it } from "vitest";
import {
	Context,
	getCurrentContext,
	setCurrentContext,
} from "../src/context.js";

function makeExtra() {
	return {
		signal: new AbortController().signal,
		requestId: "req-123",
		sessionId: "session-456",
		sendNotification: async () => {},
		sendRequest: async () => ({}),
	} as never;
}

describe("Context", () => {
	it("creates with defaults", () => {
		const ctx = new Context(makeExtra(), {
			requestId: "req-123",
			sessionId: "session-456",
		});

		expect(ctx.requestId).toBe("req-123");
		expect(ctx.sessionId).toBe("session-456");
		expect(ctx.signal).toBeInstanceOf(AbortSignal);
	});

	it("getSecret returns secret value", () => {
		const ctx = new Context(makeExtra(), {
			requestId: "req",
			toolContext: {
				secrets: { API_KEY: "abc123" },
				metadata: {},
			},
		});

		expect(ctx.getSecret("API_KEY")).toBe("abc123");
	});

	it("getSecret throws for missing secret", () => {
		const ctx = new Context(makeExtra(), {
			requestId: "req",
			toolContext: { secrets: {}, metadata: {} },
		});

		expect(() => ctx.getSecret("MISSING")).toThrow(
			"Secret 'MISSING' not found",
		);
	});

	it("getAuthToken returns token", () => {
		const ctx = new Context(makeExtra(), {
			requestId: "req",
			toolContext: {
				authToken: "token123",
				secrets: {},
				metadata: {},
			},
		});

		expect(ctx.getAuthToken()).toBe("token123");
	});

	it("getAuthToken throws when missing", () => {
		const ctx = new Context(makeExtra(), {
			requestId: "req",
			toolContext: { secrets: {}, metadata: {} },
		});

		expect(() => ctx.getAuthToken()).toThrow("Auth token not found");
	});

	it("getAuthTokenOrEmpty returns empty string when missing", () => {
		const ctx = new Context(makeExtra(), {
			requestId: "req",
			toolContext: { secrets: {}, metadata: {} },
		});

		expect(ctx.getAuthTokenOrEmpty()).toBe("");
	});

	it("userId comes from resource owner", () => {
		const ctx = new Context(makeExtra(), {
			requestId: "req",
			resourceOwner: {
				userId: "user-from-token",
				claims: {},
			},
		});

		expect(ctx.userId).toBe("user-from-token");
	});

	it("userId falls back to toolContext", () => {
		const ctx = new Context(makeExtra(), {
			requestId: "req",
			toolContext: {
				secrets: {},
				metadata: {},
				userId: "user-from-settings",
			},
		});

		expect(ctx.userId).toBe("user-from-settings");
	});

	it("setToolContext / getToolContext round-trips", () => {
		const ctx = new Context(makeExtra(), {
			requestId: "req",
		});

		ctx.setToolContext({
			secrets: { KEY: "val" },
			metadata: { foo: "bar" },
			authToken: "tok",
		});

		const data = ctx.getToolContext();
		expect(data.secrets.KEY).toBe("val");
		expect(data.authToken).toBe("tok");
	});
});

describe("getCurrentContext / setCurrentContext", () => {
	it("starts null", () => {
		setCurrentContext(null);
		expect(getCurrentContext()).toBeNull();
	});

	it("sets and gets context", () => {
		const ctx = new Context(makeExtra(), { requestId: "req" });
		setCurrentContext(ctx);
		expect(getCurrentContext()).toBe(ctx);
		setCurrentContext(null); // cleanup
	});

	it("returns previous context on set", () => {
		const ctx1 = new Context(makeExtra(), { requestId: "req1" });
		const ctx2 = new Context(makeExtra(), { requestId: "req2" });

		setCurrentContext(ctx1);
		const prev = setCurrentContext(ctx2);
		expect(prev).toBe(ctx1);
		expect(getCurrentContext()).toBe(ctx2);
		setCurrentContext(null);
	});
});

describe("Context facades", () => {
	it("has log facade", () => {
		const ctx = new Context(makeExtra(), { requestId: "req" });
		expect(ctx.log).toBeDefined();
		// Should not throw
		ctx.log.info("test message");
		ctx.log.debug("debug");
		ctx.log.warning("warn");
		ctx.log.error("err");
	});

	it("has progress facade", () => {
		const ctx = new Context(makeExtra(), { requestId: "req" });
		expect(ctx.progress).toBeDefined();
	});

	it("has tools facade", () => {
		const ctx = new Context(makeExtra(), { requestId: "req" });
		expect(ctx.tools).toBeDefined();
	});

	it("has sampling facade", () => {
		const ctx = new Context(makeExtra(), { requestId: "req" });
		expect(ctx.sampling).toBeDefined();
	});

	it("has ui facade", () => {
		const ctx = new Context(makeExtra(), { requestId: "req" });
		expect(ctx.ui).toBeDefined();
	});
});
