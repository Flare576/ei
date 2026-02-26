# Ei - Agent Collaboration Guide

AI coding agent guide for the Ei codebase.

## Architecture Overview

Ei is a local-first AI companion with persistent personas. Three frontends share one core:

```
/
├── src/                # Core library (TypeScript)
│   ├── core/           # Processor, StateManager, handlers, orchestrators
│   ├── prompts/        # LLM prompt builders (see src/prompts/AGENTS.md)
│   ├── storage/        # Storage interface + implementations
│   └── index.ts        # Public exports
├── web/                # React web frontend (Vite)
├── tui/                # Terminal UI (OpenTUI + SolidJS, Bun runtime)
├── api/                # PHP sync API (remote storage)
├── tests/              # Unit + E2E tests
└── tickets/            # Project tickets (see STATUS.md)
```

## Source of Truth

| Document | Purpose |
|----------|---------|
| `CONTRACTS.md` | **THE** source of truth for interfaces, types, and naming |
| `v1.md` | Design philosophy and background context |
| `tickets/` | Implementation tasks with acceptance criteria |

> **CRITICAL**: If a ticket uses a different name for something defined in CONTRACTS.md, **STOP and ASK**. CONTRACTS.md wins.

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

## Configuration

### Environment Variables
| Variable | Purpose |
|----------|---------|
| `EI_DATA_PATH` | Path to Ei's persistent data directory |
| `EI_SYNC_USERNAME` | Username for remote sync API |
| `EI_SYNC_PASSPHRASE` | Passphrase for remote sync API |

### Provider Setup

Providers are configured per-user via `/provider new` (TUI) or the onboarding flow (Web).
On first TUI launch, a "Local LLM" provider is auto-created if a local LLM is detected on port 1234.

### Model Specification

Format: `ProviderName:model` (e.g., `Local LLM:llama-3.1-8b`, `My OpenAI:gpt-4o`)

## Development

### Commands

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
3. Update STATUS.md when changing ticket status

### When Confused

- **About naming**: Check CONTRACTS.md
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

## TUI Frontend (OpenTUI)

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

### TUI Project Structure

```
tui/
├── src/
│   ├── app.tsx           # Root component + providers
│   ├── index.tsx         # Entry point
│   ├── components/       # UI components
│   │   ├── Chat.tsx      # Message display
│   │   ├── InputArea.tsx # Text input
│   │   ├── Sidebar.tsx   # Persona list
│   │   └── StatusBar.tsx # Queue/connection status
│   ├── context/          # SolidJS contexts
│   │   └── ei.tsx        # Processor wrapper
│   ├── storage/          # TUI-specific storage
│   └── util/             # Helpers
├── package.json
├── bunfig.toml           # Bun config (preloads)
└── AGENTS.md             # TUI-specific agent guidance
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

### Key Differences from Web

| Aspect | Web | TUI |
|--------|-----|-----|
| Storage | `LocalStorage` (browser) | `FileStorage` (EI_DATA_PATH) |
| Rendering | React DOM | OpenTUI + SolidJS |
| Input | Mouse + keyboard | Keyboard-first |
| Layout | CSS Grid/Flex | Yoga Flexbox |
| Runtime | Browser | Bun + terminal |

### TUI Testing Strategy

**Critical Insight**: Component-level tests using `testRender` verify SolidJS reactivity works (it does). They do NOT verify the Processor→TUI integration. The Processor is battle-tested via the web app—what needs testing is the **integration between TUI and Processor**.

#### Current Testing Tiers

| Tier | Tool | Scope | Status |
|------|------|-------|--------|
| Unit | Vitest/bun:test | Core logic (Processor, StateManager) | ✅ Working |
| Component | `testRender` from `@opentui/solid` | SolidJS reactivity, render logic | ✅ Working |
| E2E | tui-test | Full app + mock LLM | ✅ Working |

**E2E requires Node 20** (not Bun): `npm run test:e2e` from `tui/` handles nvm switching automatically.

**bunfig.toml requirement**:
```toml
preload = ["@opentui/solid/preload"]

[test]
preload = ["@opentui/solid/preload"]
```
