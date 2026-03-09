/**
 * get_currently_playing builtin tool
 *
 * Hits GET /me/player/currently-playing — no cache, always real-time.
 * Config: { spotify_refresh_token: "<token>" } from the spotify provider.
 * runtime: "any" (works in Web + TUI)
 */
import type { ToolExecutor } from "../types.js";
import { getSpotifyAccessToken, notAuthenticatedError } from "./spotify-auth.js";

interface SpotifyCurrentlyPlayingResponse {
  is_playing: boolean;
  progress_ms: number | null;
  item: {
    name: string;
    duration_ms: number;
    artists: Array<{ name: string }>;
    album: { name: string };
  } | null;
}

export const currentlyPlayingExecutor: ToolExecutor = {
  name: "get_currently_playing",

  async execute(_args: Record<string, unknown>, config?: Record<string, string>, onConfigUpdate?: (updates: Record<string, string>) => void): Promise<string> {
    const refreshToken = config?.spotify_refresh_token?.trim();
    if (!refreshToken) {
      return notAuthenticatedError("get_currently_playing");
    }

    let accessToken: string;
    try {
      accessToken = await getSpotifyAccessToken(refreshToken, (newToken) => {
        onConfigUpdate?.({ spotify_refresh_token: newToken });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // If token refresh fails, the refresh token is likely revoked
      return JSON.stringify({
        error: "token_refresh_failed",
        message: msg,
      });
    }

    const response = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    // 204 = nothing playing
    if (response.status === 204 || response.status === 200 && !response.headers.get("content-type")?.includes("json")) {
      return JSON.stringify({ nothing_playing: true });
    }

    if (!response.ok) {
      throw new Error(`Spotify API error (${response.status}): ${await response.text()}`);
    }

    const data = (await response.json()) as SpotifyCurrentlyPlayingResponse;

    if (!data.item) {
      return JSON.stringify({ nothing_playing: true });
    }

    const result = {
      artist: data.item.artists.map((a) => a.name).join(", "),
      title: data.item.name,
      album: data.item.album.name,
      is_playing: data.is_playing,
      progress_ms: data.progress_ms ?? 0,
      duration_ms: data.item.duration_ms,
    };
    return JSON.stringify(result);
  },

};
