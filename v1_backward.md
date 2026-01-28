The first v1 doc I wrote established the HOW of the system - the core architectural systems we'll use to make it work.

This one is about working backwards from that - starting with the User. Treat this a non-designer's "Low-fidelity wire frame", but with words. Nothing is set in stone, and I don't know exactly how any of it should look, what images to use, etc., I'm just talking about what the user can DO with the system, and how I envision them doing it.

# First Touch

When a user first hits the page, they should be greeted with an explanation of what the tool is and why it's different - privacy-first, local-first, You-nified context. They should have a call-to-action to enter their username/pass phrase if they're just switching devices, or to continue to initial settings.

Username/pass phrase should run the encryption flow and get their latest settings from flare576.com, then load them into the system*.

> * Note: in this document I won't be distinguishing between Processor, FE, etc. as frequently - it's about the user's experience

Otherwise, the system will walk them through:

1. Do you have a local LLM API? If so, what is the URL, is there an API key, is CORS enabled, etc.
2. If not, which systems do you have an account with? Anthropic/OpenAi/Google
    a. How do you want to auth? API Key, oAuth, etc.
3. Would you like to start with our recommended models for your access, or do you have your own in mind?
    a. Responses: qwen/qwen3-30b-a3b-2507
    b. Summarization: qwen/qwen3-30b-a3b-2507
    c. Topic Matching: qwen/qwen3-30b-a3b-2507

We save their settings, the setup screen fades, and the user sees Ei.

# First Sight

I'm still thinking about a 3-panel type of chat interface. First view has Ei's pill on the left, and their welcome message in chat history.

## Left
Full height "Persona" panel. At the top is you're control area, then the list of personas to the bottom of the screen. At the bottom is a small section with green + button 3/4 width to "Add Persona", and a yellow "inbox" or folder or whatever to see Archived Personas.

### Control Area
Settings button, pause button, "?", save UI

#### Settings Button
Settings button opens our "Edit Modal" for the Human entity. This should be a tabbed-navigated editor for the user to see all of their [Settings] - [Facts] - [Traits] - [People] - [Topics] from their entity document.

Each "thing" will have a easy-to-use, meaningful "Card" to edit all of the characteristics of the "thing". For example, on "Traits", each trait will have
- A full-length, single line field for "Name"
- A full-length multi-line editor for "Description"
- A split-pane line with
  - "Learned By: <persona>" on the far left
  - A "sentiment" and "strength" slider middle-aligned,
  - A Save/Restore button on the right, both of which light up when the card data becomes dirty.

Additionally, these should be broken down by "Group" Headings, so "General" would be on top, then "Adventuring", then "Fellowship", etc., letting the user clearly understand that Personas of a given "Group" will only see subsets of the Non-General data.

> Multi-line editor should have two modes; raw markdown and a Rich-Text editor. We should absolutely find the best, most-compatible open-source option out there and leverage it instead of trying to re-invent the wheel. It also has to support emoji... somehow. I'm cool if it just doesn't break if someone uses them, but if it's got a widget to select them, right on.


##### Additional Settings:

In addition to the ones we have, it'd be nice to be able to adjust:
- Name Color (for chat history)
- Name Display (for chat history)
- Time Mode (24h, 12h, Local, UTC)
- Model Defaults
- Account / Provider status

#### Pause Button

Pauses the Processor loop, terminating the current operation if there is one. Under/over/near this should be the activity indicator that we keep up-to-date with events.

While paused, the button displays a pause icon, is red, and pulses slightly. We want the user to feel like the heart of the system is stopped, because it is.

"Escape" anywhere in the tool Pauses/Unpauses

#### "?" Help Button

Opens a modal with help information. I haven't decided what needs to go in here yet because I'm trying to make everything as smooth, easy, and understandable as possible, but whatever help we need to offer, it'll go in here.

#### Save UI

Elegantly allow the user to choose their save slot, save to it as frequently as they like, and load as well. Some interface to allow them to see the list of AutoSaves, and an "Undo" button to step back through them one at-a-time. This "Undo" button should be the last thing in the UI, to make it super clear there's no "Redo."

### Persona List

By default, "Ei - Your System Guide" is there, selected, and waiting to talk!

