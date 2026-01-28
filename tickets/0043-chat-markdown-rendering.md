# 0043: Chat Panel: Markdown Rendering

**Status**: DONE
**Depends on**: 0013

## Summary

Render chat messages as Markdown with full formatting support including emoji.

## Acceptance Criteria

- [x] Bold, italic, strikethrough render correctly
- [x] `__text__` renders as underline (non-standard but requested)
- [x] Bulleted and numbered lists render correctly
- [x] Code blocks with syntax highlighting
- [x] URLs render as clickable links (open in new tab)
- [x] Emoji render correctly (native or polyfill)
- [x] XSS prevention (sanitize HTML in markdown)

## Notes

**V1 Backward Reference**:
- "All messages should be rendered as Markdown"
- "god dammit, double-underscore __is underline__"
- "Emoji will be rampant, and should be supported"

Use a well-maintained library (e.g., react-markdown, marked) rather than custom parser.

## Implementation

- `web/src/components/Chat/MarkdownContent.tsx` - React Markdown wrapper
- Dependencies: react-markdown, remark-gfm, rehype-sanitize
- Custom underline transform: `__text__` → `<u>text</u>`
- Links open in new tab with `target="_blank" rel="noopener noreferrer"`
- Styled code blocks (inline and block) with monospace font
- Native emoji support (no polyfill needed for modern browsers)
- CSS in `layout.css` under MARKDOWN CONTENT section
