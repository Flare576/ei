# V0

The current code base represents an organically coded platform that facilitates a single, unified "Human" profile across an unlimited number of "Persona" AI agents.

Barely.

It's gone through several iterations and has a lot of unnecessary code that we could invest time into cleaning...

Or we could use what we've built as the ideological foundation (i.e., a Proof of Concept) for Version 1.0 of Emotional Intelligence: Online.

# V1

I want to build a system that's architecturally sound from the beginning, but still rooted in Privacy-first concepts. I'm envisioning 4 core systems + Frontend, all running on the user's machine/browser:

1. FrontEnd
2. Processor
3. StateManager
4. QueueProcessor
5. Storage

## Frontend

I intend to start with a web-based FrontEnd, but to build the system in such a way that we can add a better, more robust CLI/TUI with OpenTUI (or similar).

### Web Frontend

A single-page application, probably React, designed to surface all of the functionality of the system to the user.

It needs to create a Ei_Interface object, which will have hooks for all of the events that the Processor can emit, such as:
- PersonaMessageAdded
- PersonaAdded
- PersonaMessageQueued
- PersonaThinkingUpdate
- PersonaMessageHistoryUpdated
- Etc.

It will pass this Ei_Interface into the Processor it instantiates. That processor will, in turn, have a number of functions that the FrontEnd can call:
- GetPersonaList
- GetPersonaMessages
- AddPersonaMessage
- CreatePersona
- GetHumanTopics
- GetPersonaGenrationTemplate
- etc.

#### But... Why?

The logical flow is that the user clicks on "Add New Persona", and the FE retrieves the GetPersonaGenerationTemplate, then creates the UI for the Human to fill out for the persona.

##### Example (Part 1)

When the user clicks "Submit", the FE calls "CreatePersona" with the contents.

The FE does whatever it does (shows a spinner, takes them back to the main interface with a optimistic "newPersona [thinking]" in the list while letting the user chat with Ei... whatever). The `CreatePersona` call is async.

Eventually, the Processor finishes creating the Persona and triggers the "PersonaAdded" hook.

> I'm still leaning toward this hook getting no data, but I could be talked into it sending the full {Persona} that was created - let's talk about it!

Now, the FE calls the "GetPersonaList" endpoint of the Processor, gets the list and the current state of all the Personas, and re-renders the list however it makes sense for that FE.

This allows the FE to do what it's good at and treat the Processor object it created as a stateful, async application.

Because it is.

## Processor

This file will be the core of the system, by:
- Setting up architecture on launch
- Hosting the primary execution loop
- Notifying the FE when things change
- Offering the FE async endpoints to interact with data
- Managing scheduled/triggered tasks

It will expect its instantiator to pass in an instance of Ei_Interface, and will return an instance of itself with public async endpoints to set and retrieve data.

It then instantiates the StateManager and the QueueProcessor and starts its infinite loop.

### The Loop

1. Pull "settings" object from HumanEntity - Check "saveInterval" against own "lastAutoSave" timestamp
    a. call StateManager.persist(...) for auto-save // We'll need to decide if we need a separate function for user-initiated "saveState"/"restoreState" and name this accordingly
2. Check for scheduled tasks (Decay, Expire, Explore) or for "Conditional tasks" (Heartbeat, Exposure)
    a. If a task requires data retrieval, it will be pulled from StateManager's data endpoints
        i. Example: heartbeat needs PersonaLastUpdate and PersonaMessagesInContextRange to determine if it is heartbeat time and the content to analyze
        ii. Example: Personas should "Expire" 
    b. If a task requires an LLM call, it will go through the StateManger's Queuing system
    c. If a task requires modifying data, it will use StateManager's data endpoints
    d. If a task run requires setting a "last_run" date of some kind, that will be saved in either:
        - HumanEntity if it's a global/human task (Exposure)
        - PersonaEntity if it's per-persona (Exposure, Decay, Expire, Explore, Heartbeat)
