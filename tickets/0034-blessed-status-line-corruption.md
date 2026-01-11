# 0034: Blessed Status Line Corruption

**Status**: PENDING

## Summary
Intermittent corruption of the status line (bottom of screen) in the Blessed UI, particularly when LLM connection errors occur.

## Problem
The status line occasionally becomes corrupted with garbled text or visual artifacts. This has been observed when:
- LM Studio is not fully initialized and a message is sent
- LLM connection errors occur
- Potentially other error conditions

The corruption is intermittent and difficult to reproduce consistently.

## Proposed Solution
Investigate status line rendering and error handling:

1. **Error handling review**: Check how errors are displayed in the status line
2. **Screen clearing**: Ensure status line is properly cleared before updates
3. **Text escaping**: Verify error messages don't contain problematic characters
4. **Blessed rendering**: Review blessed's status bar content setting

```typescript
// Potential fixes in renderStatus()
private renderStatus() {
  let status = '';
  if (this.isProcessing) {
    status += '{cyan-fg}thinking...{/cyan-fg} ';
  }
  if (this.statusMessage) {
    // Escape or sanitize status message
    const cleanMessage = this.statusMessage.replace(/[{}]/g, '');
    status += cleanMessage;
  }
  
  // Clear before setting new content
  this.layoutManager.getStatusBar().setContent('');
  this.layoutManager.getStatusBar().setContent(status);
}
```

## Acceptance Criteria
- [ ] Status line displays error messages without corruption
- [ ] Status line clears properly between updates
- [ ] No visual artifacts remain after error conditions
- [ ] Error messages are properly escaped/sanitized
- [ ] Status line remains functional after corruption events

## Value Statement
Reliable status display ensures users can see error messages and system status without visual corruption interfering with usability.

## Dependencies
- Blessed migration completion
- Error reproduction for testing

## Effort Estimate
Small-Medium (~2-3 hours) - investigation and targeted fixes