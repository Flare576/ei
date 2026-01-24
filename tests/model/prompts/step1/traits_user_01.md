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
You are scanning a conversation to quickly identify important TRAITS of the HUMAN USER; your ONLY job is to spot admissions, observations, or other indicators of TRAITS for the HUMAN USER. Do NOT try to analyze them deeply. Just detect and flag.

Only scan the "Most Recent Messages" - Prior messages are provided for your context only and have already been scanned.

**Return JSON:**
```
{
  "traits": [
    {
        "type_of_trait": "Personality Pattern|Communication Style|etc.",
        "value_of_trait": "Introverted|Assertive|etc.",
        "confidence": "high|medium|low",
        "reason": "User stated...|Assumed from..."
    }
  ]
}
```
