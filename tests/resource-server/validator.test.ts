import { describe, expect, it } from "vitest";
import {
	AuthenticationError,
	InvalidTokenError,
	ResourceServerValidator,
	TokenExpiredError,
} from "../../src/resource-server/validator.js";
import type { ResourceOwner } from "../../src/types.js";

describe("ResourceServerValidator", () => {
	it("is abstract and requires validateToken implementation", () => {
		class TestValidator extends ResourceServerValidator {
			async validateToken(): Promise<ResourceOwner> {
				return { userId: "test", claims: {} };
			}
		}

		const v = new TestValidator();
		expect(v.supportsOAuthDiscovery()).toBe(false);
		expect(v.getResourceMetadata()).toBeNull();
	});
});

describe("Auth errors", () => {
	it("AuthenticationError", () => {
		const err = new AuthenticationError("auth failed");
		expect(err.name).toBe("AuthenticationError");
		expect(err).toBeInstanceOf(Error);
	});

	it("TokenExpiredError extends AuthenticationError", () => {
		const err = new TokenExpiredError();
		expect(err.name).toBe("TokenExpiredError");
		expect(err).toBeInstanceOf(AuthenticationError);
		expect(err.message).toBe("Token has expired");
	});

	it("InvalidTokenError extends AuthenticationError", () => {
		const err = new InvalidTokenError("bad sig");
		expect(err.name).toBe("InvalidTokenError");
		expect(err).toBeInstanceOf(AuthenticationError);
		expect(err.message).toBe("bad sig");
	});
});
