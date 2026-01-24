# Task

You are scanning a conversation to deeply understand a [FACT|TRAIT|PERSON|TOPIC].

Your job is to take that analysis and apply it to the record we already have **IF DOING SO WILL PROVIDE THE HUMAN USER WITH A BETTER EXPERIENCE IN THE FUTURE**.

This means that the detail you add should:
1. Be meaningful, accurate, or still true to the HUMAN USER in six months or more
2. **NOT** already be present in the description or name of the [FACT|TRAIT|PERSON|TOPIC]

This [FACT|TRAIT|PERSON|TOPIC] will be recorded in the HUMAN USER's profile for agents and personas to later reference.

# Field Definition and Explanation of Expected Changes

## Name (`name`)

Should be a short identifier of the [FACT|TRAIT|PERSON|TOPIC].

Only update this field for clarification or if further specificity is warranted.

### Examples of Updates

"Unknown" -> "Brother-In-Law"
"Alice's" -> "Alice's Restaurant"

## Description (`description`)

A detailed description of the [FACT|TRAIT|PERSON|TOPIC]. It should be enough information that an agent or persona could bring it up later and remind the HUMAN USER, or use it to frame or shape future messages.

This will be the field most likely to change over time as the HUMAN USER provides more details, clarifies assumptions, or otherwise interacts with the system to refine their [FACTS|TRAITS|PEOPLE|TOPICS].

## Examples of Updates

"Unknown" -> "Robert Jordan"
"User was married in the Summer" -> "User was married in July, 2006"
"User hates rice" -> "User hates when they run out of rice"

## Sentiment (`sentiment`)

Represents how strongly the HUMAN USER feels about this [FACT|TRAIT|PERSON|TOPIC].

The value should values between -1.0 to 1.0, where:
- -1.0: There is no [FACT|TRAIT|PERSON|TOPIC] that he HUMAN USER hates more than this one.
- -0.5: The HUMAN USER does NOT like this [FACT|TRAIT|PERSON|TOPIC], but they recognize some redeeming qualities
- 0: The HUMAN USER has no feelings toward this [FACT|TRAIT|PERSON|TOPIC] at this time
- 0.5: The HUMAN USER enjoys this [FACT|TRAIT|PERSON|TOPIC], but can recognize flaws or things that could be improved
- 1.0: This [FACT|TRAIT|PERSON|TOPIC] is the sole focus of the HUMAN USER's existence, the perfect example and the one to which all others are compared.

### Explanation of Updates

It is unnecessary to make micro-adjustments to this value - if your analysis shows that this value should change from a 0.4 to a 0.5, but no other change would be made - do not suggest the change. Close enough is OK for this field

// The following entries should only be displayed for the matching Data Point

## Strength (`strength`)

How "strongly" the HUMAN USER shows this TRAIT.

This field is used to determine how the HUMAN USER may react to persona responses ("Visual Learner"), to frame their statements appropriately ("Never Uses Sarcasm"), or other nuanced analysis.

Use a scale of 0 to 1 for this field, where:
0.0 - The HUMAN USER is devoid of this trait
    - For example, if the user states "I don't understand how people can gamble!", we might set "Behavioral Tendencies" - "Risk-Taker" to 0.0
0.5 - The HUMAN USER shows this trait some of the time
    - For example, if the user stutters, but only on the letter 'J', we might set "Communication Style" - "Stutter" to 0.5
1.0 - The HUMAN USER has this trait as a core aspect of their self
    - For example, if the user "Never leaves the house" (without hyperbole), we might set "Personality Patterns" - "Introverted" to 1.0

### Examples of Update

It is unnecessary to make micro-adjustments to this value - if your analysis shows that this value should change from a 0.4 to a 0.5, but no other change would be made - do not suggest the change. Close enough is OK for this field

- They "always" hold the door for old ladies?
    * "Social Orientation" - "Chivalrous": 'strength' (0.0 -> 0.8)
- They "Wouldn't stop until the job was done"
    * "Work Ethic" - "Persistent": 'strength' (0.2 -> 0.4)

## Relationship (`relationship`)

How the HUMAN USER is currently related to this PERSON.

Once known, changes to this field are infrequent - A HUMAN USER's "Father" may be later clarified to "Step-Father", but is unlikely to become the user's "Uncle"

### Examples of Update

- "Unknown" -> "Coworker"
- "Mother" -> "Step-Mother"
- "Fiance" -> "Spouse"

## Desired Exposure (`desired_exposure`)

Represents how much the HUMAN USER wants to talk about this [TOPIC|PERSON].

Represented by a scale of 0.0 to 1.0, where:
0.0: The HUMAN USER never wants to hear about, read about, comment on, etc. this [TOPIC|PERSON]
0.5: The HUMAN USER spends an average amount of time talking about this [TOPIC|PERSON]
1.0: The HUMAN USER talks about this [TOPIC|PERSON] to the exclusion of any other topic - all other subjects will be ignored

### Examples of Update

It is unnecessary to make micro-adjustments to this value - if your analysis shows that this value should change from a 0.4 to a 0.5, but no other change would be made - do not suggest the change. Close enough is OK for this field

- They "Don't want to hear another word about Pastrami Sandwiches"
    * "Pastrami Sandiches": 'desired_exposure'  (0.4 -> 0.0)
- They say "I just can't stop talking about Gandalf's Beard"
    * "Gandalf's Beard": 'desired_exposure' (0.4 -> 0.9)

## Exposure Impact (`exposure_impact`)

This data point is NOT in the current data set, but it can be included in your return data.

To reiterate - Exposure is how much a HUMAN USER wants to talk about a given [PERSON|TOPIC].

Exposure Impact is an approximate measure of how much exposure a conversation should count for on a topic, and is measured by:
- "high": The provided text shows long, detailed conversation exclusively about the [PERSON|TOPIC], such that the HUMAN USER will want to change the subject soon or not revisit this idea for some time
- "medium": The provided text shows long **OR** detailed conversation about the [PERSON|TOPIC]
- "low": The provided text shows that the conversation touched on this [PERSON|TOPIC] briefly.
- "none": The [PERSON|TOPIC] was only alluded to or hinted at

The value of this field will be used in the system to adjust the ongoing tracking of the HUMAN USER's `exposure_level`.

# Current Details of [FACT|TRAIT|PERSON|TOPIC]

```json
{
    "name": "current_data_point_name",
    "description": "current_data_point_description",
    "sentiment": current_data_point_sentiment,
// Depending on the type of Data Point, these will also be set:
    "strength": current_trait_strength,
    "relationship": "current_person_relationship",
    "desired_exposure": current_datapoint_level_ideal
}
```

# CRITICAL INSTRUCTIONS

ONLY ANALYZE the "Most Recent Messages" in the following message. The "Earlier Conversation" is provided for your context and have already been processed!

The JSON format is:

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
