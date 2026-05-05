/**
 * E2E test: /generate command with real state.json
 *
 * Seeds the test environment with a copy of the real state.json, surgically
 * mutated to be safe for testing (integrations off, ceremony suppressed,
 * heartbeats disabled, queue empty). Then runs /generate end-to-end against
 * the real Anthropic API and validates the full tool-call loop completes.
 *
 * Requirements:
 *   - EXTERNAL_STATE_FILE must point to a real state.json
 *   - The state must have a rewrite_model configured (claude-opus-4-6 GUID)
 *   - The Anthropic provider must be enabled and have a valid API key in state
 *
 * Run:
 *   EXTERNAL_STATE_FILE=~/.local/share/ei/state.json \
 *   npx @microsoft/tui-test tests/e2e/generate-synthesis.real-data.ts
 */

import { test, expect } from "@microsoft/tui-test";
import { rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import assert from "node:assert";
import { BUN_PATH, getTestDataPath } from "./fixtures.js";

const TEST_DATA_PATH = getTestDataPath("generate-synthesis");
const SUBJECT = process.env.SYNTHESIS_SUBJECT ?? "personal projects and recent work";
const SYNTHESIS_TIMEOUT_MS = 240_000;

// ---------------------------------------------------------------------------
// State preparation — runs at module level, before tui-test spawns the terminal
// ---------------------------------------------------------------------------

const stateFilePath = process.env.EXTERNAL_STATE_FILE;
if (!stateFilePath || !existsSync(stateFilePath)) {
  throw new Error(
    "EXTERNAL_STATE_FILE must be set and point to a real state.json.\n" +
    "Example: EXTERNAL_STATE_FILE=~/.local/share/ei/state.json npm run test:e2e -- tests/e2e/generate-synthesis.test.ts"
  );
}

const rawState = JSON.parse(readFileSync(stateFilePath, "utf-8"));

// Stamp far-future dates so time-triggered work doesn't fire
const now = new Date().toISOString();
const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

// Surgical mutations on settings
rawState.human.settings = {
  ...rawState.human.settings,
  auto_save_interval_ms: 999_999_999,
  // Suppress ceremony (far future = won't run)
  ceremony: {
    ...rawState.human.settings?.ceremony,
    last_ceremony: farFuture,
  },
  // Kill all integrations that reach outside EI_DATA_PATH
  opencode: {
    ...rawState.human.settings?.opencode,
    integration: false,
  },
  claudeCode: {
    ...rawState.human.settings?.claudeCode,
    integration: false,
  },
  cursor: {
    ...rawState.human.settings?.cursor,
    integration: false,
  },
  personaHistory: {
    ...rawState.human.settings?.personaHistory,
    integration: false,
  },
  // Disable sync and backup — nothing should leave the temp dir
  sync: { username: "", passphrase: "" },
  backup: { enabled: false },
};

// Suppress heartbeats on every persona
for (const personaData of Object.values(rawState.personas ?? {}) as any[]) {
  if (personaData?.entity) {
    personaData.entity.heartbeat_delay_ms = 999_999_999;
    personaData.entity.last_heartbeat = now;
  }
}

// Clear the queue — no leftover work from real state
rawState.queue = [];

rmSync(TEST_DATA_PATH, { recursive: true, force: true });
mkdirSync(TEST_DATA_PATH, { recursive: true });

const statePath = join(TEST_DATA_PATH, "state.json");
writeFileSync(statePath, JSON.stringify(rawState, null, 2));

// ---------------------------------------------------------------------------
// Terminal setup
// ---------------------------------------------------------------------------

test.use({
  program: {
    file: BUN_PATH,
    args: ["run", "dev"],
  },
  rows: 40,
  columns: 140,
  env: {
    EI_DATA_PATH: TEST_DATA_PATH,
    PATH: process.env.PATH!,
    HOME: process.env.HOME!,
    TERM: "xterm-256color",
    EI_LOG_LEVEL: process.env.EI_LOG_LEVEL ?? "info",
  },
});

// ---------------------------------------------------------------------------
// Poll helper — watches state.json for the completion artifact
// ---------------------------------------------------------------------------

async function waitForGeneratedDoc(
  path: string,
  testStartTime: number,
  timeoutMs = SYNTHESIS_TIMEOUT_MS
): Promise<{ slug: string; subject: string } | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const state = JSON.parse(readFileSync(path, "utf-8"));
      const docs: Record<string, any> = state.human?.settings?.document?.processed_documents ?? {};
      const entry = Object.entries(docs).find(
        ([, r]) => r.type === "generated" && new Date(r.created_at).getTime() > testStartTime
      );
      if (entry) return { slug: entry[0], subject: (entry[1] as any).subject };
    } catch {
      // File mid-write — retry
    }
    await new Promise(r => setTimeout(r, 1_000));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe("Knowledge Synthesis (/generate)", () => {
  test("full tool-call loop produces a document in Emmett's messages", async ({ terminal }) => {
      const testStart = Date.now();

      // Wait for TUI to be ready
      await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 20_000 });

      // Issue the /generate command
      terminal.write(`/generate ${SUBJECT}`);
      terminal.submit();

      // Confirm the queue started — Processing must appear before we start polling
      await expect(terminal.getByText(/Processing/g)).toBeVisible({ timeout: 15_000 });

      // Wait for the real completion signal: document written to state.json
      // (The "Ready" status bar can flash during multi-step tool loops, so we
      //  anchor completion on the state artifact rather than the UI signal.)
      const doc = await waitForGeneratedDoc(statePath, testStart);
      assert.ok(doc, "No generated document found in state.json within timeout");
      assert.strictEqual(doc!.subject, SUBJECT);

      // "Ready" should now be stable — queue fully drained after document write
      await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 15_000 });

      // Read the final state and verify the document content
      const finalState = JSON.parse(readFileSync(statePath, "utf-8"));

      // Emmett should have a message tagged with the document slug
      const emmettMessages: any[] = finalState.personas?.emmet?.messages ?? [];
      const docMessage = emmettMessages.find(
        (m: any) => m.source_tag === `generate:document:${doc!.slug}`
      );

      assert.ok(docMessage, "Emmett has no message with the expected source_tag");
      assert.ok(docMessage.content, "Generated document content is empty");
      assert.ok(docMessage.content.length > 500, "Document is suspiciously short");

      // Content quality: the document should mention key domain terms from the input topics.
      // Not checking for exact phrases — models paraphrase — but these terms are
      // sufficiently specific that hallucination is the only way they'd appear without synthesis.
      const content: string = docMessage.content.toLowerCase();
      const expectedTerms = process.env.SYNTHESIS_EXPECTED_TERMS
        ? process.env.SYNTHESIS_EXPECTED_TERMS.split(",").map(t => t.trim())
        : [];
      for (const term of expectedTerms) {
        assert.ok(content.includes(term), `Document doesn't mention "${term}" — may not have synthesized the IDP topics`);
      }
  });
});
