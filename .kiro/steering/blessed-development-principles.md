---
inclusion: always
---

# Blessed Development Principles

## Critical Rule: Never Port Ink Code Directly

**NEVER use Ink components as source code to port to Blessed.** This is a fundamental architectural mistake that will cause complex, hard-to-debug issues.

### Why This Rule Exists

During the blessed migration, we initially tried to port Ink's complex text wrapping, manual layout calculations, and React-style rendering logic to Blessed. This resulted in:

- Broken scrolling that fought blessed's native behavior
- Complex boundary detection that blessed already handles
- Text positioning issues from manual calculations
- Hours of debugging blessed's "quirks" that were actually our code fighting blessed

### The Breakthrough

When we **removed all Ink-ported logic** and used blessed's native methods:
- `chatHistory.scroll(lines)` instead of manual position calculations
- `chatHistory.scrollTo(scrollHeight)` instead of complex maxScroll math
- Simple `setContent(text)` instead of complex color tag management
- Let blessed handle text wrapping instead of manual line calculations

**Result**: Scrolling worked perfectly immediately.

### Development Approach

✅ **DO**: Use Ink components as **functional reference**
- What features does it provide?
- What user interactions does it support?
- What data does it display?

❌ **DON'T**: Use Ink components as **implementation reference**
- Don't port text wrapping logic
- Don't port layout calculations
- Don't port manual rendering logic
- Don't port React patterns to blessed

### Blessed Philosophy

Blessed is designed to handle terminal UI complexity for you:
- **Native scrolling**: Use `scroll()` and `scrollTo()`, don't calculate positions
- **Native text wrapping**: Use `setContent()`, don't wrap text manually  
- **Native layout**: Use blessed's layout system, don't calculate dimensions
- **Native widgets**: Use blessed's built-in components, don't reinvent them

### Implementation Pattern

1. **Identify the feature** from Ink component (what it does)
2. **Research blessed's native approach** (how blessed does it)
3. **Implement using blessed patterns** (not Ink patterns)
4. **Test with blessed's expectations** (not Ink's expectations)

### Example: Scrolling

❌ **Wrong (Ink-ported approach)**:
```typescript
// Complex manual calculations
const maxScroll = scrollHeight - height;
const newScroll = currentScroll + lines;
if (newScroll > maxScroll) {
  this.chatHistory.scrollTo(maxScroll);
} else {
  this.chatHistory.scrollTo(newScroll);
}
```

✅ **Right (Blessed-native approach)**:
```typescript
// Let blessed handle it
this.chatHistory.scroll(lines);
```

### When You're Fighting The Framework

If you find yourself:
- Calculating positions manually
- Fighting "quirks" in blessed behavior
- Writing complex boundary detection
- Managing text wrapping yourself

**STOP** - You're probably porting Ink patterns. Step back and find blessed's native way to do it.

### Key Event Handling

**Critical**: In blessed.js, focused elements (like textboxes) consume ALL keypress events and don't bubble them to the screen level. This is fundamentally different from Ink.

❌ **Wrong (Ink-style approach)**:
```typescript
// This won't work when textbox has focus
screen.key(['C-c'], () => {
  handleCtrlC();
});
```

✅ **Right (Blessed-native approach)**:
```typescript
// Handle keys at the element level
inputBox.key(['C-c'], () => {
  handleCtrlC();
});
```

**Key Insight**: Screen-level key bindings only work when no element has focus. For global shortcuts that should work regardless of focus, bind them to the focused element itself.

### Future Features

When adding features like:
- Markdown rendering
- Color support  
- Text formatting
- Layout changes

Research blessed's native capabilities first. Don't assume Ink's approach is the right approach for blessed.