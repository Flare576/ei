# EI Project - Agent Collaboration Guide

This file guides AI coding agents (Claude, etc.) working on the EI codebase.

## V1 Architecture

EI V1 is a **clean-room rewrite**. The V0 code in `/v0/` is for reference only.

### Source of Truth

| Document | Purpose |
|----------|---------|
| `CONTRACTS.md` | **THE** source of truth for interfaces, types, and naming |
| `v1.md` | Design philosophy and background context |
| `tickets/` | Implementation tasks with acceptance criteria |

> **CRITICAL**: If a ticket uses a different name for something defined in CONTRACTS.md, **STOP and ASK**. CONTRACTS.md wins.

### V0 Reference Policy

The `/v0/` folder contains the proof-of-concept implementation. When working on V1:

- **DO** reference V0 for conceptual understanding
- **DO** extract prompt engineering patterns (the English, not the code)
- **DO NOT** copy code directly—V0 has accumulated technical debt
- **DO NOT** assume V0 patterns are correct—many are experiments that didn't pan out
- **WHEN IN DOUBT** about whether V0 did something intentionally, **ASK FLARE**

### Project Structure (V1)

```
/
├── AGENTS.md           # This file
├── CONTRACTS.md        # Interface definitions (SOURCE OF TRUTH)
├── v1.md               # Design philosophy
├── tickets/
│   ├── STATUS.md       # Ticket overview
│   └── *.md            # Individual tickets
├── v0/                 # Legacy PoC (REFERENCE ONLY)
│   ├── src/            # Old source code
│   ├── tests/          # Old tests
│   └── tickets/        # Old tickets (historical)
└── src/                # V1 source (to be created)
    ├── core/
    │   ├── processor.ts
    │   ├── state-manager.ts
    │   ├── queue-processor.ts
    │   └── types.ts
    ├── storage/
    │   ├── interface.ts
    │   └── local.ts
    ├── prompts/
    │   └── (organized by purpose)
    └── index.ts
```

## Ticket System

Tickets live in `/tickets/` as markdown files.

### Status Values

| Status | Meaning |
|--------|---------|
| `PENDING` | Not started |
| `IN_PROGRESS` | Active work |
| `QA` | Dev complete, awaiting review |
| `DONE` | Completed and verified |
| `BLOCKED` | Waiting on something (note blocker) |

### Working on Tickets

1. **Before starting**: Update status to `IN_PROGRESS` in both ticket file AND `tickets/STATUS.md`
2. **While working**: Keep acceptance criteria checkboxes updated
3. **When done**: Update status to `QA` or `DONE`, update STATUS.md
4. **Don't delete tickets** — they're project history

### Ticket Format

```markdown
# XXXX: Title

**Status**: PENDING
**Depends on**: (list ticket numbers or "None")
**Blocked by**: (if BLOCKED, explain why)

## Summary
One paragraph describing the goal.

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Notes
Implementation details, gotchas, decisions made.
```

## Code Conventions

### Naming (from CONTRACTS.md)

| Pattern | Convention | Example |
|---------|------------|---------|
| Interfaces | PascalCase | `HumanEntity`, `LLMRequest` |
| Functions | camelCase | `getPersonaList`, `enqueueRequest` |
| Events | on + PascalCase | `onPersonaAdded`, `onMessageQueued` |
| Entity fields | snake_case | `last_updated`, `exposure_current` |
| Constants | SCREAMING_SNAKE | `MAX_RETRIES` |

### Semantic Fields

These have specific meanings—don't invent synonyms:

| Field | Meaning |
|-------|---------|
| `exposure_current` | How recently/frequently discussed (0-1) |
| `exposure_desired` | How much entity wants to discuss (0-1) |
| `sentiment` | Emotional valence (-1 to 1) |
| `strength` | How strongly a trait manifests (0-1) |
| `confidence` | How certain a fact is accurate (0-1) |

### Prompts

All prompt builders:
- Are **synchronous**
- Receive **pre-fetched, pre-processed data**
- Return `{ system: string; user: string }`
- Do **minimal data manipulation**

The Processor is responsible for fetching, filtering, and formatting data before calling prompt builders.

