# EI Project - Agent Collaboration Guide

This file guides AI coding agents (Claude, etc.) working on the EI codebase.

## Ticket System

Tickets live in `/tickets/` as markdown files. They track features, bugs, and improvements.

### Status Tracking

Each ticket should have a status line at the top (after the title):

```markdown
# 0001: Ticket Title

**Status**: PENDING | IN_PROGRESS | DONE | BLOCKED
```

| Status | Meaning |
|--------|---------|
| `PENDING` | Not started |
| `IN_PROGRESS` | Active work |
| `DONE` | Completed and working |
| `BLOCKED` | Waiting on something (note blocker in ticket) |
| `VALIDATED` | Human has verified the work. **AGENTS: You may NOT set this status.** If work is complete, set `DONE` and ask the user to validate. If they're being lazy about it, remind them to open the ticket and set `VALIDATED` themselves. They're a grown-up. They can handle it. |

### Working on Tickets

1. **Before starting**: Update status to `IN_PROGRESS` in both ticket file AND `tickets/STATUS.md`
2. **While working**: Keep acceptance criteria checkboxes updated
3. **When done**: Update status to `DONE` in both locations, ensure all criteria checked
4. **Don't delete tickets** - they're project history

### Status Tracking

Maintain `tickets/STATUS.md` as the single source of truth for ticket overview:
- Update STATUS.md whenever ticket status changes
- Keep sections in order: PENDING → IN_PROGRESS → DONE → BLOCKED → VALIDATED → CANCELLED
- Include ticket number and title for easy reference
- Update completion statistics at bottom

### Finding What to Work On

- Tickets are numbered for rough priority (lower = earlier in roadmap)
- Check dependencies before starting (noted in each ticket)
- Some tickets are parallel-safe, others have hard dependencies

## Code Patterns

### Project Structure

```
src/
  index.tsx          # Entry point (Blessed render)
  blessed/           # Blessed-based UI components
    app.ts           # Main application class
    layout-manager.ts # Responsive layout handling
    focus-manager.ts # Input focus management
    persona-renderer.ts # Persona list rendering
    chat-renderer.ts # Chat history rendering
  processor.ts       # Message processing + LLM orchestration
  storage.ts         # File I/O for personas, history, concepts
  llm.ts             # OpenAI-compatible LLM client
  prompts.ts         # System/user prompt builders
  validate.ts        # Concept validation logic
  types.ts           # TypeScript interfaces
tickets/             # Feature/bug tickets (this doc)
data/                # Runtime data (personas, history) - gitignored
```

### Key Conventions

- **Blessed for UI**: All terminal rendering via blessed widgets
- **JSONC files**: Data files use `.jsonc` extension (JSON with comments support, though we don't use comments currently)
- **Persona-centric**: Most operations take a `persona` parameter
- **AbortController**: Long operations support cancellation via AbortSignal
- **Debug mode**: `--debug` or `-d` flag enables verbose logging

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `EI_DATA_PATH` | Data directory location | `./data` |
| `EI_LLM_BASE_URL` | LLM API endpoint | `http://127.0.0.1:1234/v1` |
| `EI_LLM_API_KEY` | LLM API key | `not-needed-for-local` |
| `EI_LLM_MODEL` | Model identifier | `google/gemma-3-12b` |

## Development Commands

```bash
npm run build    # Compile TypeScript
npm run dev      # Watch mode
npm start        # Run the app
npm start -- -d  # Run with debug output
```

## Agent-Specific Notes

### When Adding Features

1. Check if a ticket exists - if so, follow its spec
2. Match existing patterns in similar code
3. Update `/help` command if adding new commands
4. Test with `--debug` flag to verify behavior
5. **Always update STATUS.md when changing ticket status**
6. **Use specific file/line references when analyzing code** - helps human verify findings
7. **Test end-to-end when possible** - Maintainers prefers real validation over code review alone

### When Fixing Bugs

1. Create a ticket if one doesn't exist
2. Note the root cause in the ticket
3. Minimal fix - don't refactor while fixing
4. **Add unit tests for complex logic that's hard to test E2E**

### Testing Strategy

- **Unit tests**: For pure functions, complex business logic, edge cases
- **Integration tests**: For critical user flows with mocked dependencies  
- **E2E validation**: Human testing with real application - most reliable
- **Avoid testing what can't be reliably reproduced** (like specific model behaviors)

### Code Analysis Best Practices

- **Always provide file paths and line numbers** when referencing code
- **Quote specific code snippets** to make analysis concrete and verifiable
- **Explain reasoning** briefly but accurately
- **Be methodical over fast** - "Slow is smooth, smooth is fast"
- **Verify implementation matches ticket acceptance criteria** exactly

### Communication Patterns

- **Brief but accurate explanations** - no need for basic concepts
- **Ask clarifying questions** when requirements are unclear
- **Provide actionable next steps** rather than general advice
- **Use bullet points and formatting** for readability
- **Reference specific tickets/files/lines** to ground discussions in concrete details

### Handoff Protocol

When stopping work mid-task, note in the ticket:
- What's done
- What's remaining
- Any blockers or gotchas discovered

### Context Management & Session Handoffs

**When to start new sessions:**
- At ~85-90% context usage
- For major feature work requiring full context
- When switching between unrelated work streams

**Knowledge transfer between sessions:**
- All guidance is captured in steering files (`.kiro/steering/`)
- `tickets/STATUS.md` provides complete project state overview
- Individual tickets contain detailed implementation notes
- Commit messages document major changes

**Effective handoff checklist:**
- Update all ticket statuses in both files and STATUS.md
- Document any discovered patterns in steering files
- Note any "gotchas" or non-obvious implementation details
- Commit working code before major context switches
