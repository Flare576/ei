# 0005: CLI Thinking Indicators

**Status**: DONE

> Basic "thinking..." text hint implemented. Animated spinner TBD pending UI cleanup.

## Summary

Add visual feedback in the terminal when EI is processing a message, so users know the system is working.

## Problem

Without debug mode enabled, users see no feedback between sending a message and receiving a response. For longer processing times (multiple LLM calls), this creates uncertainty about whether the system is working or frozen.

## Proposed Solution

Add terminal-based progress indicators using ANSI escape sequences. Show status during processing, clear when response arrives.

### Implementation

#### Simple Spinner Approach

```typescript
const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spinnerInterval: NodeJS.Timeout | null = null;
let spinnerIndex = 0;

function startSpinner(message: string = "Thinking") {
  spinnerIndex = 0;
  spinnerInterval = setInterval(() => {
    process.stdout.write(`\r${spinnerFrames[spinnerIndex]} ${message}...`);
    spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
  }, 80);
}

function stopSpinner() {
  if (spinnerInterval) {
    clearInterval(spinnerInterval);
    spinnerInterval = null;
    process.stdout.write("\r\x1b[K"); // Clear line
  }
}
```

#### Integration Points

1. **Start spinner**: When `processQueue()` begins processing
2. **Update message** (optional): Hook into `processEvent()` stages
   - "Thinking..." → "Updating concepts..." → "Almost done..."
3. **Stop spinner**: Before printing response or on abort

### Status Messages (Optional Enhancement)

Could hook into debug log points to show progress:
- "Thinking..." (initial LLM call)
- "Updating concepts..." (concept update calls)
- "Finishing up..." (saving/cleanup)

### Edge Cases

- User interrupts with Ctrl+C → Clear spinner before exit
- Abort via new message → Clear spinner before processing new message
- Multiple rapid messages → Don't start multiple spinners

## Acceptance Criteria

- [ ] Spinner/indicator appears when processing starts
- [ ] Indicator clears cleanly when response arrives
- [ ] Works correctly with message interruption (Ctrl+C, new message)
- [ ] No visual artifacts left in terminal
- [ ] Optional: Status messages indicate processing stage

## Value Statement

Users have confidence the system is working, especially during longer processing times. Matches expectations from modern CLI tools and chat applications.

## Dependencies

None - uses existing `isProcessing` flag and ANSI escape sequences.

## Effort Estimate

Small-Medium: ~2-3 hours
