/**
 * Shared Zod introspection utilities for accessing internal `_def` structures.
 * Used by catalog.ts (zodToJson) and worker/convert.ts (zodToValueSchema).
 */
import type { z } from "zod";

/**
 * Access the internal `_def` property of a Zod schema.
 */
export function getZodDef(schema: z.ZodType): Record<string, unknown> {
  return (schema as unknown as { _def: Record<string, unknown> })._def;
}

/**
 * Access the `.shape` property of a ZodObject schema.
 */
export function getZodShape(schema: z.ZodType): Record<string, z.ZodType> {
  return (schema as unknown as { shape: Record<string, z.ZodType> }).shape;
}

/**
 * Unwrap ZodOptional/ZodDefault/ZodNullable to get the inner schema.
 */
export function unwrapOptional(schema: z.ZodType): {
  innerSchema: z.ZodType;
  isOptional: boolean;
} {
  const def = getZodDef(schema);

  if (def.typeName === "ZodOptional") {
    return { innerSchema: def.innerType as z.ZodType, isOptional: true };
  }
  if (def.typeName === "ZodDefault") {
    return { innerSchema: def.innerType as z.ZodType, isOptional: true };
  }
  if (def.typeName === "ZodNullable") {
    const inner = unwrapOptional(def.innerType as z.ZodType);
    return { innerSchema: inner.innerSchema, isOptional: inner.isOptional };
  }

  return { innerSchema: schema, isOptional: false };
}

/**
 * Check if a Zod schema is optional (ZodOptional, ZodDefault, or nested via ZodNullable).
 */
export function isOptionalSchema(schema: z.ZodType): boolean {
  return unwrapOptional(schema).isOptional;
}
