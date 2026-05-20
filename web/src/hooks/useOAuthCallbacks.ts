import { useState, useEffect } from "react";
import type React from "react";
import type { Processor } from "../../../src/core/processor";
import { exchangeCode } from '../../../src/core/tools/builtin/pkce.js';
import { SPOTIFY_CLIENT_ID, SPOTIFY_WEB_REDIRECT_URI, clearTokenCache } from '../../../src/core/tools/builtin/spotify-auth.js';
import { clearLikedSongsCache } from '../../../src/core/tools/builtin/spotify-liked-songs.js';
import { SLACK_CLIENT_ID, SLACK_WEB_REDIRECT_URI, clearSlackTokenCache } from '../../../src/core/tools/builtin/slack-auth.js';

export function useOAuthCallbacks(
  processorRef: React.RefObject<Processor | null>,
) {
  const [spotifyAuthError, setSpotifyAuthError] = useState<string | null>(null);

  useEffect(() => {
    const path = window.location.pathname;
    const providerMatch = path.match(/^\/callback\/([^/]+)/);
    if (!providerMatch) return;

    const provider = providerMatch[1];
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (!code) return;

    if (provider === 'spotify') {
      const verifier = sessionStorage.getItem('spotify_pkce_verifier');
      if (!verifier) {
        window.history.replaceState({}, '', '/');
        setSpotifyAuthError('Spotify auth failed: session expired or opened in a new tab. Please try connecting again.');
        return;
      }
      sessionStorage.removeItem('spotify_pkce_verifier');

      exchangeCode({
        code,
        verifier,
        redirectUri: SPOTIFY_WEB_REDIRECT_URI,
        clientId: SPOTIFY_CLIENT_ID,
      }).then((tokens) => {
        window.history.replaceState({}, '', '/');
        clearTokenCache();
        clearLikedSongsCache();
        let elapsed = 0;
        const MAX_WAIT_MS = 10_000;
        const checkReady = setInterval(() => {
          elapsed += 100;
          if (processorRef.current) {
            clearInterval(checkReady);
            processorRef.current.updateToolProvider('spotify', {
              config: { spotify_refresh_token: tokens.refresh_token },
              enabled: true,
            });
          } else if (elapsed >= MAX_WAIT_MS) {
            clearInterval(checkReady);
            console.error('[Spotify] Processor never initialized; token not stored.');
          }
        }, 100);
      }).catch((err) => {
        window.history.replaceState({}, '', '/');
        console.error('[Spotify] Token exchange failed:', err);
        setSpotifyAuthError(`Spotify auth failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
    else if (provider === 'slack') {
      const verifier = sessionStorage.getItem('slack_pkce_verifier');
      if (!verifier) {
        window.history.replaceState({}, '', '/');
        return;
      }
      sessionStorage.removeItem('slack_pkce_verifier');

      exchangeCode({
        code,
        verifier,
        redirectUri: SLACK_WEB_REDIRECT_URI,
        clientId: SLACK_CLIENT_ID,
        tokenEndpoint: 'https://slack.com/api/oauth.v2.access',
        tokenResponsePath: ['authed_user'],
      }).then((tokens) => {
        window.history.replaceState({}, '', '/');
        clearSlackTokenCache();
        const team = tokens._raw.team as Record<string, string> | undefined;
        let elapsed = 0;
        const MAX_WAIT_MS = 10_000;
        const checkReady = setInterval(() => {
          elapsed += 100;
          if (processorRef.current) {
            clearInterval(checkReady);
            const proc = processorRef.current;
            proc.getHuman().then((human) => {
              const workspaceId = team?.id ?? 'unknown';
              const existingWorkspace = human.settings?.slack?.workspaces?.[workspaceId] ?? {};
              proc.updateHuman({
                settings: {
                  ...human.settings,
                  slack: {
                    ...human.settings?.slack,
                    workspaces: {
                      ...human.settings?.slack?.workspaces,
                      [workspaceId]: {
                        ...existingWorkspace,
                        auth: {
                          type: 'oauth',
                          token: tokens.access_token,
                          refresh_token: tokens.refresh_token,
                          workspace_name: team?.name,
                        },
                      },
                    },
                  },
                },
              });
            });
          } else if (elapsed >= MAX_WAIT_MS) {
            clearInterval(checkReady);
            console.error('[Slack] Processor never initialized; token not stored.');
          }
        }, 100);
      }).catch((err) => {
        window.history.replaceState({}, '', '/');
        console.error('[Slack] Token exchange failed:', err);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    spotifyAuthError,
    setSpotifyAuthError,
  };
}
