---
inclusion: always
---

# Session Handoff Guide

## Current Project State (as of 2026-01-09)

### Major Accomplishments
- **Multi-persona system**: Fully functional with independent heartbeats, queues, and processing
- **Ink-based TUI**: Complete migration from readline to rich terminal interface
- **Test infrastructure**: 60 unit tests covering core business logic
- **Status tracking**: STATUS.md system for clear project overview
- **Validation patterns**: Two-tier verification (agent analysis + human testing)

### What's Working Well
- Multi-persona conversations with background processing
- Unread count tracking and visual indicators
- Message state visualization (processing/queued/sent)
- Markdown rendering in chat messages
- Echo stripping for Gemma model responses
- Comprehensive unit test coverage for processor.ts

### Known Issues (Active Tickets)
- **0025**: Ctrl+C handling incomplete - saves data but UX is broken
- **TUI Problems**: Layout and input handling issues since Ink migration
- **Missing Features**: /editor command, /quit command, persona switching improvements

### Completion Status
- **17 VALIDATED tickets** (55% completion rate)
- **12 PENDING tickets** remaining
- **2 CANCELLED tickets** (replaced by better versions)

## Working with Maintainers

### Communication Preferences
- **Brief but accurate** - 20+ years experience, humble learner type
- **Specific references** - Always include file paths and line numbers
- **Methodical approach** - "Slow is smooth, smooth is fast"
- **Collaborative style** - Prefers working together over being instructed
- **Real validation** - Trusts code review but prefers actual testing

### Development Approach
- **Careful over fast** - Values thoughtful changes over speed
- **Test-driven** - Prefers unit tests for complex logic, E2E for user flows
- **Pattern-aware** - Understands system complexity, follows established conventions
- **Quality-focused** - Would rather do it right than do it quickly

### Interaction Patterns
- Ask clarifying questions when requirements are unclear
- Provide actionable information over general explanations
- Use bullet points and formatting for readability
- Reference specific tickets/files/lines to ground discussions
- Explain reasoning briefly when making recommendations

## Technical Context

### Architecture Patterns
- **Persona-centric**: Most operations take a `persona` parameter
- **AbortController**: All long operations support cancellation
- **Ink/React**: All UI rendering through components, no raw terminal
- **JSONC files**: Data storage with comment support (though unused)
- **Debug mode**: `--debug` flag enables verbose logging

### Key Files and Their Roles
- `src/processor.ts`: Core business logic, LLM orchestration, concept updates
- `src/components/App.tsx`: Main UI component with multi-persona state management
- `src/storage.ts`: File I/O for personas, history, concepts
- `src/llm.ts`: OpenAI-compatible client with error handling
- `tests/unit/`: Comprehensive unit test coverage (60 tests)
- `tickets/STATUS.md`: Single source of truth for project status

### Environment Setup
- `EI_DATA_PATH`: Points to `/Users/flare576/personaldot/ei/` (outside workspace)
- Use bash commands to access data files (not file tools)
- Test with `npm test`, run with `npm start -- -d` for debug mode

## Common Patterns and Gotchas

### File Access Patterns
```bash
# Read data files (outside workspace)
cat "$EI_DATA_PATH/personas/ei/system.jsonc"

# Read workspace files
# Use readFile tool for src/ files
```

### Status Update Pattern
```markdown
# Always update both locations:
1. Update ticket file: **Status**: DONE
2. Update STATUS.md: Move ticket between sections
3. Update completion statistics
```

### Code Analysis Pattern
```markdown
# Always provide concrete references:
- File: src/processor.ts lines 43-67
- Function: stripEcho() handles echo removal
- Evidence: [quote specific code]
- Conclusion: [specific finding with reasoning]
```

### Testing Strategy
- **Unit tests**: Pure functions, business logic, edge cases
- **Integration tests**: Mocked dependencies, critical flows
- **E2E validation**: Human testing with real application
- **Avoid**: Testing model-specific behaviors that can't be reproduced

## Handoff Checklist

### Before Starting New Session
- [ ] Review `tickets/STATUS.md` for current project state
- [ ] Check recent commit messages for context
- [ ] Read any IN_PROGRESS tickets for current work
- [ ] Understand Maintainer's current priorities from conversation

### During Work
- [ ] Update ticket status in both file and STATUS.md
- [ ] Provide specific file/line references in analysis
- [ ] Test changes when possible (unit tests or manual)
- [ ] Document any new patterns or gotchas discovered

### Before Ending Session
- [ ] Commit any working code changes
- [ ] Update all ticket statuses accurately
- [ ] Document any incomplete work in ticket notes
- [ ] Update steering files with new insights
- [ ] Provide clear handoff summary for next agent

## Success Metrics

### What the Maintainers Value
- **Accuracy over speed** - Getting it right matters more than getting it fast
- **Concrete evidence** - File/line references, specific code quotes
- **Real validation** - Actual testing over theoretical analysis
- **Clear communication** - Bullet points, formatting, actionable information
- **Collaborative approach** - Working together, not being instructed

### Red Flags to Avoid
- Making assumptions without verifying code
- Updating status without checking both locations
- Providing general advice without specific context
- Rushing through analysis without being thorough
- Ignoring established patterns and conventions