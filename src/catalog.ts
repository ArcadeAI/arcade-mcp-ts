import type { z } from "zod";
import { ToolDefinitionError } from "./errors.js";
import {
  type MaterializedTool,
  TOOL_NAME_SEPARATOR,
  type ToolDefinition,
  type ToolHandler,
  type ToolkitInfo,
  type ToolOptions,
} from "./types.js";

/**
 * Semver regex — MAJOR.MINOR.PATCH with optional prerelease/build metadata.
 */
const SEMVER_REGEX =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/**
 * Normalize a version string to full semver.
 * Strips leading "v"/"V", expands partial versions (e.g. "1" → "1.0.0", "1.2" → "1.2.0").
 * Throws ToolDefinitionError on invalid input.
 */
export function normalizeVersion(version: string): string {
  let v = version.trim();
  if (v.startsWith("v") || v.startsWith("V")) {
    v = v.slice(1);
  }

  // Expand partial versions
  const parts = v.split(".");
  if (parts.length === 1 && /^\d+$/.test(parts[0])) {
    v = `${parts[0]}.0.0`;
  } else if (
    parts.length === 2 &&
    /^\d+$/.test(parts[0]) &&
    /^\d+$/.test(parts[1])
  ) {
    v = `${parts[0]}.${parts[1]}.0`;
  }

  if (!SEMVER_REGEX.test(v)) {
    throw new ToolDefinitionError(
      `Invalid version '${version}': must be a valid semver string (e.g. "1.0.0")`,
    );
  }

  return v;
}

/**
 * Stores and manages materialized tools. Build-time registry
 * that is handed to the server when app.run() is called.
 */
export class ToolCatalog {
  private tools = new Map<string, MaterializedTool>();
  private disabledTools: Set<string>;
  private disabledToolkits: Set<string>;

