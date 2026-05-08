import type { SlackChannelState, SlackSettings } from "./types.js";

// =============================================================================
// Slack API types
// =============================================================================

export interface SlackMessage {
  type: string;
  subtype?: string;
  hidden?: boolean;
  user?: string;
  bot_id?: string;
  username?: string;
  text: string;
  ts: string;
  thread_ts?: string;
  reply_count?: number;
  latest_reply?: string;
  parent_user_id?: string;
  client_msg_id?: string;
  edited?: { user: string; ts: string };
}

export interface SlackUser {
  id: string;
  name: string;
  real_name: string;
  profile: {
    display_name: string;
    real_name: string;
  };
  is_bot: boolean;
  deleted: boolean;
}

export interface SlackChannel {
  id: string;
  name: string;
  is_channel: boolean;
  is_group: boolean;
  is_im: boolean;
  is_mpim: boolean;
  is_private: boolean;
  is_archived: boolean;
  is_member: boolean;
  num_members?: number;
}

export type ChannelTier = "dm" | "private" | "public" | "broadcast" | "skip";

// =============================================================================
// Resolved message — Slack message with mentions substituted
// =============================================================================

export interface ResolvedMessage {
  ts: string;
  thread_ts?: string;
  userId: string;
  displayName: string;
  text: string;
  isThreadParent: boolean;
  latestReply?: string;
  replyCount?: number;
}

// =============================================================================
// SlackReader
// =============================================================================

export class SlackReader {
  private token: string;
  private userCache: Map<string, string> = new Map();   // userId → displayName
  private channelCache: Map<string, string> = new Map(); // channelId → name

  constructor(token: string) {
    this.token = token;
  }

  // ---------------------------------------------------------------------------
  // Core API fetch
  // ---------------------------------------------------------------------------

