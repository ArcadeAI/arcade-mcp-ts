/**
 * Converts MaterializedTool instances to the Python-compatible worker wire format.
 * Handles Zod schema → Python ValueSchema/InputParameter conversion.
 */
import type { z } from "zod";
import type { ToolAuthorization } from "../auth/types.js";
import type { MaterializedTool } from "../types.js";
import type {
  WorkerInputParameter,
  WorkerToolAuthRequirement,
  WorkerToolDefinition,
  WorkerToolMetadataRequirement,
  WorkerToolOutput,
  WorkerToolRequirements,
  WorkerToolSecretRequirement,
  WorkerValueSchema,
} from "./types.js";

/**
 * Convert a MaterializedTool to the Python-compatible WorkerToolDefinition.
 */
export function toWorkerToolDefinition(
  tool: MaterializedTool,
): WorkerToolDefinition {
  const parameters = zodToInputParameters(tool.parameters);

  return {
    name: tool.name,
    fully_qualified_name: tool.fullyQualifiedName,
    description: tool.description,
    toolkit: {
      name: tool.toolkitName ?? tool.name,
      description: tool.toolkitDescription ?? null,
      version: tool.toolkitVersion ?? null,
    },
    input: {
      parameters,
    },
    output: toWorkerToolOutput(),
    requirements: toWorkerRequirements(tool),
    deprecation_message: tool.deprecationMessage ?? null,
    metadata: tool.metadata ?? null,
  };
}

/**
 * Convert Zod schema to Python-compatible InputParameter array.
 */
function zodToInputParameters(schema: z.ZodType): WorkerInputParameter[] {
  const def = (schema as unknown as { _def: Record<string, unknown> })._def;
  if (def.typeName !== "ZodObject") return [];

  const shape = (schema as unknown as { shape: Record<string, z.ZodType> })
    .shape;
  const params: WorkerInputParameter[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const { innerSchema, optional } = unwrapOptional(value as z.ZodType);
    const innerDef = (
      innerSchema as unknown as { _def: Record<string, unknown> }
    )._def;

    params.push({
      name: key,
      required: !optional,
      description: (innerDef.description as string) ?? null,
      value_schema: zodToValueSchema(innerSchema),
      inferrable: true,
    });
  }

  return params;
}

/**
 * Convert a single Zod type to a Python ValueSchema.
 */
function zodToValueSchema(schema: z.ZodType): WorkerValueSchema {
  const def = (schema as unknown as { _def: Record<string, unknown> })._def;

  // Unwrap wrappers
  if (
    def.typeName === "ZodOptional" ||
    def.typeName === "ZodNullable" ||
    def.typeName === "ZodDefault"
  ) {
    return zodToValueSchema(unwrapOptional(schema).innerSchema);
  }

  if (def.typeName === "ZodString") {
    return {
      val_type: "string",
      description: (def.description as string) ?? null,
    };
  }

  if (def.typeName === "ZodNumber") {
    // Check for integer checks
    const checks = (def.checks as Array<{ kind: string }>) ?? [];
    const isInt = checks.some((c) => c.kind === "int");
    return {
      val_type: isInt ? "integer" : "number",
      description: (def.description as string) ?? null,
    };
  }

  if (def.typeName === "ZodBoolean") {
    return {
      val_type: "boolean",
      description: (def.description as string) ?? null,
    };
  }

  if (def.typeName === "ZodEnum") {
    return {
      val_type: "string",
      enum: (def as { values: string[] }).values,
      description: (def.description as string) ?? null,
    };
  }

  if (def.typeName === "ZodArray") {
    const itemSchema = zodToValueSchema(def.type as z.ZodType);
    const innerDef = (def.type as unknown as { _def: Record<string, unknown> })
      ._def;
    const isJsonItem = innerDef.typeName === "ZodObject";

    return {
      val_type: "array",
      inner_val_type:
        itemSchema.val_type === "array" ? "json" : itemSchema.val_type,
      inner_properties: isJsonItem
        ? zodToObjectProperties(def.type as z.ZodType)
        : null,
      description: (def.description as string) ?? null,
    };
  }

  if (def.typeName === "ZodObject") {
    return {
      val_type: "json",
      properties: zodToObjectProperties(schema),
      description: (def.description as string) ?? null,
    };
  }

  // Fallback
  return { val_type: "string" };
}

/**
 * Extract properties from a ZodObject as a map of WorkerValueSchema.
 */
function zodToObjectProperties(
  schema: z.ZodType,
): Record<string, WorkerValueSchema> {
  const shape = (schema as unknown as { shape: Record<string, z.ZodType> })
    .shape;
  if (!shape) return {};

  const props: Record<string, WorkerValueSchema> = {};
  for (const [key, value] of Object.entries(shape)) {
    const { innerSchema } = unwrapOptional(value as z.ZodType);
    props[key] = zodToValueSchema(innerSchema);
  }
  return props;
}

/**
 * Unwrap ZodOptional/ZodDefault/ZodNullable to get the inner schema.
 */
function unwrapOptional(schema: z.ZodType): {
  innerSchema: z.ZodType;
  optional: boolean;
} {
  const def = (schema as unknown as { _def: Record<string, unknown> })._def;

  if (def.typeName === "ZodOptional") {
    return { innerSchema: def.innerType as z.ZodType, optional: true };
  }
  if (def.typeName === "ZodDefault") {
    return { innerSchema: def.innerType as z.ZodType, optional: true };
  }
  if (def.typeName === "ZodNullable") {
    const inner = unwrapOptional(def.innerType as z.ZodType);
    return { innerSchema: inner.innerSchema, optional: inner.optional };
  }

  return { innerSchema: schema, optional: false };
}

/**
 * Convert tool auth to Python WorkerToolAuthRequirement.
 */
function toWorkerAuthRequirement(
  auth?: ToolAuthorization,
): WorkerToolAuthRequirement | null {
  if (!auth) return null;

  return {
    provider_id: auth.providerId ?? null,
    provider_type: auth.providerType,
    id: auth.id ?? null,
    oauth2: { scopes: auth.scopes ?? [] },
  };
}

/**
 * Convert tool requirements to Python format.
 */
function toWorkerRequirements(tool: MaterializedTool): WorkerToolRequirements {
  const secrets: WorkerToolSecretRequirement[] | null = tool.secrets?.length
    ? tool.secrets.map((key) => ({ key }))
    : null;

  const metadata: WorkerToolMetadataRequirement[] | null = tool.metadata
    ? Object.keys(tool.metadata).map((key) => ({ key }))
    : null;

  return {
    authorization: toWorkerAuthRequirement(tool.auth),
    secrets,
    metadata,
  };
}

/**
 * Default tool output definition.
 * TypeScript tools don't declare output schemas, so we use a generic default.
 */
function toWorkerToolOutput(): WorkerToolOutput {
  return {
    description: null,
    available_modes: ["value", "error", "null"],
    value_schema: null,
  };
}