3. queueProcessor.getState()
4. if idle: queueProcessor.start(stateManager.LLM_QueueHighest(), handler) // peek, don't pop,  the highest priority item from the queue and start it

### Handlers

Outside of the loop is the `handler` function, which will have a switch statement that checks for the `nextStep` of the payload from the QueueProcessor.
- I expect each of these nextSteps to be their own `import` in the Processor's folder so that the Processor doesn't get _too_ thicc.
- Each of these should have two params:
    * LLM_Response
    * stateManager
- If the result of the Response is _another_ LLM call (like our multi-step process for Human data), the `nextStep` function calls stateManager to queue it up - THEY NEVER CALL LLMs DIRECTLY. Otherwise, they call the stateManager's other endpoints to make whatever change/update/addition it is designed for.

#### Example (Part 2)

So, to continue our example above, when the FE calls `GetPersonaGenerationTemplate`, the Processor returns the string it has imported from the **prompts** folder (as a Promise - for consistency, all Processor getters/setters should be async).

When the FE calls the "CreatePersona" function, the Processor:
- Validates the input (persona description, potentially the model the user wants to use for generation, etc.)
- Retrieves any information it needs (settings, messages, etc.) from the StateManager
- Calls the PromptGenerator for "CreatePersona" with a fully formed data: {...} object
    * All PromptGenerators should be SYNCHRONOUS and be expected to do ZERO data retrieval and minimal data manipulation
    * Meaning, if the Prompt needs the messages split into 2 pieces for "Prior Conversation" and "Recent Messages", that's done in PROCESSOR (or utils that the Processor imports)
    * PromptGenerators should verify that the information it needs to fill out its prompt is complete and error if not
    * PromptGenerators should ALWAYS return { system, user } prompts as an object
- Takes the final prompt and calls StateManager to enqueue the LLM call with
    * system
    * user
    * messages // none for this flow
    * type (json)
    * nextStep (handleNewPersona)
    * data ({'personaName': personaName}) // any data that ANY of the following steps will need
    * model // if the user provided one, or if this were a Response call and we pulled the persona model

On the next execution loop, if the queueProcessor is idle and this is the highest priority, stateManager.peekHighest() will pick it up and start the call.

After some time, `queueHandler` is called with the LLM_Response. That function looks at the embedded LLM_Request.nextStep and sees "handleNewPersona", which it calls with the LLM_Response and the stateManager instance.

That handler unpacks the response, does what it needs to with the data, and eventually calls stateManager.persona_add. It returns null/true/whatever.

The Processor's queueHandler gets control back and finishes by calling Ei_Interface.personaAdded().

That's its last step, so it calls the stateManager.LLM_QueueFinish with the embedded LLM_Request.guid.

Almost immediately, the Processor gets a call to getPersonaList, so it calls stateManager.personaGetAll and returns the list as a Promise.

# QueueProcessor

Offers a limited set of public interfaces:
- getState() // idle | busy
- start(LLM_Request, callback) // if idle, process the request, otherwise throw error(?)
- exit() // kills the active call, Ctrl+C handling, emergencies, etc.

An LLM_Request needs to have:
- type (response | json | raw | ...)
- prompt
    * system
    * user
    * messages (optional)
- nextStep
    * since this record needs to be serialize-able, this can't be a _callback function_, but it will determine the thing that processes the response.
- model (uses our default chain if not provided)

When the LLM responds, the QueueProcessor:
- If type === json, run JSON analysis/fix/retry 3
- If type === response, run "<thinking>", "No Message", etc. checks
- If type === raw, do whatever we do now to ensure it's valid response (nothing? truncation check?)

If the output looks good, we stick it with the LLM_Request into an LLM_Response and call the `callback` function.

## Example (Part 3)

The QueueProcessor gets a call to check it's state, returns idle, then immediately gets a call to start on a LLM call.

It sees a system and user prompt, a type, and a next step. No model, so it checks its defaults. No messages, so skip that for this call. Everything looks OK, continue.

