import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodexReader, parseCodexRolloutMessages } from "../../../../src/integrations/codex/reader.js";

describe("parseCodexRolloutMessages", () => {
  it("extracts visible user and agent messages from rollout JSONL", () => {
    const text = [
      JSON.stringify({ type: "session_meta", payload: { cwd: "/tmp/project" } }),
      JSON.stringify({
        timestamp: "2026-01-01T00:00:01.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "Can you wire up the hook?" },
      }),
      JSON.stringify({
        timestamp: "2026-01-01T00:00:02.000Z",
        type: "event_msg",
        payload: { type: "token_count", tokens: 123 },
      }),
      JSON.stringify({
        timestamp: "2026-01-01T00:00:03.000Z",
        type: "event_msg",
        payload: { type: "agent_message", message: "On it." },
      }),
      "not json",
    ].join("\n");

    expect(parseCodexRolloutMessages(text, "thread-1")).toEqual([
      {
        id: "evt_2",
        sessionId: "thread-1",
        role: "user",
        content: "Can you wire up the hook?",
        timestamp: "2026-01-01T00:00:01.000Z",
      },
      {
        id: "evt_4",
        sessionId: "thread-1",
        role: "assistant",
        content: "On it.",
        timestamp: "2026-01-01T00:00:03.000Z",
      },
    ]);
  });
});

describe("CodexReader.getSessions", () => {
  let codexHome: string;

  beforeEach(() => {
    codexHome = mkdtempSync(join(tmpdir(), "codex-reader-test-"));
  });

  afterEach(() => {
    rmSync(codexHome, { recursive: true, force: true });
  });

  async function seedThreads(rows: Array<{ id: string; rolloutPath: string }>): Promise<void> {
    // Dynamic import, not static: bun:sqlite must not be a top-level import reachable by Vite's
    // static analysis (breaks root Vitest under real Node, and web/CLI bundling) — mirrors the
    // existing production pattern in src/integrations/codex/reader.ts:128 and friends.
    const { Database } = await import(/* @vite-ignore */ "bun:sqlite");
    const db = new Database(join(codexHome, "state.sqlite"));
    db.exec(
      "CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT, created_at_ms INTEGER, updated_at_ms INTEGER, cwd TEXT, title TEXT, first_user_message TEXT)"
    );
    const insert = db.prepare(
      "INSERT INTO threads (id, rollout_path, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?)"
    );
    for (const row of rows) insert.run(row.id, row.rolloutPath, 1000, 2000);
    db.close();
  }

  function validRolloutLine(message: string, timestamp: string): string {
    return JSON.stringify({
      timestamp,
      type: "event_msg",
      payload: { type: "user_message", message },
    });
  }

  // Oracle from .sisyphus/issues/codex-getsessions-throws-on-malformed-rollout.md:
  // a rollout whose first non-blank line is the JSON literal `null` parses fine
  // as JSON but breaks the `record.type` access in extractEventMessage, and that
  // throw currently propagates all the way out of getSessions(), losing every
  // other session sharing the same DB query result.
  //
  // Bun-only: seedThreads() constructs a real bun:sqlite database, which does not
  // exist under real Node — this repo's own root Vitest suite (AGENTS.md Test Runner
  // Map) must run under real Node 22+, so this test runs for real under `bun test`/
  // Bun-shim invocations and is skipped (not failed) when neither is available.
  it.skipIf(typeof Bun === "undefined")(
    "skips a session with a structurally malformed rollout (first line `null`) without failing sibling sessions",
    async () => {
    const goodRolloutPath = join(codexHome, "good.jsonl");
    const badRolloutPath = join(codexHome, "bad.jsonl");

    writeFileSync(goodRolloutPath, validRolloutLine("hello", "2026-01-01T00:00:01.000Z") + "\n");
    writeFileSync(badRolloutPath, "null\n");

    await seedThreads([
      { id: "good-session", rolloutPath: goodRolloutPath },
      { id: "bad-session", rolloutPath: badRolloutPath },
    ]);

    const reader = new CodexReader(codexHome);
    const sessions = await reader.getSessions();

    expect(sessions.map((s) => s.id)).toEqual(["good-session"]);
  });
});
