# 0049: Mingle Flag for Persona Cross-Awareness

**Status**: CANCELLED

> **Superseded by**: 0094 (Group-Based Concept Visibility System Epic)
> The group-based visibility system provides more flexible and nuanced control over persona cross-awareness than the binary mingle flag.

## Summary
Implement "mingle" flag system to control which personas are aware of each other, with default mingle behavior and `/reserved` command to opt out.

## Problem
All personas currently know about each other through the system, but users may want some personas to be private or unaware of others. Need granular control over persona cross-awareness without confusing visibility rules.

## Proposed Solution
Implement mingle flag system with intuitive defaults:

```typescript
// Persona metadata addition
interface PersonaMetadata {
  mingle: boolean;  // Default: true
}

// Commands
/reserved [persona]    // Sets persona to non-mingle (private)
/mingle [persona]      // Sets persona to mingle (default)
/status               // Shows mingle status of all personas
```

**Mingle behavior:**
- Default: All new personas have `mingle: true`
- Mingle personas know about all other mingle personas
- Reserved personas only know about themselves
- EI (system persona) always knows about all personas
- Reserved personas don't appear in other personas' awareness

## Acceptance Criteria
- [ ] New personas default to `mingle: true` in metadata
- [ ] `/reserved` sets active persona to non-mingle status
- [ ] `/reserved <name>` sets specified persona to non-mingle
- [ ] `/mingle` restores persona to mingle status (default)
- [ ] Mingle personas receive awareness of other mingle personas in prompts
- [ ] Reserved personas don't receive awareness of other personas
- [ ] Reserved personas don't appear in other personas' context
- [ ] EI system persona maintains awareness of all personas regardless
- [ ] `/status` command shows mingle flag for all personas
- [ ] `/help` command documents mingle/reserved syntax and behavior
- [ ] Mingle status persists in persona metadata files

## Value Statement
Provides privacy control and reduces context complexity by allowing users to create private personas or limit cross-persona awareness for focused conversations.

## Dependencies
- Existing persona metadata system
- Prompt generation system (for persona awareness)

## Effort Estimate
Medium (~3-4 hours)