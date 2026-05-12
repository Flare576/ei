export type ChannelTier = "dm" | "private" | "public" | "broadcast" | "skip";

// OAuth flow (PKCE) — produces a real xoxp token with auto-refresh
export interface SlackAuthOAuth {
  type: "oauth";
  token: string;           // xoxp-... user token
  refresh_token?: string;  // xoxe-xoxp-... rotating refresh token
  workspace_name?: string;
}

// Browser session tokens — extracted from Slack desktop app or DevTools.
// xoxc and xoxd may be literal token strings or env var references (e.g. $RNP_SLACK_XOXC_TOKEN).
// Env vars are resolved at call time so rotating them in the shell updates Ei automatically.
export interface SlackAuthBrowser {
  type: "browser";
  xoxc: string;
  xoxd: string;
  workspace_name?: string;
}

export type SlackAuth = SlackAuthOAuth | SlackAuthBrowser;

export interface SlackChannelState {
  extraction_point?: string;         // ISO — how far we've advanced in the timeline (spine cursor)
  last_run?: string;                 // ISO — when we last checked for updates (necro reply detection)
  name?: string;                     // cached display name
  threads?: Record<string, string>;  // threadTs → latest reply ts seen (reply cursor per thread)
}

export interface SlackWorkspaceConfig {
  auth: SlackAuth;
  integration?: boolean;
  extraction_model?: string;
  last_sync?: string;
  backfill_days?: {
    dm: number;
    private: number;
    public: number;
  };
  broadcast_threshold?: number;
  channel_overrides?: Record<string, ChannelTier>;
  channels?: Record<string, SlackChannelState>;
}

export interface SlackSettings {
  polling_interval_ms?: number;
  workspaces?: Record<string, SlackWorkspaceConfig>;  // keyed by workspace_id (e.g. "T024GE9EL")
}
