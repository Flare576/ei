# 0087: Persona Creator Modal

**Status**: DONE
**Depends on**: 0086

## Summary

Modal for creating new personas with AI-assisted field generation.

## Acceptance Criteria

- [x] Name field: comma-delimited aliases
- [x] Description field: multi-line with AI assist button
- [x] Expandable sections:
  - [+ Add Personification]
  - [+ Add Communication Style]
  - [+ Add Relationships]
  - [+ Add Topics of Interest]
  - [Select LLM Model]
- [x] Each section adds Trait cards with help text
- [x] AI button on each field for generation assist (uses One-Shot system)
- [x] Help text: "In a hurry? We'll pre-fill based on description"
- [x] On submit: If no traits/topics, generate from description
- [x] Long descriptions get auto-summarized for short_description

## Notes

**V1 Backward Reference**:
- "Initial interface is deceptively simple"
- "Each field should have an AI button"
- "Whatever is in Description when user submits should be starting description"
- "If zero Traits/Topics, generate a few based on description"
