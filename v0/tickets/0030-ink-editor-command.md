# 0030: /editor Command for Ink-based Multi-line Input

**Status**: CANCELLED

> Cancelled: This ticket was specific to the Ink-based TUI implementation. The system has migrated to Blessed, making the Ink-specific implementation details obsolete. See ticket 0041 for the Blessed-compatible version.

## Summary

Re-implement `/editor` slash command for the Ink-based TUI that opens the user's configured `$EDITOR` for composing multi-line messages.

## Resolution

**OBSOLETE**: The Blessed migration has replaced the Ink-based TUI. The `/editor` command functionality is still valuable but needs to be implemented using Blessed's event system and status handling rather than Ink's React-based approach.

**Replacement**: See ticket 0041 for Blessed-specific implementation.

## Problem

The current Ink-based input system supports multi-line input via Ctrl+J, but users still need access to their full editor (vim, etc.) for composing longer, structured messages with full editing capabilities. The previous readline-based `/editor` command was disabled during the Ink migration.

## Proposed Solution

Add `/editor` command that:
1. Creates a temp file in `/tmp/ei-edit-<timestamp>.md`
2. Spawns `$EDITOR` (falling back to `vim` if unset)
3. Waits for editor to close
4. Reads file contents and passes to message submission flow
5. Cleans up temp file

### Implementation

```typescript
case "editor":
case "e": {
  const editor = process.env.EDITOR || "vim";
  const tmpFile = `/tmp/ei-edit-${Date.now()}.md`;
  
  try {
    // Write empty file (or optional template)
    await writeFile(tmpFile, "", "utf-8");
    
    // Show status while editor opens
    setStatus("Opening editor... (save and close to send message)");
    
    // Spawn editor synchronously
    const result = spawnSync(editor, [tmpFile], { stdio: "inherit" });
    
    if (result.status === 0) {
      const content = await readFile(tmpFile, "utf-8");
      const trimmed = content.trim();
      
      if (trimmed) {
        await handleSubmit(trimmed);
      } else {
        setStatus("(empty message, not sent)");
      }
    } else {
      setStatus(`Editor exited with error (code ${result.status})`);
    }
  } catch (error) {
    setStatus(`Editor error: ${error.message}`);
  } finally {
    // Cleanup
    try { 
      await unlink(tmpFile); 
    } catch {
      // Ignore cleanup errors
    }
    
    // Clear status after a delay
    setTimeout(() => setStatus(null), 3000);
  }
  
  return true;
}
```

### Heartbeat Handling

While the editor is open, heartbeats should continue normally since the Ink-based system handles background processing better than the old readline version. No special heartbeat suppression needed.

### Integration with Ink

- Use existing `handleSubmit()` function to process editor content
- Leverage existing status message system for user feedback
- Editor spawns with `stdio: "inherit"` to take over terminal temporarily
- Ink UI resumes normally after editor closes

## Acceptance Criteria

- [ ] `/editor` opens user's `$EDITOR` for message composition
- [ ] `/e` works as shorthand alias
- [ ] Saved content is submitted through normal message flow
- [ ] Empty/aborted edits are handled gracefully with clear feedback
- [ ] Temp files are cleaned up after use
- [ ] Status messages inform user of editor state
- [ ] Ink UI resumes properly after editor closes
- [ ] Works with various editors (vim, nano, code --wait, etc.)
- [ ] `/help` updated to show editor command

## Value Statement

Power users can compose complex, multi-line messages using their preferred editor with full editing capabilities, syntax highlighting, and familiar keybindings.

## Dependencies

None - extends existing Ink-based slash command infrastructure.

## Effort Estimate

Small-Medium: ~2-3 hours (mostly testing with different editors)

## Technical Notes

Key differences from cancelled ticket 0003:
- Uses Ink's status system instead of console output
- Integrates with existing `handleSubmit()` flow
- No heartbeat suppression needed (Ink handles background better)
- Async/await pattern for file operations
- Better error handling and user feedback