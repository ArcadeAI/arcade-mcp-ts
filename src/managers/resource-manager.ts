import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { NotFoundError } from "../exceptions.js";
import type { ResourceHandler, ResourceOptions } from "../types.js";
import { ComponentRegistry } from "./base.js";

/**
 * A resource stored in the registry with its handler.
 */
export interface StoredResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  handler: ResourceHandler;
}

/**
 * Manages MCP resource registration and reading.
 */
export class ResourceManager {
  readonly registry = new ComponentRegistry<string, StoredResource>();

  addResource(
    uri: string,
    name: string,
    options: ResourceOptions,
    handler?: ResourceHandler,
  ): void {
    const stored: StoredResource = {
      uri,
      name,
      description: options.description,
      mimeType: options.mimeType,
      handler: handler ?? defaultResourceHandler(uri),
    };
    this.registry.upsert(uri, stored);
  }

  removeResource(uri: string): StoredResource {
    return this.registry.remove(uri);
  }

  listResources(): StoredResource[] {
    return this.registry.values();
  }

  getResourceUris(): string[] {
    return this.registry.keys();
  }

  async readResource(uri: string): Promise<ReadResourceResult> {
    const stored = this.registry.get(uri);
    if (!stored) {
      throw new NotFoundError(`Resource '${uri}' not found`);
    }
    return stored.handler(new URL(uri));
  }
}

function defaultResourceHandler(uri: string): ResourceHandler {
  return () => ({
    contents: [{ uri, text: "", mimeType: "text/plain" }],
  });
}
