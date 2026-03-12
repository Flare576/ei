/**
 * Spotify PKCE auth flow for TUI.
 *
 * Spins up a temporary Bun HTTP server on port 4242, opens the Spotify
 * authorization URL in the user's browser, waits for the redirect, then
 * exchanges the auth code for tokens and stores the refresh token via
 * ctx.ei.updateToolProvider().
 */
import type { CommandContext } from "./registry.js";
import { logger } from "../util/logger.js";
import {
  generateVerifier,
  generateChallenge,
  exchangeCode,
  buildAuthUrl,
} from "../../../src/core/tools/builtin/pkce.js";
import {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_SCOPES,
  SPOTIFY_TUI_REDIRECT_URI,
  SPOTIFY_TUI_PORT,
  clearTokenCache,
} from "../../../src/core/tools/builtin/spotify-auth.js";
import { clearLikedSongsCache } from "../../../src/core/tools/builtin/spotify-liked-songs.js";

export async function runSpotifyAuth(ctx: CommandContext): Promise<void> {
  logger.info("[spotify-auth] runSpotifyAuth() called");
  ctx.showNotification("Starting Spotify auth — opening browser…", "info");

  const verifier = generateVerifier();
  const challenge = await generateChallenge(verifier);
  logger.info("[spotify-auth] PKCE verifier + challenge generated");

  const authUrl = buildAuthUrl({
    clientId: SPOTIFY_CLIENT_ID,
    redirectUri: SPOTIFY_TUI_REDIRECT_URI,
    scopes: SPOTIFY_SCOPES,
    challenge,
  });
  logger.info("[spotify-auth] Auth URL built", { redirectUri: SPOTIFY_TUI_REDIRECT_URI });

  // Start the local server FIRST, then open the browser so the server
  // is already listening when Spotify redirects back.
  logger.info("[spotify-auth] Starting local HTTP server on port", SPOTIFY_TUI_PORT);
  const codePromise = waitForAuthCode(ctx);

  // Give the server a tick to bind its port before opening the browser
  logger.info("[spotify-auth] Server should be up — opening browser now");

  // Open the authorization URL in the user's default browser
  const openCmd = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
    ? "cmd /c start"
    : "xdg-open";

  logger.info("[spotify-auth] Spawning browser with", { openCmd });
  Bun.spawn([openCmd, authUrl], { stdio: ["ignore", "ignore", "ignore"] });
  logger.info("[spotify-auth] Browser spawned — awaiting OAuth callback…");

  const code = await codePromise;
  logger.info("[spotify-auth] codePromise resolved", { gotCode: !!code });

  if (!code) return; // user cancelled or error already shown

  ctx.showNotification("Exchanging auth code for tokens…", "info");

  try {
    logger.info("[spotify-auth] Exchanging code for tokens");
    const tokens = await exchangeCode({
      code,
      verifier,
      redirectUri: SPOTIFY_TUI_REDIRECT_URI,
      clientId: SPOTIFY_CLIENT_ID,
    });
    logger.info("[spotify-auth] Token exchange succeeded — storing refresh token");

    clearTokenCache();
    clearLikedSongsCache();
    await ctx.ei.updateToolProvider("spotify", {
      config: { spotify_refresh_token: tokens.refresh_token },
      enabled: true,
    });
    logger.info("[spotify-auth] Refresh token stored — done!");

    ctx.showNotification("✓ Spotify connected successfully!", "info");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[spotify-auth] Token exchange failed", { msg });
    ctx.showNotification(`Spotify auth failed: ${msg}`, "error");
  }
}

/** Spin up a one-shot HTTP server on SPOTIFY_TUI_PORT and return the auth code. */
async function waitForAuthCode(ctx: CommandContext): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const TIMEOUT_MS = 120_000; // 2 minutes

    let resolved = false;
    let server: ReturnType<typeof Bun.serve> | null = null;

    const finish = (code: string | null) => {
      if (resolved) return;
      resolved = true;
      logger.info("[spotify-auth] finish() called", { gotCode: !!code });
      try { server?.stop(true); } catch { /* ignore */ }
      clearTimeout(timer);
      resolve(code);
    };

    const timer = setTimeout(() => {
      logger.warn("[spotify-auth] Timed out waiting for callback");
      ctx.showNotification("Spotify auth timed out (2 min)", "error");
      finish(null);
    }, TIMEOUT_MS);

    try {
      server = Bun.serve({
        port: SPOTIFY_TUI_PORT,
        hostname: "127.0.0.1", // explicit IPv4 — macOS 'localhost' resolves to ::1 (IPv6)
        fetch(req) {
          const url = new URL(req.url);
          logger.info("[spotify-auth] Incoming request", { method: req.method, path: url.pathname });

          if (url.pathname !== "/") {
            return new Response("Not found", { status: 404 });
          }

          const code = url.searchParams.get("code");
          const error = url.searchParams.get("error");
          logger.info("[spotify-auth] Callback params", { hasCode: !!code, error });

          if (error || !code) {
            const msg = error ?? "no code in callback";
            logger.error("[spotify-auth] Auth denied or missing code", { msg });
            ctx.showNotification(`Spotify denied auth: ${msg}`, "error");
            finish(null);
            return new Response(
              "<html><body><h2>Auth failed — return to your terminal.</h2></body></html>",
              { headers: { "Content-Type": "text/html" } }
            );
          }

          const resp = new Response(
            "<html><head><meta charset=\"utf-8\"></head><body><h2>✓ Spotify connected! You can close this tab.</h2><p>Be sure to <strong>enable</strong> the tool for a persona!</p></body></html>",
            { headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
          // Defer finish() so the response flushes before the server stops
          setTimeout(() => finish(code), 0);
          return resp;
        },
        error(err) {
          logger.error("[spotify-auth] Bun.serve error handler", { msg: err.message });
          ctx.showNotification(`Local auth server error: ${err.message}`, "error");
          finish(null);
          return new Response("Internal Server Error", { status: 500 });
        },
      });
      logger.info("[spotify-auth] Bun.serve started", { port: server.port, hostname: server.hostname });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("[spotify-auth] Bun.serve failed to start", { msg });
      ctx.showNotification(`Failed to start local auth server: ${msg}`, "error");
      clearTimeout(timer);
      resolve(null);
    }
  });
}
