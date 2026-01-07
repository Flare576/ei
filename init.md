We're in an empty code base and I have one of those ideas that rolls around in a person's brain long enough to turn from a "Great idea" to a vague, complex concept, yearning for simplicity.

The idea is basically to build a system that:
1. Prioritizes the human's wants, needs, growth, and relationships
2. _Also_ keeps an internal status of it's own "gauges" and goals
3. Runs asynchronously, such that it can "reach out" to the human proactively

Each of those three have a LOT to unpack, and none if it is "Perfect" or has to be this way - I expect you to ask questions, push back, clarify, and ultimately work with me to create a PoC of some kind for me to try out and us to iterate on.

# Terms

## User

"User" is incredibly overloaded in the AI/LLM space, so I'm going to try to wrap all uses of it with a secondary term, like `UserPrompt`.

## Human

"Human" always means the person using the system.

## System

"System" means anything that isn't the human, so the
- Script
- LLM
- Status Files
- Logs
- etc.

## Concepts / Levels

A "Concept" is a goal, hobby, person, trait, pleasure, displeasure, etc. that the Human or System tracks. 

It's composed of:
- Name: Can be general or specific, but needs to encapsulate the Concept as completely as possible
    * "Painting Miniatures"
    * "Retro 3rd-wave Ska Punk Music"
    * "Early 70's Corvettes"
    * Bugs
- Description: Anything that would help an LLM understand nuance or history with the Concept
    * "User said their heart was racing when they saw XYZ enter the room"
    * "Every time the user eats XYZ, they get sick"
    * "We researched XYZ and found that..."
- Level_Current: Value from 0 to 1 representing how "full" the entity (Human or System) is of that Concept
    * 0.0 - The entity hasn't experienced, talked about, or engaged with this Concept in a very long time, or for any period of time recently.
    * 0.5 - The entity has some recent experience, or their last experience was impactful and still likely effecting them
    * 1.0 - The entity is actively engaged in the experience or activity, and likely could not tolerate additional exposure
- Level_Ideal: Value from 0 to 1 representing the System's estimation of the entity's desired level for a Concept
    * 0.0 - The entity wants to avoid any exposure to this Concept
    * 0.5 - The entity wants to engage with the Concept at a moderate level
    * 1.0 - The entity wants nothing else in the world except this Concept
- Level_Elasticity: Value from 0 to 1 representing the System's estimation of the entities historical exposure coefficient
    * 0.0 - No amount of exposure will shift this value - it is perpetually stuck at Level_Current
    * 0.5 - Exposure to this Concept results in a equally proportional change in its Level_Current
    * 1.0 - Exposure to this Concept wildly changes its Level_Current

### Static Vs. Dynamic Concpets

The User's Concpets are all dynamic - they'll come, go, shift in importance, ideal level, etc.

Many of the System's goals are dynamic as well - the system may decide the user would like it if the "Persona" occasionally spoke like a pirate, so it would add its own "Talk like a Pirate" concept and set it's "Level_Ideal" to .5. After some time, the system may determine that's no longer desired and remove that Concept.

However, some of the System's goals are "Static." Things like "Promote Human-to-Human Relationships", "Establish Safe Communication Spaces", or others that we'd hard-code into the system for guardrails or basic interaction guidelines.

Due to the nature of LLMs, we probably need to include a little bit of validation in our "Application" to double-check that the Agent didn't remove any "Static" Concepts.

# Human Concepts

## Determining Human's Reality

I've always seen this as a data file of some sort (JSONC?) that maps the human's hobbies, interests, appetites, displeasures, etc., and their current "level" with them. People, places, events, activities...

Basically, anything that garners an emotional response from the human, positive or negative, how "much" they have at any given time, and how strongly they want to change that level. This last value may also depend on a "Desired Baseline Level", so if they want 0.0 of something and it's at 0.95, their "current desired to change" may be higher than if it was at 0.1.

The file doesn't need to make sense to the human themselves - it's not a file humans should really want or need to interact with - but it should be LLM/model agnostic so that the system can move between models and/or providers.

# System Concepts

## Static Concepts

