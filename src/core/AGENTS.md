# Core Module

The brain of Ei. Handles state, queue, LLM communication, and orchestration.

## Architecture

```
core/
├── processor.ts        # Main orchestrator (1100+ lines)
├── state-manager.ts    # In-memory state + persistence
├── queue-processor.ts  # LLM request queue with priorities
├── llm-client.ts       # Multi-provider LLM abstraction
├── types.ts            # All core types (canonical source — CONTRACTS.md defers to these)
├── handlers/           # LLM response handlers
├── orchestrators/      # Multi-step workflows
├── personas/           # Persona loading logic
└── state/              # State slices (human, persona, messages)
```

## Key Files

### processor.ts (The Hub)

Everything flows through Processor:
- **Main loop**: 100ms tick checking queue, auto-save, heartbeat
- **Message flow**: User input → queue response request → handle result → update state
- **Background work**: Extraction, ceremony, heartbeat (all async, queued)

```typescript
// Entry points
processor.start()                    // Begin main loop
processor.sendMessage(persona, text) // User sends message
processor.stop()                     // Graceful shutdown
```

### state-manager.ts

In-memory state with dirty tracking:
- `loadState()` / `saveState()` for persistence
- Slices: human, personas, messages, config
- Auto-save every 60s when dirty

### queue-processor.ts

Priority queue for LLM requests:
- High: User-facing responses
- Normal: Extraction, analysis
- Low: Background maintenance

**Async model**: Handlers queue work, don't await results inline.

### llm-client.ts

Multi-provider LLM abstraction layer:
- Handles requests to Anthropic, OpenAI, Bedrock, local models
- **Sets `max_tokens: 8000`** by default (safe for most providers; users can configure higher per-model)
- Prevents unbounded generation (test showed timeout after 2min without limit)
- Local models silently clamp to their configured maximums
- Anthropic Opus 4 accepts up to 64K output (configure `max_output_tokens` on the model to unlock)

**JSON Response Parsing** (`parseJSONResponse()`):
- **Strategy 1**: Extract from markdown code blocks (```json)
- **Strategy 2**: Auto-repair malformed JSON (trailing commas, etc.)
- **Strategy 3**: Extract outermost `{...}` from mixed prose/JSON (handles LLM preamble)

No prompt changes needed for JSON-only output—parser handles natural language gracefully.

### handlers/index.ts (1000+ lines)

All `LLMNextStep` handlers in one file. Each handler:
1. Parses LLM response (JSON or text)
2. Updates state via StateManager
3. May queue follow-up requests

### orchestrators/

Multi-step workflows:
- `persona-generation.ts`: Create new persona (multi-LLM-call process)
- `extraction.ts`: Scan messages for facts/topics/people
- `ceremony.ts`: Periodic exposure decay + persona enrichment

## Patterns

### Time-Based Triggers

```typescript
// ✅ CORRECT: Update timestamp BEFORE async work
if (timeSinceLastX >= delay) {
  lastX = Date.now();         // Prevent duplicate queueing
  await doAsyncWork();
}

// ❌ WRONG: Other loop iterations queue duplicates
if (timeSinceLastX >= delay) {
  await doAsyncWork();
  lastX = Date.now();
}
```

### Adding New Handlers

1. Add enum to `LLMNextStep` in types.ts
2. Add handler function in handlers/index.ts
3. Register in `handlers` map at bottom of file
4. Queue from Processor or orchestrator

### State Updates

Always use StateManager methods, never mutate directly:
```typescript
// ✅ Correct
stateManager.updateHuman(h => ({ ...h, last_interaction: now }))

// ❌ Wrong - bypasses dirty tracking
state.human.last_interaction = now
```

## Testing

Unit tests in `tests/unit/core/`. Mock LLM responses for deterministic tests.

### Mock Boundaries for Handlers

Most handler tests mock at `orchestrators/index.js`:

```typescript
vi.mock("../../../../src/core/orchestrators/index.js", () => ({
  queueAllScans: vi.fn(),
  // ...
}));
```

**Exception**: `document-segmentation.ts` imports `queueAllScans` directly from
`orchestrators/human-extraction.js`, not from the index barrel. Tests for this handler
must mock `human-extraction.js` directly or the real implementation will run and fail
on missing `llm-client.js` exports:

```typescript
vi.mock("../../../../src/core/orchestrators/human-extraction.js", () => ({
  queueAllScans: vi.fn(),
}));
```

### Structural Check Gap — `console.warn + return`

`ci/structural-checks.sh` check #6 catches `console.error() + return without throw` in
handlers. It does **not** catch `console.warn + return`. If you see a warn-and-return in
a handler that could silently drop data, treat it the same as an error-and-return — it
should probably throw. File a bug. See issue #72 for precedent.
