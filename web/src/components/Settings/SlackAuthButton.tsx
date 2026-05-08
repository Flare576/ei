import React from "react";
import {
  SLACK_CLIENT_ID,
  SLACK_USER_SCOPES,
  SLACK_WEB_REDIRECT_URI,
} from "../../../../src/core/tools/builtin/slack-auth.js";
import {
  generateVerifier,
  generateChallenge,
  buildAuthUrl,
} from "../../../../src/core/tools/builtin/pkce.js";

interface SlackAuthButtonProps {
  isConnected: boolean;
  workspaceName?: string;
  onDisconnect: () => void;
}

export const SlackAuthButton: React.FC<SlackAuthButtonProps> = ({
  isConnected,
  workspaceName,
  onDisconnect,
}) => {
  const handleConnect = async () => {
    const verifier = generateVerifier();
    const challenge = await generateChallenge(verifier);

    sessionStorage.setItem("slack_pkce_verifier", verifier);

    const authUrl = buildAuthUrl({
      clientId: SLACK_CLIENT_ID,
      redirectUri: SLACK_WEB_REDIRECT_URI,
      scopes: [],
      userScopes: SLACK_USER_SCOPES,
      challenge,
      authEndpoint: "https://slack.com/oauth/v2/authorize",
    });

    window.location.href = authUrl;
  };

  if (isConnected) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "var(--ei-space-3, 12px)" }}>
        <span className="ei-data-card__meta" style={{ color: "var(--ei-success, #859900)" }}>
          ✓ {workspaceName ? `Connected to ${workspaceName}` : "Connected to Slack"}
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
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--ei-space-2, 8px)", alignItems: "flex-start" }}>
      <button
        className="ei-btn ei-btn--primary"
        onClick={handleConnect}
        type="button"
      >
        Connect Slack
      </button>
      <span className="ei-form-hint">
        Opens Slack authorization in your browser
      </span>
    </div>
  );
};
