import type { ToolAuthorization } from "./types.js";

interface ProviderOptions {
  id?: string;
  scopes?: string[];
}

function createOAuth2Provider(
  providerId: string,
  opts?: ProviderOptions,
): ToolAuthorization {
  return {
    providerId,
    providerType: "oauth2",
    id: opts?.id,
    scopes: opts?.scopes,
  };
}

export function Asana(opts?: ProviderOptions): ToolAuthorization {
  return createOAuth2Provider("asana", opts);
}

export function Atlassian(opts?: ProviderOptions): ToolAuthorization {
  return createOAuth2Provider("atlassian", opts);
}

export function Attio(opts?: ProviderOptions): ToolAuthorization {
  return createOAuth2Provider("attio", opts);
}

export function ClickUp(opts?: ProviderOptions): ToolAuthorization {
  return createOAuth2Provider("clickup", opts);
}

export function Discord(opts?: ProviderOptions): ToolAuthorization {
  return createOAuth2Provider("discord", opts);
}

export function Dropbox(opts?: ProviderOptions): ToolAuthorization {
  return createOAuth2Provider("dropbox", opts);
}

export function Figma(opts?: ProviderOptions): ToolAuthorization {
  return createOAuth2Provider("figma", opts);
}

export function GitHub(opts?: ProviderOptions): ToolAuthorization {
  return createOAuth2Provider("github", opts);
}

export function Google(opts?: ProviderOptions): ToolAuthorization {
  return createOAuth2Provider("google", opts);
}

export function Hubspot(opts?: ProviderOptions): ToolAuthorization {
  return createOAuth2Provider("hubspot", opts);
}

export function Linear(opts?: ProviderOptions): ToolAuthorization {
  return createOAuth2Provider("linear", opts);
}

export function LinkedIn(opts?: ProviderOptions): ToolAuthorization {
  return createOAuth2Provider("linkedin", opts);
}

export function Microsoft(opts?: ProviderOptions): ToolAuthorization {
  return createOAuth2Provider("microsoft", opts);
}

export function Notion(opts?: ProviderOptions): ToolAuthorization {
  return createOAuth2Provider("notion", opts);
}

export function PagerDuty(opts?: ProviderOptions): ToolAuthorization {
  return createOAuth2Provider("pagerduty", opts);
}

export function Reddit(opts?: ProviderOptions): ToolAuthorization {
  return createOAuth2Provider("reddit", opts);
}

export function Slack(opts?: ProviderOptions): ToolAuthorization {
  return createOAuth2Provider("slack", opts);
}

export function Spotify(opts?: ProviderOptions): ToolAuthorization {
  return createOAuth2Provider("spotify", opts);
}

export function Twitch(opts?: ProviderOptions): ToolAuthorization {
  return createOAuth2Provider("twitch", opts);
}

export function X(opts?: ProviderOptions): ToolAuthorization {
  return createOAuth2Provider("x", opts);
}

export function Zoom(opts?: ProviderOptions): ToolAuthorization {
  return createOAuth2Provider("zoom", opts);
}
