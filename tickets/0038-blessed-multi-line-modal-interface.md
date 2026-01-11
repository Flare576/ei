# 0038: Blessed Multi-Line Modal Interface

**Status**: PENDING

## Summary
Create a modal-style interface for displaying multi-line information that currently gets truncated in the single-line status bar.

## Problem
The current blessed UI uses a single-line status bar (height=1) for displaying information like:
- `/persona` command output (list of available personas)
- Help text
- Error messages
- Command feedback

Multi-line content gets truncated to only the first line, making information incomplete and hard to read.

## Proposed Solution
Implement a modal-style overlay that can display multi-line content temporarily over the main UI:

1. **Modal overlay**: Temporary popup that appears over the chat area
2. **Auto-dismiss**: Disappears after a timeout or on next user input
3. **Scrollable**: For very long content
4. **Styled**: Consistent with blessed UI theme

## Use Cases Identified
Current `setStatus()` calls that could benefit from multi-line support:

**Commands:**
- `/persona` (without args) - shows list of personas with status
- `/help` - could show detailed command help
- Error messages - could show stack traces or detailed error info

**System feedback:**
- Initialization errors
- LLM connection errors
- Persona switching feedback

## Implementation Approach
1. **Create ModalManager class**: Handle modal display/dismiss logic
2. **Add to LayoutManager**: Integrate modal overlay into layout system
3. **Update setStatus()**: Add optional `multiLine` parameter
4. **Keyboard handling**: ESC or any key dismisses modal

## Acceptance Criteria
- [ ] Modal overlay displays over main UI without corrupting layout
- [ ] Multi-line content displays properly formatted
- [ ] Modal auto-dismisses after 5 seconds or on user input
- [ ] `/persona` command shows full persona list in modal
- [ ] Modal is scrollable for content longer than screen height
- [ ] Modal styling matches blessed UI theme
- [ ] Single-line status messages continue to use status bar
- [ ] Modal doesn't interfere with input focus

## Value Statement
Provides proper display for multi-line information without breaking the blessed UI layout, improving usability of commands and error reporting.

## Dependencies
None - this is a blessed UI enhancement.

## Effort Estimate
Medium (~3-4 hours) - new modal system with integration into existing layout.