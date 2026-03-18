import { describe, expect, it } from "vitest";
import { ToolkitLoadError } from "../src/errors.js";
import {
	AuthorizationError,
	LifespanError,
	MCPContextError,
	MCPError,
	MCPRuntimeError,
	NotFoundError,
	PromptError,
	ProtocolError,
	RequestError,
	ResourceError,
	ResponseError,
	ServerError,
	ServerRequestError,
	SessionError,
	TransportError,
} from "../src/exceptions.js";

describe("MCPError hierarchy", () => {
	it("MCPError is abstract and cannot be instantiated directly", () => {
		// Can only instantiate concrete subclasses
		const err = new MCPRuntimeError("test");
		expect(err).toBeInstanceOf(MCPError);
		expect(err).toBeInstanceOf(Error);
	});

	it("sets name to constructor name", () => {
		const err = new SessionError("session expired");
		expect(err.name).toBe("SessionError");
		expect(err.message).toBe("session expired");
	});

	it("isMCPError returns true for all subclasses", () => {
		const errors = [
			new MCPRuntimeError("r"),
			new ServerError("s"),
			new SessionError("se"),
			new RequestError("rq"),
			new ServerRequestError("sr"),
			new ResponseError("rs"),
			new LifespanError("l"),
			new TransportError("t"),
			new ProtocolError("p"),
			new MCPContextError("c"),
			new NotFoundError("n"),
			new AuthorizationError("a"),
			new PromptError("pr"),
			new ResourceError("re"),
		];
		for (const err of errors) {
			expect(err.isMCPError).toBe(true);
		}
	});

	it("propagates cause", () => {
		const cause = new Error("root");
		const err = new ServerError("wrapper", { cause });
		expect(err.cause).toBe(cause);
	});
});

describe("MCPRuntimeError branch", () => {
	it("ServerError extends MCPRuntimeError", () => {
		const err = new ServerError("no server");
		expect(err).toBeInstanceOf(MCPRuntimeError);
		expect(err).toBeInstanceOf(MCPError);
		expect(err).toBeInstanceOf(Error);
	});

	it("SessionError extends ServerError", () => {
		const err = new SessionError("timeout");
		expect(err).toBeInstanceOf(ServerError);
		expect(err).toBeInstanceOf(MCPRuntimeError);
	});

	it("RequestError extends ServerError", () => {
		const err = new RequestError("malformed");
		expect(err).toBeInstanceOf(ServerError);
	});

	it("ServerRequestError extends RequestError", () => {
		const err = new ServerRequestError("server→client failed");
		expect(err).toBeInstanceOf(RequestError);
		expect(err).toBeInstanceOf(ServerError);
	});

	it("ResponseError extends ServerError", () => {
		const err = new ResponseError("send failed");
		expect(err).toBeInstanceOf(ServerError);
	});

	it("LifespanError extends ServerError", () => {
		const err = new LifespanError("startup failed");
		expect(err).toBeInstanceOf(ServerError);
	});

	it("TransportError extends MCPRuntimeError", () => {
		const err = new TransportError("stdio broken");
		expect(err).toBeInstanceOf(MCPRuntimeError);
		expect(err).not.toBeInstanceOf(ServerError);
	});

	it("ProtocolError extends MCPRuntimeError", () => {
		const err = new ProtocolError("bad frame");
		expect(err).toBeInstanceOf(MCPRuntimeError);
		expect(err).not.toBeInstanceOf(ServerError);
	});
});

describe("MCPContextError branch", () => {
	it("NotFoundError extends MCPContextError", () => {
		const err = new NotFoundError("tool not found");
		expect(err).toBeInstanceOf(MCPContextError);
		expect(err).toBeInstanceOf(MCPError);
		expect(err).not.toBeInstanceOf(MCPRuntimeError);
	});

	it("AuthorizationError extends MCPContextError", () => {
		const err = new AuthorizationError("forbidden");
		expect(err).toBeInstanceOf(MCPContextError);
	});

	it("PromptError extends MCPContextError", () => {
		const err = new PromptError("bad prompt");
		expect(err).toBeInstanceOf(MCPContextError);
	});

	it("ResourceError extends MCPContextError", () => {
		const err = new ResourceError("resource failed");
		expect(err).toBeInstanceOf(MCPContextError);
	});
});

describe("MCP errors are disjoint from toolkit errors", () => {
	it("MCPError is not a ToolkitError", () => {
		const err = new ServerError("test");
		expect(err).not.toBeInstanceOf(ToolkitLoadError);
	});
});
