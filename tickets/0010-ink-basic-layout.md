# 0010: Replace Readline with Ink + Basic 3-Pane Layout

**Status**: VALIDATED

## Summary

Replace readline interface with ink-based TUI featuring three panes: persona list, chat history, and input area.

## Problem

Current readline interface is single-line input with basic console.log output. No visual structure, no multi-line editing, no persistent layout.

## Proposed Solution

### Layout Structure

```
┌─Personas─┬────────────Chat: ei────────────────┐
│ > ei     │ [3:45 PM] You: Hey there           │
│   mike   │ [3:45 PM] EI: Hey! What's up?      │
│   lena   │                                    │
│   beta   │                                    │
│          │                                    │
├──────────┼────────────────────────────────────┤
│ [Ctrl+H] │ > _                                │
│ to focus │                                    │
└──────────┴────────────────────────────────────┘
```

### Component Hierarchy

```tsx
<App>
  <Box flexDirection="row">
    <PersonaList 
      personas={personas} 
      active={activePersona}
      unread={unreadCounts}
    />
    <Box flexDirection="column" flexGrow={1}>
      <ChatHistory messages={messages} />
      <InputArea onSubmit={handleSubmit} />
    </Box>
  </Box>
</App>
```

### Key Dependencies

- `ink` - React for CLI
- `ink-text-input` - Text input component (may need custom for multi-line)

### Integration Points

- Replace `rl.on("line")` with ink input handler
- Replace `console.log` with state-driven message list
- Keep all existing processing logic (processor.ts, llm.ts, etc.)

## Acceptance Criteria

- [ ] Three-pane layout renders correctly
- [ ] Persona list shows all available personas
- [ ] Chat history displays messages with timestamps
- [ ] Input area accepts text and submits on Enter
- [ ] Existing `/commands` still work
- [ ] App starts and runs without readline

## Value Statement

Foundation for rich terminal UI. Visual structure makes multi-persona interaction intuitive.

## Dependencies

- npm: `ink`, `ink-text-input`, `react`

## Effort Estimate

Medium-Large: ~4-6 hours
