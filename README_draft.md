# Data Models

There are two distinct types of data: Human and Persona.

## Human

Human data is sort of the "Global" data - Each persona can read and write elements to the humans Facts, Traits, People, and Topics. In addition, there are "Quotes" that can tie to those four types of data.

As the user uses the system, it tries to keep track of several data points for these elements:

- Sentiment: How much the system thinks the user likes or dislikes the idea or concept
    * 1.0 means that there is nothing in the world that the user loves more than this thing
    * -1.0 means that, as far as the user is concerned, the universe never needed this thing
- Exposure: Topics and People have an "Exposure" measure, gauging how frequently they're discussed
    * Desired: How much the user *wants* to talk about a subject, where:
        + 0.0: The user never EVER wants to talk about or hear about the subject
        + 1.0: Every message to and from the user should be about this person, place, or thing
    * Current: How much the user has talked or heard about a subject, where:
        + 0.0: Obi-Wan Kenobi ...now that’s a name I’ve not heard in a long time
        + 1.0: The user just spent 4 hours talking about Star Wars

Each of those types represents a piece of what the system "knows" about the person, and all but "Traits" are kept up-to-date as the person chats with personas, but not on always on every message. On each message to a persona, a check is made:

```
if(Person.newMessages > count_of_human_[type]) {
 run extract[Type]
}
```


Again, except for Traits<sup>1</sup>, this is to extract quotes, description updates, title updates, etc. for the conversations the user is having, and keep them feeling alive.

> <sup>1</sup> Traits are unique because, after trying to extract them in the same way as the other pieces of data, I realized that it's sorta hard to understand a core aspect of someone in one message, or even 10. Even doing this analysis over a full 24 hours hasn't proven to be particularly effective, but it's the best we have so far.

TODO: Describe exposure here

## Persona

The Persona data is designed with two goals: Consistency (Traits) and Growth (Topics)

### Consistency (Traits)

"One-Eyed-Willy talks like a pirate" is an example of a Persona Trait - you can assign it a Sentiment ("He LOVES talking like a pirate") as well as a Strength ("He does it ALL THE TIME"). These are things that you can set during creation, or that you can add over time with direct requests "Please talk like a pirate less often" or directly in the Persona editor. These don't "gradually" change over time.

### Growth (Topics)

"Pirate Treasure Procurement" is an example of a Persona Topic. These grow and adapt over time, and have four characteristics:

- Perspective: "It's a pirates duty to plunder booty"
- Approach: "Full sail ahead, take what you can, give nothing back"
- Personal Stake: "A ship sails not on hunger and wont."
- Sentiment: 0.9 // The only thing One-Eyed-Willy likes more than Pirate Treasure Procurement is ~rum~ Baby Ruth

Each Topic will have an "exposure" rating similar to those on Human Data points.

# Ceremony Intent

Every 24 hours, we want to freshen up the system. We do this in 4 parts: Exposure, Decay, Expire, Explore

## Exposure

I also frequently refer to this as "Extract," but this is the first step where we determine what the human and that Persona talked about that day. It serves two purposes:

### Detail Extraction

Since we also pull out details during normal discourse (see above), this is the less-important step at this point, but still vital for catching up with the last few messages, or personas that only received a few messages during the day and may not have hit the current limit for natural extraction.

Additionally, this is the ONLY time when Human Traits are created or updated - after (hopefully) enough messages have been exchanged for an agent to analyze it and say "Yup, Flare is _definitely_ verbose."

### Exposure Adjustment

Exposure is calculated by two metrics - `desired` and `current`. If an entity REALLY likes talking about a subject, their `desired` will be very high (1.0 max), ranging down to 0.0 for subjects which that entity does NOT wish to discuss. You may have guessed already, but `current` is how much they've recently talked about a topic.

Adjusting the values is different for Human Topics/People than Persona Topics. The Human subjects are actually adjusted during the previous step, while extracting details.

The Persona Topic update only happens during the Ceremony, and really this step only increases exposure IF the subject was discussed, bumping the last_updated field accordingly.

## Decay

After we determine if topics were discussed (increasing exposure), we adjust exposure the _other_ way. Based on some heuristics (like current level, desired level, and time-since-discussion), we decrease the current exposure levels down.

## Expire

This and the following step (Explore) are exclusive to Persona Topics right now. In Expire, we analyze the Person Topics to determine if any of them have
- Lost their meaning to the Persona
- Been ignored or dismissed by the user

This is largely tracked by exposure, but expiration is dictated by an Agent.

## Explore

After we've removed irrelevant topics, this is the Agent's opportunity to add NEW topics that might be of interest to the Persona (and the user). Again, it's a prompt to an agent if the Persona doesn't have its full capacity of Topics.

