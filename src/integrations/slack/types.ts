export interface SlackAuth {
  type: "pkce" | "xoxp";
  token: string;
  refresh_token?: string;
}

export interface SlackChannelState {
  spine_last_extracted?: string;
  name?: string;
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
