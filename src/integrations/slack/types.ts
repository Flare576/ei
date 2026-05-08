export interface SlackAuth {
  type: "pkce" | "xoxp";
  token: string;
  refresh_token?: string;
}

export interface SlackChannelState {
  extraction_point?: string;         // ISO — how far we've advanced in the timeline (spine cursor)
  last_run?: string;                 // ISO — when we last checked for updates (necro reply detection)
  name?: string;                     // cached display name
  threads?: Record<string, string>;  // threadTs → latest reply ts seen (reply cursor per thread)
}

export interface SlackSettings {
  integration?: boolean;
  polling_interval_ms?: number;
  extraction_model?: string;
  last_sync?: string;
  auth?: SlackAuth;
  backfill_days?: {
    dm: number;
    private: number;
    public: number;
  };
  broadcast_threshold?: number;
  channel_overrides?: Record<string, "dm" | "private" | "public" | "skip">;
  channels?: Record<string, SlackChannelState>;
}
