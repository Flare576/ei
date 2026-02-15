# 0140: TUI Persona Switching

**Status**: DONE
**Depends on**: 0139 (TUI Slash Command Foundation)
**Priority**: High (TUI V1.2)

## Summary

Implement persona switching in the TUI via `/persona` command and Tab-completion through the persona list. This is the core navigation feature that makes the TUI usable for actual conversations.

## Background

Currently the TUI displays personas in the sidebar but provides no way to switch between them. Users need to:
1. See which personas exist (sidebar shows this)
2. Switch to a different persona to chat
3. Quickly cycle through personas (Tab key)
4. Create new personas when needed

## Acceptance Criteria

### /persona Command

- [x] `/persona` or `/p` with no args shows persona list overlay
- [x] `/persona <name>` switches to matching persona (case-insensitive, partial match)
- [x] `/persona <unknown>` prompts: "Create persona '<name>'? (y/N)"
  - [x] If confirmed, calls `processor.createPersona(name)` and switches to it
  - [x] If declined, shows "Cancelled" in StatusBar
- [x] Active persona highlighted in sidebar after switch
- [x] Chat history updates to show new persona's messages

### Tab Cycling

- [x] Tab key (when input is empty) cycles through unarchived personas
- [x] Cycle order: alphabetical by name
- [x] Visual feedback: brief highlight animation on sidebar item
- [x] If only one persona exists, Tab does nothing (no-op)

### Persona List Overlay

- [x] Shows all unarchived personas with: **Name** _description snippet_
- [x] Current persona marked with `>` or highlight
- [x] j/k to navigate list (vim-style)
- [x] Enter to select and switch
- [x] Escape to dismiss without switching
- [x] `/` in overlay filters the list (fuzzy search on name)

### /archive Command

- [x] `/archive` or `/a` with no args shows archived personas overlay
- [x] `/archive <name>` archives the named persona
- [x] `/archive` with no args and no archived personas shows "No archived personas"
- [x] Cannot archive the currently active persona (show error)

### /unarchive Command

- [x] `/unarchive <name>` unarchives and switches to the persona
- [ ] Tab-completion for archived persona names (deferred - requires input autocomplete infrastructure)

## Technical Design

### Persona Switching Flow

```typescript
// tui/src/commands/persona.ts
export const personaCommand: Command = {
  name: "persona",
  aliases: ["p"],
  description: "Switch persona or list all personas",
  usage: "/persona [name]",
  
  async execute(args, ctx) {
    if (args.length === 0) {
      // Show persona list overlay
      ctx.showOverlay(() => (
        <PersonaListOverlay
          personas={ctx.processor.getPersonaList({ archived: false })}
          onSelect={(name) => {
            ctx.processor.setActivePersona(name);
            ctx.hideOverlay();
          }}
          onDismiss={ctx.hideOverlay}
        />
      ));
      return;
    }
    
    const name = args.join(" ");
    const personas = ctx.processor.getPersonaList({ archived: false });
    const match = personas.find(p => 
      p.name.toLowerCase().includes(name.toLowerCase())
    );
    
    if (match) {
      ctx.processor.setActivePersona(match.name);
      ctx.showNotification(`Switched to ${match.name}`, "info");
    } else {
      // Prompt to create
      ctx.showOverlay(() => (
        <ConfirmOverlay
          message={`Create persona '${name}'?`}
          onConfirm={async () => {
            await ctx.processor.createPersona(name);
            ctx.processor.setActivePersona(name);
            ctx.hideOverlay();
          }}
          onCancel={ctx.hideOverlay}
        />
      ));
    }
  }
};
```

### Tab Cycling Implementation

```typescript
// tui/src/context/keyboard.tsx
// Add to existing keyboard handler

if (key.name === "tab" && inputIsEmpty()) {
  const personas = processor.getPersonaList({ archived: false });
  if (personas.length <= 1) return;
  
  const currentIndex = personas.findIndex(p => p.name === activePersona());
  const nextIndex = (currentIndex + 1) % personas.length;
  processor.setActivePersona(personas[nextIndex].name);
}
```

### Persona List Overlay Component

```typescript
// tui/src/components/PersonaListOverlay.tsx
export function PersonaListOverlay(props: {
  personas: Persona[];
  currentPersona: string;
  onSelect: (name: string) => void;
  onDismiss: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [filter, setFilter] = createSignal("");
  
  const filtered = () => props.personas.filter(p =>
    p.name.toLowerCase().includes(filter().toLowerCase())
  );
  
  useKeyboard((event) => {
    if (event.key === "j") setSelectedIndex(i => Math.min(i + 1, filtered().length - 1));
    if (event.key === "k") setSelectedIndex(i => Math.max(i - 1, 0));
    if (event.key === "Enter") props.onSelect(filtered()[selectedIndex()].name);
    if (event.key === "Escape") props.onDismiss();
    // Filter input handling...
  });
  
  return (
    <box /* overlay styling */>
      <text>Select Persona</text>
      <text dim>Filter: {filter() || "(type to filter)"}</text>
      <For each={filtered()}>
        {(persona, i) => (
          <text 
            bold={i() === selectedIndex()}
            inverse={persona.name === props.currentPersona}
          >
            {i() === selectedIndex() ? ">" : " "} {persona.name}
            <text dim> - {persona.description?.slice(0, 40)}...</text>
          </text>
        )}
      </For>
      <text dim>j/k: navigate | Enter: select | Esc: cancel</text>
    </box>
  );
}
```

## File Changes

```
tui/src/
├── commands/
│   ├── persona.ts       # /persona command
│   └── archive.ts       # /archive, /unarchive commands
├── components/
│   ├── PersonaListOverlay.tsx  # Persona selection overlay
│   └── ConfirmOverlay.tsx      # Generic yes/no confirmation
└── context/
    └── keyboard.tsx     # Add Tab cycling handler
```

## Testing

### Prerequisites

Before starting work on this ticket:
- [x] Run `npm run test:all` from project root - all tests must pass
- [x] Run `npm run test:e2e` from `tui/` - all TUI E2E tests must pass

### Unit Tests

- [x] Partial name matching finds correct persona (exact > starts-with > contains)
- [x] Tab cycling wraps around correctly
- [x] Tab cycling with single persona is no-op

### E2E Tests

- [x] `/persona` shows persona list overlay
- [x] `/persona partial` switches to matching persona
- [x] `/persona unknown` prompts to create, confirm creates and switches
- [x] `/persona unknown` prompts to create, cancel shows "Cancelled"
- [x] Tab cycles through personas (verify sidebar highlight updates)
- [ ] j/k navigation in persona list overlay works (deferred - terminal.write() sends chars to filter, not nav)
- [ ] Filter in overlay narrows list (implemented but not E2E tested)
- [x] Escape dismisses overlay
- [x] `/archive <name>` archives persona, sidebar updates
- [x] `/archive` (active persona) shows error
- [x] `/unarchive <name>` unarchives and switches

### Post-Implementation

- [x] Run `npm run test:all` - all tests still pass
- [x] Run `npm run test:e2e` from `tui/` - all tests pass including new ones

## Notes

- Partial matching should prefer exact match > starts-with > contains
- Consider adding Shift+Tab for reverse cycling (future enhancement)
- The overlay pattern established here will be reused for checkpoints, quotes, etc.
