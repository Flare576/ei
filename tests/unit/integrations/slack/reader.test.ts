import { describe, it, expect, beforeEach, vi } from "vitest";
import { SlackReader } from "../../../../src/integrations/slack/reader.js";
import type { SlackChannelState, SlackSettings } from "../../../../src/integrations/slack/types.js";

// =============================================================================
// Timestamp helpers
//
// All timestamps are relative to a fixed NOW so tests never rely on wall clock.
// Slack timestamps are Unix seconds as strings (e.g. "1234567890.123456").
// =============================================================================

const NOW_MS = new Date("2026-04-15T12:00:00.000Z").getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();

function ts(offsetDays: number, offsetHours = 0, offsetMinutes = 0): string {
  const ms = NOW_MS + offsetDays * 86_400_000 + offsetHours * 3_600_000 + offsetMinutes * 60_000;
  return (ms / 1000).toFixed(6);
}

function iso(offsetDays: number, offsetHours = 0): string {
  return new Date(NOW_MS + offsetDays * 86_400_000 + offsetHours * 3_600_000).toISOString();
}

// =============================================================================
// Shared workspace snapshot
//
// One realistic #engineering channel. All four adoption scenarios query the
// same data — what changes is extraction_point and last_run, not the content.
//
// Timeline (relative to NOW):
//
//   -60d  msg A "Architecture discussion"         thread parent
//   -59d    reply A1 "Sounds good"
//   -45d    reply A2 "Update: shipped"             necro reply
//   -6h     reply A3 "Actually I disagree"         very recent necro
//   -30m    reply A4 "Replying to A3"              newest reply on old thread
//
//   -45d  msg G "Q2 planning"                     thread parent (backlog scenario)
//   -44d    reply G1 "Good point"
//   -1h     reply G2 "Circling back"               landed DURING backfill
//
//   -30d  msg B "Weekly sync notes"               thread parent
//   -29d    reply B1 "Thanks"
//   -18h    reply B2 "Circling back"               necro reply
//
//   -7d   msg C "New SDK?"                        thread parent
//   -6d     reply C1 "Yeah it's great"
//
//   -3d   msg D "Standup moved"                   spine only, no thread
//   -1d   msg E "PR review needed"                spine only, no thread
//   -2h   msg F "Just merged!"                    very recent spine
// =============================================================================

const CHANNEL_ID = "C_ENGINEERING";

const SPINE_MESSAGES = {
  A: { ts: ts(-60), thread_ts: ts(-60), reply_count: 4, latest_reply: ts(0, 0, -30), user: "UALICE",   text: "Architecture discussion" },
  G: { ts: ts(-45), thread_ts: ts(-45), reply_count: 2, latest_reply: ts(0, -1),     user: "UBOB",     text: "Q2 planning" },
  B: { ts: ts(-30), thread_ts: ts(-30), reply_count: 2, latest_reply: ts(0, -18),    user: "UCAROL",   text: "Weekly sync notes" },
  C: { ts: ts(-7),  thread_ts: ts(-7),  reply_count: 1, latest_reply: ts(-6),        user: "UALICE",   text: "New SDK?" },
  D: { ts: ts(-3),  user: "UBOB",   text: "Standup moved" },
  E: { ts: ts(-1),  user: "UCAROL", text: "PR review needed" },
  F: { ts: ts(0, -2), user: "UALICE", text: "Just merged!" },
};

