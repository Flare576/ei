# 0020: Markdown Rendering in Chat Messages

**Status**: VALIDATED

## Summary

Parse and render Markdown-style formatting in chat messages (bold, italic, code, etc.).

## Problem

LLM responses often include Markdown formatting like `**bold**`, `*italic*`, and `` `code` ``. Currently these render as raw text, losing the intended emphasis.

## Proposed Solution

### Supported Formatting

| Markdown | Rendered | Ink Style |
|----------|----------|-----------|
| `**bold**` | **bold** | `bold` prop |
| `*italic*` or `_italic_` | *italic* | `dimColor` or custom |
| `` `code` `` | `code` | `inverse` or `color="cyan"` |
| `~~strike~~` | ~~strike~~ | `strikethrough` prop |

### Code Blocks

```
\`\`\`js
const x = 1;
\`\`\`
```

Render with distinct background/border. Syntax highlighting is a stretch goal.

### Implementation Approach

Option A: Simple regex-based parser (fast, limited)
```typescript
function parseMarkdown(text: string): React.ReactNode[] {
  // Split on **...**, *...*, `...` patterns
  // Return array of <Text> elements with appropriate props
}
```

Option B: Use a library like `marked` or `simple-markdown` and transform AST to Ink components

### Edge Cases

- Nested formatting: `**bold and *italic***`
- Escaped characters: `\*not italic\*`
- Unmatched delimiters: `half **bold`
- URLs with underscores: `https://example.com/some_path`

### Performance

- Parse once when message is added, cache result
- Or parse on render but memoize

## Acceptance Criteria

- [x] `**text**` renders bold
- [x] `*text*` or `_text_` renders italic/dim
- [x] `` `text` `` renders as inline code
- [x] Code blocks render distinctly
- [x] Malformed markdown doesn't crash
- [x] Plain text still renders normally

## Value Statement

Messages look as intended. LLM formatting becomes meaningful instead of noisy.

## Dependencies

- Ticket 0010 (Ink layout) - complete

## Effort Estimate

Medium: ~3-4 hours
