export function buildManPage(): string {
  return `EI(1)                           Ei Terminal UI                          EI(1)

NAME
    ei - local-first AI companion with persistent personas

KEYBINDINGS
    Ctrl+E        Open current input in $EDITOR (preserves text)
    Ctrl+C        Clear input field (second press exits)
    Ctrl+B        Toggle sidebar
    Escape        Abort operation / resume queue
    PageUp/Down   Scroll message history

CORE COMMANDS
    /settings, /set
        Edit global settings in $EDITOR. Configure default model,
        heartbeat interval, context window, integrations, and more.

    /quit, /q
        Save, sync, and exit. Add ! to force quit without syncing: /q!

    /provider
        Open provider picker to select, edit, or create LLM providers.
        /provider <Name>           Set provider on active persona
        /provider <Name>:<Model>   Set provider and model explicitly
        /provider new              Create a new provider

    /me
        Edit your personal data (facts, traits, topics, people) in $EDITOR.
        /me facts     Edit only facts
        /me topics    Edit only topics
        /me people    Edit only people

    /details, /d
        Edit the current persona's details in $EDITOR.
        /d <name>     Edit a specific persona by name

PERSONA COMMANDS
    /persona, /p
        Open persona picker. Switch, list, or create personas.
        /p new <name>              Create a new persona
        /p update <name> [person]  Regenerate persona from a person record

    /context, /messages
        Edit which messages are included in LLM context.

    /pause
        Pause the current persona indefinitely.
        /pause <duration>   Pause for a duration: 2h, 1d, 1w

    /resume, /unpause
        Resume the current paused persona.
        /resume <name>   Resume a specific persona

    /new
        Toggle a context boundary — starts a fresh conversation thread
        without deleting history.

    /quotes, /quote
        Manage quotes attached to messages.
        /quotes <N>            View quotes from message N
        /quotes me             View your own quotes
        /quotes search "term"  Search quotes by keyword
        /quotes <persona>      View a persona's quotes

ROOM COMMANDS
    /room, /r
        Open room picker. Switch or create rooms.
        /room new         Create a new room (FFA, CYP, or MAP mode)
        /room new <name>  Create with a pre-filled name

    /activate, /a
        Advance the active node in a CYP or MAP room.
        /activate <num>   Activate a specific response by number

    /silence
        Pass your turn in a room with an optional reason.
        /silence [reason]

    /capture
        Force-extract quotes, topics, and people from the current chat now.

EXTENDED COMMANDS
    /tools
        Manage tool providers — enable or disable tools per persona.

    /auth
        Authenticate with an external service.
        /auth spotify   Connect your Spotify account

    /queue
        Pause the queue and inspect or edit active items in $EDITOR.

    /dlq
        Inspect and recover failed (dead-letter) queue items in $EDITOR.

    /dedupe
        Find and merge duplicate people or topics.
        /dedupe person Flare "Jeremy Scherer"
        /dedupe topic AI "artificial intelligence"

    /archive
        Archive a persona or room. Lists archived items if no name given.
        /archive <name>   Archive by name

    /unarchive
        Restore an archived persona or room and switch to it.
        /unarchive <name>

    /delete, /del
        Permanently delete a persona. Cannot be undone.
        /delete <name>

    /setsync, /ss
        Set sync credentials (triggers restart).
        /setsync <username> <passphrase>

    /editor, /e, /edit
        Open $EDITOR with the current input field contents.
        Note: Ctrl+E does the same thing without clearing the input first.

TIPS
    - Append ! to any command as shorthand for --force: /quit!
    - Duration strings: 30m, 2h, 1d, 1w (used by /pause, /settings)
    - All editor fields that say "null" inherit from your global settings
    - $EDITOR and $PAGER are respected throughout

Ei - 永 (ei) - eternal
`;
}