  private async slackFetch(method: string, params: Record<string, string | number | boolean>): Promise<Record<string, unknown>> {
    const url = new URL(`https://slack.com/api/${method}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }
    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!resp.ok) throw new Error(`Slack API ${method} failed: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    if (!data.ok) throw new Error(`Slack API ${method} error: ${data.error ?? "unknown"}`);
    return data;
  }

  // ---------------------------------------------------------------------------
  // Channel list
  // ---------------------------------------------------------------------------

  async listChannels(): Promise<SlackChannel[]> {
    const allChannels: SlackChannel[] = [];
    let cursor = "";
    do {
      const params: Record<string, string | number | boolean> = {
        types: "public_channel,private_channel,im,mpim",
        limit: 200,
        exclude_archived: true,
      };
      if (cursor) params.cursor = cursor;
      const data = await this.slackFetch("users.conversations", params);
      allChannels.push(...(data.channels as SlackChannel[]));
      cursor = (data.response_metadata as Record<string, string>)?.next_cursor ?? "";
    } while (cursor);
    return allChannels;
  }

  classifyChannel(ch: SlackChannel, settings: SlackSettings): ChannelTier {
    const override = settings.channel_overrides?.[ch.id];
    if (override) return override === "skip" ? "skip" : override;
    if (ch.is_im || ch.is_mpim) return "dm";
    if (ch.is_private) return "private";
    const broadcastThreshold = settings.broadcast_threshold ?? 100;
    if ((ch.num_members ?? 0) >= broadcastThreshold) return "broadcast";
    return "public";
  }

  backfillDaysForTier(tier: ChannelTier, settings: SlackSettings): number {
    const defaults = { dm: 90, private: 90, public: 30 };
    if (tier === "dm" || tier === "private") return settings.backfill_days?.dm ?? defaults[tier];
    if (tier === "public") return settings.backfill_days?.public ?? defaults.public;
    return 0;
  }

  // ---------------------------------------------------------------------------
  // Channel name resolution (lazy cache)
  // ---------------------------------------------------------------------------

  async resolveChannelName(channelId: string): Promise<string> {
    const cached = this.channelCache.get(channelId);
    if (cached) return cached;
    try {
      const data = await this.slackFetch("conversations.info", { channel: channelId });
      const name = ((data.channel as Record<string, unknown>).name as string) ?? channelId;
      this.channelCache.set(channelId, name);
      return name;
    } catch {
      this.channelCache.set(channelId, channelId);
      return channelId;
    }
  }

  // ---------------------------------------------------------------------------
  // User display name resolution (lazy cache)
  // ---------------------------------------------------------------------------

  async resolveUserName(userId: string): Promise<string> {
    const cached = this.userCache.get(userId);
    if (cached) return cached;
    try {
      const data = await this.slackFetch("users.info", { user: userId });
      const user = data.user as SlackUser;
      const name = user.profile.display_name || user.profile.real_name || user.name || userId;
      this.userCache.set(userId, name);
      return name;
    } catch {
      this.userCache.set(userId, userId);
      return userId;
    }
  }

  seedUserCache(userId: string, displayName: string): void {
    this.userCache.set(userId, displayName);
  }

  seedChannelCache(channelId: string, name: string): void {
    this.channelCache.set(channelId, name);
  }

  // ---------------------------------------------------------------------------
  // Mention resolution in message text
  // ---------------------------------------------------------------------------

  async resolveMentions(text: string): Promise<string> {
    // Collect all unique IDs needing resolution before substituting
    const userIds = new Set<string>();
    const channelIds = new Set<string>();

    for (const [, id] of text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g)) userIds.add(id);
    for (const [, id] of text.matchAll(/<#([A-Z0-9]+)(?:\|[^>]*)?>/g)) channelIds.add(id);

    // Resolve unknowns in parallel
    await Promise.all([
      ...[...userIds].filter(id => !this.userCache.has(id)).map(id => this.resolveUserName(id)),
      ...[...channelIds].filter(id => !this.channelCache.has(id)).map(id => this.resolveChannelName(id)),
    ]);

    return text
      .replace(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g, (_, id) => `@${this.userCache.get(id) ?? id}`)
      .replace(/<#([A-Z0-9]+)(?:\|[^>]*)?>/g, (_, id) => `#${this.channelCache.get(id) ?? id}(${id})`)
      .replace(/<https?:\/\/[^|>]+\|([^>]+)>/g, "$1")
      .replace(/<https?:\/\/([^>]+)>/g, "$1")
      .replace(/<!channel>/g, "@channel")
      .replace(/<!here>/g, "@here")
      .replace(/<!everyone>/g, "@everyone");
  }

  // ---------------------------------------------------------------------------
  // Message filtering
  // ---------------------------------------------------------------------------

  private isUserMessage(msg: SlackMessage): boolean {
    if (msg.hidden) return false;
    if (!msg.subtype) return !!msg.user;
    // Allow only these subtypes
    return msg.subtype === "me_message";
  }

  // ---------------------------------------------------------------------------
  // Spine messages for a channel window
  //
  // Returns messages between start and end (exclusive of thread replies).
  // Thread parents ARE included — they form the spine with reply metadata.
  // ---------------------------------------------------------------------------

  async spineMessagesBetween(
    channelId: string,
    startTs: string,
    endTs: string,
  ): Promise<ResolvedMessage[]> {
    const raw: SlackMessage[] = [];
    let cursor = "";
    do {
      const params: Record<string, string | number | boolean> = {
        channel: channelId,
        oldest: startTs,
        latest: endTs,
        limit: 200,
        inclusive: false,
      };
      if (cursor) params.cursor = cursor;
      const data = await this.slackFetch("conversations.history", params);
      raw.push(...(data.messages as SlackMessage[]));
      cursor = (data.response_metadata as Record<string, string>)?.next_cursor ?? "";
    } while (cursor);

    const userMessage = raw.filter(m => this.isUserMessage(m));

    // Resolve all mentions in parallel per message
    return Promise.all(userMessage.map(async m => {
      const userId = m.user ?? m.bot_id ?? "unknown";
      const [displayName, resolvedText] = await Promise.all([
        this.resolveUserName(userId),
        this.resolveMentions(m.text),
      ]);
      return {
        ts: m.ts,
        thread_ts: m.thread_ts,
        userId,
        displayName,
        text: resolvedText,
        isThreadParent: !!m.thread_ts && m.thread_ts === m.ts && (m.reply_count ?? 0) > 0,
        latestReply: m.latest_reply,
        replyCount: m.reply_count,
      };
    }));
  }

  // ---------------------------------------------------------------------------
  // Known threads with new replies since lastRun
  //
  // For each threadTs in the channel state's threads map whose lastSeenReply
  // is older than lastRun, fetch replies since lastRun.
  // Returns only threads that actually have new replies.
  // ---------------------------------------------------------------------------

  async threadsWithUpdatesSince(
    channelId: string,
    threadTsMap: Record<string, string>,
    lastRunTs: string,
  ): Promise<Array<{ threadTs: string; newReplies: ResolvedMessage[]; allReplies: ResolvedMessage[] }>> {
    const results: Array<{ threadTs: string; newReplies: ResolvedMessage[]; allReplies: ResolvedMessage[] }> = [];

    await Promise.all(
      Object.entries(threadTsMap).map(async ([threadTs, lastSeenReply]) => {
        if (lastSeenReply >= lastRunTs) return;
        const { newReplies, allReplies } = await this.fetchThread(channelId, threadTs, lastSeenReply);
        if (newReplies.length > 0) {
          results.push({ threadTs, newReplies, allReplies });
        }
      })
    );

    return results;
  }

  // ---------------------------------------------------------------------------
  // Fetch a full thread
  //
  // Returns:
  //   allReplies — every reply (for context_messages)
  //   newReplies — only replies after sinceTs (for messages_analyze)
  // ---------------------------------------------------------------------------

  async fetchThread(
    channelId: string,
    threadTs: string,
    sinceTs: string,
  ): Promise<{ allReplies: ResolvedMessage[]; newReplies: ResolvedMessage[] }> {
    const raw: SlackMessage[] = [];
    let cursor = "";
    do {
      const params: Record<string, string | number | boolean> = {
        channel: channelId,
        ts: threadTs,
        limit: 200,
        inclusive: false,
      };
      if (cursor) params.cursor = cursor;
      const data = await this.slackFetch("conversations.replies", params);
      raw.push(...(data.messages as SlackMessage[]));
      cursor = (data.response_metadata as Record<string, string>)?.next_cursor ?? "";
    } while (cursor);

    // First message is always the parent — skip it, include only replies
    const replies = raw.filter((m, i) => i > 0 && this.isUserMessage(m));

    const resolved = await Promise.all(replies.map(async m => {
      const userId = m.user ?? m.bot_id ?? "unknown";
      const [displayName, resolvedText] = await Promise.all([
        this.resolveUserName(userId),
        this.resolveMentions(m.text),
      ]);
      return {
        ts: m.ts,
        thread_ts: m.thread_ts,
        userId,
        displayName,
        text: resolvedText,
        isThreadParent: false,
        latestReply: undefined,
        replyCount: undefined,
      };
    }));

    const allReplies = resolved;
    const newReplies = resolved.filter(m => m.ts > sinceTs);

    return { allReplies, newReplies };
  }

  // ---------------------------------------------------------------------------
  // Select the next channel to process
  //
  // Returns the channel with the oldest extraction_point that still has
  // content to process (extraction_point < now).
  // ---------------------------------------------------------------------------

  selectCandidateChannel(
    channels: SlackChannel[],
    channelStates: Record<string, SlackChannelState>,
    settings: SlackSettings,
    now: string,
  ): { channel: SlackChannel; state: SlackChannelState; tier: ChannelTier } | null {
    const nowMs = new Date(now).getTime();

    let oldest: { channel: SlackChannel; state: SlackChannelState; tier: ChannelTier; pointMs: number } | null = null;

    for (const ch of channels) {
      const tier = this.classifyChannel(ch, settings);
      if (tier === "broadcast" || tier === "skip") continue;

      const state = channelStates[ch.id] ?? {};
      const backfillDays = this.backfillDaysForTier(tier, settings);
      const defaultPoint = new Date(nowMs - backfillDays * 86400_000).toISOString();
      const pointIso = state.extraction_point ?? defaultPoint;
      const pointMs = new Date(pointIso).getTime();

      if (pointMs >= nowMs) continue;

      if (!oldest || pointMs < oldest.pointMs) {
        oldest = { channel: ch, state: { ...state, extraction_point: pointIso }, tier, pointMs };
      }
    }

    return oldest ? { channel: oldest.channel, state: oldest.state, tier: oldest.tier } : null;
  }
}
