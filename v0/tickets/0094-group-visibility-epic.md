# 0094: Group-Based Concept Visibility System (Epic)

**Status**: DONE

## Summary
Replace boolean mingle flag concept with flexible group-based visibility system. Personas belong to groups, human concepts are tagged with groups, and visibility is determined by group membership. This enables nuanced privacy controls (e.g., work personas see work concepts, personal personas see personal concepts, reviewer personas see everything).

## Value Statement
- **Privacy**: Sensitive topics stay with appropriate personas
- **Context quality**: Each persona sees relevant concepts, reducing noise
- **Flexibility**: Reviewer/meta personas can see across groups
- **Natural mental model**: Groups are intuitive (work, personal, hobbies, etc.)

## Design Principles
1. **Implied visibility**: `group_primary` automatically grants visibility to that group's concepts
2. **Ei sees all**: System persona always has `groups_visible: ["*"]`
3. **Global concepts**: Concepts with empty `persona_groups` visible to all
4. **Orphaned concepts**: Concepts with groups no persona references become Ei-only until rediscovered

## Example Usage

```
# User creates personas
/persona Gandalf
/g Fellowship

/persona Sauron
/g "LotR Jerks"

/persona "Book Reviewer"
/gs Fellowship
/gs "LotR Jerks"
```

**Result**:
- Gandalf sees Fellowship concepts + global concepts
- Sauron sees "LotR Jerks" concepts + global concepts
- Book Reviewer sees Fellowship + "LotR Jerks" + global concepts
- Ei sees everything

**Concept tagging**:
- Concepts discussed with Gandalf get `persona_groups: ["Fellowship"]`
- Concepts discussed with both get `persona_groups: ["Fellowship", "LotR Jerks"]`
- Book Reviewer (no primary group) creates global concepts

## Stories

| Ticket | Title | Effort | Dependencies |
|--------|-------|--------|--------------|
| 0095 | Schema Changes - Group Fields | Small | None |
| 0096 | Concept Visibility Filtering | Medium | 0095 |
| 0097 | Concept Group Assignment Logic | Medium | 0096 |
| 0098 | Group Management Commands | Medium | 0095 |
| 0099 | Group-Based Persona Visibility | Medium | 0095 |
| 0100 | Epic Cleanup - Finalize Schema | Small | 0095-0099 |

**Parallelizable**: 0097, 0098, 0099 can run in parallel after 0096

## Acceptance Criteria
- [ ] User can assign personas to groups via `/g` command
- [ ] User can grant cross-group visibility via `/gs` command
- [ ] Concepts automatically tagged with persona's primary group
- [ ] Concepts accumulate groups as different personas discuss them
- [ ] Personas see only concepts from their visible groups (+ global concepts)
- [ ] Personas see only other personas from their visible groups
- [ ] Ei maintains special-case visibility to everything
- [ ] Orphaned concepts (groups with no personas) become Ei-only
- [ ] No deprecated schema fields or migration code remains
- [ ] All tests pass
- [ ] Documentation reflects new group-based system

## Technical Notes

### Migration
No migration needed - clean slate approach. Final cleanup story (0100) removes any accumulated migration cruft from earlier redesigns.

### Supersedes
- 0049: Mingle Flag for Persona Cross-Awareness (CANCELLED - replaced by this epic)

## Effort Estimate
~14-18 hours total

## Dependencies
- Existing persona metadata system
- Prompt generation system
- Concept map update system
