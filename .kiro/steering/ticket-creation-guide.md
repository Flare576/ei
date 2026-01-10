---
inclusion: always
---

# Ticket Creation Guide

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
- Review similar existing tickets
- Ensure consistency with architecture patterns
- Verify it follows EI conventions (persona-centric, AbortController, etc.)

**Update related documentation:**
- Add to `/help` command if user-facing
- Update steering files if it changes workflows
- Consider impact on AGENTS.md guidance

## Testing-Focused Tickets

When creating tickets that enable testing (like 0029), include:
- Clear automation benefits in Value Statement
- Specific testing scenarios in Acceptance Criteria
- Force/bypass options for programmatic control
- Notes on how this enables future test development

## Ticket Lifecycle Reminders

- Start status is always `PENDING`
- Only humans can set `VALIDATED` status
- Agents can set `DONE` when implementation complete
- Never delete tickets - they're project history
- Update acceptance criteria checkboxes during development