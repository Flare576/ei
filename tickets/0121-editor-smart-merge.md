# 0121: HumanEditor Smart Merge

**Status**: PENDING
**Depends on**: None
**Blocked by**: None

## Summary

HumanEditor currently resets ALL form fields whenever the `human` prop updates. This causes user input to vanish when backend events fire (e.g., during LLM extraction). Need "smart merge" that preserves dirty fields while allowing clean fields to live-update.

## Problem

1. User opens HumanEditor, starts typing in "Name Display" field
2. Backend fires `onHumanUpdated` (new fact extracted, etc.)
3. `useEffect` triggers, resets ALL local state from `human` prop
4. User's in-progress typing is lost

Current behavior is useful for live-updating lists (Facts, Traits, etc.) as extraction happens, so we can't just block all updates.

## Acceptance Criteria

- [ ] Settings fields only reset if they're not dirty
- [ ] Per-field dirty tracking for settings (not just boolean `settingsDirty`)
- [ ] Dirty fields preserve user input through backend updates
- [ ] Clean fields continue to live-update
- [ ] After successful save, field becomes "clean" again
- [ ] Same pattern applied to entity lists (Facts, Traits, Topics, People) if needed

## Technical Approach

```typescript
// Instead of:
const [settingsDirty, setSettingsDirty] = useState(false);

// Track per-field:
const [dirtySettings, setDirtySettings] = useState<Set<keyof Settings>>(new Set());

// On update, merge intelligently:
useEffect(() => {
  if (isOpen) {
    setLocalSettings(prev => {
      const merged = { ...prev };
      for (const key of Object.keys(human.settings)) {
        if (!dirtySettings.has(key)) {
          merged[key] = human.settings[key];
        }
      }
      return merged;
    });
    // Similar logic for lists - update items not in dirtyIds
  }
}, [isOpen, human]);
```

## Notes

- May want similar treatment for PersonaEditor
- Consider debouncing updates to reduce churn
- Edge case: what if backend value changes to match user's dirty value? Could clear dirty flag.
