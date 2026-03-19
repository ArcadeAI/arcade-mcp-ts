import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  buildArcadeMeta,
  convertContentToStructuredContent,
  convertToMcpContent,
  createMcpToolConfig,
} from "../src/convert.js";
import type { MaterializedTool } from "../src/types.js";

function makeTool(overrides: Partial<MaterializedTool> = {}): MaterializedTool {
  return {
    name: "test_tool",
    fullyQualifiedName: "TestKit_test_tool",
    description: "A test tool",
    handler: async () => "ok",
    parameters: z.object({ msg: z.string() }),
    dateAdded: new Date(),
    dateUpdated: new Date(),
    ...overrides,
  };
}

// ── createMcpToolConfig ─────────────────────────────────

describe("createMcpToolConfig", () => {
  it("returns description and title for a basic tool", () => {
    const config = createMcpToolConfig(makeTool());

    expect(config.description).toBe("A test tool");
    expect(config.title).toBe("test_tool");
    expect(config.annotations).toEqual({ title: "test_tool" });
    expect(config._meta).toBeUndefined();
  });

  it("uses explicit title when provided", () => {
    const config = createMcpToolConfig(makeTool({ title: "My Tool" }));

    expect(config.title).toBe("My Tool");
    expect(config.annotations?.title).toBe("My Tool");
  });

  it("prepends deprecation message to description", () => {
    const config = createMcpToolConfig(
      makeTool({ deprecationMessage: "Use new_tool instead" }),
    );

    expect(config.description).toBe(
      "[DEPRECATED: Use new_tool instead] A test tool",
    );
  });

  it("maps behavior to annotation hints", () => {
    const config = createMcpToolConfig(
      makeTool({
        behavior: {
          readOnly: true,
          destructive: false,
          idempotent: true,
          openWorld: false,
        },
      }),
    );

    expect(config.annotations).toEqual({
      title: "test_tool",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("omits annotation hints when behavior is absent", () => {
    const config = createMcpToolConfig(makeTool());

    expect(config.annotations).toEqual({ title: "test_tool" });
    expect(config.annotations?.readOnlyHint).toBeUndefined();
  });

  it("only maps defined behavior fields", () => {
    const config = createMcpToolConfig(
      makeTool({ behavior: { readOnly: true } }),
    );

    expect(config.annotations?.readOnlyHint).toBe(true);
    expect(config.annotations?.destructiveHint).toBeUndefined();
  });

  it("builds _meta when auth is present", () => {
    const config = createMcpToolConfig(
      makeTool({
        auth: {
          providerId: "github",
          providerType: "oauth2",
          scopes: ["repo"],
        },
      }),
    );

    expect(config._meta).toEqual({
      arcade: {
        requirements: {
          authorization: {
            providerId: "github",
            providerType: "oauth2",
            scopes: ["repo"],
          },
        },
      },
    });
  });

  it("builds _meta with secrets", () => {
    const config = createMcpToolConfig(
      makeTool({ secrets: ["API_KEY", "API_SECRET"] }),
    );

    expect(config._meta?.arcade).toEqual({
      requirements: {
        secrets: ["API_KEY", "API_SECRET"],
      },
    });
  });

  it("builds _meta with behavior metadata", () => {
    const config = createMcpToolConfig(
      makeTool({ behavior: { readOnly: true, destructive: false } }),
    );

    expect(config._meta?.arcade).toEqual({
      metadata: {
        behavior: { readOnly: true, destructive: false },
      },
    });
  });

  it("builds _meta with requirements and metadata combined", () => {
    const config = createMcpToolConfig(
      makeTool({
        auth: {
          providerId: "github",
          providerType: "oauth2",
          scopes: ["repo"],
        },
        secrets: ["TOKEN"],
        behavior: { readOnly: true },
      }),
    );

    expect(config._meta?.arcade).toEqual({
      requirements: {
        authorization: {
          providerId: "github",
          providerType: "oauth2",
          scopes: ["repo"],
        },
        secrets: ["TOKEN"],
      },
      metadata: {
        behavior: { readOnly: true },
      },
    });
  });
});

// ── buildArcadeMeta ─────────────────────────────────────

describe("buildArcadeMeta", () => {
  it("returns null for a bare tool", () => {
    expect(buildArcadeMeta(makeTool())).toBeNull();
  });

  it("includes authorization", () => {
    const meta = buildArcadeMeta(
      makeTool({
        auth: {
          providerId: "google",
          providerType: "oauth2",
          scopes: ["email"],
        },
      }),
    );

    expect(meta?.requirements).toEqual({
      authorization: {
        providerId: "google",
        providerType: "oauth2",
        scopes: ["email"],
      },
    });
  });

  it("includes secrets", () => {
    const meta = buildArcadeMeta(makeTool({ secrets: ["KEY"] }));

    expect(meta?.requirements).toEqual({ secrets: ["KEY"] });
  });

  it("includes metadata from tool metadata field", () => {
    const meta = buildArcadeMeta(makeTool({ metadata: { category: "email" } }));

    expect(meta?.requirements).toEqual({
      metadata: { category: "email" },
    });
  });

  it("skips empty metadata", () => {
    const meta = buildArcadeMeta(makeTool({ metadata: {} }));
    expect(meta).toBeNull();
  });

  it("skips empty secrets", () => {
    const meta = buildArcadeMeta(makeTool({ secrets: [] }));
    expect(meta).toBeNull();
  });

  it("includes behavior in metadata", () => {
    const meta = buildArcadeMeta(makeTool({ behavior: { idempotent: true } }));

    expect(meta?.metadata).toEqual({
      behavior: { idempotent: true },
    });
  });
});

// ── convertToMcpContent ─────────────────────────────────

describe("convertToMcpContent", () => {
  it("returns empty for null", () => {
    expect(convertToMcpContent(null)).toEqual([]);
  });

  it("returns empty for undefined", () => {
    expect(convertToMcpContent(undefined)).toEqual([]);
  });

  it("wraps string as text", () => {
    expect(convertToMcpContent("hello")).toEqual([
      { type: "text", text: "hello" },
    ]);
  });

  it("wraps number as text", () => {
    expect(convertToMcpContent(42)).toEqual([{ type: "text", text: "42" }]);
  });

  it("wraps boolean as text", () => {
    expect(convertToMcpContent(true)).toEqual([{ type: "text", text: "true" }]);
  });

  it("serializes object as JSON", () => {
    const result = convertToMcpContent({ key: "value" });
    expect(result).toEqual([{ type: "text", text: '{"key":"value"}' }]);
  });

  it("serializes array as JSON", () => {
    const result = convertToMcpContent([1, 2, 3]);
    expect(result).toEqual([{ type: "text", text: "[1,2,3]" }]);
  });

  it("encodes Uint8Array as base64", () => {
    const data = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const result = convertToMcpContent(data);
    expect(result).toEqual([{ type: "text", text: "SGVsbG8=" }]);
  });

  it("encodes Buffer as base64", () => {
    const data = Buffer.from("Hello");
    const result = convertToMcpContent(data);
    expect(result).toEqual([{ type: "text", text: "SGVsbG8=" }]);
  });
});

// ── convertContentToStructuredContent ────────────────────

describe("convertContentToStructuredContent", () => {
  it("returns null for null", () => {
    expect(convertContentToStructuredContent(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(convertContentToStructuredContent(undefined)).toBeNull();
  });

  it("returns plain object as-is", () => {
    const obj = { key: "value", nested: { a: 1 } };
    expect(convertContentToStructuredContent(obj)).toBe(obj);
  });

  it("wraps array in result", () => {
    expect(convertContentToStructuredContent([1, 2])).toEqual({
      result: [1, 2],
    });
  });

  it("wraps string in result", () => {
    expect(convertContentToStructuredContent("hello")).toEqual({
      result: "hello",
    });
  });

  it("wraps number in result", () => {
    expect(convertContentToStructuredContent(42)).toEqual({
      result: 42,
    });
  });

  it("wraps boolean in result", () => {
    expect(convertContentToStructuredContent(true)).toEqual({
      result: true,
    });
  });

  it("wraps Uint8Array in result", () => {
    const data = new Uint8Array([1, 2]);
    const result = convertContentToStructuredContent(data);
    expect(result).toEqual({ result: data });
  });
});
