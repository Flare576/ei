# Behind The Curtain

Welcome to the Core of Ei. If you're reading this, you're probably interested about the inner-workings of the system.

Or you're lost. That's ok, too.

# Data Models

There are two distinct types of data: Human and Persona.

## Human

Human data is sort of the "Global" data - Each Persona can read and write elements to the humans Facts, Traits, People, and Topics. In addition, there are "Quotes" that can tie to those four types of data.

As the user uses the system, it tries to keep track of several data points for these elements:

- Sentiment: How much the system thinks the user likes or dislikes the idea or concept
    * 1.0 means that there is nothing in the world that the user loves more than this thing
    * -1.0 means that, as far as the user is concerned, the universe never needed this thing
- Exposure: Topics and People have an "Exposure" measure, gauging how frequently they're discussed
    * Desired: How much the user *wants* to talk about a subject, where:
        + 0.0: The user never EVER wants to talk about or hear about the subject
        + 1.0: Every message to and from the user should be about this person, place, or thing
    * Current: How much the user has talked or heard about a subject, where:
        + 0.0: Obi-Wan Kenobi ...now that's a name I've not heard in a long time
        + 1.0: The user just spent 4 hours talking about Star Wars

Each of those types represents a piece of what the system "knows" about the person, and all but "Traits" are kept up-to-date as the person chats with Personas, but not on always on every message. On each message to a Persona, a check is made:

```
if(Person.newMessages > count_of_human_[type]) {
 run extract[Type]
}
```

Again, except for Traits<sup>1</sup>, this is to extract quotes, description updates, title updates, etc. for the conversations the user is having, and keep them feeling alive.

> <sup>1</sup> Traits are unique because, after trying to extract them in the same way as the other pieces of data, I realized that it's sorta hard to understand a core aspect of someone in one message, or even 10. Even doing this analysis over a full 24 hours hasn't proven to be particularly effective, but it's the best we have so far.

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

Since we also pull out details during normal discourse (see above), this is the less-important step at this point, but still vital for catching up with the last few messages, or Personas that only received a few messages during the day and may not have hit the current limit for natural extraction.

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

# Opencode Importer

The current implementation of the importer is very, very simple. You could probably just read the code to get the idea, but, essentially:

1. If there's any queue, skip
2. Look at the `last_extraction_ts` and find the OpenCode Session with the last_updated time closest to it
3. Check if we've already imported this session, and what the cutoff is for "already seen" messages
4. Wipe the Personas history and mark them as archived
5. Write the messages to the Persona, marking old messages as `[p,r,o,f]` processed
6. Queue the extract
7. Bump the `last_extraction_ts` to that session's last_updated timestamp

That's it. We slowly process through OpenCode's backlog, chronologically, until we finally catch up. Once we do, we just parse each message/exchange and extract for now. I think eventually I'll add a gate that says "if last_updated is less than 24h, skip this extraction" so that each session has a better chance of being "Complete" and offering the extraction process a whole look.

## Failed Approaches

In the spirit of "Right down what you tried, so you don't try it again," here are the other ways we've attempted to pull in the data.

# V1 - Greedy

The first mechanism used a three-phase process. First, we'd pull **every** message from OpenCode into Ei, assigning them to personas. This was before we had markers on each message to indicate if they'd been processed for `[Facts, tRaits, People, tOpics]` (the `[f,r,p,o]`, but I usually switch the order to `[p,r,o,f]` because I can't remember the other order). On subsequent runs, we'd just tack the latest messages onto the end of the conversation.

Second, we'd queue up Topic updates and quote retrieval starting with the most recent messages. The goal was to get the latest, hottest quotes out of the system as soon as possible so the user gets "immediate value"

Last, we'd start queuing up Fact, Trait, and People updates from the oldest records.

## Why Didn't This Work

You ever try to tell an LLM a story by starting at the end and working your way backward? Don't bother, it doesn't work. Trying to process the last messages first was an attempt to get visible value as soon as possible, but that value was a lie.

Oh, and that initial queue for quotes was about 450 items.

# V2 - Clever

The second approach ended up being roughly 800 lines of "Clever" code. I call it that because Opus found at least 4 edge cases in the logic that we added dials and trackers around, so this quote applied:

> Everyone knows that debugging is twice as hard as writing a program in the first place. So if you're as clever as you can be when you write it, how will you ever debug it?
> -- Brian Kernighan, 1974

The approach broke the messages into a "recent" timeframe and the rest. We had just added message roll-off to the main personas with a rule set of "Always keep at least 200 messages, but after that roll off any message older than 14 days," so we used the same approach for Opencode Agent personas.

We loaded the last 14 days of messages... Which was tricky because we _also_ wanted to keep messages tied to their "sessions" for context, so if a user added a message to a session from last year, we'd need to pull old messages (that we already processed) and the new messages (that we hadn't) into a block that the system could parse correctly.

Oh, and the "older than 14 days" messages we had to process in, too, so we needed _another_ timestamp tracker for that...

And sometimes that process will _also_ be split in the same way as the recent messages...

Aaaand the most recent 14 days of messages, queued for all four data types, resulted in an initial queue of 300 items **scans**, and once each of those scans found 10 Topics to talk about, the queue jumped to 3,000 instantly.

# The Processing Loop

The processor runs a tight loop every 100ms. On each tick it checks: is the queue idle? Is there a request waiting? If yes, it dequeues the highest-priority item and hands it to the LLM. One at a time. Always.

This is intentional. Concurrent LLM calls sound appealing until you're watching a persona give contradictory answers because two extractions ran in parallel on the same data. Boring serialization beats exciting race conditions.

# Context Windows

Personas don't send their entire message history to the LLM. By default, only messages from the last 8 hours are included (`context_window_hours`, configurable per persona). Older messages are still stored — they're just not in the prompt.

Message rolloff works differently: messages are kept until there are at least 200 of them _and_ any are older than 14 days. So a persona you chat with daily will roll off old messages gradually; one you chat with twice a year will keep everything.

# Embeddings

Every fact, trait, person, topic, and quote gets a vector embedding when it's created or updated. The model is `all-MiniLM-L6-v2` (384 dimensions) — small enough to run locally, accurate enough to be useful.

When building a system prompt for a response, the system doesn't just dump all your data into the context. It uses cosine similarity against the current message to find the most relevant items — up to 15 per type, with a 0.3 similarity threshold. Everything below the threshold gets left out.

The model runs via `fastembed` in Bun/Node and `@huggingface/transformers` in the browser. Both are loaded lazily so the bundler doesn't have a bad day.

# Encryption

The sync feature uses AES-GCM-256 with a key derived via PBKDF2 (310,000 iterations) from `username:passphrase`. The key never leaves your device. The server receives an encrypted blob it can't read.

There's a subtle trick for the user ID: to identify your data on the server without sending credentials, the system encrypts a fixed known plaintext (`"the_answer_is_42"`) with a fixed IV using your key. Same credentials always produce the same ciphertext, which becomes your server-side ID. No account, no lookup table — your identity _is_ your credentials.

# Heartbeats

Each persona has a heartbeat timer. If a persona hasn't had activity for 30 minutes (configurable via `heartbeat_delay_ms`), the system queues a check-in prompt. The persona "wakes up," considers what's been going on, and may have something to say.

Whether they do is up to them and the prompt. Some personas are chatty. Some are not.
