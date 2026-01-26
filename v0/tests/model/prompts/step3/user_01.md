# Conversation
## Earlier Conversation
[ei]: Persona Text
[human]: Human Text
[human]: Human Text
[ei]: Persona Text
[ei]: Persona Text
[human]: Human Text

## Most Recent Messages
[human]: Human Text
[ei]: Persona Text

# Task
Analyze the Most Recent Messages to construct your response.

**Return JSON:**
```json
{
    "name": "Example Data Point",
    "description": "This is a story of a lovely lady who was brining up three very...",
    "sentiment": 0.9,
// Depending on the type of Data Point, these will also be set:
    "strength": 0.0,
    "relationship": "Mother-In-Law|Son|Coworker|etc.",
    "desired_exposure": 0.4,
    "exposure_impact": "high|medium|low|none"
}
```

If you find no evidence of this [FACT|TRAIT|PERSON|TOPIC] in the "Most Recent Messages", respond with an empty object: `{}`.

If you determine no changes are required to the [FACT|TRAIT|PERSON|TOPIC], respond with an empty object: `{}`.

An empty object, `{}`, is the most common expected response.
