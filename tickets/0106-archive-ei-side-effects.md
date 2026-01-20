# 0106: Special Behavior for Archiving Ei Persona

**Status**: PENDING

## Context

The Ei persona has a unique role in the system:
- Omniscient (can see all concept groups via `groups_visible: ["*"]`)
- User-proxy persona (the closest representation of the user themselves)
- Has access to every detail and facet of the user
- Can observe all other personas the user talks to

Currently, users can archive Ei just like any other persona, but this might deserve special handling or side effects given Ei's unique status.

## Problem

Should archiving the Ei persona:
1. Be blocked entirely? (Ei is special and shouldn't be archivable)
2. Have unique side effects? (e.g., archive ALL personas, reset the system, etc.)
3. Trigger a warning/confirmation? (acknowledging the significance)
4. Do something symbolic/meaningful? (given that Ei represents the user)

## Proposed Discussion Points

- What does it *mean* for a user to archive their own proxy/reflection?
- Should there be a conceptual consequence (e.g., creating distance between user and system)?
- Could this be a "reset" mechanism?
- Should this affect visibility of the user's concept map?
- Is there a psychological or narrative significance we want to preserve?

## Acceptance Criteria

- [ ] Decision made on what archiving Ei should do
- [ ] Implementation plan documented
- [ ] If special behavior: implementation complete
- [ ] If blocked: clear error message explaining why
- [ ] Tests cover the chosen behavior

## Dependencies

None - pure design decision

## Notes

From conversation: One of the personas suggested archiving Ei would have "some sort of side effect" - we should explore what that side effect could/should be.