const THREAD_REPLIES: Record<string, Array<{ ts: string; thread_ts: string; user: string; text: string }>> = {
  [ts(-60)]: [
    { ts: ts(-59),       thread_ts: ts(-60), user: "UBOB",   text: "Sounds good" },
    { ts: ts(-45),       thread_ts: ts(-60), user: "UCAROL", text: "Update: shipped" },
    { ts: ts(0, -6),     thread_ts: ts(-60), user: "UBOB",   text: "Actually I disagree" },
    { ts: ts(0, 0, -30), thread_ts: ts(-60), user: "UALICE", text: "Replying to A3" },
  ],
  [ts(-45)]: [
    { ts: ts(-44),   thread_ts: ts(-45), user: "UCAROL", text: "Good point" },
    { ts: ts(0, -1), thread_ts: ts(-45), user: "UALICE", text: "Circling back" },
  ],
  [ts(-30)]: [
    { ts: ts(-29),    thread_ts: ts(-30), user: "UALICE", text: "Thanks" },
    { ts: ts(0, -18), thread_ts: ts(-30), user: "UBOB",   text: "Circling back" },
  ],
  [ts(-7)]: [
    { ts: ts(-6), thread_ts: ts(-7), user: "UBOB", text: "Yeah it's great" },
  ],
};

const USER_DISPLAY_NAMES: Record<string, string> = {
  UALICE: "Alice",
  UBOB:   "Bob",
  UCAROL: "Carol",
};

const DEFAULT_SETTINGS: SlackSettings = {
  integration: true,
  broadcast_threshold: 100,
  backfill_days: { dm: 90, private: 90, public: 30 },
};

// =============================================================================
// Mock fetch
//
// Routes Slack API calls to the workspace snapshot above.
// =============================================================================

function makeSlackFetch(overrides: Record<string, unknown> = {}) {
  return vi.fn(async (url: string) => {
    const urlObj = new URL(url);
    const method = urlObj.pathname.replace("/api/", "");
    const oldest = urlObj.searchParams.get("oldest") ?? "0";
    const latest = urlObj.searchParams.get("latest");
    const threadTs = urlObj.searchParams.get("ts");
    const userId = urlObj.searchParams.get("user");
    const channelId = urlObj.searchParams.get("channel");

    if (method === "users.info" && userId) {
      const name = USER_DISPLAY_NAMES[userId] ?? userId;
      return makeOk({ user: { id: userId, name, real_name: name, profile: { display_name: name, real_name: name }, is_bot: false, deleted: false } });
    }

    if (method === "conversations.info" && channelId) {
      return makeOk({ channel: { id: channelId, name: "engineering" } });
    }

    if (method === "conversations.replies" && threadTs) {
      const allReplies = THREAD_REPLIES[threadTs as keyof typeof THREAD_REPLIES] ?? [];
      const parent = Object.values(SPINE_MESSAGES).find(m => m.ts === threadTs);
      const msgs = parent ? [parent, ...allReplies] : allReplies;
      const filtered = msgs.filter(m => m.ts >= oldest && (!latest || m.ts <= latest));
      return makeOk({ messages: filtered, has_more: false, response_metadata: { next_cursor: "" } });
    }

    if (method === "conversations.history" && channelId === CHANNEL_ID) {
      const spineOnly = Object.values(SPINE_MESSAGES).filter(m => {
        if (m.ts < oldest) return false;
        if (latest && m.ts > latest) return false;
        return true;
      });
      return makeOk({ messages: spineOnly, has_more: false, response_metadata: { next_cursor: "" } });
    }

    return makeOk({ ...overrides, messages: [], has_more: false, response_metadata: { next_cursor: "" } });
  });
}

function makeOk(data: Record<string, unknown>) {
  return { ok: true, ...data };
}

// =============================================================================
// Tests
// =============================================================================