## LLM Configuration

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `EI_LLM_BASE_URL` | Local provider endpoint (default: `http://127.0.0.1:1234/v1`) |
| `EI_LLM_MODEL` | Global default model |
| `EI_MODEL_RESPONSE` | Model for conversations |
| `EI_MODEL_CONCEPT` | Model for extraction |
| `EI_MODEL_GENERATION` | Model for persona generation |
| `EI_OPENAI_API_KEY` | OpenAI API key |
| `EI_GOOGLE_API_KEY` | Google AI Studio key |
| `EI_ANTHROPIC_API_KEY` | Anthropic key |
| `EI_XAI_API_KEY` | xAI (Grok) key |

### Model Specification

Format: `provider:model` (e.g., `openai:gpt-4o`, `local:google/gemma-3-12b`)

Bare model names assume `local` provider.

## Development

### Commands (once V1 scaffolding exists)

```bash
npm run dev      # Watch mode
npm run build    # Compile TypeScript
npm run test     # Run tests
npm start        # Run the app
```

### Testing Strategy

- **Unit tests**: Pure functions, complex logic
- **Integration tests**: Critical flows with mocks
- **E2E validation**: Human testing (most reliable for UI)

## Agent-Specific Notes

### When Implementing Features

1. Check CONTRACTS.md for interface definitions
2. Check if a ticket exists—follow its spec
3. Match patterns from similar V1 code (not V0)
4. Update STATUS.md when changing ticket status

### When Confused

