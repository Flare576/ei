# 0125: Group Chat Exploration (Future)

**Status**: PENDING

## Summary

**FUTURE FEATURE** - Explore the feasibility and design of multi-persona group conversations. This is both "absolutely awesome" and "completely terrifying" (per Flare).

## Problem Statement

Currently, conversations are 1:1 (human ↔ persona). What if multiple personas could participate in a conversation together?

**Scenario**: User wants to discuss a problem with both "Therapist Lena" and "Logical Larry" at the same time, getting different perspectives in one conversation.

## Why This Is Hard

### Technical Challenges

1. **Turn-taking**: Who speaks when? How do we prevent ping-pong or silence?
2. **Context management**: Each persona needs to see the full group conversation
3. **Prompt complexity**: N personas = N different system prompts all referencing each other
4. **Message attribution**: Clear visual indication of who's speaking
5. **Queue coordination**: Multiple personas processing same message simultaneously
6. **Extraction coordination**: Do all personas extract from the same messages? Race conditions?

### Analytical Challenges

1. **Inter-persona dynamics**: Do personas "know about" each other's personalities?
2. **Hierarchy**: Is there a conversation moderator/leader?
3. **Disagreement handling**: What if two personas contradict each other?
4. **Cross-talk**: Personas referencing/responding to each other, not just human
5. **Group cohesion**: Does the group have shared topics/context?

### Implementation Challenges

1. **UI/UX**: How to display multi-persona chat in current 3-pane layout?
2. **Command semantics**: `/switch` doesn't make sense, need new commands
3. **History storage**: Single shared history or per-persona views?
4. **Heartbeats**: Do all group members heartbeat? Coordinated or independent?
5. **Data isolation**: If one persona is in roleplay context, does that contaminate others?

## Current Limitation to Note

**From 0107 design**: Personas have no `people` field - they can't track relationships with other personas beyond the `visiblePersonas` list.

This means:
- Personas can see each other exist (via `visiblePersonas`)
- Personas have no concept of "relationship strength" with other personas
- No built-in way to model "Frodo and Gandalf are close friends"

**Is this a blocker?** Maybe not - personas could have topics like "Gandalf (fellow adventurer)" if needed.

## Potential Approaches

### Option A: Simple Round-Robin

- User sends message to group
- Personas respond in fixed order (alphabetical?)
- Each sees previous responses before generating theirs
- Simplest to implement, feels rigid

### Option B: Priority-Based

- Each persona calculates "response relevance" score
- Highest scoring persona(s) respond
- More dynamic, but coordination complexity

### Option C: Moderator Pattern

- One persona (maybe Ei?) acts as moderator
- Moderator decides who should respond and when
- Adds layer of intelligence, but Ei becomes bottleneck

### Option D: Free-for-All with Throttling

- All personas can respond anytime
- System throttles to prevent spam (max N responses per minute)
- Most natural feeling, hardest to implement well

## Questions to Answer (Future)

1. **Core value**: What problem does group chat solve that sequential 1:1 doesn't?
2. **Common use case**: What's the primary scenario this enables?
3. **Conversation model**: Turn-based, async, realtime?
4. **Data model**: How do personas reference each other in their data?
5. **UI constraints**: Can current terminal UI support this, or need full rewrite?

## Recommendation

**Don't tackle this in 0107 epic.** Focus on getting the core entity architecture solid first. 

Once we have:
- Solid 1:1 conversations with new architecture
- Ei orchestration working
- Data extraction stable
- User feedback on the system

THEN revisit group chat with better understanding of:
- What users actually want from multi-persona interaction
- Whether the architecture supports it or needs changes
- Whether it's worth the complexity

## If We Do Pursue It

### Prerequisites

1. Stable entity architecture (0107 complete)
2. User testing of 1:1 interactions
3. Clear use case definition
4. UI/UX mockups or design
5. Technical spike on coordination challenges

### Potential Phasing

1. **Phase 1**: Static groups, round-robin, single shared history
2. **Phase 2**: Dynamic relevance scoring, smarter turn-taking
3. **Phase 3**: Personas referencing each other, relationship modeling
4. **Phase 4**: Free-form conversation with coordination

## Acceptance Criteria

- [ ] N/A - this is an exploration ticket, not implementation

## Effort Estimate

**Exploration**: Small (~2 hours to document challenges and approaches)
**Implementation**: Unknown - probably Large (15-30 hours) depending on approach

## Notes

This ticket exists to capture the idea and note the limitation. It's explicitly marked as **FUTURE** and should not block 0107 epic completion.
