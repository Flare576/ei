# 0043: Chat Panel: Markdown Rendering

**Status**: PENDING
**Depends on**: 0013

## Summary

Render chat messages as Markdown with full formatting support including emoji.

## Acceptance Criteria

- [ ] Bold, italic, strikethrough render correctly
- [ ] `__text__` renders as underline (non-standard but requested)
- [ ] Bulleted and numbered lists render correctly
- [ ] Code blocks with syntax highlighting
- [ ] URLs render as clickable links (open in new tab)
- [ ] Emoji render correctly (native or polyfill)
- [ ] XSS prevention (sanitize HTML in markdown)

## Notes

**V1 Backward Reference**:
- "All messages should be rendered as Markdown"
- "god dammit, double-underscore __is underline__"
- "Emoji will be rampant, and should be supported"

Use a well-maintained library (e.g., react-markdown, marked) rather than custom parser.
