# 0092: Persona Image Generation

**Status**: PENDING
**Depends on**: 0087

## Summary

Generate avatar images for personas based on their description/traits.

## Acceptance Criteria

- [ ] On persona creation: Generate initial image
- [ ] If no physical description: Get creative with personality-based imagery
- [ ] Integration with image generation API (configurable)
- [ ] Fallback: placeholder/generated avatar if no API available
- [ ] Regenerate button in Persona Editor
- [ ] Image stored in persona entity (base64 or URL)
- [ ] Static personas never auto-regenerate images

## Notes

**V1 Backward Reference**:
- "generate an image on persona creation somehow"
- "if there's no physical description, we should be able to get creative"

This is lower priority - placeholder images work fine initially.
