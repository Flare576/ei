# 0087: Persona Creator Modal

**Status**: PENDING
**Depends on**: 0086

## Summary

Modal for creating new personas with AI-assisted field generation.

## Acceptance Criteria

- [ ] Name field: comma-delimited aliases
- [ ] Description field: multi-line with AI assist button
- [ ] Expandable sections:
  - [+ Add Personification]
  - [+ Add Communication Style]
  - [+ Add Relationships]
  - [+ Add Topics of Interest]
  - [Select LLM Model]
- [ ] Each section adds Trait cards with help text
- [ ] AI button on each field for generation assist (uses One-Shot system)
- [ ] Help text: "In a hurry? We'll pre-fill based on description"
- [ ] On submit: If no traits/topics, generate from description
- [ ] Long descriptions get auto-summarized for short_description

## Notes

**V1 Backward Reference**:
- "Initial interface is deceptively simple"
- "Each field should have an AI button"
- "Whatever is in Description when user submits should be starting description"
- "If zero Traits/Topics, generate a few based on description"
