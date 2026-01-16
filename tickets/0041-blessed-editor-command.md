# 0041: Blessed Editor Command

**Status**: VALIDATED

## Summary
Implement `/editor` slash command for the Blessed-based TUI that opens the user's configured `$EDITOR` for composing multi-line messages.

## Problem
The Blessed-based input system supports multi-line input, but users still need access to their full editor (vim, etc.) for composing longer, structured messages with full editing capabilities. The Ink-specific `/editor` command (ticket 0030) needs to be adapted for Blessed's event system.

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
    
    // Show status in blessed status bar
    this.updateStatus("Opening editor... (save and close to send message)");
    
    // Spawn editor synchronously
    const result = spawnSync(editor, [tmpFile], { stdio: "inherit" });
    
    if (result.status === 0) {
      const content = await readFile(tmpFile, "utf-8");
      const trimmed = content.trim();
      
      if (trimmed) {
        await this.handleSubmit(trimmed);
      } else {
        this.updateStatus("(empty message, not sent)");
      }
    } else {
      this.updateStatus(`Editor exited with error (code ${result.status})`);
    }
  } catch (error) {
    this.updateStatus(`Editor error: ${error.message}`);
  } finally {
    // Cleanup
    try { 
      await unlink(tmpFile); 
    } catch {
      // Ignore cleanup errors
    }
    
    // Clear status after a delay
    setTimeout(() => this.updateStatus(""), 3000);
  }
  
  return true;
}
```

### Integration with Blessed

- Use existing `handleSubmit()` function to process editor content
- Leverage blessed status bar for user feedback
- Editor spawns with `stdio: "inherit"` to take over terminal temporarily
- Blessed UI resumes normally after editor closes
- No special heartbeat handling needed (blessed handles background processing well)

## Acceptance Criteria

- [x] `/editor` opens user's `$EDITOR` for message composition
- [x] `/e` works as shorthand alias
- [x] Saved content is submitted through normal message flow
- [x] Empty/aborted edits are handled gracefully with clear feedback
- [x] Temp files are cleaned up after use
- [x] Status messages inform user of editor state via blessed status bar
- [x] Blessed UI resumes properly after editor closes
- [ ] Works with various editors (vim, nano, code --wait, etc.) - *needs manual testing*
- [x] `/help` updated to show editor command

## Value Statement
Power users can compose complex, multi-line messages using their preferred editor with full editing capabilities, syntax highlighting, and familiar keybindings.

## Dependencies
- Blessed migration completion (task 8 from blessed-migration spec)

## Effort Estimate
Small-Medium: ~2-3 hours (mostly testing with different editors)

## Technical Notes
Key differences from cancelled Ink ticket 0030:
- Uses blessed status bar instead of Ink's status system
- Integrates with blessed's `handleSubmit()` flow
- No React/Ink lifecycle concerns
- Simpler implementation due to blessed's native terminal handling
- Better error handling through blessed's status display
