---
inclusion: always
---

# EI Project - Development Guide

## Ticket System Protocol

Tickets in `/tickets/` track all features, bugs, and improvements with numbered priority.

### Status Values
- `PENDING` - Not started
- `IN_PROGRESS` - Active work  
- `DONE` - Completed and working
- `BLOCKED` - Waiting on dependency (note blocker)
- `VALIDATED` - Human-verified (agents cannot set this)

### Workflow Rules
1. Update status to `IN_PROGRESS` before starting (both ticket file and STATUS.md)
2. Keep acceptance criteria checkboxes current during work
3. Set `DONE` when complete with all criteria checked (both locations)
4. Never delete tickets - they're project history
5. Check dependencies before starting work
6. Maintain `tickets/STATUS.md` as overview - update whenever status changes

## Status Management

### STATUS.md File
- Single source of truth for ticket overview
- Update whenever any ticket status changes
- Sections in order: PENDING → IN_PROGRESS → DONE → BLOCKED → VALIDATED → CANCELLED
- Include completion statistics at bottom
- Helps humans quickly see what's left to do vs. what's complete

## Architecture Patterns

### Core Structure
- `src/index.tsx` - Ink render entry point
- `src/components/` - React/Ink UI components
- `src/processor.ts` - LLM orchestration + message processing
- `src/storage.ts` - File I/O for personas/history/concepts
- `src/types.ts` - TypeScript interfaces
- `data/` - Runtime data (gitignored)

### Key Conventions
- Ink/React for all terminal UI
- JSONC files for data (JSON with comment support)
- Persona-centric operations (most functions take persona param)
- AbortController for cancellable long operations
- Debug mode via `--debug` or `-d` flag

### Environment Variables
- `EI_DATA_PATH` - Data directory (default: `./data`)
- `EI_LLM_BASE_URL` - API endpoint (default: `http://127.0.0.1:1234/v1`)
- `EI_LLM_API_KEY` - API key (default: `not-needed-for-local`)
- `EI_LLM_MODEL` - Model ID (default: `google/gemma-3-12b`)

## Development Commands
- `npm run build` - Compile TypeScript
- `npm run dev` - Watch mode
- `npm start` - Run app
- `npm start -- -d` - Run with debug output

## Agent Guidelines
- Follow existing patterns in similar code
- Update `/help` command when adding commands
- Test with `--debug` flag
- Create tickets for bugs if none exist
- Minimal fixes - avoid refactoring during bug fixes

## Validation Patterns

### Two-Tier Completion Verification
1. **Agent Analysis**: Code review with specific file/line references
2. **Human Validation**: Real-world testing with actual application

### What Agents Should Verify
- Implementation matches ticket acceptance criteria exactly
- All checkboxes in ticket are marked complete
- Code follows established patterns (persona-centric, AbortController, etc.)
- Integration points work correctly (storage, LLM calls, UI updates)

### What Requires Human Validation
- End-to-end user flows (multi-persona conversations, UI interactions)
- Complex business logic behavior (echo stripping, concept changes)
- Performance and user experience aspects
- Edge cases that are hard to reproduce programmatically

### Analysis Quality Standards
- Always include file paths and line numbers
- Quote relevant code snippets
- Explain the "why" behind conclusions
- Be methodical and thorough over fast
- Verify against actual implementation, not assumptions

## Project-Specific Patterns

### EI Architecture Insights
- **Multi-persona system**: Each persona has independent state (timers, queues, processing)
- **Ink-based TUI**: All UI rendering through React/Ink components, no raw terminal output
- **AbortController pattern**: All long operations support cancellation via signal
- **Concept-driven**: System learns and evolves through concept map updates
- **Test strategy**: Unit tests for business logic, E2E validation for user flows

### Common Gotchas
- **File access**: Use bash commands for files outside workspace (like EI_DATA_PATH)
- **Status updates**: Always update both ticket file AND STATUS.md
- **Echo stripping**: Already implemented and tested - don't re-implement
- **Heartbeat system**: Fully functional with independent timers per persona
- **TUI issues**: Known problems with layout/input handling since Ink migration