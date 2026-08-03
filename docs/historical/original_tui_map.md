Events:
```yaml
- onPersonaAdded
    - refresh left panel (for new item)
- onPersonaRemoved
    - refresh left panel (for removed item)
- onPersonaUpdated
    - refresh left panel (for name/desc)
- onMessageAdded
    - refresh left panel (for unread/not thinking/etc.)
    - if active && at bottom: append to ChatHistory, scroll to bottom
    - else if active: append to ChatHistory
- onMessageProcessing
    - refresh left panel (for thinking indicator)
    - refresh queue information
- onMessageQueued
    - refresh queue information
    - if human: add to ChatHistory
- onMessageRecalled
    - Parse event for message, append to top of input box
    - Pause Persona
- onHumanUpdated
    - Maybe bold/highlight some UI element for a moment? Maybe nothing
- onQuoteAdded
    - Change font color of font in chatHistory
- onQuoteUpdated
    - Not sure, maybe bold for a moment?
- onQuoteRemoved
    - Remove special formatting if it was the last reference to that quote
- onQueueStateChnge
    - Retrieve queue count, update queue information
- onError
    - Update bottom status line near queue information
- onCheckpointStart
    - Update bottom status line near queue information
- onCheckpointCreated
    - Update bottom status line near queue information
    - Pull info for listing
- onCheckpointRestored
    - Update bottom status line near queue information
- onCheckpointDeleted
    - Update bottom status line near queue information
    - Pull info for listing
- onContextBoundaryChanged
    - display "New Conversation Started" in chat history
```

Processor Calls
```yaml
- start
    * Builtin
- stop
    * /quit
        + f : force/fast - don't go through save process
- getPersonaList
    * Builtin (on startup)
    * /p[ersona] - no argument lists "unarchived" personas
    * /a[rchive] - no argument lists "archived" personas
    * /p[ersona] [existing] - switch to persona
- getPersona
    * /d[etails] - no argument - $EDITOR for active persona
    * /d[etails] [existing] - $EDITOR for provided persona
    * /d[etails] [unknown] - error in status area
    * [Tab] key
- createPersona
    * /p[ersona] [unknown] - Promp to create, $EDITOR for new persona
- archivePersona
    * /a[rchive] - no argument defaults to active
    * /a[rchive] [existing] - archive provided persona
    * /a[rchive] [unknown] - error in status area
- unarchivePersona
    * /unarchive [existing] - archive provided persona
    * /a[rchive] [unknown] - error in status area
- deletePersona
    * /delete - no arguments defaults to active
    * /delete [existing] - delete provided persona
    * /delete [unknown] - error in status area
    * NOTE: always asks in status area, Y/N
- updatePersona
    * /d[etails] save/exit
- getGroupList
    * Builtin when generating the Persona editor
- getMessages
    * Builtin on switching/new/etc.
    * "Scroll to bottom if at bottom" - OpenCode Functionality
- sendMessage
    * [Enter] key
- setContextBoundary
    * /n[ew]
- setMessageContextStatus
    * /context - $EDITOR showing messages history as YAML w/ context status
- markMessageRead
    * Builtin on "read" if possible, otherwise only markAllMessagesRead
- markAllMessagesRead
    * Builtin on having persona active for > 5 seconds
- recallPendingMessages
    * [Up] arrow key at "Top" of input box (OpenCode functionality)
- getHuman
    * /me - $EDITOR showing human data as YAML
    * /settings - $EDITOR for "settings"-type information
- updateHuman
    * /me - save/exit
    * /settings - save/exit
- upsert*
    * /me - save/exit
    * /fact, /trait, /person, /topic - $EDITOR to create new
- removeDataItem
    * /me - save/exit
- [add|update|remove|get]Quotes
    * /quotes - $EDITOR showing quotes
    * /quotes [me] - $EDITOR showing quotes for user
    * /quotes [persona] - $EDITOR showing quotes for persona
- getQuotesForMessage
    * Builtin on rendering message history
- getCheckpoints
    * /load - no arguments lists checkpoints
- createCheckpoint
    * /save [1|2|3|4|5] (name) - number required, name optional, cannot be 'remote'
- deleteCheckpoint
    * /deleteSave [1|2|3|4|5] - number required
- restoreCheckpoint
    * /load [1...15 or "Name"] - error when not found or invalid number
- exportState
    * /export (filePath) - default to $EI_DATA_DIR/exports/{datetime}.jsonc
- importState*
    * /import (filePath) - default to $EI_DATA_DIR/exports/{datetime}.jsonc
- getStorageState
    * /settings
- restoreFromState
    * /load remote
- abortCurrentOperation
    * [Escape] key
    * [Ctrl+C] key - when input blank
- resumeQueue
    * [Escape]
```

> * `importState` exists in processor but isn't in CONTRACTS.md

# Other slash commands

## EZ Persona Management (all of these can be done via /details)

```yaml
- /pause (persona) (duration)
    - default to active persona
    - default to infinity
    - parse "Duration" (30m, 1h, 10d, etc.)
    - set persona's `is_paused` value
- /resume (persona)
    - default to active persona
    - unset persona's `is_paused` value
- /nick (nickname)
    * Default: show active Persona's nicknames
    * Add nickname to persona
    * NOTE: Removal can be done with /d[etails]
- /model (provider:model|clear)
    * Default: show active Persona's model (if default, show Default - provider[:model])
    * if "clear" - unset persona's model
    * else Set active persona's model
- /g[group] (group)
    - Default: Show active persona's group
    - Set active person's group
- /gs, /groups (group)
    - Default: Show active persona's visible groups
    - Append to Set active person's groups
    - NOTE: removal can be done with /d[etails]
- /hb, /heartbeat (duration)
    * Default: Show active persona's heartbeat duration
    - parse "Duration" (30m, 1h, 10d, etc.), SET
- /cw, /contextWindow (duration)
    * Default: Show active persona's contextWindow value
    - parse "Duration" (30m, 1h, 10d, etc.), SET
```

## Self-service

```yaml
- /fact, /trait, /person, /topic
    * Open $EDITOR with fields for the entity to insert new
- /facts, /traits, /people, /topics
    * Open $EDITOR similar to /me, but filtered to just one dataType
- /e[ditor]
    * Open $EDITOR with
        + Any PENDING messages
        + Any content in INPUT box
    * on exit, write contents to INPUT box
- /h[elp]
    * Opens helpful tips overlay (OpenCode functionality)
```

# Additional Thoughts & Requirements

## Focus

I haven't been able to find a method of changing focus between the input box and the other panels. This would be a neat feature, but I definitely do not want to force the UI to allow it - being able to see the list of personas and their states on the left is enough.

## Scrolling

PageUp/Down should always scroll the chat history, regardless of overlays or focus.

## Lists

OpenCode has a feature where if you type `/`, it opens a listing of commands. As you type, it filters the commands. We should have that - I don't know if that's an OpenTUI functionality or an OpenCode one, but I think it's just a fuzzy-search on the commands/descriptions.

If you hit Enter/Tab while one is selected (say, `/agents`), it will open an overlay with your options (**AgentName** _agent description in gray_). This would be great for any feature where the default behavior is a list. It may be possible to catch different keys when this interface is open, so `d` could delete the Persona Nickname, Groups entry, or even Topic/Trait/etc., or `e` could open that specific entity in the $EDITOR.
