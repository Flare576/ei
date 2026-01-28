# 0034: Unit Tests: Processor

**Status**: PENDING
**Depends on**: 0030
**Epic**: E004 - Testing Infrastructure

## Summary

Unit tests for the Processor — the main orchestrator. Test lifecycle, API methods, event emission, and handler dispatch. Mock StateManager and QueueProcessor to isolate Processor logic.

## Acceptance Criteria

- [ ] Test start/stop lifecycle
- [ ] Test auto-save timing
- [ ] Test scheduled task checking (heartbeats)
- [ ] Test handler dispatch for different next_step values
- [ ] Test event emission (all Ei_Interface events)
- [ ] Test API methods (getPersonaList, sendMessage, etc.)
- [ ] Test error handling and onError emission
- [ ] Coverage > 80% for Processor

## Technical Notes

### Mock Dependencies

```typescript
import { vi } from 'vitest';

const mockStateManager = {
  initialize: vi.fn(),
  getHuman: vi.fn(() => defaultHumanEntity),
  persona_getAll: vi.fn(() => []),
  queue_peekHighest: vi.fn(() => null),
  checkpoint_saveAuto: vi.fn(),
  // ... etc
};

const mockQueueProcessor = {
  getState: vi.fn(() => 'idle'),
  start: vi.fn(),
  abort: vi.fn(),
};
```

### Key Test Cases

**Lifecycle:**
```typescript
test('start initializes state manager', async () => {
  await processor.start(storage);
  expect(mockStateManager.initialize).toHaveBeenCalledWith(storage);
});

test('stop saves checkpoint', async () => {
  await processor.start(storage);
  await processor.stop();
  expect(mockStateManager.checkpoint_saveAuto).toHaveBeenCalled();
});
```

**Event Emission:**
```typescript
test('sendMessage fires onMessageAdded and onMessageQueued', async () => {
  const onMessageAdded = vi.fn();
  const onMessageQueued = vi.fn();
  const processor = new Processor({ onMessageAdded, onMessageQueued });
  
  await processor.sendMessage('ei', 'Hello');
  
  expect(onMessageAdded).toHaveBeenCalledWith('ei');
  expect(onMessageQueued).toHaveBeenCalledWith('ei');
});
```

**Handler Dispatch:**
```typescript
test('dispatches to correct handler based on next_step', async () => {
  const mockHandler = vi.fn();
  handlers.handlePersonaResponse = mockHandler;
  
  // Simulate queue returning a request
  mockStateManager.queue_peekHighest.mockReturnValueOnce(request);
  mockQueueProcessor.start.mockImplementation((req, cb) => {
    cb({ request: req, success: true, content: 'response' });
  });
  
  await processor.start(storage);
  await tick(); // Let run loop execute
  
  expect(mockHandler).toHaveBeenCalled();
});
```

**API Methods:**
```typescript
test('getPersonaList returns mapped summaries', async () => {
  mockStateManager.persona_getAll.mockReturnValue([eiEntity, otherEntity]);
  
  const list = await processor.getPersonaList();
  
  expect(list).toHaveLength(2);
  expect(list[0].name).toBe('Ei');
});
```

### Time Control

Use Vitest's fake timers for auto-save and heartbeat testing:
```typescript
import { vi, beforeEach, afterEach } from 'vitest';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('auto-saves after interval', async () => {
  await processor.start(storage);
  vi.advanceTimersByTime(60000); // 1 minute
  expect(mockStateManager.checkpoint_saveAuto).toHaveBeenCalled();
});
```

### V0 Reference

`v0/tests/unit/processor.test.ts`

## Out of Scope

- Full integration tests (E2E handles that)
- Actual LLM calls
- Real storage
