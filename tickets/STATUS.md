# EI V1 - Ticket Status

> Last updated: 2026-01-28 (E006 complete)

## Overview

| Status | Count |
|--------|-------|
| PENDING | 26 |
| IN_PROGRESS | 0 |
| QA | 0 |
| DONE | 51 |
| BLOCKED | 0 |

> 79 total tickets (51 done + 26 pending + 2 backlog).

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
| **E007** | 0070-0076 | PENDING | Ceremony System |
| **E008** | 0080-0089 | PENDING | UI: Entity Management |
| **E009** | 0090-0097 | PENDING | Polish & New Features |

---

## MVP Critical Path

✅ **MVP Complete!** Basic chat flow works end-to-end.

```
0011 Response Prompt    ─┐
0012 Port Mock Server   ─┼─→ 0015 Wire UI ─→ 0016 First E2E  ✅
0013 Chat UI            ─┤     to Processor
0014 Persona List UI    ─┘
```

---

## PENDING

### E007: Ceremony System

| Ticket | Title | Depends On |
|--------|-------|------------|
| 0070 | Ceremony Orchestrator | 0065 |
| 0071 | Exposure Phase | 0070 |
| 0072 | Decay Phase | 0070 |
| 0073 | Expire Phase | 0072 |
| 0074 | Explore Phase | 0073 |
| 0075 | Human Ceremony (Decay + Ei Prompt) | 0072 |
| 0076 | Description Regeneration | 0074 |

### E008: UI: Entity Management

| Ticket | Title | Depends On |
|--------|-------|------------|
| 0080 | Entity Editor Modal Shell | 0040 |
| 0081 | Human Settings Tab | 0080 |
| 0082 | Human Facts Tab | 0080 |
| 0083 | Human Traits Tab | 0080 |
| 0084 | Human Topics Tab | 0080 |
| 0085 | Human People Tab | 0080 |
| 0086 | Persona Editor Modal | 0080 |
| 0087 | Persona Creator Modal | 0086 |
| 0088 | Context Window UI | 0086 |
| 0089 | Archived Personas UI | 0042 |

### E009: Polish & New Features

| Ticket | Title | Depends On |
|--------|-------|------------|
| 0051 | Context Boundary ("New" Command) | 0043 |
| 0090 | Onboarding Flow | 0087 |
| 0091 | Dynamic vs Static Personas | 0086, 0070 |
| 0092 | Persona Image Generation | 0087 |
| 0093 | Rich Text Editor (Markdown + WYSIWYG) | 0080 |
| 0094 | Name Color Customization | 0081 |
| 0095 | Time Display Modes | 0081 |
| 0096 | Settings Sync (flare576.com) | 0081 |
| 0097 | LLM Streaming Support | 0011 |

---

## IN_PROGRESS

(none)

---

## QA

(none)

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

---

## BLOCKED

(none)

---

## Backlog (Low Priority / Future)

| Ticket | Title | Notes |
|--------|-------|-------|
| 0009 | Ollama & Other Local LLM CORS Investigation | Document setup for other providers |
| 0010 | WebAssembly In-Browser Model Spike | Explore zero-setup browser-native models |
| - | Batch Message Context Updates | `onMessagesChanged` event |
| - | FileStorage Implementation | For TUI mode (V1.1) |
| - | RemoteStorage Implementation | flare576.com encrypted sync |
| - | TUI Frontend | OpenTUI or similar |

---

## Key Decisions (from backward doc)

1. **Extraction only runs for Ei** - Other personas wait for nightly Ceremony
2. **Dynamic vs Static personas** - Static skips all Ceremony phases
3. **Human message "Read" status** - Tracks whether response was *attempted*
4. **`pause_until` field** - Replaces boolean `is_paused` with timestamp/0/1
5. **One-Shot prompts** - New event loop for AI-assist buttons
