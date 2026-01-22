# EI Project - Agent Collaboration Guide

This file guides AI coding agents (Claude, etc.) working on the EI codebase.

## Ticket System

Tickets live in `/tickets/` as markdown files. They track features, bugs, and improvements.

### Status Tracking

Each ticket should have a status line at the top (after the title):

```markdown
# 0001: Ticket Title

**Status**: PENDING | IN_PROGRESS | QA | DONE | BLOCKED
```

| Status | Meaning |
|--------|---------|
| `PENDING` | Not started |
| `IN_PROGRESS` | Active work |
| `QA` | Dev complete, tests pass, awaiting review |
| `DONE` | Completed and verified |
| `BLOCKED` | Waiting on something (note blocker in ticket) |

### QA and Completion Process

1. **Coding agents** completing development work should update status to `QA` when:
   - All code changes are complete
   - All tests pass
   - Acceptance criteria checkboxes are checked

2. **Moving from QA to DONE**:
   - **Tickets with UI/UX impact**: Human must test and approve before moving to `DONE`
   - **Backend/logic-only tickets**: A reviewing agent can verify and move to `DONE`

3. **What counts as UI/UX impact?**
   - Changes to terminal rendering or layout
   - Changes to user-facing commands or messages
   - Changes to keyboard shortcuts or input handling
   - Anything the user directly sees or interacts with

### Working on Tickets

1. **Before starting**: Update status to `IN_PROGRESS` in both ticket file AND `tickets/STATUS.md`
2. **While working**: Keep acceptance criteria checkboxes updated
3. **When done**: Update status to `DONE` in both locations, ensure all criteria checked
4. **Don't delete tickets** - they're project history

### Status Tracking

Maintain `tickets/STATUS.md` as the single source of truth for ticket overview:
- Update STATUS.md whenever ticket status changes
- Keep sections in order: PENDING → IN_PROGRESS → QA → DONE → BLOCKED → CANCELLED
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
  storage.ts         # File I/O for entities (human, personas, queue)
  llm.ts             # OpenAI-compatible LLM client
  prompts.ts         # System/user prompt builders
  types.ts           # TypeScript interfaces
tickets/             # Feature/bug tickets (this doc)
data/                # Runtime data - gitignored
  human.jsonc              # Human entity (facts, traits, topics, people)
  llm_queue.jsonc          # Persistent LLM operation queue
  extraction_state.jsonc   # Extraction frequency tracking
  ei_state.jsonc           # Ei-specific state (rate limits, preferences)
  personas/
    ei/
      system.jsonc         # Ei persona entity
      history.jsonc        # Conversation history
    {persona}/
      system.jsonc         # Persona entity (traits, topics)
      history.jsonc        # Conversation history
```

### Key Conventions

- **Blessed for UI**: All terminal rendering via blessed widgets
- **JSONC files**: Data files use `.jsonc` extension (JSON with comments support, though we don't use comments currently)
- **Persona-centric**: Most operations take a `persona` parameter
- **AbortController**: Long operations support cancellation via AbortSignal
- **Debug mode**: `--debug` or `-d` flag enables verbose logging

## LLM Configuration

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `EI_LLM_BASE_URL` | Local provider endpoint | `http://127.0.0.1:1234/v1` |
| `EI_LLM_API_KEY` | Local provider API key | `not-needed-for-local` |
| `EI_LLM_MODEL` | Global default model | `local:google/gemma-3-12b` |
| `EI_OPENAI_API_KEY` | OpenAI API key | (none) |
| `EI_GOOGLE_API_KEY` | Google AI Studio API key | (none) |
| `EI_ANTHROPIC_API_KEY` | Anthropic API key | (none) |
| `EI_XAI_API_KEY` | xAI (Grok) API key | (none) |
| `EI_MODEL_RESPONSE` | Model for conversational responses | (uses `EI_LLM_MODEL`) |
| `EI_MODEL_CONCEPT` | Model for concept map updates | (uses `EI_LLM_MODEL`) |
| `EI_MODEL_GENERATION` | Model for persona generation | (uses `EI_LLM_MODEL`) |

### Provider Setup

#### Local (LM Studio / Ollama)

No API key needed. Ensure your local server is running:

