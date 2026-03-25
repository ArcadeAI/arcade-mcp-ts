import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { MaterializedTool } from "./types.js";

/**
 * Config object returned by createMcpToolConfig, suitable for
 * passing to McpServer.registerTool().
 */
export interface McpToolConfig {
  title?: string;
  description: string;
  annotations?: ToolAnnotations;
  _meta?: Record<string, unknown>;
}

/**
 * Build the MCP tool registration config from a MaterializedTool.
 *
 * Handles:
 * - Deprecation message injection into description
 * - Behavior → ToolAnnotations mapping
 * - _meta.arcade structure via buildArcadeMeta()
 */
export function createMcpToolConfig(tool: MaterializedTool): McpToolConfig {
  // Description with optional deprecation prefix
  const description = tool.deprecationMessage
    ? `[DEPRECATED: ${tool.deprecationMessage}] ${tool.description}`
    : tool.description;

  // Title
  const title = tool.title ?? tool.name;

  // Annotations from behavior hints
  const annotations: ToolAnnotations = { title };
  if (tool.behavior) {
    if (tool.behavior.readOnly !== undefined)
      annotations.readOnlyHint = tool.behavior.readOnly;
    if (tool.behavior.destructive !== undefined)
      annotations.destructiveHint = tool.behavior.destructive;
    if (tool.behavior.idempotent !== undefined)
      annotations.idempotentHint = tool.behavior.idempotent;
    if (tool.behavior.openWorld !== undefined)
      annotations.openWorldHint = tool.behavior.openWorld;
  }

  // _meta.arcade
  const arcadeMeta = buildArcadeMeta(tool);
  const _meta = arcadeMeta ? { arcade: arcadeMeta } : undefined;

  return { title, description, annotations, _meta };
}

/**
 * Convert a ToolAuthorization to the Python-compatible wire format
 * used in `_meta.arcade.requirements.authorization`.
 *
 * Mapping:
 *   providerId  → provider_id
 *   providerType → provider_type
 *   id          → id
 *   scopes      → oauth2.scopes  (nested under provider type key)
 */
function toWireAuthorization(
  auth: import("./auth/types.js").ToolAuthorization,
): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    provider_id: auth.providerId,
    provider_type: auth.providerType,
  };
  if (auth.id !== undefined) wire.id = auth.id;
  if (auth.scopes?.length) {
    wire[auth.providerType] = { scopes: auth.scopes };
  }
  return wire;
}

/**
 * Build the `_meta.arcade` structure from a MaterializedTool's
 * requirements (auth, secrets, metadata) and behavioral metadata.
 *
 * Returns null if there is nothing to include.
 */
export function buildArcadeMeta(
  tool: MaterializedTool,
): Record<string, unknown> | null {
  const arcadeMeta: Record<string, unknown> = {};

  // Requirements
  const requirements: Record<string, unknown> = {};
  if (tool.auth) requirements.authorization = toWireAuthorization(tool.auth);
  if (tool.secrets?.length) requirements.secrets = tool.secrets;
  if (tool.metadata && Object.keys(tool.metadata).length > 0)
    requirements.metadata = tool.metadata;

  if (Object.keys(requirements).length > 0) {
    arcadeMeta.requirements = requirements;
  }

  // Metadata (behavior)
  if (tool.behavior) {
    arcadeMeta.metadata = { behavior: tool.behavior };
  }

  return Object.keys(arcadeMeta).length > 0 ? arcadeMeta : null;
}

/**
 * Convert a value to MCP TextContent list.
 *
 * - null/undefined → []
 * - string/boolean/number → [{type:"text", text}]
 * - Buffer/Uint8Array → [{type:"text", text: base64}]
 * - object/array → [{type:"text", text: JSON.stringify}]
 */
export function convertToMcpContent(
  value: unknown,
): Array<{ type: "text"; text: string }> {
  if (value === null || value === undefined) return [];

  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return [{ type: "text", text: String(value) }];
  }

  // Binary data → base64
  if (value instanceof Uint8Array) {
    const base64 =
      typeof Buffer !== "undefined"
        ? Buffer.from(value).toString("base64")
        : btoa(String.fromCharCode(...value));
    return [{ type: "text", text: base64 }];
  }

  // Objects and arrays → JSON
  if (typeof value === "object") {
    return [{ type: "text", text: JSON.stringify(value) }];
  }

  // Fallback
  return [{ type: "text", text: String(value) }];
}

/**
 * Convert a value to MCP structured content (JSON object).
 *
 * - null/undefined → null
 * - Plain object (not array) → returned as-is
 * - Everything else → { result: value }
 */
export function convertContentToStructuredContent(
  value: unknown,
): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;

  if (
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array)
  ) {
    return value as Record<string, unknown>;
  }

  return { result: value };
}
