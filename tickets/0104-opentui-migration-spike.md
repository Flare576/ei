# 0104: OpenTUI Migration Spike

**Status**: PENDING

## Summary

Investigate OpenTUI as a replacement for blessed to achieve OpenCode-level UI smoothness. Build a proof-of-concept to validate scrolling, emoji rendering, and overall viability before committing to full migration.

## Context

### Current State
- EI uses blessed for TUI rendering
- Blessed is fundamentally limited:
  - Poor Unicode/emoji handling (required monkey-patching)
  - Manual rendering control (high maintenance burden)
  - Quirky, undocumented behaviors
  - No modern component abstractions
- Previous attempt with Ink (React for CLI) failed due to unsolvable scrolling issues (2 weeks of effort)

### OpenCode's Architecture Discovery

Through research into OpenCode (the AI coding agent we're using), discovered:

**OpenCode is NOT Go/Bubble Tea** (that was an archived project). The current OpenCode uses:

```
┌─────────────────────────────────────────────────────────────────┐
│                     OpenCode Architecture                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   TUI Process (SolidJS + OpenTUI)                               │
│   ┌────────────────────────────────────────────────────────┐    │
│   │  @opentui/solid  +  @opentui/core (Zig for perf)       │    │
│   │  - Declarative JSX like React/Ink                      │    │
│   │  - SolidJS signals for reactivity (no VDOM)            │    │
│   └────────────────────────────────────────────────────────┘    │
│                          ↕ HTTP + SSE                            │
│   Backend Process (TypeScript/Bun)                               │
│   ┌────────────────────────────────────────────────────────┐    │
│   │  Hono server - REST API + Server-Sent Events           │    │
│   │  All business logic: LLM, tools, session, storage      │    │
│   └────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Key Technologies:**
- **OpenTUI**: Custom TUI framework by anomalyco (SST team)
  - Repository: https://github.com/anomalyco/opentui
  - NPM: `@opentui/core` (v0.1.74), `@opentui/solid` (v0.1.74)
  - Core: TypeScript + Zig (native performance-critical code)
  - Reconcilers: SolidJS and React support
  - Status: "Not production-ready" per their docs, but actively developed
- **SolidJS**: Fine-grained reactivity, no VDOM, JSX syntax
- **Client/Server**: HTTP + Server-Sent Events for TUI ↔ Backend communication

**Why OpenTUI over blessed/Ink:**
- Blessed: Too limited, poor TypeScript support, manual rendering
- Ink: Virtual DOM overhead, scrolling failures
- OpenTUI: Custom-built for terminal performance with modern framework ergonomics

### Why This Matters

OpenCode feels *incredibly* smooth to use. If we can leverage the same UI foundation, EI could have that same level of polish.

**Architecture Alignment:**
- EI already separates UI (`src/blessed/`) from business logic (`src/` core files)
- OpenCode's client/server pattern matches EI's heartbeat/async needs
- OpenTUI's declarative JSX would be cleaner than blessed's imperative API

## Objectives

### Phase 1: Viability Assessment (This Spike)

Build minimal proof-of-concept to validate:

1. **Scrolling**: The Ink killer - can OpenTUI handle scrollable chat history?
2. **Emoji Rendering**: Does it "just work" without monkey-patching?
3. **Performance**: Can it handle large message histories smoothly?
4. **Developer Experience**: Is the API learnable? Documentation sufficient?
5. **SolidJS Learning Curve**: How different from React? Can we adapt?

### Phase 2: Architecture Design (If Viable)

Design migration path:
- Client/server split (TUI process vs backend process)
- HTTP/SSE communication layer
- Component structure for chat, personas, input, etc.

### Phase 3: Implementation (If Approved)

Full migration from blessed to OpenTUI.

## Technical Details

### OpenTUI Structure

**Core Packages:**
```json
{
  "@opentui/core": "^0.1.74",     // Low-level rendering (TypeScript + Zig)
  "@opentui/solid": "^0.1.74",    // SolidJS reconciler
  "solid-js": "^1.x"               // Reactive UI framework
}
```

**Component Example (from OpenCode source):**
```typescript
import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { Switch, Match, createSignal, Show } from "solid-js"

function ChatView() {
  const [messages, setMessages] = createSignal([])
  
  return (
    <Box>
      <ScrollableView>
        <For each={messages()}>
          {(msg) => <Text>{msg.content}</Text>}
        </For>
      </ScrollableView>
    </Box>
  )
}

render(<ChatView />)
```

**Key OpenTUI APIs** (from OpenCode usage):
- `render()` - Mount application to terminal
- `useKeyboard()` - Keyboard event handling
- `useRenderer()` - Access renderer for low-level control
- `useTerminalDimensions()` - Responsive layout
- `TextAttributes` - Styling (colors, bold, etc.)

### Event Batching Pattern

OpenCode implements smart event batching (worth studying):
```typescript
// Batch events within 16ms window for smooth rendering
const handleEvent = (event: Event) => {
  queue.push(event)
  const elapsed = Date.now() - last
  if (elapsed < 16) {
    timer = setTimeout(flush, 16)  // Batch with future events
  } else {
    flush()  // Process immediately
  }
}
```

### Client/Server Communication

OpenCode uses:
- **Hono** server (lightweight HTTP framework)
- **Server-Sent Events (SSE)** for real-time updates from backend to TUI
- **REST API** for TUI actions (send message, switch persona, etc.)

**Example from OpenCode:**
```typescript
const sdk = createOpencodeClient({
  baseUrl: "http://localhost:4096",
  fetch: globalThis.fetch,
})

// Subscribe to server events
const events = await sdk.event.subscribe()
for await (const event of events.stream) {
  handleBackendEvent(event)
}
```

## Spike Tasks

### 1. Repository Setup
- [ ] Clone OpenTUI: `git clone https://github.com/anomalyco/opentui`
- [ ] Review examples and documentation
- [ ] Understand build process (Zig + TypeScript)

### 2. Minimal Chat POC
- [ ] Create new Node.js project with OpenTUI dependencies
- [ ] Build simple chat view with:
  - Header showing "Chat: [persona]"
  - Scrollable message list (20+ messages)
  - Input box at bottom
  - Status bar
- [ ] Test keyboard navigation (arrow keys, PageUp/Down)
- [ ] Validate scrolling behavior with large history

### 3. Emoji Rendering Test
- [ ] Add messages with emoji (faces, symbols, CJK)
- [ ] Verify width calculations are correct
- [ ] Check for text corruption or wrapping issues
- [ ] Compare to blessed's monkey-patched behavior

### 4. Performance Validation
- [ ] Load 100+ messages
- [ ] Measure render time
- [ ] Test memory usage
- [ ] Verify smooth scrolling under load

### 5. SolidJS Learning
- [ ] Review SolidJS basics (signals, effects, JSX)
- [ ] Compare to React mental model
- [ ] Assess learning curve for team

### 6. Documentation Assessment
- [ ] Evaluate API documentation quality
- [ ] Check for examples and guides
- [ ] Identify knowledge gaps
- [ ] Determine if SST/OpenCode team is responsive to questions

## Success Criteria

**Must Have:**
- ✅ Scrolling works correctly (no Ink-style failures)
- ✅ Emoji render without corruption
- ✅ Performance acceptable for 100+ messages
- ✅ API is learnable (not cryptic)

**Nice to Have:**
- ✅ Documentation is clear
- ✅ SolidJS is intuitive (React-like)
- ✅ SST team is responsive to issues/questions

**Deal Breakers:**
- ❌ Scrolling is broken/buggy
- ❌ Major rendering issues
- ❌ Unusable API with no docs
- ❌ Project appears abandoned

## Migration Considerations (If Viable)

### Architecture Impact

**Current (blessed):**
```
src/blessed/
├── app.ts              # Main blessed app
├── layout-manager.ts   # Imperative layout management
├── focus-manager.ts    # Manual focus handling
├── persona-renderer.ts # Manual rendering logic
└── chat-renderer.ts    # Manual text rendering
```

**Future (OpenTUI + SolidJS):**
```
src/tui/
├── app.tsx             # Main SolidJS app (declarative)
├── components/
│   ├── ChatView.tsx    # Scrollable chat component
│   ├── PersonaList.tsx # Persona sidebar
│   ├── InputBox.tsx    # User input
│   └── StatusBar.tsx   # Status line
├── contexts/
│   ├── BackendContext.tsx  # HTTP/SSE connection
│   └── ThemeContext.tsx    # Theming support
└── server.ts           # HTTP + SSE backend bridge
```

### Business Logic Isolation

**No changes needed to:**
- `src/processor.ts` - Message processing
- `src/storage.ts` - File I/O
- `src/llm.ts` - LLM orchestration
- `src/concept-*.ts` - Concept map logic
- `src/prompts.ts` - Prompt building

**Minimal changes to:**
- Entry point (`src/index.tsx`) - Switch from blessed to OpenTUI render
- Message queue handling - Expose via HTTP API instead of direct function calls

### Incremental Migration Path

**Option A: Big Bang** (Risky)
- Rewrite entire TUI at once
- Switch from blessed to OpenTUI in single PR
- High risk, high downtime

**Option B: Side-by-Side** (Recommended)
1. Build OpenTUI version in parallel (`src/tui-next/`)
2. Feature flag to choose blessed vs OpenTUI
3. Migrate features incrementally
4. Validate stability before full cutover
5. Remove blessed when confident

**Option C: New Branch, Frequent Merges**
- Long-lived `opentui-migration` branch
- Regular merges from `main` to stay current
- Merge to main when feature-complete

## Resources

### OpenTUI Links
- **Main Repository**: https://github.com/anomalyco/opentui
- **NPM Package (core)**: https://www.npmjs.com/package/@opentui/core
- **NPM Package (solid)**: https://www.npmjs.com/package/@opentui/solid
- **Issues**: https://github.com/anomalyco/opentui/issues

### OpenCode (Reference Implementation)
- **Repository**: https://github.com/anomalyco/opencode
- **TUI Source**: `packages/opencode/src/cli/cmd/tui/`
- **Components**: `packages/opencode/src/cli/cmd/tui/component/`
- **Backend Server**: `packages/opencode/src/server/`

### SolidJS Learning
- **Official Docs**: https://www.solidjs.com/docs/latest
- **Tutorial**: https://www.solidjs.com/tutorial/introduction_basics
- **Comparison to React**: https://www.solidjs.com/guides/comparison

### Architecture References
- **Hono (HTTP Framework)**: https://hono.dev/
- **Server-Sent Events (SSE)**: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events

## Next Steps

1. **Clone OpenTUI** and explore examples
2. **Build minimal POC** with chat scrolling + emoji
3. **Document findings** in this ticket
4. **Decision Point**:
   - ✅ **Viable** → Create architecture design ticket
   - ⚠️ **Promising but needs work** → Contribute to OpenTUI, then reassess
   - ❌ **Not viable** → Stay with blessed, explore other options

## Notes

- OpenCode team (anomalyco/SST) built OpenTUI for their own needs (OpenCode + terminal.shop)
- Active development (recent commits)
- Small but focused codebase
- **Option C** (contribute to OpenTUI) aligns with open source values
- EI could become a real-world test case for OpenTUI's evolution
- Relationship with SST team could yield benefits (support, features, etc.)

## Dependencies

None - this is exploratory work.

## Acceptance Criteria

- [ ] OpenTUI cloned and examples running locally
- [ ] Minimal chat POC built with scrolling
- [ ] Emoji rendering tested thoroughly
- [ ] Performance validated with 100+ messages
- [ ] SolidJS basics understood
- [ ] Decision documented: Viable / Needs Work / Not Viable
- [ ] If viable: Architecture design ticket created
- [ ] If needs work: Issues filed with OpenTUI, contribution plan outlined
- [ ] If not viable: Alternative approaches documented
