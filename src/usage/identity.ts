import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getUsageFilePath } from "./constants.js";

interface UsageData {
  anonymous_id: string;
  linked_principal_id?: string;
}

/**
 * Manages anonymous user identity for usage tracking.
 * Persists a stable UUID in ~/.arcade/usage.json with optional principal linking.
 */
export class UsageIdentity {
  private data: UsageData;

  constructor() {
    this.data = this.load();
  }

  get anonymousId(): string {
    return this.data.anonymous_id;
  }

  get linkedPrincipalId(): string | undefined {
    return this.data.linked_principal_id;
  }

  /**
   * Returns the best available identity: linked principal if set, else anonymous UUID.
   */
  getDistinctId(): string {
    return this.data.linked_principal_id ?? this.data.anonymous_id;
  }

  /**
   * Returns true if a principal ID exists but hasn't been aliased yet.
   */
  shouldAlias(): boolean {
    return !!this.data.linked_principal_id;
  }

  /**
   * Link an authenticated principal ID and persist to disk.
   */
  linkPrincipal(principalId: string): void {
    this.data.linked_principal_id = principalId;
    this.save();
  }

  private load(): UsageData {
    try {
      const content = readFileSync(getUsageFilePath(), "utf-8");
      const parsed = JSON.parse(content) as Partial<UsageData>;
      if (parsed.anonymous_id) {
        return {
          anonymous_id: parsed.anonymous_id,
          linked_principal_id: parsed.linked_principal_id,
        };
      }
    } catch {
      // File doesn't exist or is corrupt — generate new identity
    }

    const data: UsageData = { anonymous_id: randomUUID() };
    this.data = data;
    this.save();
    return data;
  }

  private save(): void {
    try {
      const filePath = getUsageFilePath();
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, JSON.stringify(this.data, null, 2), "utf-8");
    } catch {
      // Silently ignore write failures — tracking should never break the server
    }
  }
}
