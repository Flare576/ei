# Ticket Status Summary

## QA ⚠️ (0 tickets)

## DONE ✅ (92 tickets)
- 0133: Native Message Format for Responses
- 0131: /clarify Command Editing Is Broken - Converted to view-only (partial fix)
- 0130: Fix ei_validation Queue Dequeue Bug (fixed in separate commit)
- 0123: Update AGENTS.md Documentation
- 0124: Time-Based Core Logic (Simplified) - Daily Ceremony + Decay timers
- 0122: Remove Old Concept System
- 0121: Ei-Specific System Prompt
- 0120: Static Concepts → Prompt Templates
- 0119: Response Prompt Overhaul
- 0117: /clarify Command (display-only, editing deferred)
- 0116: Cross-Persona Validation
- 0115: Data Verification Flow (Daily Ceremony)
- 0113: Extraction Frequency Controller
- 0112: Detail Update Prompts
- 0111: Fast-Scan Prompt Implementation
- 0126: LLM Queue Processor
- 0109: Storage Migration
- 0108: New Entity Type Definitions
- 0107: Entity Data Architecture Overhaul (Epic)
- 0078: Persona Delete Command
- 0044: New Conversation Command
- 0039: Blessed Proper Emoji Support
- 0090: Parse Qwen-style Response Markup
- 0087: JSON Parse Retry with Enhanced Prompt
- 0001: Auto-Generate Persona Descriptions
- 0002: Nickname Management Commands
- 0005: CLI Thinking Indicators
- 0006: Detect and Handle LLM Response Truncation
- 0007: Configurable Storage Location
- 0008: Multi-Persona Heartbeat System
- 0009: Per-Persona Message Queues and Read Tracking
- 0010: Replace Readline with Ink + Basic 3-Pane Layout
- 0011: Responsive Terminal Layout
- 0013: Multi-line Input with Visual Feedback
- 0014: Message State Visualization
- 0016: Parallel Conversations
- 0017: Unread Indicators and Heartbeat Countdown Display
- 0019: Test Strategy and Infrastructure
- 0020: Markdown Rendering in Chat Messages
- 0021: Fix Gemma Message Echo Bug
- 0025: Ctrl+C Handling - Incomplete Abort
- 0029: /quit Command with Force Option
- 0031: Unit Tests for processor.ts
- 0035: Blessed Duplicate Message Processing
- 0037: Blessed Debug Output Log-Only Mode
- 0040: Blessed Resize Detection Broken
- 0041: Blessed Editor Command
- 0042: Pause/Resume Active Persona with Message Queuing
- 0043: Archive/Unarchive Personas
- 0053: Graceful Quit/Exit Commands (implemented as /quit only)
- 0054: Human Concept Map Race Condition Protection
- 0056: End-to-End Testing POC with Controlled Environment
- 0057: Persona Creation via /persona Command
- 0058: Blessed App.ts Refactoring
- 0060: Fix Same-Persona Switch Behavior
- 0061: Concept Processing Architecture Overhaul (Epic)
- 0062: Add concept_processed Flag to Messages
- 0063: Add last_updated Timestamp to Concepts
- 0064: Implement ConceptQueue Background Processor
- 0065: Decouple processEvent from Concept Updates
- 0066: Implement Queue Triggers (Switch, Stale Messages)
- 0067: Replace Heartbeat LLM Calls with Programmatic Decay
- 0069: Concept Schema Overhaul (Epic)
- 0070: Update Concept Interface - Add Sentiment, Remove Elasticity
- 0073: Add Sentiment Field Handling in Prompts
- 0074: Update Heartbeat Trigger Logic for New Schema
- 0075: Update Documentation for New Concept Schema
- 0076: Persist Unread Message Counts Across Sessions
- 0077: Help Command with External Pager
- 0080: Core Multi-Provider Infrastructure
- 0081: Schema - Add Model Field to ConceptMap
- 0082: Refactor LLM Calls - Accept Model Parameter
- 0083: Operation-Specific Model Configuration
- 0084: /model Command - View and Set Persona Models
- 0085: Provider-Specific Optimizations (partial - rate limits + headers)
- 0022: Multi-Model LLM Architecture (Epic)
- 0091: Dynamic Persona System Prompt
- 0093: Persona Generation - Seed Initial Topics
- 0086: Documentation - Multi-Model Setup Guide
- 0094: Group-Based Concept Visibility (Epic)
- 0095: Schema Changes - Group Fields
- 0096: Concept Visibility Filtering
- 0097: Concept Group Assignment Logic
- 0098: Group Management Commands
- 0099: Group-Based Persona Visibility
- 0100: Epic Cleanup - Finalize Schema
- 0101: Debug Log to Data Directory
- 0048: Unified State Management System (Undo + Save/Restore)
- 0110: LLM Queue Persistence File
- 0114: Known Personas in Prompts
- 0118: Ei Heartbeat Simplification

## PENDING (24 tickets)
- 0132: Extraction System Overhaul (Epic) - HIGH PRIORITY
- 0134: Three-Step Human Extraction Flow
- 0135: Prompt Centralization
- 0136: Persona Trait Behavior Detection (supersedes 0128)
- 0137: Persona Topic Exploration
- 0138: Persona Builder Template
- 0129: Extract Time-Based Core Logic from UI Layer (FUTURE - The Elephant)

