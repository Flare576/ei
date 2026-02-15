# 0141: TUI Basic Commands

**Status**: PENDING
**Depends on**: 0139 (TUI Slash Command Foundation), 0140 (TUI Persona Switching)
**Priority**: High (TUI V1.2)

## Summary

Implement the essential conversation management commands: `/new`, `/pause`, `/resume`, and `/model`. These commands control the active conversation session without requiring the full $EDITOR integration.

## Background

Users need quick ways to:
- Start fresh conversations without losing history (`/new`)
- Temporarily pause a persona from responding (`/pause`)
- Resume a paused persona (`/resume`)
- Check or change the model being used (`/model`)

These are "inline" commands that execute immediately and show results in the StatusBar, unlike $EDITOR commands that open external editors.

## Acceptance Criteria

### /new Command (Context Boundary)

- [ ] `/new` or `/n` starts a new conversation with active persona
- [ ] Calls `processor.setContextBoundary(personaName)`
- [ ] Shows "── New Conversation ──" divider in chat history
- [ ] StatusBar shows "New conversation started"
- [ ] Previous messages remain visible but are outside context window

### /pause Command

- [ ] `/pause` pauses the active persona indefinitely
- [ ] `/pause 30m` pauses for 30 minutes (duration parsing)
- [ ] `/pause 2h` pauses for 2 hours
- [ ] `/pause <persona>` pauses a specific persona
- [ ] `/pause <persona> 1d` pauses specific persona for 1 day
- [ ] StatusBar shows "Paused [persona] until [time]" or "Paused [persona] indefinitely"
- [ ] Sidebar shows paused indicator (e.g., `⏸` or dimmed)
- [ ] Cannot pause when only one unpaused persona exists (error)

### /resume Command

- [ ] `/resume` or `/r` resumes the active persona
- [ ] `/resume <persona>` resumes a specific persona
- [ ] `/resume all` resumes all paused personas
- [ ] StatusBar shows "Resumed [persona]"
- [ ] If persona wasn't paused, shows "Already active"

### /model Command

- [ ] `/model` shows current model for active persona
- [ ] `/model clear` clears persona-specific model (uses default)
- [ ] `/model <provider:model>` sets persona's model
- [ ] Format: `provider:model` (e.g., `openai:gpt-4o`, `local:gemma-3`)
- [ ] StatusBar shows current/new model
- [ ] Invalid model format shows error

### Duration Parsing

- [ ] Parse formats: `30m`, `2h`, `1d`, `1w`
- [ ] Support full words: `30min`, `2hours`, `1day`, `1week`
- [ ] Invalid format shows error with examples

## Technical Design

### Duration Parser Utility

```typescript
// tui/src/util/duration.ts
export function parseDuration(input: string): number | null {
  const match = input.match(/^(\d+)(m|min|h|hour|d|day|w|week)s?$/i);
  if (!match) return null;
  
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  
  const multipliers: Record<string, number> = {
    m: 60 * 1000,
    min: 60 * 1000,
    h: 60 * 60 * 1000,
    hour: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
  };
  
  return value * (multipliers[unit] || 0);
}

export function formatDuration(ms: number): string {
  if (ms >= 7 * 24 * 60 * 60 * 1000) return `${Math.floor(ms / (7 * 24 * 60 * 60 * 1000))}w`;
  if (ms >= 24 * 60 * 60 * 1000) return `${Math.floor(ms / (24 * 60 * 60 * 1000))}d`;
  if (ms >= 60 * 60 * 1000) return `${Math.floor(ms / (60 * 60 * 1000))}h`;
  return `${Math.floor(ms / (60 * 1000))}m`;
}
```

### Command Implementations

