import * as jose from "jose";
import { createLogger } from "../logger.js";
import type { ResourceOwner } from "../types.js";
import type {
  AccessTokenValidationOptions,
  AuthorizationServerEntry,
} from "./types.js";
import {
  AuthenticationError,
  InvalidTokenError,
  ResourceServerValidator,
  TokenExpiredError,
} from "./validator.js";

const logger = createLogger("arcade-mcp-jwt");

const SUPPORTED_ALGORITHMS = new Set([
  "RS256",
  "RS384",
  "RS512",
  "ES256",
  "ES384",
  "ES512",
  "PS256",
  "PS384",
  "PS512",
  "EdDSA",
]);

interface JWKSValidatorEntry {
  jwks: ReturnType<typeof jose.createRemoteJWKSet>;
  issuer: string;
  audiences?: string[];
  algorithm: string;
  validationOptions: AccessTokenValidationOptions;
}

/**
 * JWT Resource Server Validator.
 * Validates Bearer tokens against one or more authorization servers using JWKS.
 */
export class JWTResourceServerValidator extends ResourceServerValidator {
  private validators: Map<string, JWKSValidatorEntry>;
  private canonicalUrl?: string;
  private authServerUrls: string[];

  constructor(options: {
    canonicalUrl?: string;
    authorizationServers: AuthorizationServerEntry[];
  }) {
    super();
    this.canonicalUrl = options.canonicalUrl;
    this.authServerUrls = options.authorizationServers.map(
      (s) => s.authorizationServerUrl,
    );
    this.validators = new Map();

    for (const entry of options.authorizationServers) {
      if (!SUPPORTED_ALGORITHMS.has(entry.algorithm ?? "RS256")) {
        throw new Error(
          `Unsupported algorithm: ${entry.algorithm}. Supported: ${[...SUPPORTED_ALGORITHMS].join(", ")}`,
        );
      }

      const jwks = jose.createRemoteJWKSet(new URL(entry.jwksUri));

      this.validators.set(entry.authorizationServerUrl, {
        jwks,
        issuer: entry.issuer,
        audiences: entry.expectedAudiences,
        algorithm: entry.algorithm ?? "RS256",
        validationOptions: entry.validationOptions ?? {
          verifyExp: true,
          verifyIat: true,
          verifyIss: true,
          verifyNbf: true,
          leeway: 0,
        },
      });
    }
  }

  /**
   * Validate a JWT token against all configured authorization servers.
   * TokenExpiredError is raised immediately (universal).
   * Other errors cause fallthrough to the next validator.
   */
  override async validateToken(token: string): Promise<ResourceOwner> {
    let lastError: Error | undefined;

    for (const [url, validator] of this.validators) {
      try {
        return await this.validateWithEntry(token, validator);
      } catch (error) {
        if (error instanceof TokenExpiredError) {
          throw error; // Always fatal
        }
        lastError = error as Error;
        logger.debug(
          { authServer: url, error: (error as Error).message },
          "Token validation failed, trying next server",
        );
      }
    }

    throw lastError ?? new InvalidTokenError("No validators configured");
  }

  private async validateWithEntry(
    token: string,
    entry: JWKSValidatorEntry,
  ): Promise<ResourceOwner> {
    try {
      const { payload } = await jose.jwtVerify(token, entry.jwks as never, {
        issuer:
          entry.validationOptions.verifyIss !== false
            ? entry.issuer
            : undefined,
        audience: entry.audiences,
        algorithms: [entry.algorithm],
        clockTolerance: entry.validationOptions.leeway ?? 0,
      });

      // Extract user ID from `sub` claim
      const userId = payload.sub;
      if (!userId) {
        throw new InvalidTokenError("Token missing required 'sub' claim");
      }

      // Extract client ID from `client_id` or `azp`
      const clientId =
        (payload.client_id as string) ?? (payload.azp as string) ?? undefined;

      // Extract email if present
      const email = payload.email as string | undefined;

      return {
        userId,
        clientId,
        email,
        claims: payload as Record<string, unknown>,
      };
    } catch (error) {
      if (error instanceof TokenExpiredError) throw error;
      if (error instanceof InvalidTokenError) throw error;

      if (error instanceof jose.errors.JWTExpired) {
        throw new TokenExpiredError("Token has expired");
      }

      if (error instanceof jose.errors.JWTClaimValidationFailed) {
        throw new InvalidTokenError(
          `Claim validation failed: ${(error as Error).message}`,
        );
      }

      if (error instanceof jose.errors.JWSSignatureVerificationFailed) {
        throw new InvalidTokenError("Invalid token signature");
      }

      throw new AuthenticationError(
        `Token validation failed: ${(error as Error).message}`,
      );
    }
  }

  override supportsOAuthDiscovery(): boolean {
    return !!this.canonicalUrl;
  }

  override getResourceMetadata(): Record<string, unknown> | null {
    if (!this.canonicalUrl) return null;

    return {
      resource: this.canonicalUrl,
      authorization_servers: this.authServerUrls,
      bearer_methods_supported: ["header"],
    };
  }
}
