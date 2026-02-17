# EI V1 - Ticket Status

> Last updated: 2026-02-16 (Added 0150 TUI /quotes Command)

## Overview

| Status | Count |
|--------|-------|
| PENDING | 15 |
| IN_PROGRESS | 0 |
| QA | 0 |
| DONE | 103 |
| BLOCKED | 0 |
| SUPERSEDED | 3 |

> 124 total tickets (103 done + 15 pending + 3 backlog + 0 in_progress + 0 QA + 3 superseded).

---

## Epics

| Epic | Tickets | Status | Description |
|------|---------|--------|-------------|
| **E001** | 0001-0008 | DONE | Foundation |
| **E002** | 0011-0017 | DONE | MVP: Basic Chat |
| **E003** | 0020-0028 | DONE | Prompts & Handlers |
| **E004** | 0030-0037 | DONE | Testing Infrastructure |
| **E005** | 0040-0050 | DONE | UI: Core Components |
| **E006** | 0060-0067 | DONE | Extraction Pipeline |
| **E007** | 0070-0076 | DONE | Ceremony System |
| **E008** | 0080-0089 | DONE | UI: Entity Management |
| **E009** | 0090-0099 | PENDING | Polish & New Features |
| **E010** | 0100-0109 | DONE | TUI & OpenCode Integration |
| **E011** | 0116-0120, 0122 | DONE | Quote Preservation System |
| **E012** | 0139-0142, 0144 | PENDING | TUI Commands (V1.2) |

---

## PENDING

### E009: Polish & New Features

| Ticket | Title | Depends On |
|--------|-------|------------|
| 0092 | Persona Image Generation | 0087 |
| 0093 | Rich Text Editor (Markdown + WYSIWYG) | 0080 |
| 0094 | Name Color Customization | 0081 |
| 0095 | Time Display Modes | 0081 |
| 0097 | LLM Streaming Support | 0011 |
| 0098 | Pre-configured Persona Templates | 0087 |
| 0099 | Story Co-Writer Agent (Non-Persona) | 0098 |
| 0129 | Settings Menu Redesign | 0096 |
| 0130 | No Response Explanation UI | 0044 |
| 0131 | Per-Persona Pause on Message Recall | 0046, 0048 |
| 0132 | Poke Functionality (Prompt Response) | 0011 |
| 0135 | Settings Namespace Migration | None |
| 0143 | Model Compatibility Guidance | 0096 |



### E010: TUI & OpenCode Integration

| Ticket | Title | Depends On |
|--------|-------|------------|
| 0101 | FileStorage Implementation | 0003 |
| 0106 | RemoteStorage Implementation | 0003, 0096 |
| 0128 | Persona GUIDs | None |
| 0107 | Sync Orchestrator | 0106 |
| 0115 | Fact Validation TUI | 0113, 0100 |
| 0134 | Single Instance Enforcement | 0101 |
| 0145 | OpenCode 1.2 SQLite Integration | 0102, 0103 |
| 0146 | Write-Through Storage | None |

### E012: TUI Commands (V1.2)

| Ticket | Title | Depends On | Status |
|--------|-------|------------|--------|
| 0140 | TUI Persona Switching | 0139 | DONE |
| 0141 | TUI Basic Commands | 0139, 0140 | DONE |
| 0142 | TUI $EDITOR Integration | 0139, 0140 | DONE |
| 0144 | TUI Unread Message Marking | 0100 | DONE |
| 0149 | TUI Markdown Rendering | 0100 | DONE |
| 0150 | TUI /quotes Command | 0100, 0116 | PENDING |

---

## IN_PROGRESS

(none)

---

## QA

(none)

---

## SUPERSEDED

| Ticket | Title | Superseded By |
|--------|-------|---------------|
| 0104 | Ei Context Exporter | Query-based CLI paradigm |
| 0105 | CLAUDE.md Context Injector | MCP tool paradigm |
| 0108 | OpenCode File Watcher | Polling-based session import |

---

## DONE