describe("SlackReader", () => {
  let reader: SlackReader;
  let mockFetch: ReturnType<typeof makeSlackFetch>;

  beforeEach(() => {
    mockFetch = makeSlackFetch();
    reader = new SlackReader("xoxp-test-token");
    // @ts-expect-error — replace private fetch for testing
    reader["slackFetch"] = async (method: string, params: Record<string, string>) => {
      const url = new URL(`https://slack.com/api/${method}`);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
      return mockFetch(url.toString());
    };
  });

  // ---------------------------------------------------------------------------
  // spineMessagesBetween
  // ---------------------------------------------------------------------------

  describe("spineMessagesBetween", () => {
    it("brand new user (first run, 30-day public backfill): returns spine messages within the first 24h window starting from backfill origin", async () => {
      const windowStart = ts(-30);
      const windowEnd   = ts(-29);

      const msgs = await reader.spineMessagesBetween(CHANNEL_ID, windowStart, windowEnd);

      const tsList = msgs.map(m => m.ts);
      expect(tsList).toContain(SPINE_MESSAGES.B.ts);
      expect(tsList).not.toContain(SPINE_MESSAGES.A.ts); // before backfill start
      expect(tsList).not.toContain(SPINE_MESSAGES.D.ts); // after window end
    });

    it("brand new user: thread parents within window are flagged as isThreadParent", async () => {
      const windowStart = ts(-30);
      const windowEnd   = ts(-29);

      const msgs = await reader.spineMessagesBetween(CHANNEL_ID, windowStart, windowEnd);
      const parent = msgs.find(m => m.ts === SPINE_MESSAGES.B.ts);

      expect(parent?.isThreadParent).toBe(true);
      expect(parent?.latestReply).toBe(SPINE_MESSAGES.B.latest_reply);
    });

    it("daily user (extraction_point=1d ago): returns only messages since last extraction", async () => {
      const windowStart = ts(-1);
      const windowEnd   = NOW_ISO > ts(0) ? ts(0) : NOW_ISO;

      const msgs = await reader.spineMessagesBetween(CHANNEL_ID, windowStart, windowEnd);
      const tsList = msgs.map(m => m.ts);

      expect(tsList).toContain(SPINE_MESSAGES.E.ts);
      expect(tsList).toContain(SPINE_MESSAGES.F.ts);
      expect(tsList).not.toContain(SPINE_MESSAGES.D.ts); // -3d, before window
      expect(tsList).not.toContain(SPINE_MESSAGES.B.ts); // -30d, before window
    });

    it("hourly user (extraction_point=1h ago): returns no spine messages when the last hour had none", async () => {
      // F is at -2h (before window), E is at -1d (before window).
      // The -1h window is genuinely empty — this is valid steady-state behavior.
      const windowStart = ts(0, -1);
      const windowEnd   = ts(0);

      const msgs = await reader.spineMessagesBetween(CHANNEL_ID, windowStart, windowEnd);

      expect(msgs).toHaveLength(0);
      expect(msgs.map(m => m.ts)).not.toContain(SPINE_MESSAGES.F.ts);  // F at -2h is before window
    });

    it("resolves user mentions to display names before returning text", async () => {
      reader.seedUserCache("UALICE", "Alice");
      const msgs = await reader.spineMessagesBetween(CHANNEL_ID, ts(-3, -1), ts(0));
      const alice = msgs.find(m => m.userId === "UALICE");
      expect(alice?.displayName).toBe("Alice");
    });

    it("empty window (no messages in range) returns empty array without error", async () => {
      const windowStart = ts(-100);
      const windowEnd   = ts(-99);

      const msgs = await reader.spineMessagesBetween(CHANNEL_ID, windowStart, windowEnd);
      expect(msgs).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // threadsWithUpdatesSince
  // ---------------------------------------------------------------------------

  describe("threadsWithUpdatesSince", () => {
    it("daily user: detects necro replies on known threads that landed since last run", async () => {
      const lastRunTs = ts(-1);  // ran yesterday
      const threadMap: Record<string, string> = {
        [SPINE_MESSAGES.A.ts]: ts(-45),  // last seen reply was A2 (-45d)
        [SPINE_MESSAGES.B.ts]: ts(-29),  // last seen reply was B1 (-29d)
        [SPINE_MESSAGES.C.ts]: ts(-6),   // last seen reply was C1 (-6d)
      };

      const results = await reader.threadsWithUpdatesSince(CHANNEL_ID, threadMap, lastRunTs);
      const updatedThreadTs = results.map(r => r.threadTs);

      expect(updatedThreadTs).toContain(SPINE_MESSAGES.A.ts); // A3 at -6h and A4 at -30m are new
      expect(updatedThreadTs).toContain(SPINE_MESSAGES.B.ts); // B2 at -18h is new
      expect(updatedThreadTs).not.toContain(SPINE_MESSAGES.C.ts); // C1 at -6d, nothing since last run
    });

    it("hourly user: only threads with replies in the last hour are returned", async () => {
      const lastRunTs = ts(0, -1);  // ran 1 hour ago
      const threadMap: Record<string, string> = {
        [SPINE_MESSAGES.A.ts]: ts(0, -6),   // last seen A3 (-6h), but A4 at -30m is newer
        [SPINE_MESSAGES.B.ts]: ts(0, -18),  // B2 at -18h was already seen
        [SPINE_MESSAGES.C.ts]: ts(-6),      // C1 at -6d was already seen
      };

      const results = await reader.threadsWithUpdatesSince(CHANNEL_ID, threadMap, lastRunTs);
      const updatedThreadTs = results.map(r => r.threadTs);

      expect(updatedThreadTs).toContain(SPINE_MESSAGES.A.ts);    // A4 at -30m is new
      expect(updatedThreadTs).not.toContain(SPINE_MESSAGES.B.ts); // B2 at -18h already seen
      expect(updatedThreadTs).not.toContain(SPINE_MESSAGES.C.ts); // C1 already seen
    });

    it("thread where lastSeenReply equals lastRunTs is not re-fetched (boundary is exclusive)", async () => {
      const lastRunTs = ts(-1);
      const threadMap: Record<string, string> = {
        [SPINE_MESSAGES.B.ts]: lastRunTs,  // exactly at boundary
      };

      const results = await reader.threadsWithUpdatesSince(CHANNEL_ID, threadMap, lastRunTs);
      expect(results.map(r => r.threadTs)).not.toContain(SPINE_MESSAGES.B.ts);
    });

    it("empty thread map (brand new user, no threads seen yet) returns empty without API calls", async () => {
      const results = await reader.threadsWithUpdatesSince(CHANNEL_ID, {}, ts(-1));
      expect(results).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalledWith(expect.stringContaining("conversations.replies"));
    });

    it("backlog user mid-extraction: thread with necro reply that landed DURING backfill is detected on next run after it is seen", async () => {
      // Scenario: backlog user processed G's window 2h ago. G's thread was new then.
      // Since then, G2 arrived at -1h. On the next run, G should appear in updates.
      const lastRunTs = ts(0, -2);  // last run was 2h ago
      const threadMap: Record<string, string> = {
        [SPINE_MESSAGES.G.ts]: ts(-44),  // G1 was the last seen reply when G was first processed
      };

      const results = await reader.threadsWithUpdatesSince(CHANNEL_ID, threadMap, lastRunTs);
      const gResult = results.find(r => r.threadTs === SPINE_MESSAGES.G.ts);

      expect(gResult).toBeDefined();
      expect(gResult?.newReplies.some(r => r.ts === SPINE_MESSAGES.G.ts)).toBe(false); // parent excluded
      expect(gResult?.newReplies.some(r => r.text === "Circling back")).toBe(true);    // G2 included
    });
  });

  // ---------------------------------------------------------------------------
  // fetchThread
  // ---------------------------------------------------------------------------

  describe("fetchThread", () => {
    it("first-ever fetch of a thread (sinceTs = parent ts): all replies go into newReplies", async () => {
      const { allReplies, newReplies } = await reader.fetchThread(
        CHANNEL_ID,
        SPINE_MESSAGES.A.ts,
        SPINE_MESSAGES.A.ts,  // sinceTs = parent ts = no prior context
      );

      expect(allReplies.length).toBe(THREAD_REPLIES[SPINE_MESSAGES.A.ts].length);
      expect(newReplies.length).toBe(THREAD_REPLIES[SPINE_MESSAGES.A.ts].length);
    });

    it("subsequent fetch with known sinceTs: earlier replies are context-only, new replies in newReplies", async () => {
      const lastSeenReply = THREAD_REPLIES[SPINE_MESSAGES.A.ts][1].ts;  // A2 was last seen
      const { allReplies, newReplies } = await reader.fetchThread(
        CHANNEL_ID,
        SPINE_MESSAGES.A.ts,
        lastSeenReply,
      );

      expect(allReplies.length).toBe(THREAD_REPLIES[SPINE_MESSAGES.A.ts].length);
      expect(newReplies.length).toBe(2); // A3 and A4 are after lastSeenReply
      expect(newReplies.every(r => r.ts > lastSeenReply)).toBe(true);
    });

    it("thread with no new replies since sinceTs returns empty newReplies", async () => {
      const lastSeenReply = THREAD_REPLIES[SPINE_MESSAGES.C.ts][0].ts;  // C1 was last seen, nothing after
      const { newReplies } = await reader.fetchThread(
        CHANNEL_ID,
        SPINE_MESSAGES.C.ts,
        lastSeenReply,
      );

      expect(newReplies).toHaveLength(0);
    });

    it("backlog user: thread discovered mid-backfill includes replies that arrived during extraction in newReplies", async () => {
      // G was discovered during backfill. sinceTs = G's own ts (never seen before).
      // G2 at -1h arrived while we were processing earlier windows.
      // Since sinceTs = G.ts (-45d), ALL replies including the mid-backfill G2 are new.
      const { newReplies } = await reader.fetchThread(
        CHANNEL_ID,
        SPINE_MESSAGES.G.ts,
        SPINE_MESSAGES.G.ts,  // first time seeing this thread
      );

      expect(newReplies.length).toBe(THREAD_REPLIES[SPINE_MESSAGES.G.ts].length); // G1 and G2 both new
      expect(newReplies.some(r => r.text === "Circling back")).toBe(true); // G2 included
    });
  });

  // ---------------------------------------------------------------------------
  // resolveMentions
  // ---------------------------------------------------------------------------

  describe("resolveMentions", () => {
    it("resolves user mention to display name", async () => {
      reader.seedUserCache("UALICE", "Alice");
      const result = await reader.resolveMentions("Hey <@UALICE>, are you available?");
      expect(result).toBe("Hey @Alice, are you available?");
    });

    it("resolves channel mention to name(id) format for quote traceability", async () => {
      reader.seedChannelCache("CDEV123", "tailboard-dev");
      const result = await reader.resolveMentions("Check <#CDEV123> for details");
      expect(result).toBe("Check #tailboard-dev(CDEV123) for details");
    });

    it("resolves hyperlink with display text to display text only", async () => {
      const result = await reader.resolveMentions("See <https://example.com|the docs>");
      expect(result).toBe("See the docs");
    });

    it("resolves bare URL to just the URL", async () => {
      const result = await reader.resolveMentions("See <https://example.com>");
      expect(result).toBe("See example.com");
    });

    it("resolves broadcast mentions to readable form", async () => {
      expect(await reader.resolveMentions("<!channel> standup now")).toBe("@channel standup now");
      expect(await reader.resolveMentions("<!here> quick question")).toBe("@here quick question");
    });

    it("leaves emoji shortcodes unchanged (LLM understands them)", async () => {
      const result = await reader.resolveMentions("Great work :thumbsup: :fire:");
      expect(result).toBe("Great work :thumbsup: :fire:");
    });

    it("resolves multiple mention types in a single message", async () => {
      reader.seedUserCache("UBOB", "Bob");
      reader.seedChannelCache("CDEV123", "dev");
      const result = await reader.resolveMentions(
        "<@UBOB> posted in <#CDEV123>: see <https://example.com|this> :rocket:"
      );
      expect(result).toBe("@Bob posted in #dev(CDEV123): see this :rocket:");
    });

    it("unknown user ID falls back to raw ID without throwing", async () => {
      const result = await reader.resolveMentions("Ping <@U_UNKNOWN_XYZ>");
      expect(result).toContain("U_UNKNOWN_XYZ");
    });
  });

  // ---------------------------------------------------------------------------
  // selectCandidateChannel
  // ---------------------------------------------------------------------------

  describe("selectCandidateChannel", () => {
    const publicCh  = { id: "C_PUB",  is_channel: true,  is_group: false, is_im: false, is_mpim: false, is_private: false, is_archived: false, is_member: true, num_members: 15, name: "general" };
    const privateCh = { id: "C_PRIV", is_channel: false, is_group: true,  is_im: false, is_mpim: false, is_private: true,  is_archived: false, is_member: true, name: "private-team" };
    const broadcastCh = { id: "C_BIG", is_channel: true, is_group: false, is_im: false, is_mpim: false, is_private: false, is_archived: false, is_member: true, num_members: 500, name: "announcements" };
    const dmCh      = { id: "D_DM",  is_channel: false, is_group: false, is_im: true,  is_mpim: false, is_private: false, is_archived: false, is_member: true, name: "dm" };

    it("brand new user: selects channel with oldest default extraction_point (DM gets 90d backfill, public gets 30d — DM wins)", () => {
      const states: Record<string, SlackChannelState> = {};
      const result = reader.selectCandidateChannel([publicCh, dmCh], states, DEFAULT_SETTINGS, NOW_ISO);

      expect(result?.channel.id).toBe("D_DM"); // 90d backfill vs 30d — DM is further back
    });

    it("channel fully caught up (extraction_point >= now) is not selected", () => {
      const states: Record<string, SlackChannelState> = {
        "C_PUB": { extraction_point: iso(1) }, // future — fully caught up
      };
      const result = reader.selectCandidateChannel([publicCh], states, DEFAULT_SETTINGS, NOW_ISO);
      expect(result).toBeNull();
    });

    it("broadcast channel (above threshold) is always skipped", () => {
      const result = reader.selectCandidateChannel([broadcastCh], {}, DEFAULT_SETTINGS, NOW_ISO);
      expect(result).toBeNull();
    });

    it("channel_overrides skip takes precedence over tier classification", () => {
      const settings: SlackSettings = {
        ...DEFAULT_SETTINGS,
        channel_overrides: { "C_PUB": "skip" },
      };
      const result = reader.selectCandidateChannel([publicCh], {}, settings, NOW_ISO);
      expect(result).toBeNull();
    });

    it("selects the channel with the oldest extraction_point when multiple channels are behind", () => {
      const states: Record<string, SlackChannelState> = {
        "C_PUB":  { extraction_point: iso(-3) },  // 3 days behind
        "C_PRIV": { extraction_point: iso(-10) }, // 10 days behind — older, wins
      };
      const result = reader.selectCandidateChannel([publicCh, privateCh], states, DEFAULT_SETTINGS, NOW_ISO);
      expect(result?.channel.id).toBe("C_PRIV");
    });

    it("daily user: channel processed yesterday is selected again today", () => {
      const states: Record<string, SlackChannelState> = {
        "C_PUB": { extraction_point: iso(-1) },
      };
      const result = reader.selectCandidateChannel([publicCh], states, DEFAULT_SETTINGS, NOW_ISO);
      expect(result?.channel.id).toBe("C_PUB");
      expect(result?.state.extraction_point).toBe(iso(-1));
    });

    it("backlog user mid-extraction: returns channel still behind with its current extraction_point preserved", () => {
      const states: Record<string, SlackChannelState> = {
        "C_PUB": { extraction_point: iso(-20) }, // still processing backlog
      };
      const result = reader.selectCandidateChannel([publicCh], states, DEFAULT_SETTINGS, NOW_ISO);
      expect(result?.state.extraction_point).toBe(iso(-20));
    });
  });
});
