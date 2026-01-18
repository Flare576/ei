# 0100: Epic Cleanup - Finalize Schema

**Status**: PENDING

## Summary
Remove deprecated migration code, clean up old schema references, cancel superseded tickets, and finalize codebase around group-based system.

## Parent Epic
0094: Group-Based Concept Visibility System

## Tasks

### 1. Cancel Superseded Tickets
- [ ] Update 0049 (Mingle Flag) status to CANCELLED with note "Superseded by 0094 epic"
- [ ] Update STATUS.md to reflect cancellation

### 2. Audit Codebase for Deprecated Fields
Search for and remove any references to:
- `mingle` boolean field (from 0049 design that was never implemented)
- Any old concept schema fields no longer used
- Migration code from previous redesigns (0061, 0069 epics)

### 3. Remove Migration Code (if any exists)
- Old persona format migrations
- Old concept format migrations  
- Temporary backward-compatibility shims
- TODO/FIXME comments referencing old schemas

### 4. Consolidate Validation
- Single source of truth for PersonaMetadata schema
- Single source of truth for HumanConcept schema
- Consistent validation across load/save paths
- Ensure all optional fields have proper defaults

### 5. Update Documentation
- `AGENTS.md` - Add group schema details to "Concept Schema" section
- `/help` command - Verify `/g` and `/gs` commands documented
- Code comments - Remove outdated references

### 6. Final Verification
- All tests pass with finalized schema
- No TypeScript errors related to schema
- Clean `npm run build`
- Spot-check that groups work end-to-end

## Acceptance Criteria
- [ ] Ticket 0049 marked as CANCELLED in both ticket file and STATUS.md
- [ ] No references to `mingle` field in codebase (grep verification)
- [ ] No migration code for pre-group schema versions
- [ ] Schema validation consolidated and consistent
- [ ] `AGENTS.md` updated with group schema details under "Concept Schema" section
- [ ] `/help` command includes `/g` and `/gs` documentation
- [ ] No TODO/FIXME comments referencing old schema designs
- [ ] All tests pass
- [ ] `npm run build` succeeds with no errors
- [ ] Manual verification: create persona, assign group, concepts get tagged correctly

## Dependencies
- 0095: Schema Changes - Group Fields
- 0096: Concept Visibility Filtering
- 0097: Concept Group Assignment Logic
- 0098: Group Management Commands
- 0099: Group-Based Persona Visibility

## Effort Estimate
Small (~1-2 hours)
