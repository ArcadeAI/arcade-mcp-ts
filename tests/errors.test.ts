import { describe, expect, it } from "vitest";
import {
  ContextRequiredToolError,
  ErrorKind,
  FatalToolError,
  RetryableToolError,
  ToolDefinitionError,
  ToolExecutionError,
  ToolInputError,
  ToolInputSchemaError,
  ToolkitLoadError,
  ToolOutputError,
  ToolOutputSchemaError,
  ToolResponseExtractionError,
  ToolSerializationError,
  UpstreamError,
  UpstreamRateLimitError,
} from "../src/errors.js";

describe("ErrorKind enum", () => {
  it("has all expected values", () => {
    expect(ErrorKind.TOOLKIT_LOAD_FAILED).toBe("toolkit_load_failed");
    expect(ErrorKind.TOOL_RUNTIME_RETRY).toBe("tool_runtime_retry");
    expect(ErrorKind.UPSTREAM_RUNTIME_RATE_LIMIT).toBe(
      "upstream_runtime_rate_limit",
    );
    expect(ErrorKind.UNKNOWN).toBe("unknown");
  });
});

describe("ToolkitLoadError", () => {
  it("has correct kind and canRetry", () => {
    const err = new ToolkitLoadError("failed to load");
    expect(err.kind).toBe(ErrorKind.TOOLKIT_LOAD_FAILED);
    expect(err.canRetry).toBe(false);
    expect(err.message).toBe("failed to load");
    expect(err.name).toBe("ToolkitLoadError");
  });

  it("isToolkitError is true", () => {
    const err = new ToolkitLoadError("test");
    expect(err.isToolkitError).toBe(true);
    expect(err.isToolError).toBe(false);
  });
});

describe("ToolDefinitionError hierarchy", () => {
  it("ToolDefinitionError has correct kind", () => {
    const err = new ToolDefinitionError("bad def");
    expect(err.kind).toBe(ErrorKind.TOOL_DEFINITION_BAD_DEFINITION);
    expect(err.isToolError).toBe(true);
  });

  it("ToolInputSchemaError overrides kind", () => {
    const err = new ToolInputSchemaError("bad input schema");
    expect(err.kind).toBe(ErrorKind.TOOL_DEFINITION_BAD_INPUT_SCHEMA);
  });

  it("ToolOutputSchemaError overrides kind", () => {
    const err = new ToolOutputSchemaError("bad output schema");
    expect(err.kind).toBe(ErrorKind.TOOL_DEFINITION_BAD_OUTPUT_SCHEMA);
  });
});

describe("ToolSerializationError", () => {
  it("has correct kind and name", () => {
    const err = new ToolSerializationError("marshal failed");
    expect(err.kind).toBe(ErrorKind.TOOL_SERIALIZATION);
    expect(err.name).toBe("ToolSerializationError");
    expect(err.isToolError).toBe(true);
  });
});

describe("ToolInputError", () => {
  it("has correct kind and statusCode", () => {
    const err = new ToolInputError("bad input");
    expect(err.kind).toBe(ErrorKind.TOOL_RUNTIME_BAD_INPUT_VALUE);
    expect(err.statusCode).toBe(400);
  });
});

describe("ToolOutputError", () => {
  it("has correct kind and statusCode", () => {
    const err = new ToolOutputError("bad output");
    expect(err.kind).toBe(ErrorKind.TOOL_RUNTIME_BAD_OUTPUT_VALUE);
    expect(err.statusCode).toBe(500);
  });
});

describe("RetryableToolError", () => {
  it("has canRetry = true", () => {
    const err = new RetryableToolError("retry me");
    expect(err.canRetry).toBe(true);
    expect(err.kind).toBe(ErrorKind.TOOL_RUNTIME_RETRY);
  });
});

describe("ContextRequiredToolError", () => {
  it("has correct kind", () => {
    const err = new ContextRequiredToolError("need context", {
      additionalPromptContent: "Please provide X",
    });
    expect(err.kind).toBe(ErrorKind.TOOL_RUNTIME_CONTEXT_REQUIRED);
    expect(err.additionalPromptContent).toBe("Please provide X");
  });
});

