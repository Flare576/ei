/**
 * get_liked_songs builtin tool
 *
 * Paginates GET /me/tracks until exhausted, caches in memory for 30 minutes.
 * Returns a flat array of { artist, title, added_at } — the LLM filters/summarizes.
 * Config: { spotify_refresh_token: "<token>" } from the spotify provider.
 * runtime: "any" (works in Web + TUI)
 */
import type { ToolExecutor } from "../types.js";
import { getSpotifyAccessToken, notAuthenticatedError } from "./spotify-auth.js";

interface SpotifyTrack {
  artist: string;
  title: string;
  added_at: string;
}

interface LikedSongsCache {
  tracks: SpotifyTrack[];
  fetched_at: number; // Date.now() ms
}

interface SpotifyTracksPage {
  items: Array<{
    added_at: string;
    track: {
      name: string;
      artists: Array<{ name: string }>;
    } | null;
  }>;
  next: string | null;
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

let likedSongsCache: LikedSongsCache | null = null;

/** Clear the in-memory liked songs cache (call on Spotify reconnect/disconnect). */
export function clearLikedSongsCache(): void {
  likedSongsCache = null;
}

/** Fetch all liked songs from Spotify, paginating 50 at a time. */
async function fetchAllLikedSongs(accessToken: string): Promise<SpotifyTrack[]> {
  const tracks: SpotifyTrack[] = [];
  let url: string | null = "https://api.spotify.com/v1/me/tracks?limit=50&market=from_token";

  while (url) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`Spotify liked songs API error (${response.status}): ${await response.text()}`);
    }

    const page = (await response.json()) as SpotifyTracksPage;

    for (const item of page.items) {
      if (!item.track) continue; // local files etc. may have null track
      tracks.push({
        artist: item.track.artists.map((a) => a.name).join(", "),
        title: item.track.name,
        added_at: item.added_at,
      });
    }

    url = page.next;
  }

  return tracks;
}

export const likedSongsExecutor: ToolExecutor = {
  name: "get_liked_songs",

  async execute(_args: Record<string, unknown>, config?: Record<string, string>, onConfigUpdate?: (updates: Record<string, string>) => void): Promise<string> {
    const refreshToken = config?.spotify_refresh_token?.trim();
    if (!refreshToken) {
      return notAuthenticatedError("get_liked_songs");
    }

    // Return cached result if still fresh
    if (likedSongsCache && Date.now() < likedSongsCache.fetched_at + CACHE_TTL_MS) {
      return JSON.stringify({ tracks: likedSongsCache.tracks, cached: true });
    }

    let accessToken: string;
    try {
      accessToken = await getSpotifyAccessToken(refreshToken, (newToken) => {
        onConfigUpdate?.({ spotify_refresh_token: newToken });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return JSON.stringify({
        error: "token_refresh_failed",
        message: msg,
      });
    }

    const tracks = await fetchAllLikedSongs(accessToken);

    likedSongsCache = { tracks, fetched_at: Date.now() };
    console.log(`[get_liked_songs] fetched and cached ${tracks.length} tracks`);

    return JSON.stringify({ tracks, cached: false });
  },
};
