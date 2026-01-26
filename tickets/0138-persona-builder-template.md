# 0138: Persona Builder Template

**Status**: DONE

## Problem

When a user creates a new persona, they're prompted:

> "This persona doesn't exist. Do you want to create it?"

If they say "y", the system either:
1. Creates a minimal persona with defaults, OR
2. Asks for a description and generates from that

Neither approach guides the user toward providing **structured, useful information** that will result in a well-formed persona.

## Solution

When user confirms persona creation, open their editor with a **guided template**:

```markdown
# Quick Generation

Tell me about this persona; the more detail you provide initially, the quicker you'll be having the conversations you're hoping for!

# Potential Details

Use these sections, or create your own, to help me build the Persona you're hoping for!

## Core Traits

Is this persona friendly? Gruff? Are they an expert in something?

## Personification

Do they have a gender identity? An age? A physical appearance?

## Topics

Are there certain things you feel this persona would be interested in? Things they'd avoid talking about?
```

This gives users:
- A framework to organize their thoughts
- Hints about what information is useful
- Freedom to write naturally (not fill out a form)
- Structured input for better LLM generation

## Implementation

### 1. Create Template File

File: `src/prompts/templates/persona-builder.md`

```markdown
# Quick Generation

Tell me about this persona; the more detail you provide initially, the quicker you'll be having the conversations you're hoping for!

# Potential Details

Use these sections, or create your own, to help me build the Persona you're hoping for!

## Core Traits

Is this persona friendly? Gruff? Are they an expert in something? Do they have communication quirks?

Examples:
- "Speaks with a slight Southern accent"
- "Always optimistic, even annoyingly so"
- "Expert in medieval history"
- "Uses too many exclamation points!"

## Personification

Do they have a gender identity? An age? A physical appearance? A backstory?

Examples:
- "Elderly woman who's seen it all"
- "Young, enthusiastic intern energy"
- "No specific appearance, just a helpful voice"

## Topics

What subjects would this persona naturally gravitate toward? What would they avoid?

Examples:
- "Loves discussing gardening and cooking"
- "Avoids talking about politics"
- "Expert in JavaScript but dismissive of other languages"

## Relationship

How should this persona relate to you?

Examples:
- "A mentor who challenges me to grow"
- "A friend who just listens"
- "A colleague who helps me think through problems"

---

Delete these instructions and examples before saving. Write whatever feels natural!
```

### 2. Load Template in Persona Creation

Update `src/processor.ts` or wherever persona creation is handled:

```typescript
import { readFile } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";

async function loadPersonaBuilderTemplate(): Promise<string> {
  const __dirname = fileURLToPath(new URL(".", import.meta.url));
  const templatePath = join(__dirname, "prompts", "templates", "persona-builder.md");
  
  try {
    return await readFile(templatePath, "utf-8");
  } catch {
    // Fallback if template not found
    return "# Describe this persona\n\nWrite anything you want about who this persona should be.\n";
  }
}
```

### 3. Update Editor Flow

In the persona creation flow (likely `src/blessed/app.ts` or command handler):

```typescript
// When user confirms "y" to create persona
const template = await loadPersonaBuilderTemplate();

// Open editor with template pre-filled
const userDescription = await openEditorWithContent(template);

// User edits and saves
// Pass to persona generator
const newPersona = await createPersonaWithLLM(personaName, userDescription);
```

### 4. Update Generation Prompt

The generation prompt in `src/persona-creator.ts` should already handle free-form descriptions. Verify it parses sections if present:

```typescript
// In createPersonaWithLLM()
const systemPrompt = `You are helping create a new AI persona. The user wants a persona named "${personaName}".

The user may have provided structured sections (Core Traits, Personification, Topics, Relationship) or free-form description. Parse whatever they provide.

Based on their description, generate:
1. aliases: Alternative names (1-3)
2. traits: Personality characteristics (2-4 traits)
3. topics: Subjects they discuss (3-5 topics, mix of positive and negative sentiment)
...
`;
```

