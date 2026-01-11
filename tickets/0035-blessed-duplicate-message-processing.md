# 0035: Blessed Duplicate Message Processing

**Status**: VALIDATED

## Summary
Messages are being processed and sent twice, resulting in duplicate entries in persona history files and potentially duplicate LLM calls.

## Problem
When sending a message in the Blessed UI, the same message appears to be processed twice:
- Same message appears twice in `~/personaldot/ei/personas/beta/history.jsonc`
- Timestamps show messages sent ~1 minute apart: `12:09:43.824Z` and `12:10:41.825Z`
- Both messages have identical content: "Hey beta, trying out the new full-featured Blessed version. How's it going?"

## Root Cause Investigation
**RESOLVED**: The issue was caused by **duplicate EIApp instance creation**.

**Root Cause**: The `src/blessed/app.ts` file had startup code at the bottom that created and initialized an EIApp instance:
```typescript
// This code was at the bottom of app.ts
const app = new EIApp();
app.init().catch(console.error);
```

This meant the app was being started twice:
1. From `src/index.tsx` (proper entry point)
2. From `src/blessed/app.ts` (incorrect startup code)

**Evidence**: Debug logs showed:
- Instance #1 created from index.tsx
- Instance #2 created immediately after from app.ts
- Both instances had their own event handlers
- Each message submission triggered both handlers

**Fix**: Removed the startup code from `src/blessed/app.ts` since it should only export the EIApp class.

## Proposed Solution
1. **Event handler management**: Ensure event handlers are properly removed/reattached during layout recreation
2. **Submission debouncing**: Add debouncing to prevent rapid duplicate submissions
3. **Input state tracking**: Track submission state to prevent duplicate processing

```typescript
// In layout-manager.ts recreateLayout()
recreateLayout() {
  // Remove event listeners before removing elements
  if (this.inputBox) {
    this.inputBox.removeAllListeners('submit');
  }
  
  // ... existing removal logic ...
  
  // Recreate layout
  this.createLayout();
  
  // Re-attach event handlers (need to expose this method)
  // this.reattachEventHandlers();
}

// In app.ts - add submission tracking
private lastSubmissionTime = 0;
private lastSubmissionText = '';

private async handleSubmit(text: string) {
  const now = Date.now();
  const timeSinceLastSubmit = now - this.lastSubmissionTime;
  
  // Prevent duplicate submissions within 1 second
  if (timeSinceLastSubmit < 1000 && text === this.lastSubmissionText) {
    return;
  }
  
  this.lastSubmissionTime = now;
  this.lastSubmissionText = text;
  
  // ... existing logic ...
}
```

## Acceptance Criteria
- [x] Messages are only processed once per submission
- [x] No duplicate entries in persona history files
- [x] No duplicate LLM API calls
- [x] Input clearing works correctly after submission
- [x] Layout recreation doesn't cause duplicate event handlers

## Implementation Details
**File**: `src/blessed/app.ts` lines 580-585 (removed)
**Change**: Removed duplicate startup code that was creating a second EIApp instance
**Verification**: Debug logs now show only "Instance #1" being created

## Value Statement
Prevents wasted LLM API calls, duplicate conversation history, and user confusion from unexpected duplicate responses.

## Dependencies
- Blessed migration completion
- Investigation of event handler lifecycle

## Effort Estimate
Medium (~3-4 hours) - investigation, fix, and testing