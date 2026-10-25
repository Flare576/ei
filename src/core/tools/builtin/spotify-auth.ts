/**
 * Spotify token refresh — shared helper for both Spotify tool executors.
 *
 * Caches the current access token in module scope so multiple tool calls
 * within the same session don't each trigger a refresh round-trip.
 *
 * The refresh token is read from the ToolProvider config at call time,
 * so it always reflects the latest stored value.
 */

import { ToolFailure } from "../tool-error.js";

const SPOTIFY_RECONNECT_REMEDIATION =
  "Reconnect Spotify. In the web app: Settings → Toolkits → Spotify → Connect Spotify. In the TUI: /auth spotify";
const SPOTIFY_RETRY_REMEDIATION = "Try again later.";

export const SPOTIFY_CLIENT_ID = "41a10178f66946f78d4a1e265606ba36";
export const SPOTIFY_SCOPES = ["user-read-currently-playing", "user-library-read"];

// Web redirect URI (hosted)
export const SPOTIFY_WEB_REDIRECT_URI = "https://ei.flare576.com/callback/spotify";
// TUI redirect URI (fixed port — Spotify rejected bare 127.0.0.1)
export const SPOTIFY_TUI_REDIRECT_URI = "http://127.0.0.1:4242";
export const SPOTIFY_TUI_PORT = 4242;

interface CachedToken {
  token: string;
  expires_at: number; // Date.now() ms
}

let cachedToken: CachedToken | null = null;

/**
 * Get a valid Spotify access token, refreshing if needed.
 * @param refreshToken - The stored refresh token from provider config
 * @param onTokenRotated - Called with the new refresh token if Spotify rotates it
 */
export async function getSpotifyAccessToken(
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
    client_id: SPOTIFY_CLIENT_ID,
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const detail = (await response.text()).trim().slice(0, 300);
    const withDetail = detail ? `: ${detail}` : "";
    if (response.status === 429 || response.status >= 500) {
      throw new ToolFailure(
        "token_refresh_failed",
        `Spotify could not refresh the login because its account service is unavailable or rate-limiting (HTTP ${response.status})${withDetail}`,
        SPOTIFY_RETRY_REMEDIATION
      );
    }
    throw new ToolFailure(
      "token_refresh_failed",
      `Spotify rejected the stored login when refreshing it (HTTP ${response.status}); the connection was most likely revoked or has expired${withDetail}`,
      SPOTIFY_RECONNECT_REMEDIATION
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string; // Spotify may rotate the refresh token
  };

  cachedToken = {
    token: data.access_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };

  // Spotify may rotate the refresh token — persist the new one if provided
  if (data.refresh_token && data.refresh_token !== refreshToken) {
    onTokenRotated?.(data.refresh_token);
  }

  return cachedToken.token;
}

/** Clear the cached token (call if refresh token changes). */
export function clearTokenCache(): void {
  cachedToken = null;
}

/** Failure for a tool call made with no stored refresh token. */
export function notAuthenticatedFailure(): ToolFailure {
  return new ToolFailure("not_authenticated", "Spotify is not connected.", SPOTIFY_RECONNECT_REMEDIATION);
}

/**
 * Map a non-success Spotify API response to a ToolFailure the persona can explain.
 * Returns undefined for statuses with no specific guidance (callers keep their generic error).
 */
export function spotifyApiFailure(status: number): ToolFailure | undefined {
  if (status === 401 || status === 403) {
    return new ToolFailure(
      "spotify_unauthorized",
      `Spotify refused the request (HTTP ${status}); the connection no longer has permission, most likely because it was revoked or lacks the required access.`,
      SPOTIFY_RECONNECT_REMEDIATION
    );
  }
  if (status === 429) {
    return new ToolFailure(
      "spotify_rate_limited",
      "Spotify is rate-limiting requests (HTTP 429).",
      SPOTIFY_RETRY_REMEDIATION
    );
  }
  if (status >= 500) {
    return new ToolFailure(
      "spotify_unavailable",
      `Spotify is having a problem on its side (HTTP ${status}).`,
      SPOTIFY_RETRY_REMEDIATION
    );
  }
  return undefined;
}
