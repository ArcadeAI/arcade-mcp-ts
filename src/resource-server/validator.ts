import type { ResourceOwner } from "../types.js";

/**
 * Authentication errors for resource server validation.
 */
export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class TokenExpiredError extends AuthenticationError {
  constructor(message = "Token has expired") {
    super(message);
    this.name = "TokenExpiredError";
  }
}

export class InvalidTokenError extends AuthenticationError {
  constructor(message = "Invalid token") {
    super(message);
    this.name = "InvalidTokenError";
  }
}

/**
 * Abstract base class for resource server validators.
 * Validates Bearer tokens and extracts resource owner information.
 */
export abstract class ResourceServerValidator {
  /**
   * Validate a Bearer token and return the resource owner.
   */
  abstract validateToken(token: string): Promise<ResourceOwner>;

  /**
   * Whether this validator supports OAuth 2.0 Protected Resource Metadata (RFC 9728).
   */
  supportsOAuthDiscovery(): boolean {
    return false;
  }

  /**
   * Get RFC 9728 resource metadata, if supported.
   */
  getResourceMetadata(): Record<string, unknown> | null {
    return null;
  }
}
