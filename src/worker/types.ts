/**
 * Worker wire format types matching the Python arcade_core.schema definitions.
 * These types define the exact JSON structure exchanged between the Arcade Engine
 * and worker routes, using snake_case to match the Python Pydantic models.
 */

// ── Tool Definition (GET /worker/tools response) ────────

export interface WorkerValueSchema {
  val_type: "string" | "integer" | "number" | "boolean" | "json" | "array";
  inner_val_type?: "string" | "integer" | "number" | "boolean" | "json" | null;
  enum?: string[] | null;
  properties?: Record<string, WorkerValueSchema> | null;
  inner_properties?: Record<string, WorkerValueSchema> | null;
  description?: string | null;
}

export interface WorkerInputParameter {
  name: string;
  required: boolean;
  description: string | null;
  value_schema: WorkerValueSchema;
  inferrable: boolean;
}

export interface WorkerToolInput {
  parameters: WorkerInputParameter[];
}

export interface WorkerToolOutput {
  description: string | null;
  available_modes: string[];
  value_schema: WorkerValueSchema | null;
}

export interface WorkerToolAuthRequirement {
  provider_id: string | null;
  provider_type: string;
  id?: string | null;
  oauth2?: { scopes?: string[] | null } | null;
}

export interface WorkerToolSecretRequirement {
  key: string;
}

export interface WorkerToolMetadataRequirement {
  key: string;
}

export interface WorkerToolRequirements {
  authorization: WorkerToolAuthRequirement | null;
  secrets: WorkerToolSecretRequirement[] | null;
  metadata: WorkerToolMetadataRequirement[] | null;
}

export interface WorkerToolkitDefinition {
  name: string;
  description: string | null;
  version: string | null;
}

export interface WorkerToolDefinition {
  name: string;
  fully_qualified_name: string;
  description: string;
  toolkit: WorkerToolkitDefinition;
  input: WorkerToolInput;
  output: WorkerToolOutput;
  requirements: WorkerToolRequirements;
  deprecation_message?: string | null;
  metadata?: Record<string, unknown> | null;
}

// ── Tool Invocation (POST /worker/tools/invoke) ─────────

export interface WorkerToolReference {
  name: string;
  toolkit: string;
  version?: string | null;
}

export interface WorkerToolAuthorizationContext {
  token?: string | null;
  user_info?: Record<string, unknown>;
}

export interface WorkerToolSecretItem {
  key: string;
  value: string;
}

export interface WorkerToolMetadataItem {
  key: string;
  value: string;
}

export interface WorkerToolContext {
  authorization?: WorkerToolAuthorizationContext | null;
  secrets?: WorkerToolSecretItem[] | null;
  metadata?: WorkerToolMetadataItem[] | null;
  user_id?: string | null;
}

export interface WorkerToolCallRequest {
  run_id?: string | null;
  execution_id?: string | null;
  created_at?: string | null;
  tool: WorkerToolReference;
  inputs?: Record<string, unknown> | null;
  context?: WorkerToolContext;
}

// ── Tool Call Response ───────────────────────────────────

export interface WorkerToolCallLog {
  message: string;
  level: "debug" | "info" | "warning" | "error";
  subtype?: "deprecation" | null;
}

export interface WorkerToolCallError {
  message: string;
  kind: string;
  developer_message?: string | null;
  can_retry: boolean;
  additional_prompt_content?: string | null;
  retry_after_ms?: number | null;
  stacktrace?: string | null;
  status_code?: number | null;
  extra?: Record<string, unknown> | null;
}

export interface WorkerToolCallRequiresAuthorization {
  authorization_url?: string | null;
  authorization_id?: string | null;
  scopes?: string[] | null;
  status?: string | null;
}

export interface WorkerToolCallOutput {
  value?: unknown;
  logs?: WorkerToolCallLog[] | null;
  error?: WorkerToolCallError | null;
  requires_authorization?: WorkerToolCallRequiresAuthorization | null;
}

export interface WorkerToolCallResponse {
  execution_id: string;
  finished_at: string;
  duration: number;
  success: boolean;
  output: WorkerToolCallOutput | null;
}
