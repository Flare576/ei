# 0019: Test Strategy and Infrastructure

**Status**: DONE

## Summary

Design and implement a testing strategy covering unit tests, component tests, and integration tests for EI's core systems.

## Problem

No test infrastructure exists. As the codebase grows more complex (Ink UI, per-persona state, parallel processing), the risk of regressions increases. Manual testing doesn't scale.

## Proposed Solution

### Test Categories

| Category | What | Tools | Coverage Target |
|----------|------|-------|-----------------|
| **Unit** | Pure functions (prompts, validation, storage utils) | Vitest | High - these are stable |
| **Component** | Ink components in isolation | Vitest + ink-testing-library | Medium - visual logic |
| **Integration** | Full message flow with mocked LLM | Vitest | Critical paths only |
| **E2E** | Full app with real terminal | Manual or Playwright? | Smoke tests |

### Recommended Stack

- **Vitest**: Fast, ESM-native, good TS support, similar API to Jest
- **ink-testing-library**: Official testing utils for Ink components
- **MSW or manual mocks**: Mock LLM responses for deterministic tests

### Test Structure

```
tests/
  unit/
    prompts.test.ts      # buildResponseSystemPrompt, etc.
    validate.test.ts     # concept validation logic
    storage.test.ts      # path resolution, JSON parsing
  components/
    PersonaList.test.tsx
    ChatHistory.test.tsx
    InputArea.test.tsx
  integration/
    message-flow.test.ts # send message -> get response
    persona-switch.test.ts
    abort-handling.test.ts
```

### What to Test First (Priority Order)

1. **Validation logic** (`validate.ts`) - pure functions, easy wins
2. **Prompt building** (`prompts.ts`) - ensure prompts don't regress
3. **Storage utilities** - JSON parsing, path resolution
4. **Message queue behavior** - the concurrency model is complex
5. **Ink components** - after UI stabilizes post-0010

### LLM Mocking Strategy

```typescript
// Mock the LLM module for deterministic tests
vi.mock("./llm.js", () => ({
  callLLM: vi.fn().mockResolvedValue("Mocked response"),
  callLLMForJSON: vi.fn().mockResolvedValue([/* mock concepts */]),
  LLMAbortedError: class extends Error { name = "LLMAbortedError" }
}));
```

### CI Considerations

- Tests should run without network access (mocked LLM)
- Tests should run without real data directory (temp dirs)
- Consider GitHub Actions workflow (future ticket?)

## Acceptance Criteria

- [x] Vitest configured and running
- [x] At least 3 unit tests for existing pure functions (44 tests total)
- [ ] At least 1 component test for an Ink component (stretch - future work)
- [ ] At least 1 integration test for message flow (stretch - future work)
- [x] `npm test` runs all tests
- [x] Tests pass in CI-like environment (no secrets, no network)

## Value Statement

Confidence to refactor. Catch regressions before users do. Sleep better at night.

## Dependencies

- Ticket 0008 (multi-persona heartbeat) - core architecture
- Ticket 0009 (per-persona queues) - core architecture  
- Ticket 0010 (ink layout) - UI components to test

## Effort Estimate

Medium-Large: ~4-6 hours for initial setup + baseline tests

## Notes

This ticket is intentionally scoped to "get testing started" rather than "achieve 100% coverage." The goal is infrastructure + patterns that make adding tests easy going forward.