Since the type is JSON, it calls the JSON handling LLM manager with the model/provider/etc. that we have in the prototype.

It awaits the call - this is its only job. If the getState is called between now and the model response is "busy"

When the model returns, the Queue processor creates a LLM_Response with the original request and calls the callback. It's now idle again.

## StateManager

The In-Memory state keeping system. On instantiation, it will attempt to load from the "Storage" module, and when told, "save" to the storage module, but otherwise this is where all of the data of the system lives:
- HumanEntity
- PersonaEntities[]
- LLM_Queue
- (... I think that's it. HumanEntity should get any global timestamps like last_message_timetamp and FACT|TRAIT|PERSON|TOPIC extractions, and PersonaEntity should get all of it's own tracking)

### Example (Part 4)

The FE spins up, instantiates Processor, and Processor instantiates the stateManager.

stateManager instantiates a storage instance for all of its destinations (see RemoteStorage below) - in this case, just LocalStorage.

It reads from the highest priority storage, validates the other storages are aligned, and then loads its initial state. Once it's loaded, it returns itself.

Very soon, the Processor calls GET functions for all of the FE's request for initial data.

Later, the Processor calls humanSettingsGet, and specifies a sub element of "defaultPersonaGenerationModel". That doesn't exist, so StateManager returns null.

Almost immediately, Processor calls LLM_QueueEnqueue() with a new Request. It adds that to the requests array, which was empty when it pulled from storage.

Within milliseconds, the Processor's loop calls LLM_QueueHighest, so it:
- Finds the highest-prioirity, not processing, oldest record
- Marks it as "processing: true"
- Returns it to the Processor

After some time, it gets a call to persona_add with appropriate data for a persona. It adds it to the Personas[] array with any timestamps, defaults, etc.

Immediately after, it  gets a LLM_QueueFinish with the guid for the only record in the array. It's success, so it simply dequeues it. If it had been "success:false", it would follow the DeadLetter process (for now, just debug log it, but maybe someday we'll figure out a better solution)

Immediately after, it gets a call for persona_getAll and returns the list with the new member.

# Storage

I have 3 storage locations in mind, and two of them are for V1. I'll start with the one that isn't, then the one that's gotta be in scope, then the _stretch goal_

## EI_DATA_PATH

This was one of the first things we did, and one of the things that worked the best. We used an envar to define where the Ei data directory would be, so all of the E2E tests set their own temp space and nothing deleted my personal profile (well, nothing except for me - I deleted it a **lot**). This is where the future TUI-based tool will write its data.

## LOCAL_DATA

Just write to local data. We should also offer a "Download your app state as JSON" 'cause that's just a data call into Processor/StateManager from the FE, then writing a download file.

## flare576.com

This will be an option that users can select. They'll see two boxes and a message that says something akin to:

> WARNING: Your data is yours, and I have no desire to see it, or even to be able to see it.
> When you enter your username + pass phrase, I never see either one. Your computer smashes them together, runs an encryption-grade hasher on them, and then encrypts "the_answer_is_42".
>
> This is your "Id" in my system.
>
> Then, every time you save your profile, it encrypts the entire save file and sends _that_ to my server.
>
> No handshake, no public/private key. I couldn't read your profile if I wanted to.
>
> And no one else can, either.
>
> When you load up on a new device, give the same username + pass phrase. I'll encrypt the same string, get the same ID, and then the app will request your encrypted data with your encrypted ID. Your machines, with your knowledge of that username and that pass phrase,  are the only ones that can make that key.
>
> Any hacker who gets into my DB will see a bunch of encrypted data an no encryption keys.
>
> So - the warning is this: FOR REALLY REAL, DO NOT LOOSE THIS USERNAME OR PASS PHRASE.
>
> If you forget and are still using this computer, just make a new one, and your machine will just write a new record to my DB, and you'll be back to good. The risk is if you get a new machine and don't have access to your old one to reset the login, and don't remember it for the new one.
>
> That'd be sad. Don't be sad - write down your login, and make sure it's UNIQUE.