```typescript
// tui/src/commands/new.ts
export const newCommand: Command = {
  name: "new",
  aliases: ["n"],
  description: "Start a new conversation",
  usage: "/new",
  
  async execute(args, ctx) {
    const persona = ctx.getActivePersona();
    if (!persona) {
      ctx.showNotification("No active persona", "error");
      return;
    }
    
    await ctx.processor.setContextBoundary(persona.name);
    ctx.showNotification("New conversation started", "info");
  }
};

// tui/src/commands/pause.ts
export const pauseCommand: Command = {
  name: "pause",
  aliases: [],
  description: "Pause a persona",
  usage: "/pause [persona] [duration]",
  
  async execute(args, ctx) {
    let personaName = ctx.getActivePersona()?.name;
    let duration: number | null = null;
    
    // Parse args: could be [persona], [duration], or [persona duration]
    for (const arg of args) {
      const d = parseDuration(arg);
      if (d !== null) {
        duration = d;
      } else {
        personaName = arg;
      }
    }
    
    if (!personaName) {
      ctx.showNotification("No persona specified", "error");
      return;
    }
    
    // Calculate pause_until: 0 = indefinite, timestamp = until then
    const pauseUntil = duration ? Date.now() + duration : 0;
    await ctx.processor.updatePersona(personaName, { pause_until: pauseUntil });
    
    const msg = duration 
      ? `Paused ${personaName} for ${formatDuration(duration)}`
      : `Paused ${personaName} indefinitely`;
    ctx.showNotification(msg, "info");
  }
};

// tui/src/commands/resume.ts
export const resumeCommand: Command = {
  name: "resume",
  aliases: ["r"],
  description: "Resume a paused persona",
  usage: "/resume [persona|all]",
  
  async execute(args, ctx) {
    if (args[0] === "all") {
      const personas = ctx.processor.getPersonaList({ archived: false });
      for (const p of personas) {
        if (p.pause_until !== 1) { // 1 = not paused
          await ctx.processor.updatePersona(p.name, { pause_until: 1 });
        }
      }
      ctx.showNotification("Resumed all personas", "info");
      return;
    }
    
    const personaName = args[0] || ctx.getActivePersona()?.name;
    if (!personaName) {
      ctx.showNotification("No persona specified", "error");
      return;
    }
    
    await ctx.processor.updatePersona(personaName, { pause_until: 1 });
    ctx.showNotification(`Resumed ${personaName}`, "info");
  }
};

// tui/src/commands/model.ts
export const modelCommand: Command = {
  name: "model",
  aliases: [],
  description: "View or set persona model",
  usage: "/model [provider:model|clear]",
  
  async execute(args, ctx) {
    const persona = ctx.getActivePersona();
    if (!persona) {
      ctx.showNotification("No active persona", "error");
      return;
    }
    
    if (args.length === 0) {
      const model = persona.model || "(default)";
      ctx.showNotification(`Model: ${model}`, "info");
      return;
    }
    
    if (args[0] === "clear") {
      await ctx.processor.updatePersona(persona.name, { model: undefined });
      ctx.showNotification("Model cleared (using default)", "info");
      return;
    }
    
    const model = args[0];
    if (!model.includes(":")) {
      ctx.showNotification("Format: provider:model (e.g., openai:gpt-4o)", "error");
      return;
    }
    
    await ctx.processor.updatePersona(persona.name, { model });
    ctx.showNotification(`Model set to ${model}`, "info");
  }
};
```

### Sidebar Pause Indicator

```typescript
// tui/src/components/Sidebar.tsx (modification)
function PersonaItem(props: { persona: Persona; isActive: boolean }) {
  const isPaused = () => {
    const pu = props.persona.pause_until;
    return pu === 0 || (pu > 1 && pu > Date.now());
  };
  
  return (
    <text dim={isPaused()}>
      {isPaused() ? "⏸ " : "  "}
      {props.persona.name}
    </text>
  );
}
```

## File Changes

```
tui/src/
├── commands/
│   ├── new.ts           # /new command
│   ├── pause.ts         # /pause command
│   ├── resume.ts        # /resume command
│   └── model.ts         # /model command
├── util/
│   └── duration.ts      # Duration parsing utilities
└── components/
    └── Sidebar.tsx      # Add pause indicator
```

## Testing

### Prerequisites

Before starting work on this ticket:
- [ ] Run `npm run test:all` from project root - all tests must pass
- [ ] Run `npm run test:e2e` from `tui/` - all TUI E2E tests must pass

### Unit Tests

- [ ] Duration parser handles all formats (30m, 2h, 1d, 1w)
- [ ] Duration parser handles full words (30min, 2hours, 1day, 1week)
- [ ] Duration parser rejects invalid input (returns null)
- [ ] Duration formatter outputs correct shorthand

### E2E Tests

- [ ] `/new` shows "── New Conversation ──" divider in chat
- [ ] `/new` StatusBar shows "New conversation started"
- [ ] `/pause` pauses active persona, sidebar shows ⏸ indicator
- [ ] `/pause 30m` sets correct expiration time
- [ ] `/pause <persona>` pauses specific persona
- [ ] `/pause` with only one unpaused persona shows error
- [ ] `/resume` clears pause, sidebar indicator removed
- [ ] `/resume <persona>` resumes specific persona
- [ ] `/resume all` clears all pauses
- [ ] `/resume` on non-paused persona shows "Already active"
- [ ] `/model` shows current model in StatusBar
- [ ] `/model openai:gpt-4o` sets model, StatusBar confirms
- [ ] `/model clear` removes model override
- [ ] `/model invalidformat` shows format error

### Post-Implementation

- [ ] Run `npm run test:all` - all tests still pass
- [ ] Run `npm run test:e2e` from `tui/` - all tests pass including new ones

## Notes

- `pause_until` values: `1` = not paused, `0` = paused indefinitely, `>1` = paused until timestamp
- Duration parsing could be extracted to shared utility (also useful for heartbeat, context window)
- Consider `/model list` to show available models (future enhancement, requires provider interrogation)
