import type { ResourceOwner } from "../types.js";

/**
 * Options for JWT claim validation.
 */
export interface AccessTokenValidationOptions {
  verifyExp?: boolean;
  verifyIat?: boolean;
  verifyIss?: boolean;
  verifyNbf?: boolean;
  /** Clock tolerance in seconds. */
  leeway?: number;
}

/**
 * Configuration for a single authorization server.
 */
export interface AuthorizationServerEntry {
  authorizationServerUrl: string;
  issuer: string;
  jwksUri: string;
  algorithm?: string;
  expectedAudiences?: string[];
  validationOptions?: AccessTokenValidationOptions;
}

// Re-export ResourceOwner for convenience
export type { ResourceOwner };
