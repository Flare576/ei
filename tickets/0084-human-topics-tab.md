# 0084: Human Topics Tab

**Status**: DONE
**Depends on**: 0080

## Summary

Topics tab in Human entity editor showing interests and discussion topics.

## Acceptance Criteria

- [x] Card-based list of topics
- [x] Each card: Name, Description
- [x] Sliders: Sentiment, Exposure Current, Exposure Desired
- [x] Grouped by `persona_groups`
- [x] Visual indicator when exposure_current ≠ exposure_desired (engagement gap)
- [x] Add new topic button
- [x] Delete topic (with confirmation)

## Notes

Topics have exposure fields instead of strength/confidence. The gap between current and desired is meaningful - it indicates topics the user wants to discuss more (or less).
