# 0013: Chat UI Component

**Status**: PENDING
**Depends on**: 0008
**Epic**: E002 - MVP: Basic Chat

## Summary

Build the chat panel UI component that displays message history and accepts user input. This is the center panel of the 3-panel layout — the primary interaction surface. Focus on function over form for MVP; polish comes in E005.

## Acceptance Criteria

- [ ] Create `src/ui/components/ChatPanel.tsx` (or similar)
- [ ] Display message history with role differentiation (human vs system)
- [ ] Messages show timestamp
- [ ] Messages show sender name (persona name for system, "You" for human)
- [ ] Input box at bottom accepts text
- [ ] Enter sends message (calls Processor.sendMessage)
- [ ] Shift+Enter inserts newline
- [ ] Input clears after send
- [ ] New messages appear immediately (optimistic UI)
- [ ] Scroll to bottom on new message
- [ ] Component receives `personaName` prop to know which history to display
- [ ] Component receives `messages` prop (or fetches via Processor)

## Technical Notes

### Message Display

```tsx
// Minimal structure
<div className="chat-panel">
  <div className="message-list">
    {messages.map(m => (
      <div key={m.id} className={`message message-${m.role}`}>
        <span className="sender">{m.role === 'human' ? 'You' : personaName}</span>
        <span className="timestamp">{formatTime(m.timestamp)}</span>
        <div className="content">{m.content}</div>
      </div>
    ))}
  </div>
  <div className="input-area">
    <textarea ... />
  </div>
</div>
```

### State Management

For MVP, keep it simple:
- Props: `personaName`, `messages`, `onSendMessage`
- Parent component handles Processor calls

Later (E005) we can add:
- Redux/Zustand for state
- Optimistic updates
- Pending message states

### From Backward Doc

> "It should look Compact without looking tight... There will only ever be TWO people chatting"

Keep the UI tight but readable. No massive name tags.

### Integration

Parent component (App.tsx or similar) will:
1. Track active persona
2. Call `processor.getMessages(personaName)` to get history
3. Pass messages to ChatPanel
4. Handle `onSendMessage` → `processor.sendMessage(personaName, content)`

## Out of Scope (Later Tickets)

- Markdown rendering (0043)
- Message states - pending/read (0044)
- Auto-resize input (0045)
- Pending message recall (0046)
- Emoji support
- Rich text
