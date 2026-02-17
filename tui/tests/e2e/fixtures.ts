/**
 * Shared test fixtures and utilities for TUI E2E tests.
 * 
 * Usage in test files:
 * ```typescript
 * import { createCheckpointWithTwoPersonas, BUN_PATH } from "./fixtures.js";
 * ```
 */

export const BUN_PATH = process.env.BUN_PATH || "/Users/flare576/.bun/bin/bun";
export const TAB = "\t";

/**
 * Creates a checkpoint with two personas (Ei and Sage) for testing.
 * Both have heartbeat and autosave disabled to prevent unwanted LLM calls.
 */
export function createCheckpointWithTwoPersonas() {
  const timestamp = new Date().toISOString();
  return {
    version: 1,
    timestamp,
    human: {
      entity: "human",
      facts: [],
      traits: [],
      topics: [],
      people: [],
      quotes: [],
      last_updated: timestamp,
      last_activity: timestamp,
      settings: { auto_save_interval_ms: 999999999 },
    },
    personas: {
      ei: {
        entity: {
          id: "ei",
          display_name: "Ei",
          entity: "system",
          aliases: ["Ei"],
          short_description: "Your personal companion",
          long_description: "A friendly AI companion for testing",
          traits: [],
          topics: [],
          facts: [],
          people: [],
          is_paused: false,
          is_archived: false,
          is_static: false,
          last_updated: timestamp,
          last_activity: timestamp,
          last_heartbeat: timestamp,
          heartbeat_delay_ms: 999999999,
        },
        messages: [
          {
            id: "msg-1",
            role: "system",
            content: "Hello! I'm ready for testing.",
            timestamp,
            read: true,
            context_status: "default",
          },
        ],
      },
      "007": {
        entity: {
          entity: "system",
          id: "007",
          display_name: "Sage",
          aliases: ["Sage"],
          short_description: "A wise mentor",
          long_description: "A wise mentor for testing",
          traits: [],
          topics: [],
          facts: [],
          people: [],
          is_paused: false,
          is_archived: false,
          is_static: false,
          last_updated: timestamp,
          last_activity: timestamp,
          last_heartbeat: timestamp,
          heartbeat_delay_ms: 999999999,
        },
        messages: [],
      },
    },
    queue: [],
  };
}

/**
 * Generate a unique test data path to avoid conflicts between parallel test files.
 */
export function getTestDataPath(testName: string): string {
  return `/tmp/ei-test-${testName}-${process.pid}-${Date.now()}`;
}