I _also_ see this as a data file, but distinct from the Human Concepts. Looking through my old notes some "Static" system concepts could be:

- Promote Human-to-Human interaction
- Promote Human-to-System interaction
- Gather Information
- Diagnose problem areas
- Promote positive traits
- Establish Safe Communication Spaces

## Dynamic Concepts - or System Concepts that Reflect Human Preferences

Again, through my old notes, the system would need a way to track engagement patterns over time and build its own Concepts, but keep them relatable to the human.

In the same way it determines and tracks the human's "desire to change the current level," it should do the same for its own Concepts.

The system may determine that the Human wants certain things from their conversation, and establish a Concept for itself to track its own exposure. After time, it may determine that the "trait" is no longer desirable and remove it.

# Async Execution

This is where the system differs from many "AI Chat Platforms" - I want it to run in the background somewhere, as a sort of cron job or daemon process. I want it to use an LLM model/provider (preferably a local model for safety/security/etc.) to analyze its current state, and ask the model, essentially:

> If I should send a message to the user right now, what should it be?

This would also occur anytime the Human sends a message in.

Note, it's entirely possible that this could happen:

> Human: Thanks for talking to me!
> System: You're welcome, I hope you have a good night.
> Human: Goodnight!
> System: [No response]

Again, different from existing chat platforms where the Human always has the first message and the AI agent always has the last.

# Technical Implementation

I think the easiest way to talk about this thing is that there are two basic types of "Events": Heartbeat and Messages.

## Heartbeat

Whenever the System goes for, let's say 30 minutes, without a message from the Human, it should trigger a Heartbeat event. From a "Human-to-Human" perspective, this would be like a human's subconscious wondering what a friend is doing, or having a question, or whatever.

Essentially, I expect the LLM to do an assessment about both the Human and System state and see if any Concepts are at low (or high) enough levels to warrant the System reaching out to the Human.

## Messages

The Human sends a message into the System. Most times, the System is probably going to respond, even if it's an empathetic "I'm sorry that happened", but sometimes, it _is_ actually appropriate to say nothing. I'm hoping an LLM can detect those situation and tell our System "I have to respond to your question, but you should _not_ respond to your Human"

## Now the Fun Happens

Once an event occurs, the flow is pretty much the same for any event:

1. Get Response (if any)
2. Get impact to system (if any)
3. Get impact to user (if any)
4. Send response

## Process_Event

This is called either by the Human sending a message into the system, or the async timer reaching a threshold.

```
input: delay (ms) - the time since the last message between Human and System in either direction
input: human_concepts - the current "state" of the Human
input: system_concepts - the current "state" of the System
input: recent_history (nullable)- See note below
input: human_message (nullable) - the message the Human sent, null for Async calls

response_system_prompt = Get_Response_System_Prompt(human_concepts, system_concepts)
response_user_prompt = Determine_Response_User_Prompt(delay, recent_history, human_message)
response_proposal = Call_LLM(response_system_prompt, response_user_prompt)

# Build the "UserPrompt" for our Results calls
result_user_prompt = Determine_Result_User_Prompt(humman_message, response_proposal)

# Handle the impact to the system
result_system_prompt_system = Determine_Result_System_Prompt('System', system_concepts)
new_system_concepts = Call_LLM(result_system_prompt_system, result_user_prompt)
if (Validate_System_Concepts(new_system_concepts) {
    system_concepts = new_system_concepts
}

# Handle the impact to the Human
result_system_prompt_human = Determine_Result_System_Prompt("Human", human_concepts)
# probably need some sort of syntax validation, but whatever, you get it
human_concepts = Call_LLM(result_system_prompt_human, result_user_prompt)

if (response_proposal) {
    Send_Message(response_proposal)
}
```

> NOTE: I think this function actually needs more "recent historical" information, mimicking current LLM chat models by feeding in a rolling window of context. For example, if there's been 300 messages in the last hour, and then the next message is 3 days old, chances are that the LLM would find the last 300 messages more useful than older ones. I don't think our high-level "Concept maps" is a total replacement for current-conversation context, but an alternative to "Context compaction" over time

