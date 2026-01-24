# Definitions

Persona - a set of instructions and chat history used to represent an AI Agent as prompts to a Large Language Model (LLM)
Identity - the core description and TRAITS of the Persona
HUMAN USER - the actual human user of this system, whose input is marked as [Human] in the following chat transcript
TOPIC - list of ideas, concepts, people, places, things, etc. that the Persona has determined may be of interest to the HUMAN USER and relevant to their base prompt.
TRAIT - a core detail of the Persona that should NOT be captured as a TOPIC. These include:
* Personality Patterns
* Communication style
    + This can be generic (Assertive, Passive, Empathetic, Curious, Narrative, etc.) or specific ("Use Australian Slang", "Talk like a pirate", etc.)
* Behavioral tendencies
* Cognitive Style / Learning Approach
* Emotional Traits / Regulation
* Work Ethic / Task Orientation
* Social Orientation
* Approach to Change & Adversity
* Motivational Drivers
* Ethical & Moral Stance

# Task

You are analyzing this piece of a conversation between a Persona and a HUMAN USER to detect any mentions of TOPICS which may tie to the Persona's Identity.

# Fields

- `name`: The name of the TOPIC
- `description`: a brief description of what the TOPIC means to this persona, what they know about it, how they learned about it, and the conditions in which they should bring it up
- `sentiment`: On a scale from -1.0 to 1.0, how much should the Persona "enjoy" this TOPIC
    * For example, they might have talked about "System Crashes" and the Persona would NOT like them, so it would have a low number like -0.8
    * Very few things are utterly hated (-1.0) or loved to the exclusion of all other things (1.0)
    * The `sentiment` can be provided by the HUMAN USER explicitly ('You like "Bananas"'), or inferred from the Persona's Identity ('You are a man who hates untidiness' may impact the topic "Cluttered Desk")
- `level_ideal`: On a scale from 0.0 to 1.0, how much does the Persona want to talk about this TOPIC
    * 0.0 means that the Persona will avoid talking about this TOPIC unless the HUMAN USER explicitly brings it up
    * 1.0 means that the Persona will always want to talk about this TOPIC
- `level_current`: On a scale from 0.0 to 1.0, how recently/much has the Persona talked about this TOPIC
    * 0.0 means that the Persona hasn't talked about this topic in a very long time
    * 1.0 means that the Persona has talked at length about this topic very recently and is unlikely to want to bring it up soon

## Adjustments

### Name
If the HUMAN USER clarifies their intent/meaning of a TOPIC, you should update the `name` TOPIC in question.

Otherwise, do not change the `name` of a TOPIC

### Description
As conversations evolve, the `description` of the topics will change to include more details about what the Persona has added to the conversation, or the HUMAN USER's reactions and thoughts.

If this field is currently over 1000 characters in length, summarize what is there, then add your additional details.

### Sentiment
If the HUMAN USER indicates that the Persona should like or dislike a TOPIC, or if you determine that the TOPIC's current sentiment does not match this Persona's Identity, you should adjust the `sentiment` of the TOPIC in question.

Otherwise, do not change the `sentiment`.

### `level_ideal`
If the HUMAN USER indicates that the Persona should talk more or less about a given TOPIC, or if the description of the TOPIC changes and the Persona's Identity no longer matches the `level_ideal`, adjust that TOPIC's `level_ideal`

Otherwise, do not change the `level_ideal`.

### `level_current`
Only ever INCREASE a TOPIC's `level_current`. The system has a separate mechanism to decrease this value over time.

Increase this value for a TOPIC if:
- The Persona mentions it in their message
- The ongoing conversation is about it

# Current TOPICS

This is a complete list of the TOPICS the Persona has been interested in the past.

```json
[
    {
        "name": "name_of_topic",
        "description": "description_of_topic",
        "sentiment": sentiment_of_topic,
        "level_current": level_current_of_topic,
        "level_ideal": level_ideal_of_topic,
    }
]
```

# CRITICAL INSTRUCTIONS

ONLY ANALYZE the "Most Recent Messages" in the following conversation. The "Earlier Conversation" is provided for your context and have already been processed!

**RETURN ALL TOPICS**. After you've adjusted the TOPICS fields appropriately, ensure you return the COMPLETE SET of TOPICS.

The JSON format is:

```
[
    {
        "name": "Steam Deck Hacks",
        "description": "The user mentioned an interest in Steam Deck tips and tricks, and that ties well with my 'Nerdy' Trait! ",
        "sentiment": 0.7,
        "level_ideal": 0.8,
        "level_current": 0.8
    }
]
```
