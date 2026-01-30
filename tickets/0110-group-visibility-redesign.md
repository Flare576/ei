# 0110: Group Visibility Redesign (* → General)

**Status**: PENDING
**Depends on**: None (can be done anytime, but UI changes depend on 0086)

## Summary

Replace the `*` wildcard group with explicit "General" group for clearer, more flexible group visibility control.

## Background

Current design uses `*` as a magic wildcard meaning "visible to all personas." This has problems:
- Implicit behavior hidden in code
- Cannot create truly isolated personas (they always see `*` data)
- User can't reason about it in the UI

New design makes visibility explicit:
- `group_primary`: Where facts learned by this persona get tagged
- `groups_visible`: List of groups this persona can READ from
- Effective visibility = `group_primary` + `groups_visible` (deduplicated)

## Acceptance Criteria

- [ ] Rename `*` to "General" in all existing data
- [ ] Update default persona creation:
  - `group_primary: "General"`
  - `groups_visible: ["General"]`
- [ ] Update data filtering logic to use explicit group membership instead of `*` wildcard
- [ ] Update UI to show "General" as a normal selectable group
- [ ] Document the visibility model in CONTRACTS.md

## Examples

**Default persona:**
```typescript
group_primary: "General"
groups_visible: ["General"]  // redundant but explicit
```
→ Sees General, writes to General

**Fellowship persona (Frodo, Gandalf):**
```typescript
group_primary: "Fellowship"
groups_visible: ["General"]  // keeps General visibility
```
→ Sees Fellowship (implicit from primary) + General (explicit)

**Isolated persona:**
```typescript
group_primary: "Hermit"
groups_visible: []  // no General!
```
→ Sees only Hermit. Truly walled off.

## Migration

1. Scan all HumanEntity data items (facts, traits, topics, people)
2. Replace `group: "*"` with `group: "General"` (or equivalent field)
3. Scan all PersonaEntity records
4. If `group_primary` is null/undefined, set to "General"
5. If `groups_visible` is empty/undefined, set to `["General"]`

## Notes

- The redundancy in defaults (`group_primary` and `groups_visible` both "General") is intentional
- When user changes `group_primary` to "Fellowship", they don't lose General visibility because it's still in `groups_visible`
- This enables true persona isolation by simply not including "General" in `groups_visible`
- TUI will benefit from this explicit model (e.g., `/group "MyGroup"` command)
