# 0139: TUI Slash Command Foundation

**Status**: PENDING
**Depends on**: 0100 (TUI Frontend Skeleton)
**Priority**: High (TUI V1.2)

## Summary

Implement the slash command parsing system for the TUI, including the foundational commands `/quit`, `/help`, and sidebar toggle (`Ctrl+B`). This establishes the command infrastructure that all other TUI features will build upon.

## Background

The TUI currently only supports sending messages. All navigation, configuration, and management must happen via slash commands (following OpenCode's pattern where input is always focused). This ticket creates the command parser and the most essential commands.

## Acceptance Criteria

### Command Parser

- [ ] Detect when input starts with `/`
- [ ] Parse command name and arguments: `/command arg1 arg2 "quoted arg"`
- [ ] Support command aliases (e.g., `/q` → `/quit`, `/h` → `/help`)
- [ ] Show error in StatusBar for unknown commands
- [ ] Commands execute on Enter, not on each keystroke

### /quit Command

- [ ] `/quit` or `/q` exits the application
- [ ] Calls `processor.stop()` before exit (saves state)
- [ ] `/quit!` or `/q!` force-quits without save prompt
- [ ] Show "Saving..." in StatusBar during shutdown

### /help Command

- [ ] `/help` or `/h` shows help overlay
- [ ] List all available commands with brief descriptions
- [ ] Show keybindings (Escape, Ctrl+C, PageUp/Down, etc.)
- [ ] Include the kanji easter egg: `永 (ei) - eternal`
- [ ] Press any key or Escape to dismiss overlay

### Sidebar Toggle

- [ ] `Ctrl+B` toggles sidebar visibility
- [ ] When hidden, chat area expands to full width
- [ ] State persists during session (not across restarts)
- [ ] StatusBar shows indicator when sidebar is hidden (e.g., `[S]`)

## Technical Design

### Command Registry Pattern

```typescript
// tui/src/commands/registry.ts
interface Command {
  name: string;
  aliases: string[];
  description: string;
  usage: string;
  execute: (args: string[], context: CommandContext) => Promise<void>;
}

interface CommandContext {
  processor: Processor;
  showOverlay: (content: JSX.Element) => void;
  hideOverlay: () => void;
  showNotification: (msg: string, level: "error" | "warn" | "info") => void;
  exitApp: () => void;
}

const commands = new Map<string, Command>();

export function registerCommand(cmd: Command) {
  commands.set(cmd.name, cmd);
  cmd.aliases.forEach(alias => commands.set(alias, cmd));
}

export function parseAndExecute(input: string, ctx: CommandContext): boolean {
  if (!input.startsWith("/")) return false;
  
  const [cmdName, ...args] = parseCommandLine(input.slice(1));
  const cmd = commands.get(cmdName);
  
  if (!cmd) {
    ctx.showNotification(`Unknown command: /${cmdName}`, "error");
    return true;
  }
  
  cmd.execute(args, ctx);
  return true;
}
```

### Help Overlay Component

```typescript
// tui/src/components/HelpOverlay.tsx
export function HelpOverlay(props: { onDismiss: () => void }) {
  useKeyboard((event) => {
    props.onDismiss();
  });
  
  return (
    <box /* overlay styling */>
      <text>Ei - 永 - Your Eternal Companion</text>
      <text>Commands:</text>
      {/* command list */}
      <text>Keybindings:</text>
      {/* keybinding list */}
      <text dim>Press any key to dismiss</text>
    </box>
  );
}
```

### Overlay System

Add overlay support to the app layout:

```typescript
// tui/src/context/overlay.tsx
const [overlay, setOverlay] = createSignal<JSX.Element | null>(null);

// In Layout.tsx
<Show when={overlay()}>
  <box /* full-screen overlay container */>
    {overlay()}
  </box>
</Show>
```

## File Changes

```
tui/src/
├── commands/
│   ├── registry.ts      # Command parser and registry
│   ├── quit.ts          # /quit command
│   └── help.ts          # /help command
├── components/
│   ├── HelpOverlay.tsx  # Help screen
│   └── Layout.tsx       # Add sidebar toggle state
├── context/
│   ├── overlay.tsx      # Overlay management
│   └── keyboard.tsx     # Add Ctrl+B handler
└── app.tsx              # Wire up overlay context
```

## Testing

- [ ] Unit test: Command parser handles quoted args, edge cases
- [ ] Unit test: Unknown command shows error
- [ ] Manual test: /quit saves and exits
- [ ] Manual test: /quit! exits without save
- [ ] Manual test: /help shows overlay, any key dismisses
- [ ] Manual test: Ctrl+B toggles sidebar

## Notes

- Keep overlay system generic - other commands will use it (persona list, checkpoint list, etc.)
- The parser should handle edge cases: `/command "arg with spaces"`, `/command`, etc.
- Consider: Should Tab in empty input open command palette? (Future ticket)
