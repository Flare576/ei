# 0115: Fact Validation TUI

**Status**: PENDING
**Depends on**: 0113, 0100

## Summary

Add `/validate` command to the TUI for reviewing and validating facts.

## Acceptance Criteria

### List Mode

- [ ] `/validate` with no args lists all facts with their validation status
- [ ] Display format:
  ```
  # Facts (3 unvalidated, 5 validated)
  
  [1] Birthday: May 26, 1984          ✓ Validated
  [2] Occupation: Software Engineer   ○ Unvalidated
  [3] Location: Unknown               ○ Unvalidated (Ei notified)
  [4] Spouse: Sarah                   ✓ Validated
  ...
  ```
- [ ] Show validation status: `✓ Validated`, `○ Unvalidated`, `○ Unvalidated (Ei notified)`
- [ ] Sort: Unvalidated first, then by name

### Validate Mode

- [ ] `/validate 2` - Validate fact by index
- [ ] `/validate "Occupation"` - Validate fact by name (partial match OK)
- [ ] `/validate 2 "Senior Software Engineer"` - Validate AND update value
- [ ] `/validate "Occupation" "Senior Software Engineer"` - Same, by name
- [ ] On validate:
  - Set `validated: "human"`
  - Set `validated_date: now()`
  - If value provided, update `description` field
  - Confirm: `✓ Validated: Occupation = Senior Software Engineer`

### Invalidate Mode

- [ ] `/validate --reset 2` or `/validate -r 2` - Reset validation to "none"
- [ ] Confirm: `○ Reset: Occupation (was validated)`

### Edge Cases

- [ ] Multiple partial matches: Show disambiguation list, don't auto-pick
- [ ] No matches: `No fact matching "xyz" found`
- [ ] Already validated: Still accept (idempotent), show `✓ Already validated: Birthday`

## Notes

**Why not `/invalidate`**: Flare considered separate commands but decided against it. If you're editing facts, you'd just set them correctly rather than "invalidate" them. The `--reset` flag covers the rare case where you want to unlock without changing the value.

**Index stability**: Indices are for the current list view only. If the user runs `/validate` again, indices may change if new facts were added.

**TUI dependency**: This requires the TUI skeleton (0100) to be in place first.
