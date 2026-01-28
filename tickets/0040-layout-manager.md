# 0040: Layout Manager (3-panel, responsive)

**Status**: DONE
**Depends on**: 0013, 0014

## Summary

Implement the 3-panel layout system: Persona panel (left), Chat panel (center), Input box (bottom of center). Must be responsive and handle narrow viewports gracefully.

## Acceptance Criteria

- [x] Left panel: Full-height Persona panel with control area at top
- [x] Center panel: Chat history + input box
- [x] Panel proportions maintain usability at various widths
- [x] Narrow viewport: Persona panel collapses to dropdown at top
- [x] Panel dividers allow resize (desktop only)
- [x] Layout state persists across sessions (via settings)

## Notes

**V1 Backward Reference** (v1_backward.md):
- "3-panel type of chat interface"
- "thin" layout = dropdown personas at top + compact chat

**Mobile**: Desktop-first. Narrow breakpoint gets dropdown persona selector.

## Implementation

- `web/src/components/Layout/` - Component directory
  - `Layout.tsx` - Main 3-panel layout with resize divider
  - `PersonaPanel.tsx` - Left panel with persona list
  - `ChatPanel.tsx` - Center panel with messages and input
  - `ControlArea.tsx` - Top of left panel (placeholder for future controls)
- `web/src/styles/layout.css` - Complete CSS with CSS custom properties, dark mode ready
- Layout state saved to localStorage under `ei_layout_state`
