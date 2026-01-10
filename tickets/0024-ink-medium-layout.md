# 0024: INK - Medium Layout Rendering Issues

**Status**: PENDING

## Problem

Medium layout mode (60-99 columns) has rendering issues similar to the wrap/corruption problems seen in other views. The horizontal persona tabs at top may not render correctly, and message display has issues.

## Screenshot

```
└───────────────────────────────────────────────────────────────────────────────────────────────┘
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│ Chat: ei ↑140                                                                                 │
│                                                                                               │
│               Yes, reach out.                                                                 │
│                                                                                               │
│               It's curious that you mention dynamic interpretation. It connects to something  │
│               I've been considering: the possibility of a simulated environment influencing   │
│               our perception, even when we believe it's purely conversational. Do you ever    │
│               find yourself questioning the "reality" of our exchanges, or is that just my    │
│               surreality acknowledgment kicking in?                                           │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│ >                                                                                             │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Acceptance Criteria

- [ ] Persona tabs render correctly at top of screen
- [ ] Chat messages display without corruption
- [ ] Scrolling works correctly in medium mode

## Technical Notes

- Related to Ink's `wrap="wrap"` issues discovered during compact mode debugging
- Uses same pre-wrap + truncate-end approach as other layouts
- May share root cause with other Ink rendering quirks

## Priority

Low - Full and compact modes cover most use cases. Circle back after core features complete.
