import type { CommandContext } from "./registry.js";
import { logger } from "../util/logger.js";
import {
  generateVerifier,
  generateChallenge,
  buildAuthUrl,
  exchangeCode,
} from "../../../src/core/tools/builtin/pkce.js";
import {
  SLACK_CLIENT_ID,
  SLACK_USER_SCOPES,
  SLACK_TUI_REDIRECT_URI,
  SLACK_TUI_PORT,
  clearSlackTokenCache,
} from "../../../src/core/tools/builtin/slack-auth.js";

export async function runSlackAuth(ctx: CommandContext): Promise<void> {
  logger.info("[slack-auth] runSlackAuth() called");
  ctx.showNotification("Starting Slack auth — opening browser…", "info");

  const verifier = generateVerifier();
  const challenge = await generateChallenge(verifier);
  logger.info("[slack-auth] PKCE verifier + challenge generated");

  const authUrl = buildAuthUrl({
    clientId: SLACK_CLIENT_ID,
    redirectUri: SLACK_TUI_REDIRECT_URI,
    scopes: [],
    userScopes: SLACK_USER_SCOPES,
    challenge,
    authEndpoint: "https://slack.com/oauth/v2/authorize",
  });
  logger.info("[slack-auth] Auth URL built", { redirectUri: SLACK_TUI_REDIRECT_URI });

  const codePromise = waitForAuthCode(ctx);

  const openCmd = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
    ? "cmd /c start"
    : "xdg-open";

  logger.info("[slack-auth] Spawning browser", { openCmd });
  Bun.spawn([openCmd, authUrl], { stdio: ["ignore", "ignore", "ignore"] });
  logger.info("[slack-auth] Browser spawned — awaiting OAuth callback…");

  const code = await codePromise;
  logger.info("[slack-auth] codePromise resolved", { gotCode: !!code });

  if (!code) return;

  ctx.showNotification("Exchanging auth code for tokens…", "info");

  try {
    logger.info("[slack-auth] Exchanging code for tokens");
    const tokens = await exchangeCode({
      code,
      verifier,
      redirectUri: SLACK_TUI_REDIRECT_URI,
      clientId: SLACK_CLIENT_ID,
      tokenEndpoint: "https://slack.com/api/oauth.v2.access",
      tokenResponsePath: ["authed_user"],
    });
    logger.info("[slack-auth] Token exchange succeeded — storing tokens");

    clearSlackTokenCache();

    const team = tokens._raw.team as Record<string, string> | undefined;
    const workspaceId = team?.id;
    const workspaceName = team?.name;

    const human = await ctx.ei.getHuman();
    await ctx.ei.updateSettings({
      slack: {
        ...human.settings?.slack,
        auth: {
          type: "pkce",
          token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          workspace_id: workspaceId,
          workspace_name: workspaceName,
        },
      },
    });

    logger.info("[slack-auth] Tokens stored — done!");
    ctx.showNotification("✓ Slack connected successfully!", "info");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[slack-auth] Token exchange failed", { msg });
    ctx.showNotification(`Slack auth failed: ${msg}`, "error");
  }
}

async function waitForAuthCode(ctx: CommandContext): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const TIMEOUT_MS = 120_000;

    let resolved = false;
    let server: ReturnType<typeof Bun.serve> | null = null;

    const finish = (code: string | null) => {
      if (resolved) return;
      resolved = true;
      logger.info("[slack-auth] finish() called", { gotCode: !!code });
      try { server?.stop(true); } catch { /* ignore */ }
      clearTimeout(timer);
      resolve(code);
    };

    const timer = setTimeout(() => {
      logger.warn("[slack-auth] Timed out waiting for callback");
      ctx.showNotification("Slack auth timed out (2 min)", "error");
      finish(null);
    }, TIMEOUT_MS);

    try {
      server = Bun.serve({
        port: SLACK_TUI_PORT,
        hostname: "127.0.0.1",
        fetch(req) {
          const url = new URL(req.url);
          logger.info("[slack-auth] Incoming request", { method: req.method, path: url.pathname });

          if (url.pathname !== "/") {
            return new Response("Not found", { status: 404 });
          }

          const code = url.searchParams.get("code");
          const error = url.searchParams.get("error");
          logger.info("[slack-auth] Callback params", { hasCode: !!code, error });

          if (error || !code) {
            const msg = error ?? "no code in callback";
            logger.error("[slack-auth] Auth denied or missing code", { msg });
            ctx.showNotification(`Slack denied auth: ${msg}`, "error");
            finish(null);
            return new Response(
              "<html><body><h2>Auth failed — return to your terminal.</h2></body></html>",
              { headers: { "Content-Type": "text/html" } }
            );
          }

          const resp = new Response(
            "<html><head><meta charset=\"utf-8\"></head><body><h2>✓ Slack connected! You can close this tab.</h2></body></html>",
            { headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
          setTimeout(() => finish(code), 0);
          return resp;
        },
        error(err) {
          logger.error("[slack-auth] Bun.serve error", { msg: err.message });
          ctx.showNotification(`Local auth server error: ${err.message}`, "error");
          finish(null);
          return new Response("Internal Server Error", { status: 500 });
        },
      });
      logger.info("[slack-auth] Bun.serve started", { port: server.port });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("[slack-auth] Bun.serve failed to start", { msg });
      ctx.showNotification(`Failed to start local auth server: ${msg}`, "error");
      clearTimeout(timer);
      resolve(null);
    }
  });
}
