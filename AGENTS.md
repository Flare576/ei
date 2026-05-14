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
└── tests/              # Unit + E2E tests
```

## Reserved Personas

Some personas are created and managed by the system. Never delete or rename them.

| Persona | Purpose |
|---------|---------|
| **Ei** | The default companion, always present. Sees all personas, helps navigate the system. |
| **Emmett** | Document import persona. All knowledge extracted via `/import` is attributed here. Static — doesn't chat. |

Emmett is seeded via `Processor.bootstrapEmmett()` and gated by `RESERVED_PERSONA_IDS`. The `/import` TUI command and the web **My Data → Documents** tab both call `processor.importDocument(path/file)`, which invokes `HandleDocumentSegmentation` through the normal queue pipeline.

To remove imported knowledge: `/unsource <source_tag>` (TUI) or the Delete button in the web Documents tab — both strip all entities where the message ID prefix matches the source tag.

Generated documents (from `/generate`) are also attributed to Emmett — written as `role: "system"` messages with IDs in the format `generate:document:<slug>:<uuid>`. The `onDocumentGenerated` callback writes the markdown file to `$EI_DATA_PATH/docs/<slug>.md` automatically after the synthesis loop completes.

## Source of Truth

| Document | Purpose |
|----------|---------|
| `CONTRACTS.md` | **THE** source of truth for naming conventions, event contracts, security model, and design rationale. TypeScript interfaces live in `src/core/types/*.ts`. |
| `v1.md` | Design philosophy and background context |
| GitHub Issues | Active feature requests and bugs |

> **CRITICAL**: If code contradicts something defined in CONTRACTS.md, **STOP and ASK**. CONTRACTS.md wins.

## Terminology

These terms have specific meanings in Ei. The industry uses most of them interchangeably — don't do that here.

| Term | Definition |
|------|-----------|
| **LLM Model** | A specific model release: `claude-sonnet-4-6`, `qwen-3-5-35b`, `gemma-4-26b`, etc. Weights only. No state, no soul, no continuity between calls. |
| **Agent** | A unit of work: one LLM call configured with a system prompt, user prompt, message history, and tool set. Ephemeral. No persistent identity. Our job is to make the Agent's task as unambiguous as possible so the LLM Model produces the best output. |
| **Identity** | The static-ish character definition Ei maintains for a Persona: `short_description`, `long_description`, `traits`, and `topics`. What gets built in the editor and fed into the Agent's system prompt. |
| **Persona** | Identity + message history + related topics + quotes. The "Soul." Has no Mind of its own — a different LLM Model could be its Mind next turn, and the definition shifts with every interaction. |

### Why This Matters

DJ is a **Persona** who wants to know what you're listening to — it's in her traits (her **Identity**). Whether she *can* know depends on:
1. Whether the **Agent** we build for her includes `spotify.get_currently_playing` in its tool set
2. Whether the **LLM Model** actually calls it

The Persona has the *want*. The Agent has the *capability*. The LLM Model has the *mind* — temporarily.

## Design Priority

When making design or architecture decisions, prioritize in this order:

1. **Everyone else** — Random user who found Ei on GitHub and wants to try it
2. **Everyone *else* else** — Power users, contributors, people with weird setups
3. ~8.5 billion other humans~
4. **Flare** — The author uses Ei daily but his preferences come last

Ei is an open-source project. Decisions should optimize for the widest possible audience,
not the author's specific workflow. If a design choice benefits Flare but makes Ei harder
for a new user to set up, the new user wins.

## Code Conventions

### Naming (from CONTRACTS.md)

| Pattern | Convention | Example |
|---------|------------|---------|
| Interfaces | PascalCase | `HumanEntity`, `LLMRequest` |
| Functions | camelCase | `getPersonaList`, `enqueueRequest` |
| Events | on + PascalCase | `onPersonaAdded`, `onMessageQueued` |
| Entity fields | snake_case | `last_updated`, `exposure_current` |
| Constants | SCREAMING_SNAKE | `MAX_RETRIES` |

> **Note**: "Interfaces" means TypeScript type/interface *names* (e.g. `Topic`, `PersonaEntity`). All *fields within* those types use `snake_case`. The common name field on all entity types (Topic, Person, Fact) is `name` — NOT `label`.

### Semantic Fields

These have specific meanings—don't invent synonyms:

| Field | Meaning |
|-------|---------|
| `exposure_current` | How recently/frequently discussed (0-1) |
| `exposure_desired` | How much entity wants to discuss (0-1) |
| `sentiment` | Emotional valence (-1 to 1) |
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
| `EI_LOG_LEVEL` | TUI log verbosity: `error`, `warn` (default), `info`, `debug` |
| `EI_DEBUG_NETWORK_VERBOSE` | Set to `1` to dump full LLM request/response payloads to `$EI_DATA_PATH/logs/` |

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
- **Structural invariant checks** (`ci/structural-checks.sh`): Fast grep-based fitness functions that enforce architectural rules without running the app. Run automatically in CI. Run locally with `bash ci/structural-checks.sh`. Currently guards:
  - Prompt builders are synchronous (no `async`/`await`)
  - Prompt builders are pure (no `.filter()`/`.reduce()` data logic — belongs in Processor)
  - Prompt strings stay in `src/prompts/` (no escaped strings in handlers/orchestrators)
  - All `*Overlay.tsx` components register with keyboard context
  - Every prompt subdirectory has `types.ts` + `index.ts`
  - Extraction handlers throw on bad results (no `console.error` + `return` — that's a silent data drop)

## Agent-Specific Notes

### When Implementing Features

1. Check CONTRACTS.md for naming conventions, event contracts, and design decisions. Check `src/core/types/*.ts` for TypeScript interface definitions.
2. Check GitHub Issues for context on the feature being built

### When Confused

- **About naming**: Check CONTRACTS.md
- **About scope**: Ask before expanding beyond the stated criteria

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

### First-Launch Startup Note

On first launch after upgrading, `migrateMessageIds()` rewrites all existing `Quote.message_id` and persona/room message IDs to the fully-qualified format. For users with large OpenCode histories (20MB+ state.json), this can take 45–60 seconds. The TUI will appear to hang during this time — it hasn't. Subsequent launches are instant. Do not add a timeout or skip logic; the migration only runs once per ID and is idempotent.

---

## Release Protocol

**MANDATORY pre-flight before any `git tag` or version bump.**

The v0.1.9 incident: two syntax errors slipped through `tsc` and only `vite build` caught them.
All 34 E2E tests failed. The tag pointed to a broken commit. Don't repeat this.

### Checklist

1. `git status` — working tree must be clean
2. `git branch --show-current` — must be `main`
3. **Did you update the docs?** — Check README.md, AGENTS.md, src/cli/README.md, tui/README.md for anything stale. New tools, changed behavior, removed fields — if a human would be confused without knowing, update it now.
4. `git pull` — must be up to date with origin
5. `npm test` — all unit tests must pass (runs core + TUI)
6. `cd web && npx tsc --noEmit && npx vite build` — **Both must succeed**: `tsc --noEmit` catches `noUnusedLocals` and dead-code errors that Vite's lenient bundler misses; Vite catches bundler/JSX errors that `tsc` misses. This is what CI runs. (v0.1.9 incident = vite; v0.1.18 deploy failure = tsc)
7. `npm run test:e2e` — all web E2E tests must pass

If **any step fails**: STOP. Fix before tagging.

### Why Both `tsc --noEmit` AND `vite build` Are Non-Negotiable

`tsc --noEmit` catches type errors including `noUnusedLocals` dead-code violations that Vite's
bundler silently ignores. `vite build` catches bundler/JSX/circular-import errors that `tsc` misses.
Running only one gives you a false green. CI runs both — so should you.

### The `/release` slash command

The `.opencode/commands/release.md` slash command enforces this checklist.
Use it. If you're tempted to tag manually without running it, that's the smell.

### CI Gates

Both `publish.yml` (tag-triggered) and `deploy.yml` (push-to-main) run:
- Core unit tests
- TUI unit tests (via Bun)
- Web Vite build
- Web Playwright E2E (34 tests)

Tags that push to npm will be blocked if CI fails. But CI is the last line of defense —
the pre-flight checklist is your first.

---

## Tool Policy

### Failure Behavior

Tool calling can fail in several ways. Here's how each is handled:

| Failure | Behavior |
|---------|----------|
| Provider disabled | Tool excluded from persona's available tools silently |
| Tool returns 5xx / network error | Inject error result, remove tool from payload for remainder of interaction |
| `max_calls_per_interaction` reached | Omit tool from subsequent LLM calls in this interaction |
| Hard interaction limit (10 total calls) reached | All remaining tool calls skipped silently |
| Tool returns empty result | Inject `"No results found"`, continue loop normally |
| LLM emits malformed tool call JSON | Log warning, treat as stop, return what we have |
| No executor registered for tool name | Inject error result, mark tool exhausted |
| All tools exhausted or failed | LLM synthesizes final response without tools — always responds |

**Rule**: Tool failures are never fatal. They inject an error result into the LLM's tool history and continue. The LLM is responsible for synthesizing a response with whatever information it has.

**Tool calling applies to** (v1): `HandlePersonaResponse`, `HandleHeartbeatCheck`, `HandleEiHeartbeat`.

**Tool calling does NOT apply to** (v1): extraction steps, ceremony phases, one-shot requests.

### Built-in Tool Registry

Seeded on every startup via `Processor.bootstrapTools()`. Safe to call repeatedly — only adds if absent.

**Provider: `ei`** (Ei Built-ins, always enabled, no config needed)

| Tool name | Runtime | Description |
|-----------|---------|-------------|
| `find_memory` | `any` | Semantic embedding search of `StateManager.searchHumanData()` — no external call. Supports optional `persona` filter for scoping to a specific persona's learned data. |
| `fetch_memory` | `any` | Full-record lookup for a human entity (Fact, Topic, Person, or Quote) by ID. Use when `find_memory` returns an item and you need its complete details. |
| `fetch_message` | `any` | Retrieve a specific message by its fully-qualified ID with optional `before`/`after` context window. Accepts FQ IDs (`opencode:machine:session:id`, `ei:uuid`, `claudecode:...`, `cursor:...`) and routes to the correct source DB. Returns message content, surrounding context, and session metadata. |
| `file_read` | `node` | Read a file from local filesystem (TUI only) |
| `list_directory` | `node` | List directory contents (TUI only) |
| `directory_tree` | `node` | Recursive directory tree up to configurable depth (TUI only) |
| `search_files` | `node` | Find files by name glob pattern (TUI only) |
| `grep` | `node` | Search file contents by regex (TUI only) |
| `get_file_info` | `node` | File/directory metadata (TUI only) |
| `web_fetch` | `node` | Fetch URL content as text (HTML stripped; TUI only — web blocked by CORS) |

**Provider: `tavily`** (Tavily Search, disabled by default, requires `config.api_key`)

| Tool name | Runtime | Description |
|-----------|---------|-------------|
| `tavily_web_search` | `any` | Web search via Tavily API |
| `tavily_news_search` | `any` | News search via Tavily API |

**Provider: `spotify`** (Spotify, disabled by default, requires OAuth `config.spotify_refresh_token`)

| Tool name | Runtime | Description |
|-----------|---------|-------------|
| `get_currently_playing` | `any` | Currently playing Spotify track |
| `get_liked_songs` | `any` | User's full liked songs library (cached 30 min) |

### Runtime Field

`runtime: "any"` — available in both Web and TUI.

`runtime: "node"` — TUI only. The executor is registered lazily via `registerFileReadExecutor()` to prevent `node:fs` from being bundled in the web build. In the browser, these tools exist in the registry but no executor is registered — they return an error result if called.

### Adding a New Built-in Tool

1. Create executor in `src/core/tools/builtin/[name].ts` — implement `ToolExecutor` interface
2. Register executor in `src/core/tools/index.ts` (or `registerFileReadExecutor()` if Node-only)
3. Add seed block in `Processor.bootstrapTools()` using `tools_getByName` guard
4. If it needs a new provider, add provider seed block before the tool seed block
5. Update the Built-in Tool Registry table above

---

## Room Modes — Terminology and Flow

This section captures design intent that isn't obvious from the code.

### Key Terms

| Term | Meaning |
|------|---------|
| **Participant** | Human + all Personas in the room, **except** the Judge in MAP. Everyone who submits a response. |
| **Judge** | MAP only. One designated Persona who does not submit a response but evaluates all submissions and picks the winner. |
| **Activated Node** | CYP only. A node that has already been chosen and locked in. Revisiting an Activated Node skips the "wait for responses" phase — all responses are already collected. |

### Submission Rules (all modes)

- Human responses are **required** to advance. There is no optional skip — but `silence_reason` counts as a valid submission (same as Persona silence).
- A Participant has submitted when their message has either `content` or `silence_reason` set.
- The Judge in MAP is **not** a Participant and never submits a round response.

### Choose Your Path (CYP) — Round Flow

1. Human sends a message. This creates the initial `active_node`.
2. System waits for **all Participants** to submit responses. Responses are hidden from the chat until Activate.
   - ↑ arrow recalls the human's response unless the current node is an Activated Node.
3. Once all Participants have submitted, the Activate button becomes **enabled**.
4. Human clicks Activate (or presses Enter when the send button reads "Activate").
   - The node is marked Activated.
   - The CYP picker UI appears, showing all submissions as cards.
   - Cards show "Choose" (new node) or "Resume Path" (Activated Node).
5. Human picks a card → that node becomes the new `active_node` → loop back to step 2.

**Scroll-to-bottom triggers in CYP (three signals):**
1. All Participants have submitted → Activate button becomes enabled
2. Human clicks Activate → CYP picker appears inline below messages
3. Human clicks "Choose" or "Resume Path" → new branch selected, chat updates

### Messages Against Personas (MAP) — Round Flow

1. Human creates a room with one **Judge** persona and at least one other Participant persona. Sends the initial message — this is `active_node`.
2. System waits for **all Participants** (human + non-Judge personas) to submit. Responses are hidden from the chat.
3. Once all Participants have submitted, Activate button becomes **enabled**.
4. Human clicks Activate.
   - Node is marked Activated — but **nothing is revealed yet**.
   - All submissions are bundled and sent to the Judge with their full identity (description, traits, topics) as system context.
   - Non-Judge personas are told to play to the Judge's personality; the human is not bound by their identity.
5. Judge responds, picks the winner.
   - All losing submissions are **permanently deleted**.
   - The Judge's verdict is appended to the room and becomes the new `active_node`.
   - Switching `active_node` reveals only the winning submission and the verdict in the chat.
6. Loop back to step 2.

**Scroll-to-bottom triggers in MAP:**
1. All Participants have submitted → Activate button becomes enabled
2. Judge verdict arrives → `active_node` changes → winning message + verdict appear

### Activate Button Design Contract

- **Always visible** in MAP and CYP (never hidden).
- **Disabled / shows "Waiting…"** when any Participant hasn't submitted yet.
- **Enabled** when all Participants have submitted (`needsActivation = true`).
- Exists in two places: the status bar above the input area, and the send button (which relabels itself). Both should reflect the same state.

### Hidden Message Counts

Visible messages in MAP/CYP represent far fewer entries than are stored. In a 3-Persona MAP room, 100 visible messages = ~400 stored messages (3 competing + 1 winner per round). Virtualization is worth considering for heavy users but is not required for correctness.
