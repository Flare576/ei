# 0109: OpenCode Agent Persona Bootstrap

**Status**: DONE
**Depends on**: 0102

## Summary

Create personas for OpenCode agents on-demand during session import. Each unique agent encountered becomes a static persona with minimal metadata.

## Acceptance Criteria

- [x] Function: `ensureAgentPersona(agentName: string): Promise<PersonaEntity>`
- [x] Creates persona if not exists, returns existing if found
- [x] `name` = agentName (e.g., "sisyphus", "build", "atlas")
- [x] `short_description` = Agent.description from OpenCode, or "OpenCode coding agent"
- [x] `long_description` = Generic: "An OpenCode agent that assists with coding tasks."
- [x] `is_dynamic: false` (no ceremony phases)
- [x] `heartbeat_delay_ms: 0` (disabled - never initiates)
- [x] `group` = "OpenCode"
- [x] No traits generated (static persona)
- [x] No topics generated (static persona)
- [x] Aliases: `[agentName]` (no additional aliases)

## Notes

### Why Minimal?

OpenCode agents don't have rich personality definitions we can import. Rather than hallucinate traits, we:
1. Start with name + description only
2. Let Human-side extraction capture topics naturally
3. Allow future enhancement to generate traits from message history

### Agent Description Sources

Priority order:
1. OpenCode Agent.Info.description (from config)
2. Built-in defaults:
   - "build" → "The default OpenCode agent for executing tasks"
   - "explore" → "Fast agent specialized for exploring codebases"
   - "plan" → "Planning agent that creates implementation plans"
   - Other → "OpenCode coding agent"

### Static Persona Behavior

Static personas (`is_dynamic: false`):
- Skip all Ceremony phases
- No heartbeat checks
- No trait/topic generation
- Messages come from imports, not direct chat
- Still visible in persona list
- Still participate in cross-persona context (other personas can reference)

### Future Enhancement

Once we have message history, we could:
1. Run a "persona extraction" prompt on first N messages
2. Generate traits and long_description from observed patterns
3. This would be a separate ticket (one-time enhancement, not ongoing)
