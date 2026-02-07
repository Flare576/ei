# 0100: TUI Frontend Skeleton

**Status**: PENDING
**Depends on**: 0006, 0007

## Summary

Create the terminal-based frontend for Ei using OpenTUI framework. This is the foundation for local-first Ei that integrates with the filesystem and OpenCode.

## Framework Decision: OpenTUI

**Selected**: OpenTUI with SolidJS reconciler (`@opentui/solid`)

| Aspect | Details |
|--------|---------|
| **GitHub** | https://github.com/anomalyco/opentui (8k+ stars) |
| **Packages** | `@opentui/core`, `@opentui/solid` |
| **Runtime** | Bun + Zig (for native rendering modules) |
| **Layout Engine** | Yoga (CSS Flexbox for terminals) |
| **Reference Project** | OpenCode (https://github.com/anomalyco/opencode) |

**Why OpenTUI**:
- Native TypeScript - matches Ei core layer
- SolidJS reactive model works with Ei_Interface events
- OpenCode demonstrates exact 3-panel chat layout we need
- Vim-style keybindings via `useKeyboard()` hook
- Built by SST team (production-tested in terminal.shop, OpenCode)

**Alternatives Considered**:
- **Ink** (React for CLI): More mature ecosystem, but slower than OpenTUI
- **blessed-contrib**: Dashboard-focused, imperative API, better for charts than chat

## Project Structure

```
tui/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Entry point (createCliRenderer)
│   ├── app.tsx               # Root component + provider composition
│   ├── routes/
│   │   ├── home.tsx          # Landing/persona selection (optional)
│   │   └── session/
│   │       ├── index.tsx     # Main chat screen (3-panel layout)
│   │       ├── sidebar.tsx   # Persona list component
│   │       ├── messages.tsx  # Chat history (scrollable)
│   │       └── prompt.tsx    # Input area
│   ├── components/
│   │   ├── message-item.tsx  # Individual message rendering
│   │   ├── persona-card.tsx  # Persona list item
│   │   └── status-bar.tsx    # Queue status, help hints
│   ├── context/
│   │   ├── ei.tsx            # EiProvider (wraps Processor + Ei_Interface)
│   │   ├── keyboard.tsx      # Vim keybindings context
│   │   └── theme.tsx         # Terminal color scheme
│   └── util/
│       └── vim-keys.ts       # Navigation helpers
```

## Acceptance Criteria

- [ ] Bun + OpenTUI project scaffolded in `/tui/`
- [ ] EiProvider context wraps Processor with Ei_Interface handlers
- [ ] Uses FileStorage (EI_DATA_PATH) instead of LocalStorage
- [ ] 3-panel layout renders: sidebar (30 cols) + messages (flex) + input (5 rows)
- [ ] Persona list shows all non-archived personas with status indicators
- [ ] Messages scroll with j/k keys
- [ ] Input area accepts multi-line text with Enter to send
- [ ] Vim-style focus: h/l to switch panels, Tab to cycle
- [ ] Ctrl+C aborts current LLM operation (if busy)
- [ ] Graceful terminal resize handling (Yoga recalculates)
- [ ] Can run alongside OpenCode sessions (no port conflicts)

## Stories (Sub-tasks)

### 0100a: Project Scaffold

- [ ] Initialize `/tui/` with Bun + TypeScript
- [ ] Install dependencies: `@opentui/core`, `@opentui/solid`, `solid-js`
- [ ] Create entry point with `createCliRenderer`
- [ ] Verify "Hello World" renders in terminal

### 0100b: Core Integration

- [ ] Create `EiProvider` context that instantiates Processor
- [ ] Implement Ei_Interface event handlers that update SolidJS signals
- [ ] Wire FileStorage with EI_DATA_PATH env var
- [ ] Verify processor starts and checkpoints load

### 0100c: 3-Panel Layout

- [ ] Create session layout with Flexbox (row + column)
- [ ] Sidebar: fixed 30 columns, border
- [ ] Messages: flex-grow, scrollable
- [ ] Input: fixed 5 rows at bottom

### 0100d: Persona List

- [ ] Fetch personas via `processor.getPersonaList()`
- [ ] Render PersonaCard for each (name, short_description, unread_count)
- [ ] Highlight selected persona
- [ ] j/k to navigate, Enter to select

### 0100e: Message Display

- [ ] Fetch messages via `processor.getMessages(selectedPersona)`
- [ ] Render MessageItem with role-based colors (human/system)
- [ ] ScrollBox with auto-scroll to bottom on new messages
- [ ] Refresh on `onMessageAdded` event

### 0100f: Input Area

- [ ] Multi-line textarea with Enter to send
- [ ] Shift+Enter for newline (or configurable)
- [ ] Send via `processor.sendMessage(personaName, content)`
- [ ] Clear input after send

### 0100g: Keybindings

- [ ] useKeyboard hook for global bindings
- [ ] h/l: switch focus between sidebar/messages
- [ ] j/k: scroll in focused panel
- [ ] Tab: cycle focus (sidebar -> messages -> input)
- [ ] Ctrl+C: abort current operation
- [ ] ?: show help overlay

### 0100h: Status Bar

- [ ] Show queue state (idle/busy)
- [ ] Show pending count if > 0
- [ ] Show keybinding hints

## Notes

### Core Layer Compatibility

The Ei core is **highly compatible** with TUI:

1. **Event-driven**: `Ei_Interface` provides all necessary callbacks for reactive updates
2. **Async API**: All Processor methods are async, perfect for terminal UIs
3. **No browser dependencies**: Core has zero React/browser assumptions
4. **Storage abstraction**: TUI uses `FileStorage`, web uses `LocalStorage`

### OpenCode Reference

When implementing, reference OpenCode files for patterns:
- Layout: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
- Provider composition: `packages/opencode/src/cli/cmd/tui/app.tsx`
- Keybindings: `packages/opencode/src/cli/cmd/tui/context/keyboard.tsx`
- Scrollable content: Look for `ScrollBox` usage

### Daily Workflow (Vision)

```
Morning: TUI + OpenCode -> work all day with shared context
Evening: Sync to flare576.com -> use web version on phone
Next morning: TUI pulls latest -> loop continues
```

The TUI is the **integration point** for:
- OpenCode session awareness (0102, 0103)
- CLAUDE.md context injection (0104, 0105)
- Filesystem-based storage (0101)
- Local LLM providers (existing EI_LLM_BASE_URL)

**V1 Backward Reference**:
- "I intend to start with a web-based FrontEnd, but to build the system in such a way that we can add a better, more robust CLI/TUI with OpenTUI (or similar)."

---

## Testing Strategy

### Component Testing: `@opentui/core/testing`

OpenTUI has **built-in testing support** - no external library needed:

```typescript
// tui/src/routes/session/index.test.tsx
import { test, expect } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';

test('renders 3-panel layout', async () => {
  const { renderer, mockInput, captureCharFrame } = 
    await createTestRenderer({ width: 100, height: 30 });
  
  // Render component, simulate input
  await mockInput.typeText("Hello AI");
  await mockInput.pressEnter();
  
  const output = captureCharFrame();
  expect(output).toContain("Hello AI");
  
  renderer.destroy();
});
```

**Available APIs**:
- `createTestRenderer({ width, height })` - Headless renderer
- `mockInput.typeText()`, `mockInput.pressKey()` - Keyboard simulation
- `mockMouse.click()`, `mockMouse.drag()` - Mouse simulation
- `captureCharFrame()`, `captureSpans()` - Output assertions
- `renderOnce()` - Async render pass

### E2E Testing: `@microsoft/tui-test`

For full app E2E (spawns real process, real PTY):

```typescript
// e2e/tui.test.ts
import { test, expect } from '@microsoft/tui-test';

test.use({ 
  program: { file: 'bun', args: ['run', './tui/src/app.tsx'] },
  columns: 120,
  rows: 30
});

test('persona selection flow', async ({ terminal }) => {
  await expect(terminal.getByText('Select a persona:')).toBeVisible();
  
  terminal.keyDown();
  terminal.keyEnter();
  
  await expect(terminal.getByText('Chat with')).toBeVisible();
});

test('sends message and receives response', async ({ terminal }) => {
  terminal.keyEnter(); // Select first persona
  terminal.write('Hello AI!');
  terminal.keyEnter();
  
  await expect(terminal.getByText('You: Hello AI!')).toBeVisible();
  await expect(terminal.getByText('Thinking...')).toBeVisible();
});
```

**Features**:
- Spawns real process via node-pty
- Uses xterm.js for terminal emulation
- Rich assertions: `getByText()`, `toBeVisible()`, color checks
- Snapshot testing: `toMatchSnapshot()`
- Tracing: Records sessions for debugging

### Testing Tiers

| Tier | Tool | Scope | Speed |
|------|------|-------|-------|
| Unit | Vitest | Core logic (Processor, StateManager) | ⚡⚡ Fast |
| Component | `@opentui/core/testing` | TUI components | ⚡ Fast |
| E2E | `@microsoft/tui-test` | Full app flows | 🐢 Slower |

### Why This Matters

We got burned with blessed/Ink because we didn't have E2E testing:
- Ceremony changes broke UI without knowing
- Data type additions caused silent failures
- No regression testing for keyboard flows

With this stack, we can:
- Test core logic independently (Vitest)
- Test TUI components in isolation (OpenTUI testing)
- Run full E2E flows against bundled app (tui-test)
- Catch regressions in both Web AND TUI when core changes
