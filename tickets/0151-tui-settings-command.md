# 0151: TUI /settings Command

**Status**: PENDING
**Depends on**: 0139, 0129
**Blocked by**: None

## Summary

Implement `/settings` slash command for TUI to allow users to view and modify settings without leaving the terminal. This provides parity with the web Settings modal redesign (0129).

## Acceptance Criteria

### Command Structure
- [ ] `/settings` - Show current settings overview
- [ ] `/settings general` - Show/edit general settings
- [ ] `/settings providers` - List provider accounts
- [ ] `/settings provider add` - Add new provider account
- [ ] `/settings provider edit <name>` - Edit existing provider
- [ ] `/settings provider delete <name>` - Delete provider
- [ ] `/settings data` - Show backup/sync status

### General Settings (view/edit)
- [ ] Name Display - `/settings name <value>`
- [ ] Time Mode - `/settings time <24h|12h|local|utc>`
- [ ] Ceremony Time - `/settings ceremony <HH:MM|off>`
- [ ] Default Model - `/settings model <provider:model>`

### Provider Management
- [ ] List all providers with status (enabled/disabled)
- [ ] Add provider with interactive prompts (name, type, url, api_key)
- [ ] Edit provider opens $EDITOR with JSON (like `/edit` command)
- [ ] Toggle provider enabled state - `/settings provider toggle <name>`

### Data Operations
- [ ] `/settings backup` - Create local backup file
- [ ] `/settings sync status` - Show sync configuration state
- [ ] `/settings sync enable` - Interactive setup (username, passphrase)
- [ ] `/settings sync disable` - Clear sync credentials
- [ ] `/settings sync now` - Trigger manual sync

### Display
- [ ] Settings output uses consistent formatting with other TUI commands
- [ ] Boolean values show as enabled/disabled
- [ ] Sensitive data (API keys, passphrases) show as masked (••••••)
- [ ] Changes confirm with "Setting updated" message

## Notes

The TUI settings command provides text-based access to the same settings available in the web UI's Settings modal (0129). 

Key differences from web:
- No tabs, use subcommands instead
- Provider editing via $EDITOR (JSON) rather than form modal
- Sync credentials collected interactively (not stored in command history)

### Settings Location
Settings live in `HumanEntity.settings` and `HumanEntity.ceremony_config`. The TUI accesses these through the same Processor API as the web UI.

### Security Note
API keys and passphrases should never echo to terminal during input. Use appropriate input masking.

### TUI Remote Sync Configuration

Unlike the web UI, TUI uses **environment variables** for remote sync credentials:
- `EI_SYNC_USERNAME` - Remote sync username
- `EI_SYNC_PASSPHRASE` - Remote sync passphrase

This avoids storing credentials in state files and aligns with how TUI handles other secrets (like `EI_*_API_KEY` for providers).

**TUI Sync Behavior**:
- `/settings sync status` checks if env vars are set (shows "Configured" or "Not configured")
- `/settings sync now` triggers sync if env vars present, errors if not
- No `/settings sync enable` for TUI - just set the env vars
- Exit behavior uses same flow as web but checks env vars instead of stored credentials
