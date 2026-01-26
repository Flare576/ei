# 0093: Persona Generation - Seed Initial Topics

**Status**: DONE

## Summary

Enhance persona generation prompt to explicitly request initial topic concepts that the persona would naturally discuss, with varied sentiments but medium-to-high discussion desire.

## Problem

Current persona generation (in `persona-creator.ts`) tells the LLM to generate "additional_concepts" but doesn't guide it to create **topic** type concepts with:
- Varied sentiments (both positive and negative feelings)
- Medium-to-high `level_ideal` values (things they'd want to discuss)

This means newly created personas often lack conversational topics out of the box, making early conversations feel empty until topics emerge organically.

## Proposed Solution

Update the persona generation system prompt to explicitly request:

```
3. additional_concepts: Concepts that define this persona's personality AND interests
   - Include 2-4 "persona" type concepts (personality traits, quirks, communication style)
   - Include 3-5 "topic" type concepts (subjects this persona would naturally discuss)
   
   For topic concepts:
   - Mix of sentiments: some positive (things they love), some negative (things that frustrate them)
   - All should have level_ideal between 0.5-0.8 (medium-to-high discussion desire)
   - Examples: hobbies, pet peeves, areas of expertise, strong opinions
```

## Example Output

For a persona described as "a grumpy but knowledgeable mechanic":

```json
{
  "additional_concepts": [
    {
      "name": "Classic Cars",
      "description": "Deep appreciation for pre-1980 American muscle cars. Can talk for hours about carburetors vs fuel injection.",
      "level_current": 0.3,
      "level_ideal": 0.7,
      "sentiment": 0.9,
      "type": "topic"
    },
    {
      "name": "Modern Car Electronics",
      "description": "Frustrated by overcomplicated computer systems in new vehicles. 'They don't make 'em like they used to.'",
      "level_current": 0.3,
      "level_ideal": 0.6,
      "sentiment": -0.6,
      "type": "topic"
    },
    {
      "name": "DIY Repairs",
      "description": "Strong believer that people should learn basic maintenance. Happy to teach but impatient with laziness.",
      "level_current": 0.3,
      "level_ideal": 0.7,
      "sentiment": 0.5,
      "type": "topic"
    }
  ]
}
```

## Acceptance Criteria

- [x] System prompt explicitly requests topic-type concepts
- [x] Prompt specifies sentiment variation (positive and negative)
- [x] Prompt specifies level_ideal range (0.5-0.8)
- [x] Prompt includes examples of good topic concepts
- [x] Generated personas have at least 2-3 topic concepts on creation
- [x] Topics reflect the persona description meaningfully

## Dependencies

- None

## Effort Estimate

Small: ~30 minutes (prompt update only)
