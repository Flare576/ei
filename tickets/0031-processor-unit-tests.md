# 0031: Unit Tests for processor.ts

**Status**: VALIDATED

## Summary

Add comprehensive unit test coverage for `processor.ts`, focusing on functions that are difficult to test end-to-end like `stripEcho` and `conceptsChanged`.

## Problem

The `processor.ts` file contains critical business logic that's challenging to test via end-to-end methods:
- `stripEcho()` function (ticket 0021) requires specific model behaviors to trigger
- `conceptsChanged()` function has complex comparison logic
- `processEvent()` orchestrates multiple LLM calls with intricate error handling
- Edge cases and error conditions are hard to reproduce in E2E tests

Currently, ticket 0021 (Gemma Echo Fix) is marked as validated based on code review, but lacks automated verification of the echo-stripping logic.

## Proposed Solution

Create comprehensive unit tests in `tests/unit/processor.test.ts` covering:

### stripEcho Function Tests
```typescript
describe('stripEcho', () => {
  test('removes exact prefix match', () => {
    expect(stripEcho('Hello world', 'Hello world\n\nThis is my response')).toBe('This is my response');
  });
  
  test('removes first line match', () => {
    expect(stripEcho('Hello', 'Hello\nThis is my response')).toBe('This is my response');
  });
  
  test('preserves intentional quotes', () => {
    expect(stripEcho('Hello', 'You said "Hello" and I think...')).toBe('You said "Hello" and I think...');
  });
  
  test('handles null/empty inputs safely', () => {
    expect(stripEcho(null, 'response')).toBe('response');
    expect(stripEcho('input', '')).toBe('');
  });
});
```

### conceptsChanged Function Tests
```typescript
describe('conceptsChanged', () => {
  test('detects new concepts', () => {
    const old = [{ name: 'A', description: 'desc' }];
    const new = [{ name: 'A', description: 'desc' }, { name: 'B', description: 'desc2' }];
    expect(conceptsChanged(old, new)).toBe(true);
  });
  
  test('detects removed concepts', () => {
    const old = [{ name: 'A' }, { name: 'B' }];
    const new = [{ name: 'A' }];
    expect(conceptsChanged(old, new)).toBe(true);
  });
  
  test('detects description changes', () => {
    const old = [{ name: 'A', description: 'old' }];
    const new = [{ name: 'A', description: 'new' }];
    expect(conceptsChanged(old, new)).toBe(true);
  });
});
```

### processEvent Integration Tests (Mocked)
```typescript
describe('processEvent', () => {
  beforeEach(() => {
    vi.mock('../llm.js');
    vi.mock('../storage.js');
  });
  
  test('handles LLM abort gracefully', async () => {
    const abortController = new AbortController();
    abortController.abort();
    
    const result = await processEvent('test', 'ei', false, abortController.signal);
    expect(result.aborted).toBe(true);
  });
});
```

## Acceptance Criteria

- [x] `stripEcho()` has 100% test coverage including edge cases
- [x] `conceptsChanged()` has comprehensive test coverage
- [x] `processEvent()` has mocked integration tests for key flows
- [x] Tests verify ticket 0021 echo-stripping behavior specifically
- [x] Tests run fast (< 1 second total for processor tests)
- [x] Tests are deterministic (no flaky behavior)
- [x] Mock LLM responses for predictable testing
- [x] Error handling paths are tested

## Value Statement

Provides automated verification of critical business logic that's impractical to test end-to-end. Specifically enables confidence in ticket 0021's echo-stripping without requiring specific model behaviors or manual testing scenarios.

## Dependencies

- Ticket 0019 (Test Strategy) - provides Vitest infrastructure

## Effort Estimate

Medium: ~3-4 hours

## Technical Notes

**Why unit tests over E2E for these functions:**
- `stripEcho()` requires specific Gemma model echo behavior to trigger naturally
- `conceptsChanged()` needs precise concept map variations to test edge cases  
- Error conditions (LLM failures, aborts) are hard to reproduce reliably in E2E
- Unit tests provide faster feedback and more precise failure diagnosis

**Testing approach:**
- Mock external dependencies (LLM calls, file I/O)
- Focus on pure function logic and error handling
- Use realistic data structures from actual persona files
- Verify both positive and negative cases