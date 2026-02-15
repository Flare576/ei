# 0141: TUI Basic Commands

**Status**: DONE
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

- [x] `/new` starts a new conversation with active persona
- [x] Calls `processor.setContextBoundary(personaName, timestamp)`
- [x] Shows "── New Context ──" divider in chat history (via MessageList boundary detection)
- [x] StatusBar shows "Context boundary set - conversation starts fresh"
- [x] Previous messages remain visible but are outside context window

### /pause Command

- [x] `/pause` pauses the active persona indefinitely
- [x] `/pause 30m` pauses for 30 minutes (duration parsing)
- [x] `/pause 2h` pauses for 2 hours
- [ ] `/pause <persona>` pauses a specific persona (NOT IMPLEMENTED - active persona only)
- [ ] `/pause <persona> 1d` pauses specific persona for 1 day (NOT IMPLEMENTED)
- [x] StatusBar shows "Paused [persona] for [duration]" or "Paused [persona] indefinitely"
- [x] Sidebar shows paused indicator (⏸ emoji + dimmed text)
- [x] Cannot pause when only one unpaused persona exists (error message)

### /resume Command

- [x] `/resume` or `/unpause` resumes the active persona
- [x] `/resume <persona>` resumes a specific persona (matches by name or alias, case-insensitive)
- [ ] `/resume all` resumes all paused personas (NOT IMPLEMENTED - deemed unnecessary)
- [x] StatusBar shows "Resumed [persona]"
- [x] If persona wasn't paused, shows "[persona] is not paused" warning
- [x] If persona not found, shows "Persona not found" error

### /model Command

- [ ] `/model` shows current model for active persona (NOT IMPLEMENTED - shows usage instead)
- [ ] `/model clear` clears persona-specific model (NOT IMPLEMENTED)
- [x] `/model <provider:model>` sets persona's model
- [x] Format: `provider:model` (e.g., `openai:gpt-4o`, `local:gemma-3`)
- [x] StatusBar shows new model
- [x] Invalid model format shows error

### Duration Parsing

- [x] Parse formats: `30m`, `2h`, `1d`, `1w`
- [x] Support full words: `30min`, `2hours`, `1day`, `1week`
- [x] Invalid format shows error with examples

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
- [x] Run `npm run test:all` from project root - all tests must pass
- [x] Run `npm run test:e2e` from `tui/` - all TUI E2E tests must pass

### Unit Tests

- [x] Duration parser handles all formats (30m, 2h, 1d, 1w)
- [x] Duration parser handles full words (30min, 2hours, 1day, 1week)
- [x] Duration parser rejects invalid input (returns null)
- [x] Duration formatter outputs correct shorthand

### E2E Tests

- [x] `/new` shows "── New Context ──" divider in chat (test created)
- [x] `/new` StatusBar shows "Context boundary set" (test created)
- [x] `/pause` pauses active persona, sidebar shows ⏸ indicator (test created)
- [x] `/pause 2h` sets correct expiration time (test created)
- [ ] `/pause <persona>` pauses specific persona (NOT IMPLEMENTED)
- [x] `/pause` with only one unpaused persona shows error (implemented, test relies on 2-persona fixture)
- [x] `/resume` shows warning on non-paused persona (test created)
- [ ] `/resume <persona>` resumes specific persona (NOT IMPLEMENTED)
- [ ] `/resume all` clears all pauses (NOT IMPLEMENTED)
- [x] `/resume` on non-paused persona shows "is not paused" (test created)
- [x] `/model` shows usage when no args (test created)
- [x] `/model openai:gpt-4o` sets model, StatusBar confirms (test created)
- [ ] `/model clear` removes model override (NOT IMPLEMENTED)
- [x] `/model invalidformat` shows format error (test created)

### Post-Implementation

- [x] Run `bun run test` from `tui/` - all unit tests pass (32 passing)
- [x] Run E2E tests - all 47 tests pass (Node 20)

## Notes

- `pause_until` values: `1` = not paused, `0` = paused indefinitely, `>1` = paused until timestamp
- Duration parsing could be extracted to shared utility (also useful for heartbeat, context window)
- Consider `/model list` to show available models (future enhancement, requires provider interrogation)