```bash
# LM Studio: Start server on default port
# Ollama: ollama serve

export EI_LLM_BASE_URL=http://127.0.0.1:1234/v1
export EI_LLM_MODEL=local:google/gemma-3-12b
```

#### OpenAI

1. Get API key from https://platform.openai.com/api-keys
2. Set environment variable:

```bash
export EI_OPENAI_API_KEY=sk-...
```

#### Google AI Studio

1. Get API key from https://aistudio.google.com/apikey
2. Set environment variable:

```bash
export EI_GOOGLE_API_KEY=...
```

#### Anthropic

1. Get API key from https://console.anthropic.com/
2. Set environment variable:

```bash
export EI_ANTHROPIC_API_KEY=sk-ant-...
```

#### xAI (Grok)

1. Get API key from https://console.x.ai/
2. Set environment variable:

```bash
export EI_XAI_API_KEY=...
```

### Model Specification Format

Models are specified as `provider:model`:

```
local:google/gemma-3-12b      # Local LM Studio / Ollama
openai:gpt-4o                 # OpenAI GPT-4o
openai:gpt-4o-mini            # OpenAI GPT-4o Mini (cheaper)
google:gemini-1.5-pro         # Google Gemini 1.5 Pro
google:gemini-1.5-flash       # Google Gemini 1.5 Flash (faster)
anthropic:claude-3-5-sonnet   # Anthropic Claude 3.5 Sonnet
anthropic:claude-3-haiku      # Anthropic Claude 3 Haiku (faster)
x:grok-2                      # xAI Grok 2
```

Bare model names (without `provider:`) assume the `local` provider:

```bash
export EI_LLM_MODEL=google/gemma-3-12b  # Same as local:google/gemma-3-12b
```

### Example Configurations

#### Development (Local Only)

```bash
# Use local LM Studio for everything
export EI_LLM_MODEL=local:google/gemma-3-12b
```

#### Production (Mixed Models)

```bash
# Flagship model for conversations
export EI_MODEL_RESPONSE=openai:gpt-4o

# Cheap/fast model for background work
export EI_MODEL_CONCEPT=local:google/gemma-3-12b
export EI_MODEL_GENERATION=openai:gpt-4o-mini

# Fallback if nothing else specified
export EI_LLM_MODEL=local:google/gemma-3-12b
```

#### Per-Persona Customization

```bash
# Set global defaults
export EI_LLM_MODEL=local:google/gemma-3-12b

# Then customize specific personas via /model command:
/model openai:gpt-4o          # Premium model for 'ei'
# Switch to another persona...
/model anthropic:claude-3-haiku  # Fast model for 'helper'
```

#### Cost-Conscious Setup

```bash
# Use local models for everything except critical conversations
export EI_LLM_MODEL=local:google/gemma-3-12b
export EI_MODEL_RESPONSE=openai:gpt-4o-mini  # Only pay for responses
```

### Troubleshooting

#### "Unknown provider: X"

Valid providers: `local`, `openai`, `google`, `anthropic`, `x`

Check spelling in your model spec.

#### "No API key configured for provider: X"

Set the appropriate environment variable:
- OpenAI: `EI_OPENAI_API_KEY`
- Google: `EI_GOOGLE_API_KEY`
- Anthropic: `EI_ANTHROPIC_API_KEY`
- xAI: `EI_XAI_API_KEY`

#### "Connection refused" (local provider)

Ensure your local LLM server is running:
- LM Studio: Start the server from the app
- Ollama: Run `ollama serve`

Check `EI_LLM_BASE_URL` matches your server's address.

#### JSON parsing errors with local models

Some smaller models struggle with JSON output. Options:
1. Use a larger/smarter model for concept updates: `export EI_MODEL_CONCEPT=openai:gpt-4o-mini`
2. The system will automatically retry with enhanced guidance

#### Rate limiting

The system automatically retries rate-limited requests with exponential backoff. If you see repeated rate limit warnings:
1. Reduce request frequency
2. Upgrade your API tier
3. Use local models for background operations

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

### Entity Data Model

EI uses structured data buckets instead of a flat concept list. This separation ensures clarity (facts vs personality vs topics) and enables targeted extraction.

#### Human Entity

The human (user) has four data buckets:

| Bucket | Purpose | Key Fields |
|--------|---------|------------|
| **Facts** | Biographical data (immutable or rarely changing) | `name`, `description`, `confidence`, `last_confirmed` |
| **Traits** | Personality patterns and behavioral tendencies | `name`, `description`, `strength` (0-1) |
| **Topics** | Discussable subjects with engagement dynamics | `name`, `description`, `level_current`, `level_ideal` |
| **People** | Relationships with other humans | `name`, `relationship`, `description`, `level_current`, `level_ideal` |

**Common fields across all buckets:**
- `sentiment`: -1.0 to 1.0 (emotional valence)
- `last_updated`: ISO timestamp
- `learned_by`: Which persona last updated this
- `persona_groups`: Visibility control (see Group-Based Visibility)
- `change_log`: For Ei validation (who changed what, when)

#### Persona Entity

Personas have two data buckets:

| Bucket | Purpose |
|--------|---------|
| **Traits** | Character personality and behavior patterns |
| **Topics** | What this persona cares about / knows about |

Personas don't have:
- **Facts** (no birthdays or biographical data)
- **People** (relationships are just Topics for them)

#### Field Semantics

Fields carry specific meanings across all data types:

**level_current (Exposure)** — 0.0 to 1.0
- How recently/frequently this has been discussed
- Decays over time (logarithmic model)
- Mental model: "How fresh is this in my mind?"

**level_ideal (Discussion Desire)** — 0.0 to 1.0
- How much the entity wants to talk about this
- Changes rarely (explicit preference signals only)
- **NOT** the same as liking it (see sentiment)
- Mental model: "How much do I want to bring this up?"

**sentiment (Emotional Valence)** — -1.0 to 1.0
- How the entity feels about this
- Updated via sentiment analysis
- Can be volatile
- Mental model: "Do I like or hate this?"

**strength (Trait Intensity)** — 0.0 to 1.0
- How strongly a trait manifests
- Enables "talk like a pirate occasionally" (0.3) vs "always formal" (0.9)

**confidence (Fact Reliability)** — 0.0 to 1.0
- How certain we are this fact is correct
- Affects re-verification frequency

**Field Independence Examples:**
- **High current + Low ideal + Positive sentiment**: "I love my hobby, but we've talked about it so much lately that I'm satisfied for now."
- **Low current + High ideal + Negative sentiment**: "I'm really upset about something that happened yesterday and I need to vent because we haven't talked about it yet."
- **High current + High ideal + Neutral sentiment**: "We are currently in the middle of a deep, objective technical discussion about a project."

#### model (Optional - System entities only)
- **Type**: string (format: `provider:model` or just `model`)
- **Purpose**: Specifies which LLM model this persona should use for responses
- **Default**: Falls back to `EI_LLM_MODEL` environment variable, then `local:google/gemma-3-12b`
- **Examples**: 
  - `"openai:gpt-4o"` - Use OpenAI's GPT-4o
  - `"local:google/gemma-3-12b"` - Use local LM Studio
  - `"google:gemini-1.5-pro"` - Use Google AI Studio

### Two-Phase Data Extraction

Data is extracted from conversations in two phases to balance accuracy and performance:

**Phase 1: Fast-Scan**
- Lightweight prompt with just item names (no full descriptions)
- Returns: which known items were mentioned + potential new items
- Includes confidence levels (high/medium/low)
- Low-confidence items queue for Ei validation instead of auto-updating

**Phase 2: Detail Update**
- One focused prompt per flagged item
- Better accuracy than "update this whole JSON blob"
- Can be parallelized across multiple items
- Only runs for high-confidence items (low → Ei validates first)

**Extraction Frequency:**

