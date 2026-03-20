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

const provider =
  (id: string) =>
  (opts?: ProviderOptions): ToolAuthorization =>
    createOAuth2Provider(id, opts);

export const Asana = provider("asana");
export const Atlassian = provider("atlassian");
export const Attio = provider("attio");
export const ClickUp = provider("clickup");
export const Discord = provider("discord");
export const Dropbox = provider("dropbox");
export const Figma = provider("figma");
export const GitHub = provider("github");
export const Google = provider("google");
export const Hubspot = provider("hubspot");
export const Linear = provider("linear");
export const LinkedIn = provider("linkedin");
export const Microsoft = provider("microsoft");
export const Notion = provider("notion");
export const PagerDuty = provider("pagerduty");
export const Reddit = provider("reddit");
export const Slack = provider("slack");
export const Spotify = provider("spotify");
export const Twitch = provider("twitch");
export const X = provider("x");
export const Zoom = provider("zoom");
