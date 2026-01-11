# 0036: Blessed Text Rendering Corruption

**Status**: PENDING

## Summary
Text rendering corruption in chat messages where characters appear mixed up, overlapped, or incorrectly positioned.

## Problem
Chat message text displays with character corruption:
```
Beta's inkthe mix—justgfinishedeaBquickdsanity checkyonlthe—Blessedrupgrade.eNoomajor,
hiccups, butnIpdidinoticeuadsubtletlagnwhenorenderingslarge'tables;emightebeeworthatweakinguthesbuffer
size.eAlso,ton ardifferent note—bananasostilltmyaleast favorite snack; they're just too sweet and
```

Should display as:
```
Beta's in the mix—just finished a quick sanity check on the Blessed upgrade. No major
hiccups, but I did notice a subtle lag when rendering large tables; might be worth tweaking the buffer
size. Also, on a different note—bananas still my least favorite snack; they're just too sweet and
```

## Root Cause Investigation
Potential causes:
1. **Blessed text wrapping**: Blessed's native text wrapping conflicting with content
2. **Color tag interference**: Blessed color tags `{color-fg}` interfering with text positioning
3. **Buffer size issues**: Terminal buffer size causing character positioning problems
4. **Unicode handling**: Issues with Unicode characters or escape sequences
5. **Screen rendering timing**: Race conditions in screen updates

## Proposed Solution
1. **Text sanitization**: Ensure message content is properly escaped for blessed
2. **Wrapping configuration**: Review blessed box wrapping settings
3. **Color tag handling**: Verify color tags don't interfere with text flow
4. **Buffer management**: Investigate terminal buffer size settings

```typescript
// In chat-renderer.ts
private sanitizeMessageContent(content: string): string {
  // Escape blessed color tags in user content
  return content
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\n/g, '\n'); // Preserve intentional newlines
}

// In layout-manager.ts - review text box settings
this.chatHistory = blessed.box({
  // ... existing settings ...
  wrap: true,           // Ensure proper wrapping
  scrollable: true,
  alwaysScroll: true,
  tags: true,           // May need to be false if causing issues
  shrink: false,        // Prevent content shrinking
  padding: {            // Add padding to prevent edge issues
    left: 1,
    right: 1
  }
});
```

## Acceptance Criteria
- [ ] Chat messages display without character corruption
- [ ] Text wrapping works correctly at all terminal widths
- [ ] Color formatting doesn't interfere with text positioning
- [ ] Long messages display correctly without character mixing
- [ ] Unicode characters render properly
- [ ] No visual artifacts in message display

## Value Statement
Ensures chat messages are readable and professional-looking, critical for a chat application's usability.

## Dependencies
- Blessed migration completion
- Text rendering investigation

## Effort Estimate
Medium (~3-4 hours) - investigation, testing different blessed configurations, and fixes