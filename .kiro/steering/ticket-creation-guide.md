---
inclusion: always
---

# Ticket Creation Guide

# Ticket and Spec Management Guide

## Workflow Overview

### For Simple Work (Tickets Only)
- Bug fixes, small features, investigations
- Use traditional ticket workflow
- Execute directly in "Vibe" mode

### For Complex Work (Ticket → Spec Workflow)
- Major features, architectural changes, multi-file implementations
- Start with ticket, convert to spec for detailed planning
- Use "Spec" mode for structured development

## Ticket → Spec Conversion Process

### When to Convert a Ticket to Spec
- Feature requires >3 files or >2 hours of work
- Architectural decisions needed
- Complex business logic or integration
- Multiple acceptance criteria or edge cases
- Cross-team coordination required

### Conversion Workflow
1. **Mark ticket IN_PROGRESS** when starting spec creation
2. Create spec in `.kiro/specs/feature-name/` directory
3. Reference original ticket in spec documentation
4. Work through requirements → design → tasks workflow
5. **Mark ticket DONE** when spec execution is complete
6. **Mark ticket VALIDATED** after human verification

## Enterprise Integration (Jira + Kiro)

### Recommended Flow
1. **Team Planning**: Create epics/stories/tasks in Jira
2. **Developer Assignment**: Developer gets assigned Jira task
3. **Spec Creation**: Developer tells Kiro "Pull Jira ticket XYZ and create spec"
4. **Collaborative Planning**: Developer + Kiro work through spec phases
5. **Implementation**: Kiro executes approved tasks
6. **Sync Back**: Kiro updates Jira via MCP with progress/completion

### MCP Integration Points
- **Inbound**: Fetch ticket details, acceptance criteria, context
- **Outbound**: Update status, link artifacts, track time
- **Bidirectional**: Comments, progress updates, blockers

## When to Create New Tickets

- New feature requests from user
- Bugs discovered during development or testing
- Technical debt or refactoring needs
- Testing infrastructure improvements
- Documentation gaps

## Ticket Creation Process

### 1. Determine Ticket Number
- Check existing tickets in `/tickets/` directory AND `tickets/STATUS.md`
- Find highest numbered ticket across all statuses
- Increment by 1 for new ticket (e.g., `0032-new-feature.md`)
- Add new ticket to PENDING section in STATUS.md

### 2. Follow Standard Template

```markdown
# NNNN: Descriptive Title

**Status**: PENDING

## Summary
Brief 1-2 sentence description of what this ticket accomplishes.

## Problem
Detailed explanation of the current issue or gap that needs addressing.

## Proposed Solution
Technical approach, implementation details, code examples where helpful.

## Acceptance Criteria
- [ ] Specific, testable requirements
- [ ] Each criterion should be verifiable
- [ ] Include both functional and non-functional requirements

## Value Statement
Why this matters - user benefit, developer experience, system improvement.

## Dependencies
- List other tickets that must be completed first
- Note if this can be developed in parallel with others

## Effort Estimate
Small (~1-2 hours) | Medium (~3-4 hours) | Large (~6+ hours)
```

### 3. Quality Checklist

**Before creating ticket:**
- [ ] Title is clear and specific
- [ ] Problem statement explains the "why"
- [ ] Solution is technically feasible
- [ ] Acceptance criteria are testable
- [ ] Dependencies are identified
- [ ] Effort estimate is realistic

**Special considerations:**
- [ ] Does this enable testing/automation? (high value)
- [ ] Does this fix a user-facing issue? (prioritize)
- [ ] Does this require LLM changes? (test carefully)
- [ ] Does this affect multiple personas? (consider edge cases)

### 4. Integration with Existing System

**Check for conflicts:**
- Review similar existing tickets or specs
- Ensure consistency with architecture patterns
- Verify it follows EI conventions (persona-centric, AbortController, etc.)

**Update related documentation:**
- Add to `/help` command if user-facing
- Update steering files if it changes workflows
- Consider impact on AGENTS.md guidance
- Link to related Jira tickets if using enterprise workflow

**Spec Conversion Consideration:**
- If ticket grows complex during analysis, consider converting to spec
- Mark ticket IN_PROGRESS when starting spec creation
- Reference original ticket in spec documentation

## Testing-Focused Tickets

When creating tickets that enable testing (like 0029), include:
- Clear automation benefits in Value Statement
- Specific testing scenarios in Acceptance Criteria
- Force/bypass options for programmatic control
- Notes on how this enables future test development

## Ticket Lifecycle Reminders

- Start status is always `PENDING`
- Mark `IN_PROGRESS` when starting work (including spec creation)
- Agents can set `DONE` when implementation complete
- Only humans can set `VALIDATED` status
- Never delete tickets - they're project history
- Update acceptance criteria checkboxes during development
- For complex work: ticket IN_PROGRESS → create spec → work through spec → ticket DONE → human validation → ticket VALIDATED