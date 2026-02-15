# TUI - Agent Collaboration Guide

Agent-specific guidance for the TUI frontend.

## Architecture

- **Framework**: OpenTUI + SolidJS
- **Runtime**: Bun (dev), Node 20 (E2E tests only)
- **Layout**: Yoga Flexbox for terminals

See root `AGENTS.md` for overall project structure.

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

### Unit Tests (Bun)

```bash
bun run test
```

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
├── CLAUDE.md             # Bun-specific guidance
└── AGENTS.md             # This file
```

## Common Gotchas

1. **Bun vs Node**: Use Bun for development, Node 20 for E2E tests
2. **Signal timing**: Set SolidJS signals BEFORE async processor calls that fire callbacks
3. **Scrollbox children**: Use `visible` prop, not `<Show>`, for conditional content
4. **E2E cache**: If E2E tests fail with module errors, clear `.tui-test/cache`