  constructor() {
    this.disabledTools = new Set(
      (process.env.ARCADE_DISABLED_TOOLS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    this.disabledToolkits = new Set(
      (process.env.ARCADE_DISABLED_TOOLKITS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }

  /**
   * Add a tool to the catalog.
   */
  addTool<T extends z.ZodType>(
    name: string,
    options: ToolOptions<T>,
    handler: ToolHandler<z.infer<T>>,
    toolkit?: ToolkitInfo,
  ): void {
    // Per-tool toolkit override merges with (and wins over) app-level toolkit
    const resolved: ToolkitInfo | undefined =
      options.toolkit && toolkit
        ? {
            name: options.toolkit.name ?? toolkit.name,
            version: options.toolkit.version ?? toolkit.version,
            description: options.toolkit.description ?? toolkit.description,
          }
        : options.toolkit
          ? { name: options.toolkit.name ?? name, ...options.toolkit }
          : toolkit;

    const toolkitName = resolved?.name;
    const fqn = toolkitName
      ? `${toolkitName}${TOOL_NAME_SEPARATOR}${name}`
      : name;

    if (this.disabledTools.has(fqn) || this.disabledTools.has(name)) {
      return;
    }
    if (toolkitName && this.disabledToolkits.has(toolkitName)) {
      return;
    }

    if (this.tools.has(fqn)) {
      throw new ToolDefinitionError(
        `Tool '${fqn}' is already registered in the catalog`,
      );
    }

    const normalizedVersion = resolved?.version
      ? normalizeVersion(resolved.version)
      : undefined;

    const now = new Date();
    this.tools.set(fqn, {
      name,
      fullyQualifiedName: fqn,
      description: options.description,
      handler: handler as ToolHandler,
      parameters: options.parameters,
      auth: options.auth,
      secrets: options.secrets,
      metadata: options.metadata,
      toolkitName,
      toolkitVersion: normalizedVersion,
      toolkitDescription: resolved?.description,
      dateAdded: now,
      dateUpdated: now,
    });
  }

  /**
   * Look up a tool by fully-qualified name.
   */
  getTool(name: string): MaterializedTool | undefined {
    return this.tools.get(name) ?? this.getToolByName(name);
  }

  /**
   * Look up a tool by short name (without toolkit prefix).
   */
  getToolByName(name: string): MaterializedTool | undefined {
    for (const tool of this.tools.values()) {
      if (tool.name === name) return tool;
    }
    return undefined;
  }

  /**
   * Get all tools as an iterable.
   */
  getAll(): IterableIterator<MaterializedTool> {
    return this.tools.values();
  }

  /**
   * Get all tool names.
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Check if a tool is registered.
   */
  has(name: string): boolean {
    return this.tools.has(name) || this.getToolByName(name) !== undefined;
  }

  /**
   * Number of tools in the catalog.
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * Whether the catalog has no tools.
   */
  get isEmpty(): boolean {
    return this.tools.size === 0;
  }

  /**
   * Remove all tools from the catalog.
   */
  clear(): void {
    this.tools.clear();
  }

  /**
   * Remove a tool from the catalog.
   */
  removeTool(name: string): boolean {
    if (this.tools.delete(name)) return true;
    // Try by short name
    for (const [fqn, tool] of this.tools) {
      if (tool.name === name) {
        this.tools.delete(fqn);
        return true;
      }
    }
    return false;
  }

  /**
   * Convert all tools to wire-format definitions.
   */
  toDefinitions(): ToolDefinition[] {
    const defs: ToolDefinition[] = [];
    for (const tool of this.tools.values()) {
      defs.push(toToolDefinition(tool));
    }
    return defs;
  }
}

/**
 * Convert a MaterializedTool to its wire-format ToolDefinition.
 */
export function toToolDefinition(tool: MaterializedTool): ToolDefinition {
  const zodToJsonSchema = zodToJson(tool.parameters);

  return {
    name: tool.fullyQualifiedName,
    description: tool.description,
    inputSchema: zodToJsonSchema,
    auth: tool.auth,
    secrets: tool.secrets,
    metadata: tool.metadata,
    toolkit: tool.toolkitName
      ? {
          name: tool.toolkitName,
          version: tool.toolkitVersion,
          description: tool.toolkitDescription,
        }
      : undefined,
  };
}

/**
 * Simple Zod-to-JSON-Schema conversion for tool parameters.
 * Leverages Zod's built-in JSON schema generation.
 */
function zodToJson(schema: z.ZodType): Record<string, unknown> {
  // Use Zod's built-in method if available (Zod 3.23+)
  if ("_def" in schema) {
    const def = (schema as unknown as { _def: Record<string, unknown> })._def;

    // ZodObject — most common case for tool parameters
    if (def.typeName === "ZodObject") {
      const shape = (schema as unknown as { shape: Record<string, z.ZodType> })
        .shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJson(value as z.ZodType);
        if (!isOptional(value as z.ZodType)) {
          required.push(key);
        }
      }

      return {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
      };
    }

    // ZodString
    if (def.typeName === "ZodString") {
      const result: Record<string, unknown> = { type: "string" };
      if (def.description) result.description = def.description;
      return result;
    }

    // ZodNumber
    if (def.typeName === "ZodNumber") {
      const result: Record<string, unknown> = { type: "number" };
      if (def.description) result.description = def.description;
      return result;
    }

    // ZodBoolean
    if (def.typeName === "ZodBoolean") {
      const result: Record<string, unknown> = { type: "boolean" };
      if (def.description) result.description = def.description;
      return result;
    }

    // ZodArray
    if (def.typeName === "ZodArray") {
      return {
        type: "array",
        items: zodToJson(def.type as z.ZodType),
        ...(def.description ? { description: def.description } : {}),
      };
    }

    // ZodEnum
    if (def.typeName === "ZodEnum") {
      return {
        type: "string",
        enum: (def as { values: string[] }).values,
        ...(def.description ? { description: def.description } : {}),
      };
    }

    // ZodOptional
    if (def.typeName === "ZodOptional") {
      return zodToJson(def.innerType as z.ZodType);
    }

    // ZodDefault
    if (def.typeName === "ZodDefault") {
      const inner = zodToJson(def.innerType as z.ZodType);
      return {
        ...inner,
        default: (def as { defaultValue: () => unknown }).defaultValue(),
      };
    }

    // ZodNullable
    if (def.typeName === "ZodNullable") {
      const inner = zodToJson(def.innerType as z.ZodType);
      return { ...inner, nullable: true };
    }

    // ZodDescription wrapper
    if (def.description) {
      return { type: "string", description: def.description as string };
    }
  }

  // Fallback
  return { type: "object" };
}

function isOptional(schema: z.ZodType): boolean {
  const def = (schema as unknown as { _def: Record<string, unknown> })._def;
  return (
    def.typeName === "ZodOptional" ||
    def.typeName === "ZodDefault" ||
    (def.typeName === "ZodNullable" && isOptional(def.innerType as z.ZodType))
  );
}
