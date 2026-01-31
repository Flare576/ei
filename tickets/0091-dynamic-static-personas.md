# 0091: Dynamic vs Static Personas

**Status**: DONE
**Depends on**: 0086, 0070

## Summary

Implement Static persona mode that skips all adaptive behaviors.

## Acceptance Criteria

- [x] `is_static` field on PersonaEntity (default: false)
- [x] Toggle in Persona Editor Settings tab
- [x] Static personas skip:
  - Exposure phase
  - Decay phase
  - Expire phase
  - Explore phase
  - Description regeneration
  - Image regeneration
- [x] Static personas still:
  - Read human data (traits, topics, etc.)
  - Respond to messages
  - Track unread status
- [x] Help text explains use case (e.g., story co-writer)

## Notes

**V1 Backward Reference**:
- "Dynamic vs Static: I know there's one persona I do NOT want adapting - my Story Co-Writer"
- "If that persona constantly adapted, impossible to write story with 2+ characters"
- Static means: "Don't do Exposure, Decay, Expire, Explore; Don't regenerate descriptions/image; Don't add HumanEntity records"
