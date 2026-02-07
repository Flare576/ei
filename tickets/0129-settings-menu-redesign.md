# 0129: Settings Menu Redesign

**Status**: PENDING
**Depends on**: 0096
**Blocked by**: None

## Summary

Redesign the settings interface to consolidate the multi-button control area (top-right) into a unified menu, separate Human info from Settings, and organize settings into logical tabs with save-on-change behavior.

## Acceptance Criteria

- [ ] Replace multi-button interface (⏸💾⚙️?) in top-right with a single menu trigger
- [ ] Menu provides access to: Pause, Save/Load, Settings, Human Info, Help
- [ ] Split "Settings" and "Human Info" into separate screens/modals
- [ ] Settings screen uses tabs: [General] [LLM] [Data]
  - **General**: Display settings (theme, time format, etc.)
  - **LLM**: Provider accounts, model selection, API keys
  - **Data**: Backup/restore, cloud sync, auto-save interval
- [ ] All settings save-on-change (eliminate explicit "Save" button)
- [ ] Human Info editor remains as-is (already has tabs for Facts/Traits/Topics/People/Quotes)

## Notes

Current top-right buttons:
- ⏸ Pause - pauses all background processing
- 💾 Save/Load - checkpoint management modal
- ⚙️ Settings - opens combined settings + human editor
- ? Help - opens help modal

The current ⚙️ button opens a modal that combines:
1. Display settings (auto-save interval, etc.)
2. Provider accounts management
3. Cloud sync configuration
4. Backup/restore
5. Human entity editor (facts, traits, topics, people, quotes)

This ticket splits that into:
- **Settings modal** with tabs for General/LLM/Data configuration
- **Human Info modal** (existing entity editor, accessed separately)

Save-on-change pattern already exists for entity editing (facts, traits, etc.) - extend this to all settings fields.
