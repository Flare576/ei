# 0149: TUI Markdown Rendering

**Status**: DONE
**Depends on**: 0100 (TUI Frontend Skeleton)
**Priority**: Medium (TUI V1.2)

## Summary

Render markdown content in TUI messages using OpenTUI's built-in `<markdown>` component. Currently messages display as plain text, losing formatting from LLM responses (bold, italic, code blocks, lists, quotes).

## Background

LLM responses often contain markdown formatting:
- **Bold** and *italic* text for emphasis
- `inline code` and code blocks for technical content
- Bullet and numbered lists
- Blockquotes (important for Ei's quote system)
- Headers for structure

OpenTUI includes a native `<markdown>` component that handles all of this, powered by `marked.js`.

## Acceptance Criteria

### Core Rendering

- [x] Messages render with full markdown support (bold, italic, code, lists, quotes, headers)
- [x] Code blocks display with syntax highlighting
- [x] Both human and AI messages support markdown
- [x] Existing message layout (timestamps, speaker names) preserved

### Theme/Syntax Support

- [x] Syntax highlighting style configured (matches Solarized Dark theme)
- [x] Colors consistent with existing TUI palette

### Edge Cases

- [x] Empty messages don't crash
- [x] Very long code blocks scroll properly within scrollbox
- [x] Malformed markdown gracefully degrades to plain text

## Technical Design

### OpenTUI Markdown Component

The `<markdown>` component is a built-in OpenTUI intrinsic (no imports needed):

```tsx
<markdown
  content={message.content}
  syntaxStyle={syntaxStyle}
  streaming={false}
  conceal={true}
/>
```

**Required Props:**
- `content`: The markdown string to render
- `syntaxStyle`: Syntax highlighting theme (SyntaxStyle enum or object)

**Optional Props:**
- `streaming`: Enable for content still being generated (default: false)
- `conceal`: Hide markdown syntax characters like `**` (default: true)

### Syntax Style Options

OpenTUI provides several built-in syntax styles. Need to investigate which matches Solarized Dark best:

```typescript
import { SyntaxStyle } from "@opentui/core"

// Options to evaluate:
// - SyntaxStyle.Monokai
// - SyntaxStyle.OneDark
// - SyntaxStyle.GithubDark
// - Custom object matching our #839496, #268bd2, etc. colors
```

### MessageList.tsx Changes

```tsx
// Before (current):
<text 
  fg="#839496" 
  marginLeft={2}
  content={message.content}
/>

// After:
<markdown
  marginLeft={2}
  content={message.content}
  syntaxStyle={getSyntaxStyle()}
  streaming={false}
  conceal={true}
/>
```

### Theme Context (Optional)

Could add a theme context for centralized style management:

```typescript
// tui/src/context/theme.tsx
export function useTheme() {
  return {
    syntax: () => SyntaxStyle.OneDark,  // or custom
    colors: {
      primary: "#268bd2",
      secondary: "#2aa198",
      // ...
    }
  }
}
```

Or simply hardcode the syntax style in MessageList if theme abstraction isn't needed yet.

## File Changes

```
tui/src/
├── components/
│   └── MessageList.tsx     # Use <markdown> instead of <text> for content
└── context/
    └── theme.tsx           # (Optional) Centralized theme/syntax config
```

## Research Needed

- [x] Which SyntaxStyle best matches Solarized Dark? → Created custom style in `tui/src/util/syntax.ts`
- [x] Does `<markdown>` work inside `<scrollbox>` without issues? → Yes, works correctly
- [x] Are there any `visible` prop concerns (per TUI AGENTS.md warnings)? → No, markdown doesn't use Show

## Testing

### Manual Testing

- [ ] Message with **bold** and *italic* renders with proper styling
- [ ] Message with `inline code` shows monospace/highlighted
- [ ] Message with code block shows syntax highlighting
- [ ] Message with bullet list renders properly
- [ ] Message with numbered list renders properly
- [ ] Message with blockquote renders with distinct styling
- [ ] Long messages scroll correctly
- [ ] Human messages render markdown too

### Post-Implementation

- [ ] Run `npm run test:all` - all tests still pass
- [ ] Run `npm run test:e2e` from `tui/` - all tests pass

## Notes

- OpenTUI uses `marked.js` internally for markdown parsing
- The `<markdown>` component renders to native OpenTUI renderables (TextRenderable, CodeRenderable, BoxRenderable)
- OpenCode (reference app) uses `<markdown>` with `streaming={true}` for LLM responses
- Once markdown works, can consider adding unread message styling (accent border, etc.)

## References

- OpenTUI MarkdownRenderable: `@opentui/core/src/renderables/Markdown.ts`
- OpenCode usage: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
