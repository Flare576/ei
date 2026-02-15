# Core Module

The brain of Ei. Handles state, queue, LLM communication, and orchestration.

## Architecture

```
core/
├── processor.ts        # Main orchestrator (1100+ lines)
├── state-manager.ts    # In-memory state + persistence
├── queue-processor.ts  # LLM request queue with priorities
├── llm-client.ts       # Multi-provider LLM abstraction
├── types.ts            # All core types (source: CONTRACTS.md)
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
