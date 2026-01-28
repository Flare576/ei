# 0040: Layout Manager (3-panel, responsive)

**Status**: PENDING
**Depends on**: 0013, 0014

## Summary

Implement the 3-panel layout system: Persona panel (left), Chat panel (center), Input box (bottom of center). Must be responsive and handle narrow viewports gracefully.

## Acceptance Criteria

- [ ] Left panel: Full-height Persona panel with control area at top
- [ ] Center panel: Chat history + input box
- [ ] Panel proportions maintain usability at various widths
- [ ] Narrow viewport: Persona panel collapses to dropdown at top
- [ ] Panel dividers allow resize (desktop only)
- [ ] Layout state persists across sessions (via settings)

## Notes

**V1 Backward Reference** (v1_backward.md):
- "3-panel type of chat interface"
- "thin" layout = dropdown personas at top + compact chat

**Mobile**: Desktop-first. Narrow breakpoint gets dropdown persona selector.