describe("FatalToolError", () => {
  it("has correct kind and statusCode", () => {
    const err = new FatalToolError("fatal");
    expect(err.kind).toBe(ErrorKind.TOOL_RUNTIME_FATAL);
    expect(err.statusCode).toBe(500);
  });
});

describe("ToolExecutionError", () => {
  it("has correct kind and statusCode", () => {
    const err = new ToolExecutionError("handler threw");
    expect(err.kind).toBe(ErrorKind.TOOL_RUNTIME_EXECUTION);
    expect(err.name).toBe("ToolExecutionError");
    expect(err.statusCode).toBe(500);
  });
});

describe("ToolResponseExtractionError", () => {
  it("has correct kind and statusCode", () => {
    const err = new ToolResponseExtractionError("bad response shape");
    expect(err.kind).toBe(ErrorKind.TOOL_RUNTIME_RESPONSE_EXTRACTION);
    expect(err.name).toBe("ToolResponseExtractionError");
    expect(err.statusCode).toBe(500);
  });
});

describe("UpstreamError", () => {
  it("maps status codes to kinds", () => {
    expect(UpstreamError.kindFromStatusCode(400)).toBe(
      ErrorKind.UPSTREAM_RUNTIME_BAD_REQUEST,
    );
    expect(UpstreamError.kindFromStatusCode(401)).toBe(
      ErrorKind.UPSTREAM_RUNTIME_AUTH_ERROR,
    );
    expect(UpstreamError.kindFromStatusCode(403)).toBe(
      ErrorKind.UPSTREAM_RUNTIME_AUTH_ERROR,
    );
    expect(UpstreamError.kindFromStatusCode(404)).toBe(
      ErrorKind.UPSTREAM_RUNTIME_NOT_FOUND,
    );
    expect(UpstreamError.kindFromStatusCode(422)).toBe(
      ErrorKind.UPSTREAM_RUNTIME_VALIDATION_ERROR,
    );
    expect(UpstreamError.kindFromStatusCode(429)).toBe(
      ErrorKind.UPSTREAM_RUNTIME_RATE_LIMIT,
    );
    expect(UpstreamError.kindFromStatusCode(500)).toBe(
      ErrorKind.UPSTREAM_RUNTIME_SERVER_ERROR,
    );
    expect(UpstreamError.kindFromStatusCode(undefined)).toBe(
      ErrorKind.UPSTREAM_RUNTIME_UNMAPPED,
    );
  });

  it("sets kind from statusCode", () => {
    const err = new UpstreamError("upstream fail", { statusCode: 404 });
    expect(err.kind).toBe(ErrorKind.UPSTREAM_RUNTIME_NOT_FOUND);
  });
});

describe("UpstreamRateLimitError", () => {
  it("has correct kind and retryAfterMs", () => {
    const err = new UpstreamRateLimitError("rate limited", {
      retryAfterMs: 5000,
    });
    expect(err.kind).toBe(ErrorKind.UPSTREAM_RUNTIME_RATE_LIMIT);
    expect(err.retryAfterMs).toBe(5000);
  });
});

describe("withContext", () => {
  it("prepends context to message", () => {
    const err = new ToolInputError("bad value");
    err.withContext("MyTool");
    expect(err.message).toContain("MyTool");
    expect(err.message).toContain(ErrorKind.TOOL_RUNTIME_BAD_INPUT_VALUE);
  });
});

describe("toPayload", () => {
  it("serializes error to payload", () => {
    const err = new RetryableToolError("retry", {
      retryAfterMs: 1000,
      extra: { foo: "bar" },
    });
    const payload = err.toPayload();
    expect(payload.kind).toBe(ErrorKind.TOOL_RUNTIME_RETRY);
    expect(payload.message).toBe("retry");
    expect(payload.can_retry).toBe(true);
    expect(payload.retry_after_ms).toBe(1000);
    expect(payload.extra).toEqual({ foo: "bar" });
  });
});
