/**
 * Slack token refresh — shared helper for the Slack integration.
 *
 * Caches the current access token in module scope so multiple API calls
 * within the same session don't each trigger a refresh round-trip.
 *
 * The refresh token is read from human.settings.slack.auth at call time,
 * so it always reflects the latest stored value.
 *
 * Auth flow uses PKCE (no client_secret required — public client).
 * Slack issues rotating refresh tokens for localhost/desktop redirects;
 * callers must persist the new refresh token via onTokenRotated.
 */

export const SLACK_CLIENT_ID = "11080256060354.11080294064034";

export const SLACK_USER_SCOPES = [
  "channels:history",
  "channels:read",
  "groups:history",
  "groups:read",
  "im:history",
  "im:read",
  "mpim:history",
  "mpim:read",
  "users:read",
  "users:read.email",
];

// TUI redirect URI — Slack requires HTTPS for distributed apps, so we relay
// through ei.flare576.com/callback/slack/tui which does a 302 to localhost.
export const SLACK_TUI_REDIRECT_URI = "https://ei.flare576.com/callback/slack/tui";
export const SLACK_TUI_PORT = 4243;

// Web redirect URI — must match slack_manifest.yaml
export const SLACK_WEB_REDIRECT_URI = "https://ei.flare576.com/callback/slack";

interface CachedToken {
  token: string;
  expires_at: number; // Date.now() ms
}

let cachedToken: CachedToken | null = null;

/**
 * Get a valid Slack access token, refreshing if needed.
 * @param refreshToken - The stored refresh token from human.settings.slack.auth
 * @param onTokenRotated - Called with the new refresh token when Slack rotates it
 */
export async function getSlackAccessToken(
  refreshToken: string,
  onTokenRotated?: (newRefreshToken: string) => void
): Promise<string> {
  // Return cached token if still valid (60s buffer)
  if (cachedToken && Date.now() < cachedToken.expires_at - 60_000) {
    return cachedToken.token;
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: SLACK_CLIENT_ID,
  });

  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Slack token refresh failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    ok: boolean;
    error?: string;
    authed_user?: {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
  };

  if (!data.ok || !data.authed_user?.access_token) {
    throw new Error(`Slack token refresh failed: ${data.error ?? "unknown error"}`);
  }

  const expiresIn = data.authed_user.expires_in ?? 43200; // 12h default
  cachedToken = {
    token: data.authed_user.access_token,
    expires_at: Date.now() + expiresIn * 1000,
  };

  // Slack rotates the refresh token — persist the new one if provided
  if (data.authed_user.refresh_token && data.authed_user.refresh_token !== refreshToken) {
    onTokenRotated?.(data.authed_user.refresh_token);
  }

  return cachedToken.token;
}

/** Clear the cached token (call if refresh token changes). */
export function clearSlackTokenCache(): void {
  cachedToken = null;
}

/** Return a structured "not authenticated" error. */
export function slackNotAuthenticatedError(): string {
  return JSON.stringify({
    error: "not_authenticated",
    integration: "slack",
    message:
      "Slack is not connected. In the TUI: /auth slack. In the web app: My Data → External → Connect Slack.",
  });
}
