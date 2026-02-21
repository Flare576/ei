# 0154: TUI /context Command

**Status**: PENDING
**Depends on**: 0100 (TUI Frontend Skeleton)
**Blocked by**: None

## Summary

Add a `/context` (alias `/messages`) slash command to the TUI that lets users view and manage message context status for the active persona. Mirrors the web's `ContextWindowTab`. Also adds soft-delete (`is_deleted`) to the `Message` type and a `deleteMessage` method to the Processor.

## Background

The web persona editor has a full Context Window tab (`ContextWindowTab.tsx`) showing all messages with their `context_status` (Default/Always/Never) and allowing per-message or bulk overrides. The TUI has no equivalent. Users navigating the TUI have no way to prune or pin messages from the context window.

`context_status` values:
- `default` — respect the sliding time window and boundary
- `always` — always include in LLM context regardless of age
- `never` — always exclude from LLM context

## Design

### Command Signature

```
/context              # Opens messages for active persona in $EDITOR (YAML)
/messages             # Alias
```

Single mode only — open in `$EDITOR` following the pattern of `/me`, `/details`, `/settings`, `/quotes`. No overlay needed for MVP.

### YAML Format

```yaml
# context_status: default | always | never
messages:
  - id: "msg-uuid"          # read-only
    role: "human"           # read-only
    timestamp: "2026-01-15T10:30:00Z"  # read-only
    context_status: default
    is_deleted: false
    content: |
      The message content here...
```

The comment on the first line communicates the allowed `context_status` values inline — no external reference needed.

Read-only fields (`id`, `role`, `timestamp`, `content`) are included for human readability but ignored on parse. Only `context_status` and `is_deleted` are applied on save.

### Soft Delete

`is_deleted: true` marks a message as deleted without removing it from storage. Deleted messages:
- Are excluded from LLM context (treated as `never`, overrides `always`)
- Are hidden from normal message display in the TUI chat view
- Are not sent to extraction/ceremony passes
- Are still retrievable for audit purposes

This requires:
1. Adding `is_deleted?: boolean` to the `Message` interface in `src/core/types.ts` (default `false`)
2. Adding `deleteMessage(id: string): void` and `restoreMessage(id: string): void` to `Processor`
3. Adding `messages_delete` / `messages_restore` methods to `StateManager`
4. Filtering `is_deleted` messages out of context building in the Processor's response prompt logic

## Acceptance Criteria

### Message Type

- [ ] `is_deleted?: boolean` added to `Message` in `src/core/types.ts` (defaults to `false`)
- [ ] Existing messages without the field treated as `is_deleted: false`

### Processor

- [ ] `deleteMessage(personaId: string, messageId: string): void` added
- [ ] `restoreMessage(personaId: string, messageId: string): void` added
- [ ] `updateMessageContextStatus(personaId: string, messageId: string, status: ContextStatus): void` added (if not already present)
- [ ] Deleted messages excluded from response prompt context
- [ ] Deleted messages excluded from extraction scans

### TUI Command

- [ ] `/context` and `/messages` both registered
- [ ] Opens current persona's messages in `$EDITOR` as YAML
- [ ] Inline comment documents `context_status` allowed values
- [ ] On save: applies `context_status` changes and `is_deleted: true` flags
- [ ] Confirmation shown: "Context updated" or error on YAML parse failure
- [ ] Re-edit or discard prompt on parse error (matches `/me` pattern)

### TUI Chat View

- [ ] Messages with `is_deleted: true` hidden from `MessageList`

## Technical Notes

- Follow the `$EDITOR` pattern from `tui/src/commands/me.tsx` and `tui/src/util/yaml-serializers.ts`
- Add `contextToYAML` / `contextFromYAML` to `yaml-serializers.ts`
- Command file: `tui/src/commands/context.tsx`
- Register in `tui/src/components/PromptInput.tsx`
- Web reference for context status logic: `web/src/components/EntityEditor/tabs/ContextWindowTab.tsx`
