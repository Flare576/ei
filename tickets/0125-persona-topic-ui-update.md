# 0125: PersonaTopic UI Update

**Status**: DONE
**Priority**: MEDIUM
**Epic**: E009 (Polish & New Features)
**Depends on**: 0123, 0124
**Blocked by**: None

## Summary

Update the web frontend to support the new `PersonaTopic` data structure with `perspective`, `approach`, and `personal_stake` fields (replacing the old `description` field).

## Background

Tickets 0123 and 0124 changed the `PersonaTopic` interface:

**Old structure:**
```typescript
{
  name: string;
  description: string;  // Single catch-all field
  sentiment: number;
  exposure_current: number;
  exposure_desired: number;
}
```

**New structure:**
```typescript
{
  name: string;
  perspective: string;      // Their view/opinion on this topic
  approach: string;         // How they prefer to engage with this topic
  personal_stake: string;   // Why this topic matters to them personally
  sentiment: number;
  exposure_current: number;
  exposure_desired: number;
}
```

The backend prompts and handlers are updated; now the UI needs to catch up.

## Affected Components

### 1. PersonaEditor Modal (`web/src/components/Modals/PersonaEditor.tsx`)

The topics tab currently shows/edits `description`. Needs to:
- Display the three new fields instead of description
- Allow editing each field separately
- Handle empty values gracefully (approach/personal_stake may be empty initially)

**Suggested layout:**
```
Topic: [name field]
├─ Perspective: [textarea - always shown, required feel]
├─ Approach: [textarea - optional, collapsible or smaller]
├─ Personal Stake: [textarea - optional, collapsible or smaller]
├─ Sentiment: [slider -1 to 1]
└─ Exposure: [current/desired sliders]
```

### 2. PersonaCreator Modal (`web/src/components/Modals/PersonaCreator.tsx`)

When users provide initial topics during persona creation:
- Update the topic input form to accept the new fields
- At minimum: `name` + `perspective` (approach/personal_stake can default to empty)
- The generation prompt will fill in missing fields

**Suggested approach:**
- Keep it simple: just `name` and `perspective` in the creator
- Let the LLM generate approach/personal_stake during generation
- Full editing available in PersonaEditor after creation

### 3. Type imports

Ensure any components importing topic types use `PersonaTopic` from core types, not any local type definitions.

## Acceptance Criteria

### PersonaEditor
- [ ] Topics tab displays `perspective` instead of `description`
- [ ] Topics tab displays `approach` field (can be empty)
- [ ] Topics tab displays `personal_stake` field (can be empty)
- [ ] All three fields are editable
- [ ] Empty approach/personal_stake shown as placeholder or "(not set)" rather than blank
- [ ] Saving updates all three fields correctly

### PersonaCreator
- [ ] Topic input accepts `name` and `perspective` at minimum
- [ ] Generated personas have properly structured PersonaTopics
- [ ] No TypeScript errors related to old `description` field

### General
- [ ] No references to `topic.description` remain in web/ code
- [ ] Build passes (`npm run build` in web/)
- [ ] Existing personas with old data don't crash the UI

## Implementation Notes

### Backward Compatibility

Old saved data may have `description` instead of the new fields. The UI should handle this gracefully:
- If `perspective` is empty but `description` exists, show description as perspective
- Or just show empty (the Ceremony will populate these fields over time)

### Field Guidelines

From CONTRACTS.md:
- `perspective`: Their view/opinion - should always be populated
- `approach`: How they engage - optional, only if clear pattern exists
- `personal_stake`: Why it matters - optional, only if evidence exists

### UI/UX Considerations

- `perspective` is the most important field - make it prominent
- `approach` and `personal_stake` are supplementary - could be in an "Advanced" accordion or shown smaller
- Consider read-only display vs edit mode differently (read shows only non-empty fields)

## Files to Check/Update

```
web/src/components/Modals/PersonaEditor.tsx
web/src/components/Modals/PersonaCreator.tsx
web/src/components/Modals/EntityEditor.tsx  (if topics are edited here too)
```

## Testing

- [ ] Create new persona with topics → verify new structure
- [ ] Edit existing persona topics → verify all fields save
- [ ] Load persona with old `description` data → verify no crash
- [ ] Build passes

## Related

- **0123**: PersonaTopic Data Model Separation (backend complete)
- **0124**: Persona Topic Ceremony Redesign (backend complete)
