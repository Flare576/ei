# 0142: TUI $EDITOR Integration

**Status**: PENDING
**Depends on**: 0139 (TUI Slash Command Foundation)
**Priority**: High (TUI V1.2)

## Summary

Implement commands that spawn `$EDITOR` for editing structured data: `/details`, `/me`, and `/settings`. These commands open the user's preferred editor with YAML content, then process changes on save.

## Background

Terminal users expect to edit configuration in their preferred editor (vim, nvim, nano, etc.). The pattern:
1. Serialize data to YAML
2. Write to temp file
3. Spawn `$EDITOR` (blocks TUI)
4. On exit, parse YAML and apply changes
5. Clean up temp file

This is how tools like `kubectl edit`, `git commit`, and `crontab -e` work.

## Acceptance Criteria

### $EDITOR Spawning

- [ ] Use `$EDITOR` environment variable, fallback to `$VISUAL`, then `vi`
- [ ] Block TUI while editor is open (terminal returns to editor)
- [ ] On editor exit, TUI resumes and processes changes
- [ ] If YAML parse fails, show error and offer to re-edit

### /details Command (Persona Editor)

- [ ] `/details` or `/d` edits the active persona
- [ ] `/details <name>` edits the named persona
- [ ] `/details <unknown>` shows error in StatusBar
- [ ] YAML includes all editable persona fields:
  ```yaml
  name: PersonaName
  description: "Current description"
  model: "provider:model"  # or null for default
  group: General
  visible_groups:
    - General
    - Work
  nicknames:
    - Nick1
    - Nick2
  heartbeat_delay: 3600000  # ms
  context_window: 86400000  # ms
  pause_until: 1  # 1=active, 0=indefinite, timestamp=until
  is_static: false
  ```
- [ ] Changes saved via `processor.updatePersona()`
- [ ] Cannot change `name` (show comment in YAML explaining this)

### /me Command (Human Editor)

- [ ] `/me` edits the human profile
- [ ] YAML includes human settings and all data items:
  ```yaml
  # Human Settings
  name: "User's Name"
  nickname: "Nick"
  timezone: "America/Chicago"
  
  # Facts
  facts:
    - id: "uuid"
      content: "Fact content"
      confidence: 0.9
      last_updated: "2026-02-14"
    # ...
  
  # Traits
  traits:
    - id: "uuid"
      content: "Trait description"
      strength: 0.8
    # ...
  
  # Topics
  topics:
    - id: "uuid"
      name: "Topic Name"
      category: "category"
      exposure_current: 0.5
      exposure_desired: 0.7
    # ...
  
  # People
  people:
    - id: "uuid"
      name: "Person Name"
      relationship: "friend"
      notes: "Notes about them"
    # ...
  ```
- [ ] Can add/edit/remove items (processor handles diffs)
- [ ] Items without `id` are created as new
- [ ] Items removed from YAML are deleted (with confirmation?)

### /settings Command (System Settings)

- [ ] `/settings` edits system/storage settings
- [ ] YAML includes:
  ```yaml
  # Model Configuration
  default_model: "local:gemma-3"
  response_model: null  # null = use default
  concept_model: null
  generation_model: null
  
  # Provider Settings
  providers:
    local:
      base_url: "http://127.0.0.1:1234/v1"
    openai:
      api_key: "sk-..."  # masked or omitted?
    # ...
  
  # OpenCode Integration
  opencode:
    sessions_path: "/path/to/sessions"
    auto_import: true
  
  # Sync Settings (if logged in)
  sync:
    enabled: true
    last_sync: "2026-02-14T12:00:00Z"
  ```
- [ ] Sensitive values (API keys) shown masked or require explicit reveal

### /editor Command (Message Editor)

- [ ] `/editor` or `/e` opens editor with current input + pending messages
- [ ] On save, content replaces input box
- [ ] Useful for composing long messages

## Technical Design

### Editor Spawning Utility

