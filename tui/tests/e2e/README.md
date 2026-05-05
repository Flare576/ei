# TUI E2E Testing

E2E tests for the TUI using `@microsoft/tui-test`.

## Requirements

- Node.js 20 (not 25 - tui-test has native dependency issues)
- Mock LLM server from `../../../tests/e2e/framework/mock-server.ts` (shared with web E2E tests)

## Running Tests

```bash
# Switch to Node 20
source ~/.nvm/nvm.sh && nvm use 20

# Clean previous runs and execute
rm -rf .tui-test /tmp/ei-test-*
npx @microsoft/tui-test tests/e2e/
```

## Common Pitfalls

### Ceremony Will Jam Your Queue

The Processor runs a daily "ceremony" on startup if `human.settings.ceremony.last_ceremony` is unset or in the past. It queues several LLM tasks that block room/persona responses from completing.

**Symptom**: Test times out with "Ready" never appearing, thinking indicators stuck, or persona responses never showing up.

**Fix**: The shared `fixtures.ts` already sets `last_ceremony: new Date().toISOString()` — use `createTestSettings()` from it for all human settings blocks. If you build a custom checkpoint without it, add this manually:

```typescript
settings: {
  ...createTestSettings(MOCK_SERVER_URL),
  // or manually:
  ceremony: {
    time: "09:00",
    last_ceremony: new Date().toISOString(),
  },
}
```

This has bitten us three times. Don't let it bite you a fourth time.

### Heartbeats Fire Immediately Without `heartbeat_delay_ms`

If a persona entity doesn't have `heartbeat_delay_ms` set (or `last_heartbeat` is unset), heartbeat checks fire immediately on startup and queue additional LLM work.

```typescript
// Always include on persona entities in test checkpoints:
heartbeat_delay_ms: 999999999,
last_heartbeat: timestamp,
```

## Critical Pattern: Module-Level Setup

tui-test spawns the terminal BEFORE test callbacks run. All setup must happen at module level:

```typescript
// ✅ CORRECT - runs before terminal spawns
const mockServer = new MockLLMServerImpl();
await mockServer.start(PORT);
mockServer.setResponseForType("response", { type: "fixed", content: "..." });
// Seed checkpoint data (settings must include provider account pointing at mock server)
const checkpoint = createCheckpointWithTwoPersonas(`http://127.0.0.1:${PORT}/v1`);
writeFileSync(statePath, JSON.stringify(checkpoint));
test.use({
  program: { file: BUN_PATH, args: ["run", "dev"] },
  env: { EI_DATA_PATH: TEST_DATA_PATH }
});

// ❌ WRONG - terminal already spawned, too late
test("...", async ({ terminal }) => {
  mockServer.setResponseForType(...); // Won't affect initial requests
});
```

## Test Isolation

Each test file needs:
- Unique mock server port (3098, 3099, etc.)
- Unique data directory (randomized `/tmp/ei-test-*` paths)

This allows parallel file execution while sharing the mock server within a file.

## Checkpoint Seeding

Tests require pre-seeded checkpoint data to prevent unwanted LLM calls:

```typescript
const checkpoint = {
  version: 1,
  timestamp: now,
  human: { 
    settings: { auto_save_interval_ms: 999999999 } // Disable autosave
  },
  personas: {
    ei: {
      entity: {
        last_heartbeat: now,
        heartbeat_delay_ms: 999999999 // Disable heartbeat
      },
      messages: [{ role: "assistant", content: "Ready for testing" }]
    }
  }
};
```

## Mock Server Response Types

The mock server detects request types from prompt content:

| Type | Detection | Default Response |
|------|-----------|------------------|
| `response` | No special markers | Conversational reply |
| `fact-extraction` | "Extract only" in prompt | Empty JSON |
| `concept-extraction` | "concepts from this" in prompt | Empty JSON |
| `generation` | "persona entity" in prompt | Generated persona |
| `heartbeat` | "heartbeat" in prompt | Empty response |

Override with `mockServer.setResponseForType(type, config)`.

## File Structure

```
tui/tests/e2e/
├── slash-commands.test.ts       # /help, /quit, Ctrl+B (port 3097)
├── chat-flow.test.ts            # Send/receive messages (port 3098)
├── error-handling.test.ts       # LLM error scenarios (port 3099)
├── persona-switching.test.ts    # /persona, /archive, Tab (port 3100)
├── basic-commands.test.ts       # /new, /pause, /resume, /model (port 3101)
├── context-boundary.test.ts     # /new divider behavior with messages (port 3102)
├── delete-command.test.ts       # /delete persona deletion with confirmation (port 3103)
├── me-command.test.ts           # /me human entity editing (port 3105)
├── quotes-command.test.ts       # /quotes quote management and overlay (port 3106)
├── provider-command.test.ts     # /provider overlay, direct set, /model inference (port 3107)
├── provider-editor.test.ts      # /provider new via $EDITOR (port 3108)
├── tools-command.test.ts        # /tools overlay, toolkit list (port 3115)
├── generate-synthesis.real-data.ts  # /generate full loop against real state.json (opt-in, see below)
├── fixtures.ts                  # Shared test utilities and checkpoint factory
├── framework/
│   └── mock-server.ts           # Re-export shim (see file for why)
├── types.ts                     # TypeScript interfaces
└── README.md                # This file
tests/e2e/framework/             # Canonical mock server (used by both web and TUI)
└── mock-server.ts
```

## Running Individual Test Files

Since tui-test doesn't support running test subsets, tests are split into separate files. Run a specific file:

```bash
npx @microsoft/tui-test tests/e2e/basic-commands.test.ts
npx @microsoft/tui-test tests/e2e/context-boundary.test.ts
```

## Real-Data Synthesis Test (Opt-In)

`generate-synthesis.test.ts` exercises the full `/generate` pipeline against your real `state.json`. It is **excluded from the normal test run** because it requires live Anthropic API access and your personal state file.

```bash
# Requires: EXTERNAL_STATE_FILE pointing to your state.json
# Uses rewrite_model from your state (should be Opus-class)
# Takes 2-4 minutes depending on knowledge base size

EXTERNAL_STATE_FILE=~/.local/share/ei/state.json \
npx @microsoft/tui-test tests/e2e/generate-synthesis.real-data.ts

# Override the synthesis subject:
SYNTHESIS_SUBJECT="your topic here" \
EXTERNAL_STATE_FILE=~/.local/share/ei/state.json \
npx @microsoft/tui-test tests/e2e/generate-synthesis.real-data.ts

# Assert on specific domain terms in the output:
SYNTHESIS_SUBJECT="your topic" \
SYNTHESIS_EXPECTED_TERMS="term1,term2,term3" \
EXTERNAL_STATE_FILE=~/.local/share/ei/state.json \
npx @microsoft/tui-test tests/e2e/generate-synthesis.real-data.ts
```

The generated document lands in the test's temp dir (`/tmp/ei-test-generate-synthesis-*/docs/*.md`) and is also stored in Emmett's messages in the isolated test state — it does not affect your real `state.json`.