# Background Tasks

## Ceremony - RIP
~~Throughout the day, different actions will enqueue "ei_validation" records. At a given time each day, Ei will put together 5 of the top-priority items and ask about them in a batch.

Maybe.

I'm not sure that one prompt is really going to be able to handle 5 different reconciliation requests - that's 5 separate topics to parse out, then intent to infer, then intended action... That's a hell of a lot.

I'm keeping it here for now, but I have doubts... Which is why Ei's Heartbeat is so important.~~

We'll still queue up `ei_validations`, but the Ceremony itself has been broken up into Heartbeats, Just-In-Time course corrections, and other core systems to help keep the Entities shiny and new. #long_live_the_new_ceremonies

## Heartbeat

Every persona's heartbeat occurs [persona_delay_setting|30  minutes default] after the "last_event" (or whatever) for that persona. This could be a message from the user, another heartbeat, editing the persona details, one of the persona's messages being marked "Read", etch.

### Non-Ei Personas

Super basic, we enqueue an LLM call for "Should you reach out?" using everything we've learned about that prompt in the PoC.

### Ei Persona

This is an adjustment from the PoC - On Ei's heartbeat, we do an Ei-Specific  check to see if we should reach out - Ei's check needs some filtering/logic in it.

See, in the web interface, the User **ALWAYS** has direct access to their data points... But they're probably not actively monitoring them. Ei's job is figure out what data most looks problematic, and asking the user if it's OK.

Right now, the best mechanism we have for that is the "ei_validation" records in the queue. So, if the "Should I reach out" comes back "Yup, based on the recent history and your role as the curator of the system, you should reach out about [potential problem]," then Ei asks "Hey, did you mean XYZ? If not, you should fix it in your [FACTS|TRAITS|PEOPLE|TOPICS] section!"

Don't try to auto-fix, don't try to parse their intent from their response - tell them "Here's how you fix it the way you want it." The LLM approach already failed once, there's no sense in trying to get it to Understand the failure AND try to fix it.

## Decay

This is the rare example of a scheduled task that DOESN'T need to call an LLM. It should run... every hour? sure, every hour! And it should run on every personaEntity and the HumanEntity. This job simply checks the last time all the Topics on that entity has been "updated", and then applies a decrease to the exposure_current based on that delta, the current level, and math. It should update the last_updated so that next time we run the job we have a new calculation point.

## Expire

Nightly? Or, maybe "Nightly, after human hasn't engaged for an hour"?

This is a new concept in the system, but essentially "What topics should we no longer track for this entity." 

For Personas, it's designed to account for dramatic shifts in Trait or Description - like if we add "Loves sea shanties and booty" to a Persona, and the user changes their "Talks like a Pirate" Trait to `strength: 0.0` and `sentiment: -1.0`, we probably need to clear out that Topic.

For Humans, I don't know how we'd phrase the prompt, or what metrics we'd use, but I'd imagine it'd be something along the lines of "If the following are all true:
- User's `sentiment` is near zero
- User's `exposure_ideal` is between .2 and .5
    * at over .5, it's a topic they do enjoy talking about
    * at under .2, they actively DO NOT want to talk about ti, so we want to track it so that we don't accidentally
- User's `description` indicates they ignored prompts to talk about it, or indicated they weren't interested in it.

In any case, the reason for pruning is partially for prompt optimization, but also to allow the Explore job

## Explore

Right after Expire, this is a new prompt we added at the end of the PoC, so still needs testing and evaluation, but essentially let's the Persona flesh out their topics a bit, but not feel as random as "Pick a new topic" and start talking about the chemical composition of cheese.

## Exposure

THIS is the biggest departure from the current system. Right now, we run an Exposure check on EVERY three-step human check AND in the one-shot Persona Topic scan.

That was always stupid, and I just didn't realize it.

