# 0154: TUI /context Command

**Status**: PENDING
**Depends on**: 0100 (TUI Frontend Skeleton)
**Blocked by**: None

## Summary

Add a `/context` (alias `/messages`) slash command to the TUI that lets users view and manage message context status for the active persona. Mirrors the web's `ContextWindowTab`. Also adds a `deleteMessages` method to the Processor using the existing `messages_remove` hard-delete path.

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
# _delete: true — permanently removes the message
messages:
  - id: "msg-uuid"          # read-only
    role: "human"           # read-only
    timestamp: "2026-01-15T10:30:00Z"  # read-only
    context_status: default
    _delete: false
    content: |
      The message content here...
```

The comments on the first lines communicate the allowed `context_status` values and delete behavior inline — no external reference needed.

Read-only fields (`id`, `role`, `timestamp`, `content`) are included for human readability but ignored on parse. Only `context_status` and `_delete` are applied on save.

### Delete

`_delete: true` hard-deletes the message via the existing `messages_remove()` path — the same mechanism used by ceremony pruning, message recall, and OpenCode import. Deleted messages are permanently removed from storage.

The `_delete` field is a write-only action flag in the YAML, not a persisted field on Message — matching the existing pattern used by facts, traits, topics, people, and quotes in `yaml-serializers.ts`. On parse, messages marked `_delete: true` are collected and removed via `messages_remove()`. The field defaults to `false` in the YAML output.

## Acceptance Criteria

### Processor

- [ ] `deleteMessages(personaId: string, messageIds: string[]): void` added (thin wrapper around existing `messages_remove`)
- [ ] `updateMessageContextStatus(personaId: string, messageId: string, status: ContextStatus): void` added (if not already present)

### TUI Command

- [ ] `/context` and `/messages` both registered
- [ ] Opens current persona's messages in `$EDITOR` as YAML
- [ ] Inline comments document `context_status` allowed values and `_delete` behavior
- [ ] On save: applies `context_status` changes and hard-deletes messages marked `_delete: true`
- [ ] Confirmation shown: "Context updated" or error on YAML parse failure
- [ ] If messages were deleted, confirmation includes count: "Context updated (N messages deleted)"
- [ ] Re-edit or discard prompt on parse error (matches `/me` pattern)

### TUI Chat View

- [ ] Deleted messages disappear from `MessageList` after save (natural consequence of hard delete)

## Stretch Goal: Quote Cleanup on Delete

Currently, `messages_remove()` does not clean up `Quote.message_id` references — quotes extracted from deleted messages retain a dangling `message_id`. This is a pre-existing issue (ceremony pruning has the same behavior), but since this ticket gives users direct access to deletion, it's worth addressing:

- [ ] `messages_remove()` in `src/core/state/personas.ts` nullifies `Quote.message_id` for any quotes referencing removed message IDs
- [ ] This benefits all callers (ceremony, recall, import, and the new `/context` command)

## Technical Notes

- Follow the `$EDITOR` pattern from `tui/src/commands/me.tsx` and `tui/src/util/yaml-serializers.ts`
- Add `contextToYAML` / `contextFromYAML` to `yaml-serializers.ts`
- Command file: `tui/src/commands/context.tsx`
- Register in `tui/src/components/PromptInput.tsx`
- Web reference for context status logic: `web/src/components/EntityEditor/tabs/ContextWindowTab.tsx`
- Hard delete uses existing `stateManager.messages_remove()` — no new storage methods needed
- `_delete` is a YAML-only action flag, NOT a field on the Message type — follows the existing `_delete` convention in `yaml-serializers.ts`
