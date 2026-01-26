# 0123: Update AGENTS.md Documentation

**Status**: QA

## Summary

Update AGENTS.md to reflect the new entity data architecture, replacing all concept-related documentation.

## Sections to Update

### Project Structure
Update to show new file organization:
```
data/
  human.jsonc              # Human entity (facts, traits, topics, people)
  llm_queue.jsonc          # Persistent LLM operation queue
  extraction_state.jsonc   # Extraction frequency tracking
  ei_state.jsonc           # Ei-specific state (rate limits, preferences)
  personas/
    ei/
      system.jsonc         # Ei persona entity
      history.jsonc        # Conversation history
    {persona}/
      system.jsonc         # Persona entity (traits, topics)
      history.jsonc        # Conversation history
```

### Remove "Concept Schema" Section
Replace entirely with new sections.

### New Section: Entity Data Model

```markdown
### Entity Data Model

EI uses structured data buckets instead of a flat concept list.

#### Human Entity

The human (user) has four data buckets:

| Bucket | Purpose | Fields |
|--------|---------|--------|
| **Facts** | Biographical data | name, description, sentiment, confidence, last_confirmed |
| **Traits** | Personality patterns | name, description, sentiment, strength |
| **Topics** | Discussable subjects | name, description, sentiment, level_current, level_ideal |
| **People** | Relationships | name, relationship, description, sentiment, level_current, level_ideal |

#### Persona Entity

Personas have two data buckets:

| Bucket | Purpose |
|--------|---------|
| **Traits** | Character personality and behavior patterns |
| **Topics** | What this persona cares about / knows about |

Personas don't have Facts (no birthdays) or People (relationships are just Topics for them).
```

### New Section: Data Extraction

```markdown
### Two-Phase Data Extraction

Data is extracted from conversations in two phases:

1. **Fast-Scan**: Quick identification of what was discussed
   - Uses only item names (lightweight)
   - Returns confidence levels (high/medium/low)
   - Low-confidence items queue for Ei validation

2. **Detail Update**: Focused update of individual items
   - One prompt per item
   - Better accuracy than bulk updates
   - Runs in parallel when possible

### Extraction Frequency

| Data Type | Frequency |
|-----------|-----------|
| Facts | Tapers off as data fills (aggressive → rare) |
| Traits | Tapers off as data fills |
| Topics | Every conversation (engagement changes frequently) |
| People | Every conversation |
```

### New Section: Ei's Role

```markdown
### Ei's Orchestrator Role

Ei has special responsibilities beyond normal conversation:

1. **Fact Verification**: Confirms extracted facts with the user
2. **Cross-Persona Validation**: Checks when non-Ei personas update global data
3. **Data Editing**: Guides users through `/clarify` command
4. **Onboarding**: Helps new users get started
5. **System Guide**: Explains features, helps create personas

Ei's descriptions are locked (not LLM-generated) and Ei sees all groups.
```

### New Section: Behavioral Guidelines

```markdown
### Behavioral Guidelines

Guidelines are now hardcoded in prompt templates, not stored as data.

**Universal (all personas):**
- Be genuine, not sycophantic
- Match conversational energy
- Respect boundaries

**Ei-specific:**
- Encourage human-to-human connection
- Be transparent about being AI
- Growth over comfort
```

### Update LLM Configuration Section
No changes needed - model configuration is unchanged.

### Update Group-Based Visibility Section
Minor updates to reference new entity structure instead of ConceptMap.

## Acceptance Criteria

- [x] "Concept Schema" section removed
- [x] "Entity Data Model" section added
- [x] "Two-Phase Data Extraction" section added
- [x] "Ei's Orchestrator Role" section added
- [x] "Behavioral Guidelines" section added
- [x] Project structure updated
- [x] All code references updated to new types
- [x] Examples use new schema
- [x] No references to old Concept system

## Dependencies

- All other 0107 sub-tickets (document final state)

## Effort Estimate

Small-Medium (~2 hours)
