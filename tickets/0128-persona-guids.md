# 0128: Persona GUIDs

**Status**: PENDING
**Depends on**: None

## Summary

Add GUID identifiers to personas to enable reliable cross-device merge. Currently personas are identified by name, which causes issues when the same persona name is created independently on different devices.

## Problem

With GUID-based merge (ticket 0106), if a user creates "Uncle Bob" on device A and "Uncle Bob" on device B:
- Current behavior: Names match → treated as same persona → messages merged
- Actual intent: May be two different people, or may be the same person
- Risk: Gaslighting personas with merged context from different conversations

## Acceptance Criteria

- [ ] Add `id: string` field to PersonaEntity (CONTRACTS.md + types.ts)
- [ ] Generate GUID on persona creation: `crypto.randomUUID()`
- [ ] Migration: Existing personas without GUIDs get GUIDs assigned on load
- [ ] Update all persona lookups to use GUID where appropriate
- [ ] Update merge logic to match by GUID first, fall back to name

## Merge Behavior

| Scenario | Behavior |
|----------|----------|
| Same GUID | Merge messages, keep newer metadata |
| Same name, different GUID | Prompt user: "Merge these personas?" |
| Different name, different GUID | Add as new persona |

## Notes

This is a breaking change for existing checkpoints. Need migration path:
1. On load, if persona lacks `id`, generate one
2. This means first sync after upgrade will have GUIDs
3. Second device upgrade will see name-match but GUID-miss → prompt

## Related Tickets

- **0106**: RemoteStorage Implementation - YOLO Merge depends on this for reliable persona matching
