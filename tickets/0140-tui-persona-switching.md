# 0140: TUI Persona Switching

**Status**: PENDING
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

- [ ] `/persona` or `/p` with no args shows persona list overlay
- [ ] `/persona <name>` switches to matching persona (case-insensitive, partial match)
- [ ] `/persona <unknown>` prompts: "Create persona '<name>'? (y/N)"
  - [ ] If confirmed, calls `processor.createPersona(name)` and switches to it
  - [ ] If declined, shows "Cancelled" in StatusBar
- [ ] Active persona highlighted in sidebar after switch
- [ ] Chat history updates to show new persona's messages

### Tab Cycling

- [ ] Tab key (when input is empty) cycles through unarchived personas
- [ ] Cycle order: alphabetical by name
- [ ] Visual feedback: brief highlight animation on sidebar item
- [ ] If only one persona exists, Tab does nothing (no-op)

### Persona List Overlay

- [ ] Shows all unarchived personas with: **Name** _description snippet_
- [ ] Current persona marked with `>` or highlight
- [ ] j/k to navigate list (vim-style)
- [ ] Enter to select and switch
- [ ] Escape to dismiss without switching
- [ ] `/` in overlay filters the list (fuzzy search on name)

### /archive Command

- [ ] `/archive` or `/a` with no args shows archived personas overlay
- [ ] `/archive <name>` archives the named persona
- [ ] `/archive` with no args and no archived personas shows "No archived personas"
- [ ] Cannot archive the currently active persona (show error)

### /unarchive Command

- [ ] `/unarchive <name>` unarchives and switches to the persona
- [ ] Tab-completion for archived persona names

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

- [ ] Unit test: Partial name matching finds correct persona
- [ ] Unit test: Tab cycling wraps around correctly
- [ ] Manual test: `/persona` shows overlay
- [ ] Manual test: `/persona partial` switches to matching persona
- [ ] Manual test: `/persona unknown` prompts to create
- [ ] Manual test: Tab cycles through personas
- [ ] Manual test: j/k navigation in overlay works
- [ ] Manual test: Filter in overlay narrows list
- [ ] Manual test: `/archive` and `/unarchive` work

## Notes

- Partial matching should prefer exact match > starts-with > contains
- Consider adding Shift+Tab for reverse cycling (future enhancement)
- The overlay pattern established here will be reused for checkpoints, quotes, etc.
