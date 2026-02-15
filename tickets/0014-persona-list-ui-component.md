# 0014: Persona List UI Component

**Status**: DONE
**Depends on**: 0008
**Epic**: E002 - MVP: Basic Chat

## Summary

Build the persona list sidebar component that displays available personas and allows switching between them. This is the left panel of the 3-panel layout. MVP version is functional — status indicators and hover controls come in E005.

## Acceptance Criteria

- [x] Create `src/ui/components/PersonaPanel.tsx` (or similar)
- [x] Display list of personas from `processor.getPersonaList()`
- [x] Each persona shows name (primary alias)
- [x] Each persona shows short_description (truncated if needed)
- [x] Active persona is visually highlighted
- [x] Clicking a persona switches to it (calls parent handler)
- [x] Archived personas are hidden (or shown separately)
- [x] Paused personas show some indicator (can be simple for MVP)
- [x] "Ei" appears first in the list (system persona)

## Technical Notes

### Persona Display

```tsx
// Minimal structure
<div className="persona-panel">
  <div className="persona-list">
    {personas.map(p => (
      <div 
        key={p.name}
        className={`persona-pill ${p.name === activePersona ? 'active' : ''}`}
        onClick={() => onSelectPersona(p.name)}
      >
        <span className="name">{p.name}</span>
        <span className="description">{p.short_description}</span>
        {p.is_paused && <span className="paused-badge">⏸</span>}
      </div>
    ))}
  </div>
</div>
```

### Data Contract

```typescript
interface PersonaSummary {
  name: string;
  aliases: string[];
  short_description?: string;
  is_paused: boolean;
  is_archived: boolean;
  unread_count: number;
  last_activity?: string;
}
```

### From Backward Doc

> "Each Persona should have a single-line 'Pill' with an image on the left... Bold name, smaller normal text description right after it."

For MVP, skip the image. Just name + description in a pill.

> "Their image should feature a 'Status circle' in the bottom right"

MVP: Simple text badge. Full status indicators in ticket 0041.

### Filtering

- Filter out `is_archived === true` by default
- Sort: Ei first, then by `last_activity` descending (most recent first)

### Integration

Parent component:
1. Calls `processor.getPersonaList()` on mount and after persona events
2. Tracks `activePersona` state
3. Passes list + active + handler to PersonaPanel

## Out of Scope (Later Tickets)

- Status indicators with colors (0041)
- Hover controls (pause/edit/archive/delete) (0042)
- Unread count badges
- New persona button
- Archived personas section
- Persona images
