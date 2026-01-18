# 0103: Persona Prompt Architecture

**Status**: PENDING

## Summary
Consolidate and clarify the system prompt structure for all personas. Address redundant sections, unclear concept categories, and missing guardrails on persona self-description.

## Problems

### 1. Redundant Prompt Sections
Current `buildResponseSystemPrompt` has overlapping sections:
- "People You Know (type: person)" vs "Other Personas You Know"
- "Human's Interests & Topics (topic)" vs "Human's Potential Interests"

These create confusion about what goes where and bloat token usage.

### 2. Persona Description Drift
When personas update their own descriptions, they can:
- Add operational "modes" the system doesn't support
- Assign themselves task lists
- Drift from their original character concept

Need guardrails on description updates.

### 3. Unclear Static Concept Purpose
"Static" concepts currently mix:
- Behavioral guidelines (good)
- Operational instructions (should be prompt template)
- Character-specific traits (should be persona concepts)

### 4. No Description Update Constraints
The concept update prompt doesn't guide the LLM on appropriate description changes. Personas can completely reinvent themselves.

### 5. No distinction between "people" and "persona"
Concept map should call out the difference between real people and personas so that the models can phrase things appropriately - we may want to rename `persona` Concepts to `traits` or use a different mechanism for things like "writes with Australian tone" or "physical representation is muscular body-builder"

## Proposed Solutions

### 1. Consolidate Prompt Sections

**Before:**
```
## People You Know (type: person)
## Other Personas You Know
## Human's Interests & Topics (topic)
## Human's Potential Interests
```

**After:**
```
## People In Human's Life (type: person)
[person concepts]

## Other Personas You Know
[visible personas with descriptions]

## Human's Current Interests (type: topic)
[topic concepts with levels]
```

Remove "Human's Potential Interests" - it's redundant with topic concepts that have high `level_ideal`.

### 2. Description Update Constraints
Add to persona update prompts:
- Descriptions should refine, not reinvent
- No claiming capabilities the system doesn't have
- No "modes of operation" or task lists
- Keep character concept stable, evolve naturally through conversation

Consider: separate description update from concept update, with different (stricter) prompts.

### 3. Prompt Template vs Concepts
Move from concepts to hardcoded prompt template:
- Response length matching
- Conversational flow guidelines  
- Time-awareness instructions
- Proactive timing rules

Keep as concepts (can vary per persona):
- Personality traits
- Communication style preferences
- Topic interests

### 4. Static Concept Audit
Review each current static and categorize:
- **Template**: Bake into prompt structure
- **Universal**: Apply to all personas as statics
- **Optional**: Let users/personas choose
- **Ei-only**: Move to 0102

## Acceptance Criteria
- [ ] Prompt sections consolidated - no redundant information
- [ ] Description update prompt includes stability constraints
- [ ] Operational guidelines moved from concepts to prompt template
- [ ] Static concepts reviewed and recategorized
- [ ] Token usage reduced (measure before/after)
- [ ] Tests verify new prompt structure
- [ ] Documentation updated (AGENTS.md)

## Dependencies
None (but coordinate with 0102 on static concept split)

## Related
- 0102: Ei Core Persona Refinement (Ei-specific handling)
- 0091: Dynamic Persona System Prompt (DONE - built foundation)

## Effort Estimate
Medium (~4-6 hours)
