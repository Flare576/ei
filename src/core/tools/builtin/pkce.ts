/**
 * PKCE helpers — shared by Web (SpotifyAuthButton) and TUI (spotify-auth command).
 *
 * Uses the Web Crypto API (available in both browser and Bun/Node >= 19).
 * All functions are synchronous except generateChallenge which needs crypto.subtle.
 */

/** Generate a random code verifier (128 chars, URL-safe base64). */
export function generateVerifier(): string {
  const array = new Uint8Array(96); // 96 bytes → 128 chars base64url
  crypto.getRandomValues(array);
  return base64url(array);
}

/** Derive the PKCE code challenge (SHA-256 of verifier, base64url). */
export async function generateChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64url(new Uint8Array(digest));
}

/** Exchange an authorization code for tokens (used by both Web and TUI). */
export async function exchangeCode(params: {
  code: string;
  verifier: string;
  redirectUri: string;
  clientId: string;
}): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const { code, verifier, redirectUri, clientId } = params;

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Spotify token exchange failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }>;
}

/** Build the Spotify authorization URL. */
export function buildAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  challenge: string;
  state?: string;
}): string {
  const { clientId, redirectUri, scopes, challenge, state } = params;
  const url = new URL("https://accounts.spotify.com/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function base64url(buffer: Uint8Array): string {
  // btoa works in browser; Buffer works in Node/Bun
  let binary: string;
  if (typeof btoa === "function") {
    binary = String.fromCharCode(...buffer);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }
  // Node/Bun fallback
  return Buffer.from(buffer).toString("base64url");
}
