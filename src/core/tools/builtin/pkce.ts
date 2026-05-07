/**
 * PKCE helpers — shared by Web and TUI auth flows (Spotify, Slack, etc.).
 *
 * Uses the Web Crypto API (available in both browser and Bun/Node >= 19).
 * All functions are synchronous except generateChallenge which needs crypto.subtle.
 */

export function generateVerifier(): string {
  const array = new Uint8Array(96); // 96 bytes → 128 chars base64url
  crypto.getRandomValues(array);
  return base64url(array);
}

export async function generateChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64url(new Uint8Array(digest));
}

export async function exchangeCode(params: {
  code: string;
  verifier: string;
  redirectUri: string;
  clientId: string;
  tokenEndpoint?: string;
  tokenResponsePath?: string[];
}): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const {
    code,
    verifier,
    redirectUri,
    clientId,
    tokenEndpoint = "https://accounts.spotify.com/api/token",
    tokenResponsePath,
  } = params;

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  });

  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  const json = await response.json() as Record<string, unknown>;

  const payload = tokenResponsePath
    ? tokenResponsePath.reduce<Record<string, unknown>>((obj, key) => {
        const next = obj[key];
        return (next && typeof next === "object" ? next : obj) as Record<string, unknown>;
      }, json)
    : json;

  return payload as { access_token: string; refresh_token: string; expires_in: number };
}

export function buildAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  challenge: string;
  state?: string;
  userScopes?: string[];
  authEndpoint?: string;
}): string {
  const {
    clientId,
    redirectUri,
    scopes,
    challenge,
    state,
    userScopes,
    authEndpoint = "https://accounts.spotify.com/authorize",
  } = params;

  const url = new URL(authEndpoint);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  if (scopes.length > 0) url.searchParams.set("scope", scopes.join(" "));
  if (userScopes && userScopes.length > 0) url.searchParams.set("user_scope", userScopes.join(" "));
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

// ---------------------------------------------------------------------------

function base64url(buffer: Uint8Array): string {
  if (typeof btoa === "function") {
    const binary = String.fromCharCode(...buffer);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }
  return Buffer.from(buffer).toString("base64url");
}
