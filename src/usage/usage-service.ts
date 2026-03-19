import { PostHog } from "posthog-node";
import { POSTHOG_API_KEY, POSTHOG_HOST } from "./constants.js";
import type { UsageIdentity } from "./identity.js";

/**
 * Wraps PostHog client for usage event capture and identity aliasing.
 */
export class UsageService {
  private client: PostHog;
  private identity: UsageIdentity;

  constructor(identity: UsageIdentity) {
    this.identity = identity;
    this.client = new PostHog(POSTHOG_API_KEY, { host: POSTHOG_HOST });
  }

  /**
   * Capture a usage event.
   * Sets $process_person_profile to false for anonymous users.
   */
  capture(
    event: string,
    properties: Record<string, unknown>,
    isAnon: boolean,
  ): void {
    try {
      this.client.capture({
        distinctId: this.identity.getDistinctId(),
        event,
        properties: {
          ...properties,
          ...(isAnon ? { $process_person_profile: false } : {}),
        },
      });
    } catch {
      // Silently ignore — tracking must never break the server
    }
  }

  /**
   * Alias an anonymous ID to an authenticated principal ID.
   * Must be called before the first event with the new distinct ID.
   */
  alias(principalId: string): void {
    try {
      this.client.alias({
        distinctId: principalId,
        alias: this.identity.anonymousId,
      });
      this.identity.linkPrincipal(principalId);
    } catch {
      // Silently ignore
    }
  }

  /**
   * Flush pending events and shut down the PostHog client.
   */
  async shutdown(): Promise<void> {
    try {
      await this.client.shutdown();
    } catch {
      // Silently ignore
    }
  }
}
