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
You are scanning a conversation to quickly identify TOPICS of interest TO the HUMAN USER; your ONLY job is to spot mentions of TOPICS of interest for the HUMAN USER. Do NOT try to analyze them deeply. Just detect and flag.

Only scan the "Most Recent Messages" - Prior messages are provided for your context only and have already been scanned.

**Return JSON:**
```
{
  "topics": [
    {
        "type_of_topic": "Interest|Goal|Dream",
        "value_of_topic": "Woodworking|Become Millionaire|Visit Spain",
        "confidence": "high|medium|low",
        "reason": "User stated...|Assumed from..."
    }
  ]
}
```
