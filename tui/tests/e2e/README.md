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

## Critical Pattern: Module-Level Setup

tui-test spawns the terminal BEFORE test callbacks run. All setup must happen at module level:

```typescript
// ✅ CORRECT - runs before terminal spawns
const mockServer = new MockLLMServerImpl();
await mockServer.start(PORT);
mockServer.setResponseForType("response", { type: "fixed", content: "..." });

// Seed checkpoint data
writeFileSync(autosavesPath, JSON.stringify([checkpoint]));

test.use({
  program: { file: BUN_PATH, args: ["run", "dev"] },
  env: { EI_LLM_BASE_URL: `http://127.0.0.1:${PORT}/v1` }
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
├── slash-commands.test.ts   # /help, /quit, Ctrl+B (port 3097)
├── chat-flow.test.ts        # Send/receive messages (port 3098)
├── error-handling.test.ts   # LLM error scenarios (port 3099)
├── persona-switching.test.ts # /persona, /archive, Tab (port 3100)
├── basic-commands.test.ts   # /new, /pause, /resume, /model (port 3101)
├── context-boundary.test.ts # /new divider behavior with messages (port 3102)
├── delete-command.test.ts   # /delete persona deletion with confirmation (port 3103)
├── me-command.test.ts       # /me human entity editing (port 3105)
├── quotes-command.test.ts   # /quotes quote management and overlay (port 3106)
├── fixtures.ts              # Shared test utilities and checkpoint factory
├── framework/
│   └── mock-server.ts       # Re-export shim (see file for why)
├── types.ts                 # TypeScript interfaces
└── README.md                # This file

tests/e2e/framework/         # Canonical mock server (used by both web and TUI)
└── mock-server.ts
```

## Running Individual Test Files

Since tui-test doesn't support running test subsets, tests are split into separate files. Run a specific file:

```bash
npx @microsoft/tui-test tests/e2e/basic-commands.test.ts
npx @microsoft/tui-test tests/e2e/context-boundary.test.ts
```