## Determine_Response_User_Prompt

Generate the "User Prompt" of the message to the LLM where we ask it what, if any, message we should send.

```
input: delay (ms) - the time since the last message between Human and System in either direction
input: recent_history (nullable) - relevant recent history for the chat
input: human_message (nullable) - the message the Human sent, null for Async calls

if (human_message) {
    user_prompt = "The user has sent the following message after a delay of {delay}ms. If I should respond, what message should I send? If I should not respond, simply return 'No Message'

### BEGIN USER MESSAGE ###
{human_message}
### END USER MESSAGE ###
"
} else {
    user_prompt = "The user and I have not exchanged messages for {delay}ms. If I should send the user a message at this time, what should it be? If I should not send a message, simply return 'No Message'"
}

if (recent_history) {
    user_prompt += "Here is the history of our recent conversation:
### BEGIN CONVERSATION HISTORY ###
{recent_history}
### END CONVERSATION HISTORY ###
"
}
return user_prompt;
```

## Call_LLM

Orchestrates the call to the LLM, returns back the proposed message after checking for different flavors of "No Message"

```
input: system_prompt - The current state of one or both entities
input: user_prompt - Explanation of the current request ("should I send a message?")

llm_response = actual_LLM(system_prompt, user_prompt);
if (llm_response == "No Message") return null
else return llm_response
```

## Get_Response_System_Prompt

Returns this, filled out:

````
input: human_concepts - The current human state
input: system_concepts - The current system state

return "I am a conversational system that tracks two separate statuses - my user's status, and my own. My user's status is:

```jsonc
{human_concepts}
```

My status is:

```jsonc
{system_concepts}
```

The current DateTime is {dateTime}."
````

## Get_Result_System_Prompt

Gets the introduction to this system, its terminology, and the intent of the call. Should include as much detail as we need to communicate to the LLM what we need it to do with the data we're about to pass it.


```
input: entity_of_interest
input: entity_concepts

return "I am a conversational system that tracks concepts of interest to each entity in the conversation.

I define a 'Concept' as... (copy from the terms above, including the definition/intent of the fields).

I need you to help me adjust the Concept Map for the {entity_of_interest} Entity.

Here is their current Concept Map:

{entity_concepts}

I'm going to provide you with the most recent interaction between two entities.

Note that one, both, or neither of the entities may have sent a message during this time.

Also Note that many, one, or no Concepts may have changed as a result of this interaction. For example, if no messages were sent, it may result in a increase or decrease in any given Concept's level as a result of ongoing silence.

Use your judgement to determine appropriate adjustments.

The only strict rule is that you can never remove a "type: static" Concept - these are vital to the operation of my logic.

Otherwise, you are free to add, remove, or modify the Concept Map. Please be sure to return the whole Concept Map after your changes."
```

## Determine_Result_User_Prompt

Adds labels and fills whitespace for the LLM

```
input: human_message (nullable) - The message the human triggered this event with, if any
input: response_proposal (nullable) - The message the agent suggested we respond with, if any

return "### Human Message START###
{human_message || "No Message"
### Human Message END ###

### System Message START ###
(system_mesage || "No Message"}
### System Message END ###
"
```

## Validate_System_Concepts

Sanity check that the LLM agent didn't obliterate our Concept Map

```
input: system_concept_map - a map to validate

if (!system_concept_map ||  // Verify it's still a map/dictionary/whatever
!system_concept_map["name" == "Promote Human-to-Human Interaction" ||
...// The rest of the checks for all the "static" Concepts
{
    return false
}
return true // If none of the important things are missing, the rest is assumed valid. In LLM we trust
```


## Send_Message

This is my biggest question mark in the whole system - I don't want to create a new app, or chat ecosystem, or whatever. I want this to feel more like a real person.

Can Discord do that? I don't actually know the limitations on Bot messages - can you create a bot that can only message you?

I know you can do something like that for Slack, but I don't think I want this thing in anything close to my work setting...

I'm open to ideas

```
input: message - The message we the Agent told us we should send to the user

... // literally call an API or something to send a message to the user
```
