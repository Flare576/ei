# 0005: QueueProcessor Implementation

**Status**: DONE
**Depends on**: 0002

## Summary

Implement the QueueProcessor that executes LLM calls one at a time. It's intentionally simple—just runs requests and calls back when done. Queue management is handled by StateManager.

## Acceptance Criteria

- [x] Create `src/core/queue-processor.ts` implementing the QueueProcessor interface
- [x] Implement `getState()` returning "idle" or "busy"
- [x] Implement `start(request, callback)` that:
  - Throws if not idle
  - Makes LLM API call based on request type
  - Handles JSON parsing for `type === "json"` requests
  - Handles response cleaning for `type === "response"` requests
  - Calls callback with LLMResponse (success or failure)
- [x] Implement `abort()` that cancels in-flight request
- [x] Support AbortController for request cancellation
- [ ] Unit tests with mocked fetch - **deferred to test infrastructure**

Also created `src/core/llm-client.ts` with:
- Provider configuration (local, openai, google, anthropic, x)
- JSON repair logic
- Response cleaning (thinking tag removal)

## Implementation Notes

### LLM Call Types

```typescript
switch (request.type) {
  case "json":
    // Parse JSON, retry with repair if needed
    // Set response.parsed on success
    break;
  case "response":
    // Clean thinking tags, check for "no message" patterns
    break;
  case "raw":
    // Return content as-is
    break;
}
```

### Provider Resolution

Reference V0's `llm.ts` for the provider abstraction pattern:
- Parse `provider:model` format
- Support local, openai, google, anthropic, x providers
- Use environment variables for API keys

### Error Handling

- Rate limits: Include in response as failure (Processor decides retry policy)
- Timeouts: AbortController with configurable timeout
- JSON parse failures: Attempt repair, then fail

## File Structure

```
src/
└── core/
    ├── types.ts
    ├── state-manager.ts
    ├── queue-processor.ts  # NEW
    └── index.ts
```

## V0 Reference

Look at `v0/src/llm.ts` for:
- Provider configuration pattern
- JSON repair logic
- Response cleaning patterns

Do NOT copy the code directly—extract the patterns and reimplement cleanly.