```typescript
// tui/src/util/editor.ts
import { spawn } from "child_process";
import { writeFileSync, readFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as yaml from "yaml";

export interface EditorResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export async function editInEditor<T>(
  initialData: T,
  options?: {
    header?: string;  // Comment at top of file
    validate?: (data: unknown) => T | null;
  }
): Promise<EditorResult<T>> {
  const editor = process.env.EDITOR || process.env.VISUAL || "vi";
  const tmpFile = join(tmpdir(), `ei-edit-${Date.now()}.yaml`);
  
  // Write initial content
  let content = "";
  if (options?.header) {
    content += options.header.split("\n").map(l => `# ${l}`).join("\n") + "\n\n";
  }
  content += yaml.stringify(initialData);
  writeFileSync(tmpFile, content, "utf-8");
  
  // Spawn editor and wait
  return new Promise((resolve) => {
    const child = spawn(editor, [tmpFile], {
      stdio: "inherit",  // Give editor full terminal control
    });
    
    child.on("exit", (code) => {
      if (code !== 0) {
        unlinkSync(tmpFile);
        resolve({ success: false, error: "Editor exited with error" });
        return;
      }
      
      try {
        const newContent = readFileSync(tmpFile, "utf-8");
        const parsed = yaml.parse(newContent);
        
        if (options?.validate) {
          const validated = options.validate(parsed);
          if (!validated) {
            // Could offer re-edit here
            resolve({ success: false, error: "Validation failed" });
          } else {
            resolve({ success: true, data: validated });
          }
        } else {
          resolve({ success: true, data: parsed as T });
        }
      } catch (e) {
        resolve({ success: false, error: `YAML parse error: ${e}` });
      } finally {
        unlinkSync(tmpFile);
      }
    });
  });
}
```

### /details Command

```typescript
// tui/src/commands/details.ts
export const detailsCommand: Command = {
  name: "details",
  aliases: ["d"],
  description: "Edit persona in $EDITOR",
  usage: "/details [persona]",
  
  async execute(args, ctx) {
    const personaName = args[0] || ctx.getActivePersona()?.name;
    if (!personaName) {
      ctx.showNotification("No persona specified", "error");
      return;
    }
    
    const persona = ctx.processor.getPersona(personaName);
    if (!persona) {
      ctx.showNotification(`Persona '${personaName}' not found`, "error");
      return;
    }
    
    // Prepare editable structure
    const editable = {
      name: persona.name,  // Read-only, shown for reference
      description: persona.description,
      model: persona.model || null,
      group: persona.group,
      visible_groups: persona.visible_groups,
      nicknames: persona.nicknames,
      heartbeat_delay: persona.heartbeat_delay,
      context_window: persona.context_window,
      pause_until: persona.pause_until,
      is_static: persona.is_static,
    };
    
    ctx.suspendTUI();  // Release terminal for editor
    
    const result = await editInEditor(editable, {
      header: `Editing persona: ${persona.name}\nNote: 'name' cannot be changed here.`,
    });
    
    ctx.resumeTUI();  // Restore TUI
    
    if (!result.success) {
      ctx.showNotification(result.error || "Edit cancelled", "error");
      return;
    }
    
    // Apply changes (exclude name)
    const { name, ...changes } = result.data!;
    await ctx.processor.updatePersona(personaName, changes);
    ctx.showNotification(`Updated ${personaName}`, "info");
  }
};
```

### TUI Suspend/Resume

```typescript
// tui/src/context/app.tsx
// The TUI needs to yield terminal control during editor sessions

export function suspendTUI() {
  // OpenTUI should have a method for this
  // Similar to how vim handles :! commands
  renderer.suspend();
}

export function resumeTUI() {
  renderer.resume();
  // Force full redraw
  invalidateAll();
}
```

## File Changes

```
tui/src/
├── commands/
│   ├── details.ts       # /details command
│   ├── me.ts            # /me command
│   ├── settings.ts      # /settings command
│   └── editor.ts        # /editor command
├── util/
│   └── editor.ts        # $EDITOR spawning utility
└── context/
    └── app.tsx          # Add suspend/resume methods
```

## Testing

- [ ] Unit test: YAML serialization round-trips correctly
- [ ] Unit test: Validation catches invalid changes
- [ ] Manual test: `/details` opens editor with persona YAML
- [ ] Manual test: Changes in editor are saved
- [ ] Manual test: Invalid YAML shows error
- [ ] Manual test: `/me` opens human data
- [ ] Manual test: Adding new fact in YAML creates it
- [ ] Manual test: Removing fact from YAML deletes it
- [ ] Manual test: `/settings` shows system config
- [ ] Manual test: `/editor` for composing messages works

## Notes

- OpenTUI suspend/resume: Need to verify this API exists. OpenCode may have patterns for this.
- Deletion confirmation: Consider requiring explicit `_delete: true` flag instead of implicit removal
- API key masking: Show `sk-...xxxx` format, only update if full key provided
- Large YAML: `/me` with many entities could be unwieldy. Consider `/facts`, `/traits`, etc. as filtered views (future ticket)
- The `yaml` package handles serialization. Already a dependency via OpenTUI.

## Future Enhancements (Not in scope)

- `/fact`, `/trait`, `/person`, `/topic` - Create single new entity (from tui-map.md)
- `/facts`, `/traits`, `/people`, `/topics` - Edit filtered subset
- `/quotes` - Quote management in editor
- `/context` - Message context status editor