There's no way we can determine how much "Exposure" a conversation had for a given topic until that conversation is over. We should do this calculation at LEAST an hour after the human has stopped talking, either to the system, or about that topic, and then run the assessment across each Persona and compound the results.

We could accomplish this two ways. The first is to use our `data` element in our LLM query to make a list of all the personas, then each time that LLM_Request is processed, the callback takes one Persona out of the queue and pushes one result into another ("assessments?" queue. When the persona list is empty, we can look at the "assessments" queue and say "ok, none, none, high, high - if two Personas spent signification time talking about this topic, it's an overall base change of .4 Exposure)."

We'd then pass 0.4 into an algorithm with that topic to determine how impactful that is to it, using a similar log scale (so, if the topic was at 0.0 exposure, we might apply a full 0.4 swing. If it was already at 0.8, the change we apply would be smaller - it takes more exposure to push the CURRENT exposure up).

I think we could apply the same mentality to the individual persona's topics as well - this may even make sense to do as the first part of their "Exposure -> Decay -> Expire -> Explore" flow.

# Things that we need to change from V0

- Don't call anything "level_current" or similar - its `strength` or `sentiment` or `exposure` or other descriptive name.
- Treat V0 as a Proof Of Concept - copy _ideas_, not code from it.
    * Even the prompts - double check that they make sense, and that it's the right "version" of the prompt. We have a lot of experiments and old data in that system. When in doubt - ASK FLARE!
        + Every prompt is going to need to define its expected "data" shape anyway, so take these slow - in fact, each probably deserves its own ticket with the fields defined so that the planner investigates, and the ticket execution agent DOUBLE CHECKS.
- I want to provide a whole "Edit My Profile" and "Edit Persona" interface, where we break our JSON objects for these Entities into panes/panels for the user to edit. We're not constrained by a TUI anymore, and it's all THEIR data
- I want an interface where the user can easily set a "Context Window" for a Persona - a PAIR of cut-off points for their current conversation (start and end, so they can resume a prior conversation). After setting the dates, they can further toggle OFF messages they don't want in context.
    * Yes, this means we need a flag on the Message object for "inContext" that we set as they user adjusts those. One of the (many) reasons we're switching to StateManager's in-memory state

# First Order of Business - Validation

I actually don't know if we can hit LM Studio from
- another web app running on Port 3000 (or whatever)
- A github Pages page
- A sub-page off of flare576.com (my domain)

# Second Order of Business - Analysis

Look through the PoC and determine the contracts between every layer:

- Every Entity+Result for Ei_Interface (the Processor -> FE hooks)
    * personaMessageAdded
    * personaAdded
    * personaMessageQueued
    * ...
- Every Processor function (the FE -> Processor data layer)
    * CREATE
        + createPersona
        + addPersonaMessage
        + ...
    * READ
        + getPersonaList
        + getPersonaMessages
        + ...
    * UPDATE
        + setPersonaMessagesInContext
        + ...
    * DELETE
        + removePersonaMessage
        + removePersona
        + archivePersona
        + ...
- Every state+modification function (the Processor -> stateManager layer)
    * persona_add
    * persona_delete
    * human_fact_add
    * human_fact_update
    * LLM_QueueHighest
    * LLM_QueueFinish
    * LLM_QueueDeadLetter // could combine with Finish if we wanted - just need to pass in a success flag
    * ...
- Every "data" payload for the prompts

And we write them all as "Source Of Truth For Naming Stuff" - (note: I tried to keep typos out of the stuff above, but please don't treat my brain dump as gospel - we should decide on a naming pattern and use it sanely)

# Third Order of... you get it

Move all project contents under a v0 folder and put an AGENTS.md file in the root that makes it EXPLICIT AND CLEAR to all future agents that the code in that folder is for "Inspiration, not Truth" and that the doc we create out of the step above is the Source of Truth - if a ticket uses a different name for a thing, STOP and ASK.

Then we take my brain dump, your questions, my answers, my questions.... nd we make a new set of /tickets for V1.

Then... we march.
