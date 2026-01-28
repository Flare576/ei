# 0033: Unit Tests: QueueProcessor

**Status**: DONE
**Depends on**: 0030
**Epic**: E004 - Testing Infrastructure

## Summary

Unit tests for QueueProcessor — the single LLM executor. Test request processing, response type handling, abort functionality, and error cases.

## Acceptance Criteria

- [ ] Test idle → busy → idle state transitions
- [ ] Test response type handling (response, json, raw)
- [ ] Test JSON parsing and repair
- [ ] Test "no message" detection patterns
- [ ] Test abort during processing
- [ ] Test error handling (LLM failure)
- [ ] Test callback invocation
- [ ] Test concurrent start throws error
- [ ] Coverage > 80% for QueueProcessor

## Technical Notes

### Mock LLM Client

Don't hit real LLM in unit tests. Mock at the `callLLMRaw` level:
```typescript
import { vi } from 'vitest';
import * as llmClient from '../../src/core/llm-client';

vi.spyOn(llmClient, 'callLLMRaw').mockResolvedValue({
  content: 'Test response',
  finishReason: 'stop',
});
```

### Key Test Cases

**State Transitions:**
```typescript
test('transitions from idle to busy on start', () => {
  expect(processor.getState()).toBe('idle');
  processor.start(request, callback);
  expect(processor.getState()).toBe('busy');
});

test('transitions back to idle on completion', async () => {
  processor.start(request, callback);
  await waitForCallback();
  expect(processor.getState()).toBe('idle');
});
```

**Response Types:**
```typescript
test('handles json type with valid JSON', async () => {
  mockLLM('{"key": "value"}');
  let response: LLMResponse;
  processor.start(jsonRequest, (r) => response = r);
  await waitForCallback();
  expect(response.success).toBe(true);
  expect(response.parsed).toEqual({ key: 'value' });
});

test('handles json type with malformed JSON', async () => {
  mockLLM('{"key": "value"'); // missing closing brace
  // Should attempt repair...
});
```

**Abort:**
```typescript
test('abort cancels in-progress request', async () => {
  mockLLMSlow(5000); // Slow response
  processor.start(request, callback);
  processor.abort();
  // Verify AbortController.abort() was called
});
```

**Concurrent Start:**
```typescript
test('throws if started while busy', () => {
  processor.start(request1, callback);
  expect(() => processor.start(request2, callback)).toThrow('QUEUE_BUSY');
});
```

### V0 Reference

`v0/tests/unit/queue-processor.test.ts`

## Out of Scope

- Actual LLM calls (mock everything)
- Retry logic (handled by queue, not processor)
- Rate limiting
