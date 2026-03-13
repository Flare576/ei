# TUI - Agent Collaboration Guide

Agent-specific guidance for the TUI frontend.

## Architecture

- **Framework**: OpenTUI + SolidJS
- **Runtime**: Bun (dev), Node 20 (E2E tests only)
- **Layout**: Yoga Flexbox for terminals

See root `AGENTS.md` for overall project structure.

## Bun Runtime

Default to Bun instead of Node.js for all TUI development.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun install` instead of `npm install`
- Use `bun run <script>` instead of `npm run <script>`
- Use `bunx <package>` instead of `npx <package>`
- Bun automatically loads `.env` — don't use dotenv

### Prefer Bun Built-in APIs

| Instead of | Use |
|------------|-----|
| `express` | `Bun.serve()` (supports WebSockets, HTTPS, routes) |
| `better-sqlite3` | `bun:sqlite` |
| `ioredis` | `Bun.redis` |
| `pg` / `postgres.js` | `Bun.sql` |
| `ws` | Built-in `WebSocket` |
| `node:fs` readFile/writeFile | `Bun.file` |
| `execa` | `Bun.$\`ls\`` |

## Critical: OpenTUI Conditional Rendering

**DO NOT use `<Show>` inside `<scrollbox>`** - it causes element accumulation bugs.

### The Problem

SolidJS's `<Show>` component removes and recreates DOM nodes when conditions change. OpenTUI renderables **must be destroyed** when removed to free native terminal resources. When SolidJS reuses nodes after removal, OpenTUI nodes get corrupted and accumulate.

### The Solution

Use the `visible` prop instead of `<Show>` for conditional rendering inside scrollbox:

```tsx
// ❌ WRONG - causes element accumulation
<scrollbox>
  <For each={items()}>
    {(item) => (
      <Show when={shouldShow()}>
        <box>content</box>
      </Show>
    )}
  </For>
</scrollbox>

// ✅ CORRECT - hides without destroying
<scrollbox>
  <For each={items()}>
    {(item) => (
      <box visible={shouldShow()}>
        content
      </box>
    )}
  </For>
</scrollbox>
```

### When to Use Each Pattern

| Pattern | Use For |
|---------|---------|
| `visible={condition}` | Conditionals inside `<scrollbox>`, `<box>`, or any OpenTUI component |
| `<Show when={...}>` | Top-level routing, completely separate UI states, fallback content |

### Evidence

- OpenCode uses `visible` prop throughout: `autocomplete.tsx`, `prompt/index.tsx`, `session/index.tsx`
- [Answer Overflow discussion](https://www.answeroverflow.com/m/1422353680367222785) from OpenTUI maintainer explains the node lifecycle issue

## Testing

### Unit Tests (Two Runners)

```bash
# Vitest - for tests needing SolidJS JSX (testRender, providers)
bun run vitest run

# Bun test - for pure logic tests (faster)
bun test src/ tests/*.test.tsx

# Combined (recommended):
bun run test    # Runs both
```

**When to use which:**
- `bun:test` — Pure functions, command parser, registry logic
- `vitest` — Components using `testRender()` from `@opentui/solid`

### E2E Tests (Node 20 Required)

```bash
# From tui/ directory
npm run test:e2e

# From project root
npm run test:e2e:tui
```

**Important**: E2E tests use `@microsoft/tui-test` which requires Node 20 due to native PTY dependencies. The npm scripts handle nvm switching automatically.

### Test Data Seeding

E2E tests require pre-seeded checkpoint data. See `tests/e2e/README.md` for patterns.

### E2E Test Efficiency Pattern

**CRITICAL: E2E tests are SLOW (30s-2min). Run ONCE, analyze output from file.**

**❌ WRONG (wasteful):**
```bash
# Running test suite multiple times to check results
npm run test:e2e  # Run 1
# Read streaming output...
npm run test:e2e  # Run 2 because uncertain
# Read streaming output again...
npm run test:e2e  # Run 3 "just to be sure"
```

**✅ CORRECT (efficient):**
```bash
# Run ONCE, save output to evidence file
npm run test:e2e > ../.sisyphus/evidence/e2e-tui-results.txt 2>&1

# THEN analyze the saved file (instant, repeatable)
grep -E "(PASS|FAIL|✓|✗)" ../.sisyphus/evidence/e2e-tui-results.txt
grep "tests passing" ../.sisyphus/evidence/e2e-tui-results.txt

# Or read specific sections
head -50 ../.sisyphus/evidence/e2e-tui-results.txt  # First 50 lines
tail -30 ../.sisyphus/evidence/e2e-tui-results.txt  # Summary
```

**Why this matters:**
- E2E tests spawn actual terminal processes, seed data, verify UI state
- One full run = 1-2 minutes of wall time
- Streaming output to LLM context = expensive token cost
- Running 6 times (seen in practice) = 6-12 minutes wasted

**File output benefits:**
- Run once, analyze many times (grep, head, tail, read specific lines)
- Repeatable verification without re-running tests
- Evidence persists for debugging and verification
- Clear separation: execution (slow) vs analysis (instant)

**When to re-run:**
- After fixing a test failure (code changed)
- After modifying test setup/fixtures
- Never re-run just to "double-check" the same output
## File Structure

```
tui/
├── src/
│   ├── app.tsx           # Root component
│   ├── components/       # UI components
│   │   ├── MessageList.tsx   # Chat messages + context dividers
│   │   ├── PromptInput.tsx   # User input
│   │   ├── Sidebar.tsx       # Persona list
│   │   └── StatusBar.tsx     # Queue status
│   ├── commands/         # Slash command implementations
│   ├── context/          # SolidJS contexts
│   │   ├── ei.tsx        # Processor integration
│   │   └── keyboard.tsx  # Keyboard navigation
│   └── util/             # Helpers
├── tests/
│   └── e2e/              # E2E tests (Node 20)
└── AGENTS.md             # This file
```

## Common Gotchas

1. **Bun vs Node**: Use Bun for development, Node 20 for E2E tests
2. **Signal timing**: Set SolidJS signals BEFORE async processor calls that fire callbacks
3. **Scrollbox children**: Use `visible` prop, not `<Show>`, for conditional content
4. **E2E cache**: If E2E tests fail with module errors, clear `.tui-test/cache`
