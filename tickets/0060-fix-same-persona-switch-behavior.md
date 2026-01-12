# 0060: Fix Same-Persona Switch Behavior

**Status**: PENDING

## Summary
Fix same-persona switching to only scroll to bottom instead of performing full reload operations, eliminating unnecessary file I/O and matching product owner specifications.

## Problem
Integration tests reveal that switching to the currently active persona calls `loadHistory` when it should be a lightweight scroll-only operation. The early return in `switchPersona()` isn't working properly.

**Root Cause**: `src/blessed/app.ts` lines 656-657 - early return condition failing or not executing properly.

**Test Evidence**: `tests/integration/persona-management.test.ts:150` - `loadHistory` called when it shouldn't be.

## Expected Behavior (Per Product Owner)
When switching to the same persona:
- **Should**: Scroll to bottom (most recent message) 
- **Should**: Provide visual feedback that command was processed
- **Should NOT**: Call `loadHistory`, reload data, or perform heavy operations

## Proposed Solution
Fix the same-persona switch logic to:
1. **Detect same-persona correctly** - debug why condition fails
2. **Implement lightweight scroll** - just scroll to bottom and render
3. **Provide user feedback** - brief status message or visual indication
4. **Skip all heavy operations** - no file I/O, no state reloading

## Technical Implementation
```typescript
private async switchPersona(personaName: string) {
  if (personaName === this.activePersona) {
    // Lightweight same-persona handling
    this.layoutManager.getChatHistory().scrollTo(0);
    this.setStatus(`Scrolled to latest in: ${personaName}`);
    this.render();
    return;
  }
  
  // Full switching logic for different personas...
}
```

## Acceptance Criteria
- [ ] Same-persona switches do not call `loadHistory`
- [ ] Same-persona switches scroll to bottom of chat
- [ ] User gets visual feedback that command was processed
- [ ] Integration test `switching to same persona does nothing` passes
- [ ] No performance regression for different-persona switches
- [ ] Early return condition works reliably

## Value Statement
Eliminates unnecessary file I/O operations and fixes integration test failures, proving the test infrastructure is catching real performance issues.

## Dependencies
None - this is a pure bug fix in existing functionality.

## Effort Estimate
Small (~1 hour) - debug condition failure and implement lightweight scroll behavior.