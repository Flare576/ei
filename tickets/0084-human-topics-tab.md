# 0084: Human Topics Tab

**Status**: PENDING
**Depends on**: 0080

## Summary

Topics tab in Human entity editor showing interests and discussion topics.

## Acceptance Criteria

- [ ] Card-based list of topics
- [ ] Each card: Name, Description
- [ ] Sliders: Sentiment, Exposure Current, Exposure Desired
- [ ] Grouped by `persona_groups`
- [ ] Visual indicator when exposure_current ≠ exposure_desired (engagement gap)
- [ ] Add new topic button
- [ ] Delete topic (with confirmation)

## Notes

Topics have exposure fields instead of strength/confidence. The gap between current and desired is meaningful - it indicates topics the user wants to discuss more (or less).