### 5. Handle Empty/Minimal Input

If user deletes everything or provides minimal input, fall back gracefully:

```typescript
const trimmedDescription = userDescription.trim();

if (!trimmedDescription || trimmedDescription.length < 10) {
  // Minimal persona with sensible defaults
  return createMinimalPersona(personaName);
}

// Full generation
return createPersonaWithLLM(personaName, trimmedDescription);
```

## Alternative: Skip Editor for Quick Create

Some users might want to skip the editor. Add a flag:

```typescript
// User types: /persona create Mike --quick
// Creates minimal persona without editor

// User types: /persona create Mike
// Opens editor with template
```

Or detect from the creation context:
- Direct command (`/persona create Mike`) → template editor
- Conversation switch to nonexistent persona → quick create with confirmation

## Acceptance Criteria

- [x] Create template file at `src/prompts/templates/persona-builder.ts`
- [x] Load template when opening editor for new persona
- [x] Editor opens with template pre-filled
- [x] Generation handles both structured sections and free-form input
- [x] Graceful fallback for empty/minimal input
- [x] E2E tests pass (7/7) - test mode uses fallback prompt flow
- [x] Unit tests pass (13/13) - persona creator handles all cases
- [x] Manual test: Create persona using template, verify quality (Flare confirmed)
- [ ] Manual test: Delete template content, write free-form, verify still works

## Testing

### Manual Tests
1. Create new persona via `/persona create TestPersona`
2. Verify editor opens with template
3. Fill in sections naturally
4. Save and exit editor
5. Verify generated persona has relevant traits/topics
6. Create another persona, delete template, write one sentence
7. Verify still generates reasonable persona

## Dependencies

- 0135 (Prompt Centralization) - template lives in `src/prompts/templates/`

## Files Changed

| File | Changes |
|------|---------|
| `src/prompts/templates/persona-builder.md` | New template file |
| `src/processor.ts` or `src/blessed/app.ts` | Load template, open editor |
| `src/persona-creator.ts` | Verify generation handles structured input |

## Future Enhancements

- **Interactive mode**: Instead of editor, guided questions in chat
- **Templates per category**: Different templates for "friend", "expert", "character"
- **Import from file**: `--from-file persona.md` to skip editor

## Notes

- Template is a human-facing prompt (guides user), not an LLM prompt
- Lives in `src/prompts/templates/` for organization, but isn't an LLM prompt
- Should feel inviting, not like a form to fill out
- Examples help users understand what's useful without being prescriptive

## Implementation Notes

### Template Instruction Prefix: `/\`
- All instructional/example lines in template are prefixed with `/\` (forward slash + backslash)
- This allows users to add their own comments/notes without conflict
- System strips these lines before LLM processing via `stripTemplateInstructions()`
- Weird enough to not collide with actual user content

### Flow Changes
- **Before**: `confirm` → `describe` stage → user types → generate
- **After**: `confirm` → open editor immediately → user edits → generate
- Removed the intermediate "What should this persona be like?" prompt
- Editor opens with pre-filled template on "y" confirmation

### Files Actually Changed
| File | Changes |
|------|---------|
| `src/prompts/templates/persona-builder.ts` | Template exported as string constant with `/\` prefixes |
| `src/blessed/app.ts` | Added `stripTemplateInstructions()`, `openPersonaCreationEditor()` |
| `src/blessed/app.ts` | Modified `handlePersonaCreationInput()` to call editor on "y" |
| `src/blessed/app.ts` | Import `PERSONA_BUILDER_TEMPLATE` constant |

### Edge Cases Handled
- Empty editor content: Cancels creation with message
- Minimal input: `createPersonaWithLLM()` already handles this gracefully
- **Test mode fallback**: When `testInputEnabled` is true (E2E tests), falls back to old prompt-based flow instead of opening editor (since `screen.exec()` doesn't work in non-PTY test environments)
