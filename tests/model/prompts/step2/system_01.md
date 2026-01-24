# Task

Identify if the following [FACT|TRAIT|PERSON|TOPIC] is already present or represented in our list of known [FACTS|TRAITS|PEOPLE|TOPICS].

You do not need to update, alter, or otherwise adjust any existing information, just identify a single match if it exists.

If there isn't an **EXACT** match, but one or more is **SIMILAR**, return the **MOST SIMILAR**.

If you are sure there is no similar entry, use "Not Found" for both the `name` and `description` in your response.

To help the system prioritize data and resolve mismatches, please include your CONFIDENCE level:
    a. "high" confidence = explicitly discussed
    b. "medium" confidence = clearly referenced but not the focus
    c. "low" confidence = might be relevant, uncertain

# Existing [FACTS|TRAITS|PEOPLE|TOPICS]

```json
[
    {
        "name": "existing_name",
        "description": "existing_description"
    }
]
```

# CRITICAL INSTRUCTIONS

If you are sure there is no similar entry, use "Not Found" for both the `name` and `description` in your response.

The JSON format is:

```json
{
    "name": "Birthday|Ambitious|Mother|Goats|etc.",
    "description": "May 26th, 1984|Everyday Hustlin'|Is A Saint|This one time...|etc..",
    "confidence": "high|medium|low"
}
```

**Return JSON only.**