| Ticket | Title | Completed |
|--------|-------|-----------|
| 0001 | LM Studio Browser Validation | 2026-01-26 |
| 0002 | Core Types & Enums | 2026-01-26 |
| 0003 | Storage Interface & LocalStorage | 2026-01-26 |
| 0004 | StateManager Implementation | 2026-01-26 |
| 0005 | QueueProcessor Implementation | 2026-01-26 |
| 0006 | Processor Skeleton & Loop | 2026-01-26 |
| 0007 | Ei_Interface & Event System | 2026-01-26 |
| 0008 | Web Frontend Skeleton | 2026-01-26 |
| 0011 | Response Prompt Builder | 2026-01-28 |
| 0012 | Port Mock LLM Server | 2026-01-28 |
| 0013 | Chat UI Component | 2026-01-28 |
| 0014 | Persona List UI Component | 2026-01-28 |
| 0015 | Wire UI to Processor | 2026-01-28 |
| 0016 | First E2E Test (Send Message) | 2026-01-28 |
| 0017 | Ei Welcome Message | 2026-01-28 |
| 0020 | Heartbeat Check Prompt + Handler | 2026-01-28 |
| 0021 | Ei Heartbeat Prompt + Handler | 2026-01-28 |
| 0022 | Persona Generation Prompt + Handler | 2026-01-28 |
| 0023 | Persona Descriptions Prompt + Handler | 2026-01-28 |
| 0024 | Persona Trait Extraction | 2026-01-28 |
| 0025 | Persona Topic Detection | 2026-01-28 |
| 0026 | Persona Topic Exploration | 2026-01-28 |
| 0027 | Ei Validation Prompt + Handler | 2026-01-28 |
| 0028 | One-Shot Prompt System | 2026-01-28 |
| 0030 | Vitest Configuration | 2026-01-28 |
| 0031 | Playwright Configuration | 2026-01-28 |
| 0032 | Unit Tests: StateManager | 2026-01-28 |
| 0033 | Unit Tests: QueueProcessor | 2026-01-28 |
| 0034 | Unit Tests: Processor | 2026-01-28 |
| 0035 | E2E: Persona Switching | 2026-01-28 |
| 0036 | E2E: Checkpoint Save/Restore | 2026-01-28 |
| 0037 | E2E: Message Flow Complete | 2026-01-28 |
| 0040 | Layout Manager (3-panel, responsive) | 2026-01-28 |
| 0041 | Persona Panel: Status Indicators | 2026-01-28 |
| 0042 | Persona Panel: Hover Controls | 2026-01-28 |
| 0043 | Chat Panel: Markdown Rendering | 2026-01-28 |
| 0044 | Chat Panel: Message States (pending/read) | 2026-01-28 |
| 0045 | Input Box: Auto-resize | 2026-01-28 |
| 0046 | Input Box: Pending Message Recall | 2026-01-28 |
| 0047 | Keyboard Navigation | 2026-01-28 |
| 0048 | Control Area: System Pause | 2026-01-28 |
| 0049 | Control Area: Save UI | 2026-01-28 |
| 0050 | Help Modal | 2026-01-28 |
| 0060 | Human Fact Scan (Step 1) | 2026-01-28 |
| 0061 | Human Trait Scan (Step 1) | 2026-01-28 |
| 0062 | Human Topic Scan (Step 1) | 2026-01-28 |
| 0063 | Human Person Scan (Step 1) | 2026-01-28 |
| 0064 | Human Item Match (Step 2) | 2026-01-28 |
| 0065 | Human Item Update (Step 3) | 2026-01-28 |
| 0066 | Extraction Frequency Throttling | 2026-01-28 |
| 0067 | Cross-Persona Validation Queue | 2026-01-28 |
| 0070 | Ceremony Orchestrator | 2026-01-29 |
| 0071 | Exposure Phase | 2026-01-29 |
| 0072 | Decay Phase | 2026-01-29 |
| 0073 | Expire Phase | 2026-01-29 |
| 0074 | Explore Phase | 2026-01-29 |
| 0075 | Human Ceremony | 2026-01-29 |
| 0076 | Description Regeneration | 2026-01-29 |
| 0080 | Entity Editor Modal Shell | 2026-01-30 |
| 0081 | Human Settings Tab | 2026-01-30 |
| 0082 | Human Facts Tab | 2026-01-30 |
| 0083 | Human Traits Tab | 2026-01-30 |
| 0084 | Human Topics Tab | 2026-01-30 |
| 0085 | Human People Tab | 2026-01-30 |
| 0086 | Persona Editor Modal | 2026-01-30 |
| 0086+ | Batch Message Context Updates | `onMessagesChanged` event |
| 0087 | Persona Creator Modal | 2026-01-30 |
| 0088 | Context Window UI | 2026-01-30 |
| 0089 | Archived Personas UI | 2026-01-30 |
| 0051 | Context Boundary ("New" Command) | 2026-01-31 |
| 0091 | Dynamic vs Static Personas | 2026-01-30 |
| 0113 | Fact Validation System (Core) | 2026-02-01 |
| 0114 | Fact Validation Web UI | 2026-02-01 |
| 0112 | E2E Session Bug Coverage | 2026-02-02 |
| 0116 | Quote Data Type & Storage | 2026-02-02 |
| 0117 | Quote Extraction (Step 3) | 2026-02-02 |
| 0118 | Quote Chat Rendering | 2026-02-02 |
| 0119 | Quote Capture UI (Scissors Modal) | 2026-02-02 |
| 0120 | Quote Management UI | 2026-02-02 |
| 0110 | Group Visibility Redesign (* → General) | 2026-02-02 |
| 0122 | Quote Visibility & Response Integration | 2026-02-02 |
| 0123 | PersonaTopic Data Model Separation | 2026-02-02 |
| 0124 | Persona Topic Ceremony Redesign (3-Step) | 2026-02-02 |
| 0125 | PersonaTopic UI Update | 2026-02-02 |
| 0126 | Human Topic Category Field | 2026-02-02 |
| 0096 | Provider Accounts & Settings Sync | 2026-02-03 |
| 0127 | Queue Message Fetch Refactor | 2026-02-03 |
| 0121 | HumanEditor Smart Merge | 2026-02-03 |
| 0106 | RemoteStorage Implementation | 2026-02-04 |
| 0100 | TUI Frontend Skeleton | 2026-02-10 |
| 0133 | TUI Polish & Robustness | 2026-02-10 |
| 0102 | OpenCode Session Reader | 2026-02-11 |
| 0109 | OpenCode Agent Persona Bootstrap | 2026-02-11 |
| 0103 | OpenCode Session Importer | 2026-02-11 |
| 0090 | Onboarding Flow | 2026-02-14 |
| 0139 | TUI Slash Command Foundation | 2026-02-14 |
| 0140 | TUI Persona Switching | 2026-02-14 |
| 0141 | TUI Basic Commands | 2026-02-15 |
| 0142 | TUI $EDITOR Integration | 2026-02-15 |
| 0144 | TUI Unread Message Marking | 2026-02-16 |
| 0149 | TUI Markdown Rendering | 2026-02-16 |

