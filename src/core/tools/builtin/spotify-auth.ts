/**
 * Spotify token refresh — shared helper for both Spotify tool executors.
 *
 * Caches the current access token in module scope so multiple tool calls
 * within the same session don't each trigger a refresh round-trip.
 *
 * The refresh token is read from the ToolProvider config at call time,
 * so it always reflects the latest stored value.
 */

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
    const text = await response.text();
    throw new Error(`Spotify token refresh failed (${response.status}): ${text}`);
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

/** Return a structured "not authenticated" error for the LLM to relay to the user. */
export function notAuthenticatedError(tool: string): string {
  return JSON.stringify({
    error: "not_authenticated",
    tool,
    message:
      "Spotify is not connected. In the web app: Settings → Tool Kits → Spotify → Connect Spotify. In the TUI: /auth spotify",
  });
}
