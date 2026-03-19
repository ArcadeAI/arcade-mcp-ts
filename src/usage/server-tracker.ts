import { platform, release } from "node:os";
import {
  EVENT_MCP_SERVER_STARTED,
  EVENT_MCP_TOOL_CALLED,
  isTrackingEnabled,
} from "./constants.js";
import { UsageIdentity } from "./identity.js";
import { UsageService } from "./usage-service.js";

export interface ServerStartParams {
  transport: "stdio" | "http";
  host?: string;
  port?: number;
  toolCount: number;
  resourceServerType?: string;
}

export interface ToolCallParams {
  success: boolean;
  failureReason?: string;
}

/**
 * Tracks MCP server events for product analytics via PostHog.
 * To opt out, set ARCADE_USAGE_TRACKING=0.
 */
export class ServerTracker {
  private service?: UsageService;
  private identity?: UsageIdentity;
  private enabled: boolean;
  private version: string;

  constructor(version: string) {
    this.version = version;
    this.enabled = isTrackingEnabled();

    if (!this.enabled) return;

    try {
      this.identity = new UsageIdentity();
      this.service = new UsageService(this.identity);
    } catch {
      this.enabled = false;
    }
  }

  trackServerStart(params: ServerStartParams): void {
    if (!this.enabled || !this.service || !this.identity) return;

    const isAnon = !this.identity.linkedPrincipalId;

    const properties: Record<string, unknown> = {
      transport: params.transport,
      tool_count: params.toolCount,
      resource_server_type: params.resourceServerType ?? null,
      mcp_server_version: this.version,
      runtime_language: "typescript",
      runtime_version: process.version,
      os_type: platform(),
      os_release: release(),
      device_timestamp: new Date().toISOString(),
    };

    if (params.transport === "http") {
      properties.host = params.host ?? null;
      properties.port = params.port ?? null;
    }

    this.service.capture(EVENT_MCP_SERVER_STARTED, properties, isAnon);
  }

  trackToolCall(params: ToolCallParams): void {
    if (!this.enabled || !this.service || !this.identity) return;

    const isAnon = !this.identity.linkedPrincipalId;

    const properties: Record<string, unknown> = {
      is_execution_success: params.success,
      mcp_server_version: this.version,
      runtime_language: "typescript",
      runtime_version: process.version,
      os_type: platform(),
      os_release: release(),
      device_timestamp: new Date().toISOString(),
    };

    if (!params.success && params.failureReason) {
      properties.failure_reason = params.failureReason;
    }

    this.service.capture(EVENT_MCP_TOOL_CALLED, properties, isAnon);
  }

  async shutdown(): Promise<void> {
    if (!this.service) return;
    await this.service.shutdown();
  }
}