- **About naming**: Check CONTRACTS.md
- **About V0 behavior**: Ask Flare (don't assume V0 was right)
- **About scope**: Ask before expanding beyond ticket criteria

### Code Quality

- Never suppress type errors (`as any`, `@ts-ignore`)
- Never commit unless explicitly requested
- Fix minimally when debugging—don't refactor while fixing

### Time-Based Triggers (IMPORTANT)

When implementing features that check timestamps and queue async work:

```typescript
// ❌ WRONG: Update timestamp AFTER async work completes
if (timeSinceLastX >= delay) {
  await doAsyncWork();        // Takes seconds
  lastX = Date.now();         // Other loop iterations queue duplicates!
}

// ✅ CORRECT: Update timestamp BEFORE async work
if (timeSinceLastX >= delay) {
  lastX = Date.now();         // Prevent duplicate queueing
  await doAsyncWork();
}
```

**Why this matters**: The processor loop runs every 100ms. If async work (like LLM calls) takes 5+ seconds, the condition remains true for ~50 loop iterations, queueing duplicates.

**Examples in this codebase**:
- `queueHeartbeatCheck()` updates `last_heartbeat` before queueing
- Future: Ceremony triggers, extraction throttling

---

## V2: TUI Frontend (OpenTUI)

### Framework: OpenTUI

| Aspect | Details |
|--------|---------|
| **GitHub** | https://github.com/anomalyco/opentui (8k+ stars) |
| **Packages** | `@opentui/core`, `@opentui/react`, `@opentui/solid` |
| **Runtime** | Bun + Zig (for native rendering modules) |
| **Layout Engine** | Yoga (CSS Flexbox for terminals) |
| **Reference Project** | OpenCode (https://github.com/anomalyco/opencode) |

**Why OpenTUI**:
- Native TypeScript - matches Ei core
- Same `Ei_Interface` event-driven integration as web
- OpenCode demonstrates 3-panel chat layout (our exact use case)
- Vim-style keybindings via `useKeyboard()`
- Built by SST team (terminal.shop, OpenCode)

### Project Structure (V2/TUI)

```
/
├── src/                # Core layer (shared with web)
│   ├── core/
│   ├── storage/
│   ├── prompts/
│   └── index.ts
├── web/                # React web frontend
├── api/                # PHP sync API
└── tui/                # OpenTUI frontend (V2)
    ├── src/
    │   ├── app.tsx              # Root component + providers
    │   ├── routes/
    │   │   ├── home.tsx         # Landing/persona selection
    │   │   └── session/
    │   │       ├── index.tsx    # Main chat screen (3-panel)
    │   │       ├── sidebar.tsx  # Persona list
    │   │       ├── messages.tsx # Chat history (scrollable)
    │   │       └── prompt.tsx   # Input area
    │   ├── components/
    │   │   ├── message-item.tsx
    │   │   ├── persona-card.tsx
    │   │   └── status-bar.tsx
    │   ├── context/
    │   │   ├── ei.tsx           # Ei_Interface + Processor wrapper
    │   │   ├── keyboard.tsx     # Vim keybindings
    │   │   └── theme.tsx        # Terminal colors
    │   └── util/
    │       └── vim-keys.ts      # j/k navigation, focus management
    ├── package.json
    └── tsconfig.json
```

### Core Integration Pattern

The TUI uses the **same Ei_Interface pattern** as web:

```typescript
// tui/src/context/ei.tsx
import { createContext, useContext } from "solid-js"
import { Processor, Ei_Interface, FileStorage } from "../../../src"

export function EiProvider(props) {
  const storage = new FileStorage(process.env.EI_DATA_PATH)
  
  const eiInterface: Ei_Interface = {
    onPersonaAdded: () => setPersonaListDirty(true),
    onMessageAdded: (personaName) => refreshMessages(personaName),
    onQueueStateChanged: (state) => setQueueState(state),
    // ... all event handlers trigger reactive state updates
  }
  
  const processor = new Processor(eiInterface, storage)
  
  return (
    <EiContext.Provider value={processor}>
      {props.children}
    </EiContext.Provider>
  )
}
```

### 3-Panel Layout (Flexbox)

```tsx
// tui/src/routes/session/index.tsx
<Box flexDirection="row" width="100%" height="100%">
  {/* Left: Persona list */}
  <Sidebar width={30} />
  
  {/* Center: Chat + Input */}
  <Box flexDirection="column" flexGrow={1}>
    <MessageList flexGrow={1} />
    <PromptInput height={5} />
  </Box>
</Box>
```

### Vim-Style Navigation

```typescript
// tui/src/context/keyboard.tsx
keyboard.on("keypress", (key) => {
  if (key.name === "j") scrollDown()
  if (key.name === "k") scrollUp()
  if (key.name === "h") focusSidebar()
  if (key.name === "l") focusMessages()
  if (key.ctrl && key.name === "c") abort()
  if (key.name === "tab") cycleFocus()
})
```

### Key Differences from Web

| Aspect | Web | TUI |
|--------|-----|-----|
| Storage | `LocalStorage` (browser) | `FileStorage` (EI_DATA_PATH) |
| Rendering | React DOM | OpenTUI + SolidJS |
| Input | Mouse + keyboard | Keyboard-first (vim) |
| Layout | CSS Grid/Flex | Yoga Flexbox |
| Runtime | Browser | Bun + terminal |

### OpenCode Reference Files

When implementing the TUI, reference these OpenCode files for patterns:
- Layout: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
- Provider composition: `packages/opencode/src/cli/cmd/tui/app.tsx`
- Keybindings: `packages/opencode/src/cli/cmd/tui/context/keyboard.tsx`
- Scrollable content: Look for `ScrollBox` usage

### TUI Testing Strategy

Unlike blessed/Ink, OpenTUI has **built-in testing support**:

#### Component Testing: `@opentui/core/testing`

```typescript
import { createTestRenderer } from '@opentui/core/testing';

const { renderer, mockInput, captureCharFrame } = 
  await createTestRenderer({ width: 100, height: 30 });

await mockInput.typeText("Hello");
await mockInput.pressEnter();

const output = captureCharFrame();
expect(output).toContain("Hello");
```

**APIs**: `mockInput.typeText()`, `mockInput.pressKey()`, `mockMouse.click()`, `captureCharFrame()`, `captureSpans()`

#### E2E Testing: `@microsoft/tui-test`

Full app E2E via real PTY + xterm.js:

```typescript
import { test, expect } from '@microsoft/tui-test';

test.use({ program: { file: 'bun', args: ['run', './tui/src/app.tsx'] } });

test('persona selection', async ({ terminal }) => {
  await expect(terminal.getByText('Select persona')).toBeVisible();
  terminal.keyDown();
  terminal.keyEnter();
  await expect(terminal.getByText('Chat with')).toBeVisible();
});
```

**Features**: Headless execution, input simulation, `getByText()` assertions, snapshot testing, tracing

#### Testing Tiers

| Tier | Tool | Scope |
|------|------|-------|
| Unit | Vitest | Core logic (Processor, StateManager) |
| Component | `@opentui/core/testing` | TUI components in isolation |
| E2E | `@microsoft/tui-test` | Full app flows |

This ensures Ceremony changes, data type additions, etc. don't silently break TUI (or Web).
