# 0027: Enhanced Markdown Rendering

**Status**: PENDING

## Summary

Expand markdown support beyond basic inline formatting and solidify existing behavior.

## Current State (0020 baseline)

Working:
- **Bold** (`**text**`) - renders bold
- *Italic* (`_text_` or `*text*`) - renders dim
- `Code` (`` `text` ``) - renders cyan inverse
- Nested markdown in code is correctly ignored

Partially working:
- ~~Strikethrough~~ (`~~text~~`) - recognized but visual effect unclear in terminal

Not implemented:
- Bold-italic combo (`**_text_**`)
- Headings (`# text`)
- Block quotes (`> text`)
- Links (`[text](url)`)
- Lists (`- item`)
- Code blocks (triple backticks)

## Acceptance Criteria

- [ ] Bold-italic renders with both effects
- [ ] Headings render bold with color differentiation
- [ ] Block quotes render with indent and color
- [ ] Code blocks render in a distinct style (not processed for inner markdown)
- [ ] Links show text with URL indicator (maybe `text [↗]` or similar)
- [ ] Lists render with bullet preservation
- [ ] Strikethrough has clear visual treatment (dim + strikethrough, or prefix with `~`?)

## Intentional Behavior to Preserve

**Raw markdown in pending messages**: When a message is in "processing" or "queued" state (gray/dim), raw markdown syntax is displayed instead of rendered. This provides a visual distinction and lets users see exactly what they typed. 

- [ ] Add test to verify pending messages show raw markdown
- [ ] Document this as intentional in code comments

## Technical Notes

- `parseMarkdownInline` in `markdown.tsx` handles inline formatting
- `parseMarkdownBlocks` exists but may not be fully integrated
- Terminal limitations: no underline in all terminals, strikethrough support varies
- Consider: should headings even render differently in chat context?

## Priority

Low - Current inline formatting covers 90% of use cases.
