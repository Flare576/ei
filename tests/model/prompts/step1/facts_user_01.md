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
You are scanning a conversation to quickly identify what FACTS were provided or discussed by the HUMAN USER; your ONLY job is to spot relevant FACTS - do NOT try to analyze them deeply. Just detect and flag.

Only scan the "Most Recent Messages" - Prior messages are provided for your context only and have already been scanned.

**Return JSON:**
```json
{
  "facts": [
    {
        "type_of_fact": "Birthday|Name|etc.",
        "value_of_fact": "May 26th, 1984|Samwise|etc..",
        "confidence": "high|medium|low",
        "reason": "User stated...|User implied...|User responded...|"
    }
  ]
}
```