- 0127: Persona Facts/People as Topics (Future Enhancement)
- 0106: Special Behavior for Archiving Ei Persona
- 0105: Context Window Command
- 0104: OpenTUI Migration Spike
- 0015: Persona Switching (Commands + Navigation)
- 0018: Warn on Public Repository Storage
- 0027: Enhanced Markdown Rendering
- 0028: Investigate Slow LLM Response Times
- 0032: Failed Message Edit and Retry Interface
- 0038: Blessed Multi-Line Modal Interface
- 0045: Poke Command with Physical Context Interpretation
- 0046: Clone Persona with Concept Map
- 0047: Force Edit Current Persona
- 0050: Global -p Parameter for Command Targeting
- 0052: Window Size CLI Parameter
- 0055: Logging System Improvements
- 0079: Validate Command Argument Counts
- 0088: Token Usage Logging
- 0089: Proactive API Key Validation
- 0092: LLM Validation and Error Handling

## SUPERSEDED (1 ticket)
- 0128: Persona Trait Change Detection Overhaul → absorbed into 0136

## CANCELLED ❌ (13 tickets)
- 0003: /editor Command for Multi-line Input
- 0049: Mingle Flag for Persona Cross-Awareness (superseded by 0094)
- 0051: Undo System (In-Memory State) (superseded by unified design in 0048)
- 0004: Inline Carriage Return Support (Ctrl+J)
- 0023: INK - Reduce Layout Resize Delay
- 0024: INK - Medium Layout Rendering Issues
- 0026: Heartbeats Should Not Interrupt Active Processing
- 0030: /editor Command for Ink-based Multi-line Input
- 0033: Blessed Resize Input Corruption Validation
- 0034: Blessed Status Line Corruption
- 0036: Blessed Text Rendering Corruption
- 0059: Heartbeat Countdown Live Updates
- 0068: Refine Elasticity Guidance and Defaults
- 0102: Ei Core Persona Refinement (absorbed into 0107)
- 0103: Persona Prompt Architecture (absorbed into 0107)

---

**Last Updated**: 2026-01-23
**Total Tickets**: 138 created
**Stats**: 92 done, 0 QA, 0 in_progress, 24 pending, 1 superseded, 13 cancelled, 7 archived (0107 epic sub-tickets)

## Epic Status

### 0061: Concept Processing Architecture Overhaul - DONE
- 0062: DONE - concept_processed flag
- 0063: DONE - last_updated timestamp
- 0064: DONE - ConceptQueue
- 0065: DONE - Decouple processEvent
- 0066: DONE - Queue triggers
- 0067: DONE - Programmatic decay
- 0068: CANCELLED - superseded by 0069

### 0069: Concept Schema Overhaul - DONE
- 0070: DONE - Update interface
- 0073: DONE - Sentiment field handling
- 0074: DONE - Heartbeat trigger logic
- 0075: DONE - Documentation updates

### 0022: Multi-Model LLM Architecture - DONE
- 0080: DONE - Core multi-provider infrastructure
- 0081: DONE - Schema model field
- 0082: DONE - Refactor LLM calls
- 0083: DONE - Operation-specific models
- 0084: DONE - /model command
- 0085: DONE (partial) - Rate limit handling + provider headers
- 0086: DONE - Documentation

## Deferred from 0085 (standalone tickets)
- 0087: DONE - JSON parse retry with enhanced prompt
- 0088: PENDING - Token usage logging
- 0089: PENDING - Proactive API key validation

### 0094: Group-Based Concept Visibility - DONE
- 0095: DONE - Schema changes (group fields)
- 0096: DONE - Concept visibility filtering
- 0097: DONE - Concept group assignment logic
- 0098: DONE - Group management commands (/g, /gs)
- 0099: DONE - Group-based persona visibility
- 0100: DONE - Epic cleanup (finalize schema)

### 0107: Entity Data Architecture Overhaul - DONE ✅
Replaces monolithic "Concept" system with structured data buckets.
Absorbs 0102 (Ei Core Persona) and 0103 (Persona Prompt Architecture).

**Completed work:**
- Two-phase extraction (fast-scan + detail update)
- Entity data buckets (facts/traits/topics/people) 
- LLM queue processor with persistence
- Daily Ceremony + decay timer infrastructure
- Cross-persona data validation
- /clarify command (display-only)
- Ei orchestrator role implementation

**Known edge cases (filed as separate bugs):**
- 0130: ei_validation queue dequeue (FIXED in separate commit)
- 0131: /clarify editing (display-only workaround, full editing deferred)

**Sub-tickets (all DONE):**
- 0108, 0109, 0110, 0111, 0112, 0113, 0114, 0115, 0116, 0117, 0118, 0119, 0120, 0121, 0122, 0123, 0124, 0126

**Future exploration (NOT blocking):**
- 0125: Group Chat Exploration
- 0129: Extract time-based logic from UI layer

### 0132: Extraction System Overhaul - PENDING
Complete overhaul of extraction system based on prompt engineering learnings.

**Sub-tickets:**
- 0133: DONE - Native Message Format for Responses
- 0134: PENDING - Three-Step Human Extraction Flow
- 0135: PENDING - Prompt Centralization
- 0136: PENDING - Persona Trait Behavior Detection (supersedes 0128)
- 0137: PENDING - Persona Topic Exploration
- 0138: PENDING - Persona Builder Template

**Implementation order:**
1. 0135 (Prompt Centralization) - enables cleaner work
2. 0133 (Native Message Format) - foundation
3. 0134 (Three-Step Extraction) - core overhaul
4. 0136 (Persona Traits) - depends on 0134, 0135
5. 0137 (Persona Topics) - depends on 0134, 0135
6. 0138 (Persona Builder) - low priority, nice-to-have
