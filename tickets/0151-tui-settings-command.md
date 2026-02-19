# 0151: TUI /settings Command

**Status**: DONE
**Depends on**: 0139, 0129
**Blocked by**: None

## Summary

Implement `/settings` slash command for TUI to allow users to view and modify settings without leaving the terminal. This provides parity with the web Settings modal redesign (0129).

## Acceptance Criteria

### MVP (Implemented)
- [x] `/settings` - Opens $EDITOR with YAML for settings (default_model, time_mode, ceremony, opencode)
- [x] ~~`/settings sync`~~ - Removed (sync only on exit, not manual)
- [x] Exit flow (`/quit`, Ctrl+C) calls `saveAndExit()` with proper remote sync
- [x] `/quit force` or `/q!` to force quit without syncing
- [x] Sync configured via env vars (`EI_SYNC_USERNAME`, `EI_SYNC_PASSPHRASE`)
- [x] Sync credentials written to state on startup for Processor compatibility
- [x] Notification on sync failure with instructions to use force quit

### Future Enhancements (Not Implemented)
- [ ] `/settings general` - Show/edit general settings inline
- [ ] `/settings providers` - List provider accounts
- [ ] `/settings provider add` - Add new provider account
- [ ] `/settings provider edit <name>` - Edit existing provider
- [ ] `/settings provider delete <name>` - Delete provider
- [ ] `/settings data` - Show backup/sync status

### General Settings (via YAML editor)
- [x] Default Model - editable in YAML
- [x] Time Mode - editable in YAML (24h|12h|local|utc)
- [x] Ceremony Time - editable in YAML (HH:MM format)
- [x] OpenCode settings - editable in YAML (integration, polling_interval_ms)

### Data Operations
- [x] ~~`/settings sync`~~ - Removed (sync happens on exit only)
- [ ] `/settings backup` - Create local backup file (future)

### Display
- [x] Settings output uses YAML format in $EDITOR
- [x] Changes confirm with "Settings updated" message
- [x] YAML parse errors prompt re-edit or discard

## Notes

MVP scope delivers core functionality:
- YAML-based settings editing (matches `/me`, `/details` pattern)
- Environment variable based sync (no credentials in command history)
- Proper exit sync flow (matches web behavior)

### Implementation Details

**Files Modified:**
- `tui/src/context/ei.tsx` - Added `saveAndExit`, `updateSettings`, `syncStatus`, `triggerSync` methods; bootstrap configures sync from env vars
- `tui/src/context/keyboard.tsx` - `exitApp()` now calls `saveAndExit()` instead of `stopProcessor()`
- `tui/src/commands/quit.ts` - Handles `force` flag for force quit without sync
- `tui/src/commands/settings.tsx` - New `/settings` command with YAML editor
- `tui/src/util/yaml-serializers.ts` - Added `settingsToYAML`/`settingsFromYAML`
- `tui/src/components/PromptInput.tsx` - Registered `/settings` command