Each Persona should have a single-line "Pill" with an image on the left (we should generate an image on persona creation somehow - if there's no physical description to the persona, we should be able to get creative) and then their longest alias name and their short description combined, then truncated to fit. Bold name, smaller normal text description right after it.

Their image should feature a "Status circle" in the bottom right - this is where "Thinking" (yellow), "Ready" (green), "unread message" (red... maybe with a number, but that might be ugly) is indicated.

Hovering over a persona gives you a hover tip with their short description as a fly-under (or over, if they're near the bottom of the list) to the persona name pill.

On Hover, the controls appear at the right of the tag are controls: Pause, edit, archive, delete

#### Persona Pause

Disables this persona's
- Idle heartbeat
- Response generation (messages will appear as pending)

Paused Personas display a play icon. It can be yellow, but it should not have the same urgency as the core system being paused.

Hovering over the button for a moment should give you times: 1h, 8h, 24h, [infinity_emoji]. Default should be infinity.

#### Edit

Opens the same "Modal Entity Editor" with [Settings] - [Identity] - [Topics] - [Context]

Settings should be impersonal stuff 
- Heartbeat length
- Default Context Window
- Paused (with time remaining or [infinity_emoji]
- Archived
- "Dynamic" vs "Static"*
    * Default to Dynamic
- LLM Model
- Group [Explain that this is primarily used to compartmentalize Traits and Topics on the User's record]
- Group Visibility [Explain this lets this persona see into multiple "Groups" of your Traits+Topics]
- Etc.

Identity has their Image, Descriptions (long/short), and Traits.
Topics has their topics

>* Dyanmic vs. Static is something I've been thinking about. I know there's at least one persona I do NOT want adapting to their situation - my "Story Co-Writer". If that persona constantly adapted, it would be impossible to write a story with more than two characters! This setting tells the system:
> - Don't do Exposure, Decay, Expire, Explore
> - Don't regenerate Descriptions
> - Don't regenerate Image
> - Don't _add_ HumanEntity records (still read them... I think)

##### Context

This is by far the most complicated interface in my mind. It's hard because there's a lot of variables to control:
1. All Personas have a sliding context window, defaulting to 8h, controlled in [Settings]
2. Every Message can have a `context_status` of Default, Always, and Never
3. We want the user to be able to mark batches of Messages with a given `context_status`
4. We want the user to be able to mark individual Messages with a given `context_status`

I think the best way to do this is to have the "Sliding Context Window" be represented by the background color of the Messages being displayed. If the background is green, the message is within the current Context Window. Gray is outside.

The top of this interface provides a calendar + clock for Start and for End. This is the primary filter for the messages that are displayed below.

The messages below are paginated, 50 at a time, with "Who", "When", "What", and "Context" fields
- Who: "You!" or "<Persona Name>"
- When: Timestamp
- What: truncated message, click to... Pop a modal over the modal? Not sure how to display long texts at ths point
- Context: the current Default|Always|Never
    * Note: "Always" should always have a green bacgkround, "Never" should always be gray, and default should be dependent on the "default window" and current date/time.

The editor lets you mark individual, or "All messages matching time filters".

If you can think of elegant changes or additions, I'm all ears.

#### Archive

Poof. The pill is replaced by a message that says "Archived Personas appear in the [icon] at the bottom!" for 2 seconds, then collapses up.

#### Delete

Do not require archive first. That's stupid.

Warning message flies in, red and angry: "There's no going back!" and under it "[] Also delete any of my traits this Persona learned"

"I'm sure" on the left, "Oops, J/K" on the right.

I have a love/hate relationship with Double-Confirmations - let's not do it. If they really want to undo, Auto-Save is right friggen there.

### Persona Management Buttons

#### New Persona
[  +  ] Big, happy green button to add Personas. Pops up Persona Generator Modal
- Each text box has default/hint text in the box that disappears on focus
- Each Multi-line box is our dual-format Editor
- ... AND, in this interface, each field should have an AI button* on the bottom-right

Initial interface is deceptively simple
- Full-width, single line "Name" field, showing comma delimted names: `Alice, "Alice, the boss", Awesome Alice`
- Full-width, multi-line "Description" field "Tell me about this persona! Optionally, also use the fields below to fine-tune it!"

Under, you can see
- [+ Add Personification]
- [+ Add Communication Style]
- [+ Add Relationships]
- [+ Add Topics of Interest]
- [Select LLM Model]

All but the last one add Persona "Trait" cards with help-text to guide the user on formatting and field intent.

There should be help text next to the [+] with a message akin to "In a hurry? Don't worry! We'll pre-fill some information based on your description, and you can always edit it later via the Persona Edit menu!"

> * AI Button: We should stop re-generating all of the fields on persona creation by default. I've gotten frustrated that I spent a bunch of time describing a persona only to have our system "Process" it and replace t with it's own. Whatever is in the "Description" field when the user submits should be the Persona's starting description... BUT we should give the user the option to use an AI system to help them write the prompt if they want. The AI button should have a quick System prompt that the user wants to generate a [Description], [Personification Trait Name], [Communication Style Description for 'talks fast'] and the user prompt should be whatever they have in the box at the time. 

Once they're done, Persona creation should take place. If there are zero Traits/Topics, we generate a few based on the description. We tell the prompt "THe longer the description, the more [Topics] or [Traits] you should add. If the description is longer than our desired "Short Description," we use an LLM to summarize it for the short description.

#### Archived Personas

Button shows a Modal list of archived personas as cards, Image+ Aliases on top, descriptions on the bottom, like an ID Card, fitting the "folder" button that opens the interface. Simple "unarchive" button at the bottom/right.

## Chat History

Ei's message is waiting for the user, introducing themselves and the system. It asks them for their name.

Ironically, I think this is the ONLY pre-defined, user-facing prompt in the system.

### How It Looks

It should look Compact without looking tight. I know "Whitespace is important," so I need you to keep me from making the UI into something only a dev would enjoy reading, But I also don't think we need massive name tags - There will only ever be TWO people chatting, though both members can easily have back-to-back messages (the AI won't always respond to the user, and the AI will occasionally try to start conversations while the user is away.

When a user first sends a message, it should appear immediately in the Chat History, grayed out until the system processes it for a response. Once the AI responds (or chooses not to), it should be marked Read.

All messages should be rendered as Markdown - bulleted lists, bold, italic, URLs, etc. And god dammit, double-underscore __is underline__ (as is \<ul\>, obviously).

Emoji will be rampant, and should be supported


#### Input Box

It should start thin, expand up to 33% of window height. I don't know how the "Best" input box will handle controls/sending/etc., so I won't prescribe that, but it should grow elegantly as necessary, and stop before it fills the entire screen.

Ideally, by default "Enter" sends the message, and "Shift+Enter" puts in a line break. Changing that behavior would be great "Settings" options, but again, we'll know what our options are soon.

Pressing the [up] arrow at the top of the text box while message(s) are pending does 3 things:
- Interrupts the agent
    * Meaning, if it's processing a Response, it aborts that processing
- Pulls all "Pending" messages back into the Input box
- Removes the "Pending" messages from the Persona's history

Clicking a Pending message does the same thing.

Switching personas should NOT clear out your input

Ctrl+C _should_ clear out your input.

# Keyboard Navigation

Pressing Ctrl+h while in the input box should move focus to the Persona panel, highlighting the active persona.

Up/Down moves through the personas, Enter/Space selects them and moves your cursor back to input. Ctrl+l also moves you back to input.

Left-right arrows on the Pill selects their buttons, and when selected Enter/Space activates them

Page Up/Down always scrolls chat history, regardless of focus. (it's tempting to want to make scroll wheel scroll the Persona list when that's "focused," but then you have to fuck with what persona gets selected when the one you HAVE selected goes off the screen.)

# View Sizes

I know "Mobile first" is a big deal, but let's get desktop working first. I think "thin" is just going to end up with a Persona Pill-as-a-dropdown at the top and an even more compact/mobile looking chat history with a minimal input box, so 

# Technical Notes / Observations

While writing this doc I'm going to hit Engineering/Technical pieces in my head that I won't be able to move past unless I write them down. Those go here.

## "Read" Status on Human Messages

I'd said in V1 we don't need "Read" status for human messages - I was wrong. We need a way to know we've "Processed a Response" for a Human message at least once because the system CAN CHOOSE NOT TO RESPOND. So, the human sends "Goodnight", it should appear "Gray/Processing/Sending/Whatever" until the persona has a chance to see it and decide not to respond, THEN it should get marked "Seen/Read/normal/whatever".
- This would be easy-but-potentially-wasteful by including a full list of all message GUIDS in the `data` payload to the promptGenerator and QueueProcessor. These `data` fields aren't sent raw to the LLM, so they wouldn't clog context, they'd just be stuff that the post-call handler could pull out of the Request and ensure all the messages are marked "read".
    * OH! Easy solution - before we call the prompt generator we HAVE to pull all the messages AND loop through them to make the [messages] part of the PromptGenerator's payload - just do second check on that loop and, if the message is unread, grab it an put it in Data - that way we're not passing 200 guids when there's only 1 new one!

## "Extraction"
I think the reality is that only one Persona really needs to run "Extractions" with the frequency we had in V0 - Ei.

To be clear, an "Extraction" is a process that scaled based on how many of a Data Point type an entity had. e.g., if a Human had 0 traits, "Extraction ran on every message they sent with any persona. If they had 10 or more traits, it was run every 10 messages.

I think that's valuable for Ei, but no other Persona. Those can wait for the nightly Ceremony.

Which actually works really, really well - because we had to invent a really complex tracking system for the human to figure out when they sent "10" messages across every friggen persona.

So, I'm going to stop using the term "Extraction," and talk about "Message Loops"

## Message Loops
Messages come from two sources: The FE (human Input box), and Heartbeats (Persona check-ins)

Both trigger onMessageAdded(), but that's all the Heartbeat does. The Human messages, though...

### Human Messages
Every human message should trigger two things:
- The Persona Response check
    * "Should I respond? With What?" - Exists!
- The Persona Trait Check
    * "Did the human tell me to act a certain way?" - Exists!

Additionally, if the message was sent to Ei, we also do a ScalingHumanSeed check:
- The HumanEntity needs to get a `lastSeeded_[Fact|Trait|Person|Topic]` field that is a timestamp
- On message to Ei, we see how many messages are after that timestamp
- If HumanEntity.[Fact|Trait|Person|Topic].length < messagesSinceTimestamp, we run a Ceremony:Exposure check on the conversation for that Data Point

Ei is the persona that's going to get the most facts, traits, and meaningful information from the user at the start, so parsing the data early makes sense to help the other Personas "Know" the user.

## Background Jobs - "Heartbeat"
We should double-check just to be sure that we don't mark the Topic the Persona asks about as updated/changed so that the decay function can operate on it.

## Background Jobs - "Ceremony"

I'm bringing back the term, but it's so different from the original that you should pretend it's NEW!

This term describes the NIGHTLY background process we use to prune and expand our data: Exposure, Decay, Expire, Explore. There need to be separate prompts/flows for the Human and each Persona.

WARNING: This is yet-another-sweeping-change, but for the human it's only a matter of timing, and for the Persona it's admitting that I was wrong again (the current "Topic" prompt for Personas does 3 or 4 things all-in-one, and we've already proven that **Doesn't Work**)

Ei is always the LAST Persona to run.

### Ceremony - Exposure

For each Persona, Enqueue Step 1 for human [Fact|trait|person|topic], and Step 1 for Persona [Topic]
- Check if Human has interacted. If not, Skip
- Enqueue Step 1 for human [Fact|trait|person|topic], and Step 1 for Persona [Topic]

#### Human Mode
- Queue "Step 1 - Human - [Fact|Trait|Person|Topic] Identification"
    * Exists!
    * This prompt should chain each "entity" to a call for Step 2: "match existing"
        + Exists!
        + This prompt should chain to Step 3: Update
            + Exists!
            + TECHNICALLY, this prompt does "too much" - it expects the agent to, but for now don't worry:
                + See if the `description` of the [Fact|Trait|Person|Topic] should change
                + See if the `sentiment` of the [Fact|Trait|Person|Topic] should change
                + See if the `strength` of a [trait] should change
                + See if the `exposure_desired` of a [topic|person] should change
                + See if the `exposure_current` of a [topic|person] should change
                    + THIS NEEDS SPECIAL HANDLING - we're asking the model for high|medium|low|none, which is correct!
                    + We just need to add logic to Step3's handler to apply this change against a log function to the [topic|person]!

- If new topic, ensure `learned_by` is added.
- If the topic is new, or not "General", ensure this Persona's Group is in the `persona_groups` field
- If the Persona is anyone other than Ei, and the [Fact|Trait|Person|Topic] is General group:
    - add a change log.
    - Add a `ei_validation` queue item, inverse priority to confidence (so, `high` confidence = `low` priority)

#### Persona Mode
- Queue "Step 1 - Persona - [Topic] Identification"
    * Doesn't *Exactly* exist, but we can easily make it from the Human version - it needs to change the focus and probably update the definition slightly ("people" do count as topics to a Persona, for example)
    * This prompt should chain similarly to the Human version for Step 2: match existing"
        + I think we can use the exact same prompt, just with a different handler in the Queue item
        + Step 3: Honestly? This might _also_ be the same prompt, just focused on the Persona side of the conversation. Do an analysis and see if we can make some search/replace keywords, or if we do need a different one (don't force it, file storage is cheep)

Regardless, for any DP that comes back from step 3 with changes, update it in that entity and be sure to set the last_updated timestamp.... because we're about to apply _decay_.

### Ceremony - Decay

There's no LLM call for this - we cycle through the Persona and apply decay to every Topic.

### Ceremony - Expire

I don't think we have a Prompt for this yet, but the stub can be "Find topics that the Persona no longer cares about and remove them. Return the list without the uninteresting topics"

I'm guessing we're going to have to tell the model what each of the fields means, what guidelines it should use, etc., so use what we've already written for the other prompts to give it a starting point, and we'll iterate.

### Ceremony - Explore

An earlier agent DID Make this prompt, but we haven't actually tested it yet to see how it works. I think the idea was that we only execute it if the Persona is "low" on topics after the Expire step.

# Descriptions
After the Persona Update cycle (Exposure, Decay, Expire, Explore), we should send a very, VERY cautious call to the LLM to see if we should update the long description. If it does change, we then call the summary prompt.

In the new system, we're putting a lot more focus on that Persona Builder with AI generation with the human in the loop - we should update only if the LLM sees a drastic departure from the Topics/Traits that have been building out.


### Ceremony - Human

Finally, after all the Personas have had their turn, we apply "Decay" to the Human's Topics and People.

This produces the delta that Ei uses to prompt the user.

Ei cares about _exactly_ what the human cares about - they are the representation of the human in the system. It should ask about topics before they "Expire", and should rely on the human to self-explore, or explore with Personas.


## Change Log

Only the HumanEntity state should get change logs.
- meaning, the PersonaEntity state should NOT track changes.

Only non-Ei Personas should write change logs.
- Meaning, if Ei's "Ceremony" steps result in changes, they are not logged.

Only DataPoints with "General" group should get change logs.

Change Logs should not appear on the Human's Edit interface.

Change logs should capture the prior state of the record before change...
- EXCEPT THE CHANGE LOG FIELD

## Persona Setting - "pause_until"
`is_paused` probably needs to change to `pause_until: string | boolean` and have:
- a timestamp if the pause expires
- `0` if it's not paused
- `1` if it's paused until manually unpaused

# New Contracts


## One-Shot Prompts
Remember how I said that "Events" shouldn't contain data? Well, we both knew that'd break down eventually.

During Persona creation (and anywhere we want to sprinkle it), there's an "AI" button that is designed to help the user write the content for the box... which needs an event loop. It's not hard, but it is _more_ data than we'd planned.

### Events
onOneShotReturned(guid: string, content: string)
- Frontend has to:
    * generate the guid
    * Tie it to a UI element
    * Submit it along with the query to Processor.submitOneShot()
- On call, the FE can update the UI element with the GUID with the CONTENT it receives

### Processor
submitOneShot(guid: string, systemPrompt: string, userPrompt: string)
- enqueues a high-priority LLM call with type 'frontend_oneshot'
  - type: raw? I think?
- New handler: calls onOneShotReturned with guid from data and content from LLM

### State/Storage
No new operations

### 
