/**
 * Auth provider type — currently only OAuth2 is supported.
 */
export type AuthProviderType = "oauth2";

/**
 * Describes the authorization requirement for a tool.
 */
export interface ToolAuthorization {
	/** The provider identifier (e.g., "github", "google") */
	providerId: string;
	/** The type of auth provider */
	providerType: AuthProviderType;
	/** Unique identifier for this specific provider instance */
	id?: string;
	/** OAuth scopes required */
	scopes?: string[];
}
