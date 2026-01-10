# 0011: Responsive Terminal Layout

**Status**: VALIDATED

## Summary

Adapt UI layout based on terminal dimensions. Full 3-pane layout for large terminals, simplified single-pane for constrained terminals.

## Problem

The 3-pane layout (personas | chat | input) requires reasonable terminal width. In a 57x23 pane (Flare's normal setup), horizontal space is tight.

## Proposed Solution

### Breakpoints

| Terminal Width | Layout |
|----------------|--------|
| >= 100 cols    | Full 3-pane (personas + chat + input) |
| 60-99 cols     | 2-pane (chat + input, persona bar at top) |
| < 60 cols      | Single pane (classic AIM style, commands for persona) |

### Layout Variants

**Full (>=100 cols):**
```
┌─Personas─┬─────────Chat: ei──────────┐
│ > ei     │ You: Hey                  │
│   mike   │ EI: What's up?            │
├──────────┼───────────────────────────┤
│          │ > _                       │
└──────────┴───────────────────────────┘
```

**Medium (60-99 cols):**
```
┌─[ei] mike lena beta─────────────────┐
│ You: Hey                            │
│ EI: What's up?                      │
├─────────────────────────────────────┤
│ > _                                 │
└─────────────────────────────────────┘
```

**Compact (<60 cols):**
```
┌─Chat: ei────────────────────────────┐
│ You: Hey                            │
│ EI: What's up?                      │
├─────────────────────────────────────┤
│ > _                                 │
└─────────────────────────────────────┘
```

### Implementation

```tsx
const { columns } = useStdout();

if (columns >= 100) return <FullLayout />;
if (columns >= 60) return <MediumLayout />;
return <CompactLayout />;
```

### Resize Handling

- Detect terminal resize events
- Re-render with appropriate layout
- Preserve scroll position and input content

## Acceptance Criteria

- [x] Layout adapts to terminal width
- [x] All three variants render correctly
- [x] Resize triggers layout recalculation
- [x] Content preserved during resize
- [x] Persona switching works in all layouts

## Value Statement

EI works well in any terminal configuration, from full-screen to split panes.

## Dependencies

- Ticket 0010 (basic ink layout)

## Effort Estimate

Small-Medium: ~2-3 hours