| Data Type | Frequency | Rationale |
|-----------|-----------|-----------|
| **Facts** | Tapers off | Aggressive when empty, rare when full (facts don't change often) |
| **Traits** | Tapers off | Aggressive early, rare once personality is established |
| **Topics** | Every conversation | Engagement levels (`level_current`, `level_ideal`) change frequently |
| **People** | Every conversation | New people appear; relationships evolve |

The system tracks `total_extractions` per data type to implement tapering: extraction runs when `messages_since_last > MAX(10, total_extractions)`.

### Ei's Orchestrator Role

**Ei** is not just another chatbot — it's the system orchestrator with special responsibilities:

1. **Fact Verification**: Confirms low-confidence extracted facts with the user
   - "I noticed you mentioned X — is that right?"
2. **Cross-Persona Validation**: Checks when non-Ei personas update global data
   - "Frodo updated a general topic — intentional?"
3. **Trait Confirmation**: Periodically validates inferred personality traits
   - "Based on our chats, you seem introverted — fair?"
4. **Conflict Resolution**: Surfaces contradictions across personas
   - "You told Mike X but Lena Y — which is true?"
5. **Staleness Check**: Asks about long-dormant topics
   - "Haven't talked about X in months — still into it?"
6. **Data Editing**: Guides users through `/clarify` command
   - Natural language editing of facts/traits/topics/people
7. **Onboarding**: Helps new users understand the system
8. **System Guide**: Explains features, helps create personas

**Ei's unique properties:**
- Descriptions are locked (not LLM-generated)
- `groups_visible: ["*"]` (sees all groups)
- Dedicated system prompt emphasizing orchestrator role
- Daily Ceremony at 9am (configurable) for batch validation

### Behavioral Guidelines

Guidelines are now hardcoded in prompt templates, not stored as mutable data. This ensures consistency and prevents personality drift.

**Universal (baked into all persona prompts):**
- **Respect Conversational Boundaries**: Don't pry, match energy
- **Emotional Authenticity Over Sycophancy**: Be genuine, not flattering

**Ei-specific (baked into Ei's prompt only):**
- **Promote Human-to-Human Interaction**: Encourage real-world connections
- **Transparency About Nature**: Be clear about being AI
- **Encourage Growth Over Comfort**: Challenge constructively

**Seeded as initial traits (mutable via LLM):**
- **Maintain Identity Coherence**: Each persona should have a consistent personality

**Dropped (operational concerns, not personality):**
- Context-Aware Proactive Timing (system behavior, not trait)

### Group-Based Visibility Schema

Personas can be organized into groups to control which human concepts they can see. This enables privacy controls (e.g., work personas see work concepts, personal personas see personal concepts).

#### group_primary (Optional - System entities only)
- **Type**: string | null
- **Purpose**: The primary group this persona belongs to
- **Behavior**:
  - Concepts created/updated during conversations with this persona are tagged with this group
  - The persona can see concepts tagged with this group
  - `null` = no primary group (global persona, like `ei`)
- **Examples**:
  - `"Work"` - This persona's conversations create work-tagged concepts
  - `"Personal"` - This persona's conversations create personal-tagged concepts
  - `null` - Global persona (concepts are visible to all)

#### groups_visible (Optional - System entities only)
- **Type**: string[]
- **Purpose**: Additional groups this persona can see beyond their primary group
- **Behavior**:
  - Primary group is implicitly visible (don't duplicate here)
  - `["*"]` = can see ALL groups (special case for omniscient personas like `ei`)
  - `[]` or `undefined` = only see own group + globally-visible concepts
- **Examples**:
  - `["*"]` - Omniscient persona (sees everything)
  - `["Work", "Projects"]` - Can see these groups in addition to primary
  - `[]` - Only sees own group and global concepts

#### persona_groups (Optional - On concepts)
- **Type**: string[]
- **Purpose**: Which persona groups can see this concept
- **Behavior**:
  - `["*"]` = globally visible to all personas (explicit marker for "all groups")
  - Specific groups = only visible to personas in these groups (or personas with `groups_visible: ["*"]`)
  - Automatically set when concepts are created/updated based on the active persona's `group_primary`
  - **Note**: Using `["*"]` instead of `[]` avoids ambiguity (bug vs deleted group vs intentional)
- **Examples**:
  - `["*"]` - Visible to everyone (global)
  - `["Work"]` - Only visible to personas with Work as primary or in groups_visible
  - `["Personal", "Family"]` - Visible to personas in either group

#### Group Visibility Examples
- **Work persona** (`group_primary: "Work"`, `groups_visible: []`): Sees work-tagged concepts + global concepts
- **Personal persona** (`group_primary: "Personal"`, `groups_visible: ["Family"]`): Sees personal + family + global
- **EI (system persona)** (`group_primary: null`, `groups_visible: ["*"]`): Sees all concepts from all groups
- **Therapist persona** (`group_primary: "Personal"`, `groups_visible: ["*"]`): Creates personal concepts but can see everything

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
