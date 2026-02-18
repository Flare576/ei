# 0129: Settings Menu Redesign (Web)

**Status**: DONE
**Depends on**: 0096
**Blocked by**: None
**Completed**: 2026-02-18

## Summary

Redesign the web UI header and settings experience:
1. Replace the top-right multi-button interface with a hamburger menu
2. Separate "My Data" (Human entity editor) from "Settings" (app configuration)
3. Reorganize Settings into logical tabs
4. Improve queue pause/resume UX with conditional Play button

## Acceptance Criteria

### Hamburger Menu
- [x] Replace top-right buttons (Pause, Settings, Help, Save&Exit) with hamburger menu
- [x] Menu items: My Data, Settings, Help, Sync & Exit
- [x] "My Data" opens Human entity editor (existing modal, tabs: Facts/Traits/People/Topics/Quotes)
- [x] "Settings" opens new Settings modal (see below)
- [x] "Help" opens existing help modal
- [x] "Sync & Exit" triggers remote sync (if enabled) then... TBD behavior

### Pause/Play UX
- [x] Remove static Pause button from header
- [x] Queue status indicator remains (shows: Ready, Processing... (N pending), or Paused)
- [x] When paused: Show Play button next to status text
- [x] When resumed: Play button disappears (status area shows queue count when active)
- [x] Escape key still toggles pause (unchanged)

### Recall Button
- [x] Remove "Recall" button from chat header
- [x] Up-arrow keyboard shortcut remains for recalling pending messages

### Settings Modal (New)
- [x] Three tabs: **General** | **Providers** | **Data**
- [x] All settings save-on-change (no explicit Save button needed)

#### General Tab
- [x] Name Display (text input)
- [x] Time Mode (dropdown: 24-Hour, 12-Hour, Local, UTC)
- [x] Ceremony Time (time picker, HH:MM format)
- [x] Ceremony explanation: "Ceremonies run nightly to summarize conversations and help Personas grow. Disable by leaving empty."
- [x] **Remove**: Name Color (not used anywhere)
- [x] **Remove**: Auto-save Interval (no longer used)

#### Providers Tab
- [x] Default Model (text input with format hint)
- [x] Provider Accounts list (existing ProviderList component)
- [x] Add/Edit/Delete/Toggle provider accounts (existing ProviderEditor)

#### Data Tab
- [x] Backup & Restore section (Download/Upload buttons)
- [x] Cloud Sync section (username, passphrase, enable/disable)

### Cleanup
- [x] Remove `auto_save_interval_ms` from HumanSettings interface (core types)
- [x] Remove auto-save interval handling from processor (if any remaining)
- [x] Ensure `ceremony_config` is properly surfaced from `HumanEntity.ceremony_config`

## Notes

Current top-right buttons being replaced:
- Pause button moves to conditional Play in status area (only shows when paused)
- Settings button moves to hamburger menu "Settings" option
- Help button moves to hamburger menu "Help" option  
- Save & Exit button moves to hamburger menu "Sync & Exit" option

The Human entity editor (Facts/Traits/People/Topics/Quotes tabs) stays as-is but is now accessed via "My Data" in the hamburger menu instead of being combined with Settings.

Layout issue discovered: Recall button was visually blocked by processing status. Removing it (up-arrow is sufficient).

### Sync & Exit Flow (Web Implementation)

The goal: On launch, the app checks "Do I have state to load?" to decide between onboarding/login vs jumping into Ei.

**Exit Behavior**:
1. User clicks "Sync & Exit" in hamburger menu
2. Web FE calls `processor.saveAndExit()`
3. Processor fires `onSaveAndExitStart` → FE shows loading state
4. Processor:
   - Aborts current queue operations
   - Awaits final disk writes (StateManager flush)
5. IF remote sync configured:
   - Trigger and await remote sync
   - On success: Move local state to backup location (`ei_state` → `ei_state_backup` in localStorage)
   - On failure: Prompt user "Sync failed: [error]. Exit anyway?" - if yes, leave state in place
6. IF no remote sync: Leave state in place (user will resume locally next time)
7. Processor fires `onSaveAndExitFinish`
8. FE navigates to login/onboarding screen (or shows "Safe to close" message)

**Launch Behavior**:
- Check for `ei_state` in localStorage
- If found → Boot directly into Ei (resume session)
- If not found → Show onboarding/login screen (fresh start or remote sync pull)

**Backup Purpose**: Emergency recovery only. If remote pull fails, user can manually restore from `ei_state_backup`.

### Core Changes Required

1. **Ei_Interface** (types.ts): Add `onSaveAndExitStart?: () => void` and `onSaveAndExitFinish?: () => void`
2. **Processor**: Add `saveAndExit()` method implementing the flow above
3. **LocalStorage**: Add method to move state to backup key
4. **Web App.tsx**: Update `handleSaveAndExit` to use new processor method and handle events
