# 0003: /editor Command for Multi-line Input

**Status**: CANCELLED

> Cancelled: This ticket was written for the readline-based interface. The system has since switched to Ink, making the problem statement and implementation details outdated. See ticket 0030 for the Ink-compatible version.

## Summary

Add `/editor` slash command that opens the user's configured `$EDITOR` (vim, etc.) to compose multi-line messages.

## Problem

The current readline-based input is line-by-line only. Users cannot enter carriage returns, making it difficult to compose longer, structured messages (code snippets, lists, formatted thoughts).

## Proposed Solution

Add `/editor` command that:
1. Creates a temp file in `/tmp/ei-edit-<timestamp>.md`
2. Spawns `$EDITOR` (falling back to `vim` if unset)
3. Waits for editor to close
4. Reads file contents and passes to `queueMessage()`
5. Cleans up temp file

### Implementation

```typescript
case "editor":
case "e": {
  const editor = process.env.EDITOR || "vim";
  const tmpFile = `/tmp/ei-edit-${Date.now()}.md`;
  
  // Write empty file (or optional template)
  fs.writeFileSync(tmpFile, "");
  
  // Spawn editor synchronously
  const result = spawnSync(editor, [tmpFile], { stdio: "inherit" });
  
  if (result.status === 0) {
    const content = fs.readFileSync(tmpFile, "utf-8").trim();
    if (content) {
      queueMessage(content);
    } else {
      console.log("(empty message, not sent)");
    }
  }
  
  // Cleanup
  try { fs.unlinkSync(tmpFile); } catch {}
  
  rl.prompt();
  return true;
}
```

### Heartbeat Handling

While the editor is open, heartbeats should be suppressed (same pattern as persona creation). Set `isAwaitingInput = true` before spawning editor, reset to `false` after editor closes.

```typescript
case "editor":
case "e": {
  const editor = process.env.EDITOR || "vim";
  const tmpFile = `/tmp/ei-edit-${Date.now()}.md`;
  
  fs.writeFileSync(tmpFile, "");
  
  isAwaitingInput = true;  // Suppress heartbeats while editing
  const result = spawnSync(editor, [tmpFile], { stdio: "inherit" });
  isAwaitingInput = false; // Resume heartbeats
  
  // ... rest of implementation
}
```

### Edge Cases

- Empty file on save → Don't send message, print notice
- Editor exits with error → Print error, don't send
- User has no `$EDITOR` set → Fall back to `vim`
- File read fails → Print error, prompt continues
- Heartbeat fires while editor open → Skipped (via `isAwaitingInput` flag)

## Acceptance Criteria

- [ ] `/editor` opens user's `$EDITOR` for message composition
- [ ] `/e` works as shorthand alias
- [ ] Saved content is sent through normal message queue
- [ ] Empty/aborted edits are handled gracefully
- [ ] Temp files are cleaned up after use
- [ ] Heartbeats are suppressed while editor is open (using `isAwaitingInput` flag)
- [ ] `/help` updated to show editor command

## Value Statement

Power users can compose complex, multi-line messages using their preferred editor with full editing capabilities (vim motions, syntax highlighting, etc.).

## Dependencies

None - extends existing slash command infrastructure.

## Effort Estimate

Small: ~1-2 hours
