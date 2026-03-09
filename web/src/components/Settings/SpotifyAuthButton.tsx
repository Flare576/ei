import React from "react";
import {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_SCOPES,
  SPOTIFY_WEB_REDIRECT_URI,
} from "../../../../src/core/tools/builtin/spotify-auth.js";
import {
  generateVerifier,
  generateChallenge,
  buildAuthUrl,
} from "../../../../src/core/tools/builtin/pkce.js";

interface SpotifyAuthButtonProps {
  /** Whether a refresh token is already stored (shows "Connected ✓" state) */
  isConnected: boolean;
  /** Called with the new refresh token after successful auth exchange */
  onConnected: (refreshToken: string) => void;
  /** Called when the user wants to disconnect */
  onDisconnect: () => void;
}

/**
 * "Connect Spotify" / "Connected ✓" / "Disconnect" button for ToolkitEditor.
 *
 * Auth flow:
 * 1. Generate PKCE verifier + challenge
 * 2. Store verifier in sessionStorage (survives the Spotify redirect)
 * 3. Redirect browser to Spotify authorize URL
 * 4. App.tsx detects the ?code= callback, calls onConnected()
 */
export const SpotifyAuthButton: React.FC<SpotifyAuthButtonProps> = ({
  isConnected,
  onConnected: _onConnected, // used by App.tsx callback path, not here directly
  onDisconnect,
}) => {
  const handleConnect = async () => {
    const verifier = generateVerifier();
    const challenge = await generateChallenge(verifier);

    // Store verifier so the /callback handler can retrieve it
    sessionStorage.setItem("spotify_pkce_verifier", verifier);

    const authUrl = buildAuthUrl({
      clientId: SPOTIFY_CLIENT_ID,
      redirectUri: SPOTIFY_WEB_REDIRECT_URI,
      scopes: SPOTIFY_SCOPES,
      challenge,
    });

    window.location.href = authUrl;
  };

  if (isConnected) {
    return (
      <div className="ei-spotify-auth">
        <span className="ei-spotify-auth__status ei-spotify-auth__status--connected">
          ✓ Connected to Spotify
        </span>
        <button
          className="ei-btn ei-btn--secondary ei-btn--sm"
          onClick={onDisconnect}
          type="button"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="ei-spotify-auth">
      <button
        className="ei-btn ei-btn--primary ei-spotify-auth__connect"
        onClick={handleConnect}
        type="button"
      >
        Connect Spotify
      </button>
      <span className="ei-spotify-auth__hint">
        Opens Spotify authorization in your browser
      </span>
    </div>
  );
};