---

## BLOCKED

(none)

---

## Backlog (Low Priority / Future)

| Ticket | Title | Notes |
|--------|-------|-------|
| 0009 | Ollama & Other Local LLM CORS Investigation | Document setup for other providers |
| 0010 | WebAssembly In-Browser Model Spike | Explore zero-setup browser-native models |
| 0111 | Persona Tool Use (Web Search) | 🌶️x5 - Enable external verification to prevent hallucinations |


---

## Key Decisions (from backward doc)

1. **Extraction only runs for Ei** - Other personas wait for nightly Ceremony
    a. 2026-02-01: Reverted this decision. Now anytime a persona hits `messages_since_[dataType]_seed` > `human.[dataType]_count`, extraction occurs
2. **Dynamic vs Static personas** - Static skips all Ceremony phases
    a. 2026-02-01: Right now this also skips the Human-side of the ceremony
    b. 2026-02-01: Re-evaluate this decision when we change Persona.Topics to clear their description when a human engages with the topic.
3. **Human message "Read" status** - Tracks whether response was *attempted*
4. **`pause_until` field** - Replaces boolean `is_paused` with timestamp/0/1
5. **One-Shot prompts** - New event loop for AI-assist buttons
6. **Bidirectional OpenCode Integration** - TUI is the integration point:
   - OpenCode → Ei: Session imports via file watcher
   - Ei → OpenCode: Context injection to CLAUDE.md
   - Sync via flare576.com enables Web (mobile) ↔ TUI (desktop)
7. **Sisyphus Persona** - Static persona representing coding agent, history = imported sessions
8. **Quote Preservation** - Quotes are a separate entity (not on Topic/Fact), validated via exact string match, human-in-the-loop for capture/management

---

## Ticket Sequencing: Settings & Storage Refactor

The following tickets form a logical sequence for settings/storage cleanup:

| Order | Ticket | Title | Rationale |
|-------|--------|-------|-----------|
| 1 | **0146** | Write-Through Storage | Simplifies storage model, may remove `auto_save_interval_ms` |
| 2 | **0135** | Settings Namespace Migration | Consolidates scattered settings into `settings.*` |
| 3 | **0129** | Settings Menu Redesign | UI assumes clean `settings.*` namespace |
| 4 | **0145** | OpenCode SQLite Integration | Independent, can parallel with 0129 |

**Why this order:**
- 0146 changes what settings exist (removes auto-save interval)
- 0135 moves remaining settings to proper namespace
- 0129 builds UI assuming settings are organized
- 0145 is storage-related but doesn't touch user settings
