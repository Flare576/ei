# 0098: Group Management Commands

**Status**: PENDING

## Summary
Implement `/group` (`/g`) and `/groups` (`/gs`) commands for managing persona group membership.

## Parent Epic
0094: Group-Based Concept Visibility System

## Command Spec

### Primary Group (`/group`, `/g`)

Single value - determines which group concepts get tagged with.

```bash
/g              # Show current primary group
/g Fellowship   # Set primary group to "Fellowship"
/g clear        # Clear primary group (set to null)

# Edge case
/g set Foo      # Error: /g only takes one argument (or "clear")
```

### Visible Groups (`/groups`, `/gs`)

List of additional groups persona can see (primary is always implied).

```bash
/gs                      # List visible groups
/gs "LotR Jerks"         # Add "LotR Jerks" to visible groups
/gs remove "LotR Jerks"  # Remove "LotR Jerks" from visible groups
/gs clear                # Clear all visible groups
```

## Behavior Notes
- Setting `group_primary` does NOT automatically add to `groups_visible` (visibility implied)
- Adding `group_primary` value to `groups_visible` should warn: "Fellowship is already your primary group"
- Clearing `group_primary` leaves `groups_visible` intact
- Groups are free-form strings (no predefined list, no validation against existing groups)
- Groups with spaces require quotes: `/g "My Group Name"`
- Commands only work on current persona (cannot target other personas)

## Display Format

```
# /g when set
Primary group: Fellowship

# /g when not set
Primary group: (none)

# /gs with groups
Visible groups: Fellowship (primary), Personal, Work

# /gs with no additional groups
Visible groups: Fellowship (primary)

# /gs with no groups at all
Visible groups: (none)
```

## Error Messages

```
# /g set Foo
Error: /g takes one argument (group name) or "clear"

# /gs Fellowship (when Fellowship is primary)
Note: "Fellowship" is already visible as your primary group

# /g or /gs on Ei
Error: Ei's groups are managed by the system
```

## Acceptance Criteria
- [ ] `/g` displays current primary group (or "none")
- [ ] `/g Fellowship` sets primary group to "Fellowship"
- [ ] `/g "My Group"` handles quoted group names with spaces
- [ ] `/g clear` sets primary group to null
- [ ] `/group` works as full command (alias of `/g`)
- [ ] `/gs` lists visible groups, showing "(primary)" marker for primary group
- [ ] `/gs Personal` adds "Personal" to visible groups
- [ ] `/gs Personal` warns if "Personal" is already primary group (but still works for non-primary)
- [ ] `/gs remove Personal` removes "Personal" from visible groups
- [ ] `/gs clear` empties visible groups array
- [ ] `/groups` works as full command (alias of `/gs`)
- [ ] Changes persist to persona metadata file immediately
- [ ] `/help` documents `/g` and `/gs` commands with examples
- [ ] Commands error gracefully when used on Ei persona
- [ ] Error messages guide user when used incorrectly

## Dependencies
- 0095: Schema Changes - Group Fields

## Effort Estimate
Medium (~2-3 hours)
