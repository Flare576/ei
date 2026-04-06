# EI V1 - Contracts & Interface Definitions

This document is the **Source of Truth** for naming conventions, interface contracts, and design rationale in EI V1.

> **For AI Agents**: If a ticket uses a different name for something defined here, **STOP and ASK**. This document supersedes ticket descriptions.
>
> **What lives here**: Only knowledge that cannot be expressed in code — naming conventions, event contracts, security model, group visibility rules, and error codes. TypeScript interfaces live in `src/core/types/*.ts`. API method signatures live in the source. Do not add interface definitions here.

---

## Naming Conventions

### General Rules

| Pattern | Convention | Example |
|---------|------------|---------|
| Interfaces | PascalCase | `HumanEntity`, `LLMRequest` |
| Functions | camelCase | `getPersonaList`, `enqueueRequest` |
| Events | PascalCase, past tense | `PersonaAdded`, `MessageQueued` |
| Entity fields | snake_case | `last_updated`, `exposure_current` |
| Constants | SCREAMING_SNAKE | `MAX_RETRIES`, `DEFAULT_HEARTBEAT_MS` |

> **Note**: "Interfaces" means TypeScript type/interface *names* (e.g. `Topic`, `PersonaEntity`). All *fields within* those types use `snake_case`. The common name field on all entity types (Topic, Person, Fact) is `name` — NOT `label`.

> **Note**: AGENTS.md shorthand uses `on + PascalCase` for event handler names (e.g., `onPersonaAdded`). The canonical form here — PascalCase past tense — is the event name. The `on` prefix is the handler naming convention.

### Semantic Field Names

These field names have **specific meanings** and should be used consistently:

| Field | Type | Meaning |
|-------|------|---------|
| `exposure_current` | 0.0-1.0 | How recently/frequently this has been discussed |
| `exposure_desired` | 0.0-1.0 | How much the entity wants to discuss this |
| `sentiment` | -1.0 to 1.0 | Emotional valence (negative to positive) |
| `strength` | 0.0-1.0 | How strongly a trait manifests |
| `validated_date` | ISO string | When this fact was acknowledged (empty string = unacknowledged; ISO timestamp = acknowledged by Ei mention OR user edit) |
| `last_ei_asked` | ISO string \| null | When Ei last proactively asked about this Person/Topic |
| `last_updated` | ISO string | When this record was last modified |
| `last_activity` | ISO string | When the user last interacted with this entity |

> **V0 Migration Note**: `level_current` → `exposure_current`, `level_ideal` → `exposure_desired`

---

## Ei_Interface (Processor → Frontend)

The Frontend provides these event handlers when instantiating the Processor. All handlers are **optional**.

> **Design Decision**: Events carry minimal payload—just enough for the FE to know which subset of state to re-fetch. This lets the FE manage its own redux-style state efficiently. Handlers should not receive large data payloads; they should trigger a targeted re-fetch.

```typescript
interface Ei_Interface {
  // === Persona Events ===
  
  /** A new persona was created and is ready */
  onPersonaAdded?: () => void;
  
  /** A persona was archived or deleted */
  onPersonaRemoved?: () => void;
  
  /** A persona's entity data changed (traits, topics, description, model, etc.) */
  onPersonaUpdated?: (personaId: string) => void;
  
  // === Message Events ===
  
  /** A message was added to a persona's history (human or system) */
  onMessageAdded?: (personaId: string) => void;
  
  /** A message is being processed (LLM call in progress) */
  onMessageProcessing?: (personaId: string) => void;
  
  /** A message was queued for processing */
  onMessageQueued?: (personaId: string) => void;
  
  /** Pending human messages were recalled (for edit). Payload includes combined content for input field. */
  onMessageRecalled?: (personaId: string, content: string) => void;
  
  // === Human Entity Events ===
  
  /** Human entity data changed (facts, traits, topics, people) */
  onHumanUpdated?: () => void;
  
  // === Quote Events ===
  
  /** A quote was added */
  onQuoteAdded?: () => void;
  
  /** A quote was updated */
  onQuoteUpdated?: () => void;
  
  /** A quote was removed */
  onQuoteRemoved?: () => void;
  
  // === System Events ===
  
  /** Queue processor state changed */
  onQueueStateChanged?: (state: "idle" | "busy" | "paused") => void;
  
  /** An error occurred that the user should know about */
  onError?: (error: EiError) => void;
  
  // === One-Shot Events ===
  
  /** A one-shot LLM request completed (for AI-assist buttons) */
  onOneShotReturned?: (guid: string, content: string) => void;
  
  // === Context Events ===
  
  /** A persona's context boundary changed (via /new command) */
  onContextBoundaryChanged?: (personaId: string) => void;
  
  // === Save/Exit & Sync Events ===
  
  /** saveAndExit() has started (sync in progress) */
  onSaveAndExitStart?: () => void;
  
  /** saveAndExit() completed (success or failure) */
  onSaveAndExitFinish?: () => void;
  
  /** Remote state is newer than local — user must resolve conflict */
  onStateConflict?: (data: StateConflictData) => void;
  
  /** State was imported from external source (importState or post-conflict resolution) */
  onStateImported?: () => void;

  // === Tool Provider Events ===

  /** A tool provider was added */
  onToolProviderAdded?: () => void;

  /** A tool provider's config or enabled state was updated */
  onToolProviderUpdated?: (id: string) => void;

  /** A tool provider was removed (and all its tools) */
  onToolProviderRemoved?: () => void;

  // === Tool Events ===

  /** A tool was added to the platform registry */
  onToolAdded?: () => void;

  /** A tool's definition or config was updated */
  onToolUpdated?: (id: string) => void;

  /** A tool was removed from the platform registry */
  onToolRemoved?: () => void;
}
```

### Event Emission Rules

| Event | Emitted When |
|-------|--------------|
| `onPersonaAdded` | After persona creation completes |
| `onPersonaRemoved` | After persona archive or delete |
| `onPersonaUpdated` | After any persona entity field changes |
| `onMessageAdded` | After a message is appended to history |
| `onMessageProcessing` | When QueueProcessor starts a response-type request |
| `onMessageQueued` | When a user message is added and response is queued |
| `onMessageRecalled` | When pending human messages are recalled via `recallPendingMessages` |
| `onHumanUpdated` | After any human entity field changes |
| `onQueueStateChanged` | When QueueProcessor transitions between idle/busy/paused |
| `onError` | When a recoverable error occurs (e.g., LLM failure after retries) |
| `onOneShotReturned` | When a one-shot LLM request completes |
| `onContextBoundaryChanged` | When context boundary updates for a persona |
| `onSaveAndExitStart` | When `saveAndExit()` begins (sync starting) |
| `onSaveAndExitFinish` | When `saveAndExit()` completes (success or failure) |
| `onStateConflict` | When remote state is newer than local on startup |
| `onStateImported` | After `importState()` or post-conflict state restore |

---

## Processor Layer

The Processor is the **single entry point** for all frontend interactions. It owns the execution loop, orchestrates all async work, and emits `Ei_Interface` events to notify the frontend of state changes.

**Responsibilities**:
- Running the 100ms tick loop (heartbeat checks, queue dispatch, auto-save scheduling)
- Accepting user actions (send message, update persona, manage providers) and translating them into StateManager mutations + queued LLM work
- Dispatching LLM responses to the correct handler (`LLMNextStep` routing)
- Emitting `Ei_Interface` events after state changes so the frontend knows what to re-fetch
- Bootstrapping built-in tool providers and tools on startup

**Relationship to other layers**:
- Reads/writes all state through `StateManager` — never touches storage directly
- Delegates LLM execution to `QueueProcessor` — never calls the LLM inline
- Notifies the frontend through `Ei_Interface` — never holds frontend references directly

**What it is NOT**:
- Not a data store (that's StateManager)
- Not a prompt builder (that's `src/prompts/`)
- Not a tool executor (that's `src/core/tools/`)

For method signatures, read `src/core/processor.ts` directly. The canonical API is the code.

---

## StateManager Layer

The StateManager is the **in-memory state store**. It holds all runtime data and exposes typed CRUD operations. It does not call LLMs, does not call the network, and does not know about the frontend.

**Responsibilities**:
- Maintaining in-memory state: human entity, personas, messages, LLM queue, tool providers, tool definitions
- Providing typed read/write operations that update `last_updated` and mark state dirty
- Serializing state to/from `StorageState` for persistence
- Running load-time migrations (field renames, schema changes)

**Relationship to other layers**:
- Receives a `Storage` instance at `initialize()` time and delegates all persistence to it
- Is called exclusively by the Processor — no other layer mutates state through StateManager
- Exposes `getStorageState()` / `restoreFromState()` for sync and export/import flows

**State slices** (implemented as sub-classes in `src/core/state/`):
- `HumanState` — facts, topics, people, quotes, settings
- `PersonaState` — persona entities, message histories
- `QueueState` — LLM request queue, DLQ, pause flag
- `PersistenceState` — storage reference, dirty tracking, auto-save

For method signatures, read `src/core/state-manager.ts` directly. The canonical API is the code.

---

## Storage Interface

Storage is an abstraction over persistence backends. The interface is defined in `src/storage/interface.ts`.

### Storage Implementations

| Implementation | Description | Used By |
|----------------|-------------|---------|
| `IndexedDBStorage` | Browser IndexedDB (web frontend) | Web |
| `FileStorage` | Node.js file system (`EI_DATA_PATH`) | TUI |
| `RemoteStorage` | flare576.com encrypted sync | Both (optional) |

**Embedding storage**: All vector embeddings are serialized as base64-encoded `Float32Array` blobs before persistence, then compressed. This reduces storage size by ~75% vs. JSON float arrays. Decompression and decoding happen transparently at load time.

### RemoteSync Security Model

The RemoteSync module handles encrypted cloud backup to flare576.com.

**Security Model** (irreplaceable — not expressed in code comments):
1. Credentials never leave the browser unencrypted
2. User ID derived via `PBKDF2(username:passphrase)` → AES-GCM encrypt a fixed known plaintext (`"the_answer_is_42"`) with a fixed IV → this ciphertext becomes the server-side user ID. Same credentials always produce the same ID, with no account system and no lookup table.
3. State encrypted with the same derived key + a random IV per upload
4. Server stores only encrypted blobs — cannot decrypt even with full database access

**Rate Limiting**: 3 uploads per hour per user. Server returns 429 with `Retry-After` header if exceeded.

---

## Group Visibility Model

Groups control which data (facts, topics, people, quotes) personas can see.

### Persona Group Fields

| Field | Type | Purpose |
|-------|------|---------|
| `group_primary` | `string \| null` | Where data learned by this persona gets tagged |
| `groups_visible` | `string[]` | Additional groups this persona can read from |

**Effective visibility** = `group_primary` ∪ `groups_visible`

### Data Item Visibility

The `persona_groups` field on data items controls which personas can see them:
- **Empty array** (`[]`): Treated as `["General"]` (default/legacy data)
- **Specific groups**: Only visible to personas with matching groups in their effective visibility

### Ei Special Case

Ei is the system persona with **global visibility**:
- `group_primary`: Always "General" (immutable)
- `groups_visible`: Displays "All Groups" in UI (immutable)
- Bypasses group filtering entirely — sees all data regardless of groups

### Examples

```typescript
// Default persona - sees General, writes to General
group_primary: "General"
groups_visible: ["General"]  // redundant but explicit

// Fellowship persona (Frodo, Gandalf)
group_primary: "Fellowship"
groups_visible: ["General"]  // sees Fellowship + General

// Isolated persona - truly walled off
group_primary: "Hermit"
groups_visible: []  // sees only Hermit
```

### Default Values

New personas default to:
```typescript
group_primary: "General"
groups_visible: ["General"]
```

---

## Error Codes

Standard error codes for `onError` events:

| Code | Meaning |
|------|---------|
| `LLM_RATE_LIMITED` | Rate limit exceeded, retries exhausted |
| `LLM_TIMEOUT` | LLM call timed out |
| `LLM_INVALID_JSON` | JSON parse failed after retries |
| `LLM_TRUNCATED` | Response was truncated |
| `LLM_AUTH_ERROR` | Authentication failed (401/403) |
| `LLM_SERVER_ERROR` | LLM server error (5xx) |
| `LLM_REQUEST_ERROR` | Invalid request (4xx) |
| `LLM_ERROR` | Unclassified LLM error |
| `HANDLER_NOT_FOUND` | No handler registered for next_step |
| `HANDLER_ERROR` | Handler threw an exception |
| `STORAGE_LOAD_FAILED` | Could not load state from storage |
| `STORAGE_SAVE_FAILED` | Could not save state to storage |
| `PERSONA_NOT_FOUND` | Requested persona doesn't exist |
| `PERSONA_ARCHIVED` | Operation not allowed on archived persona |
| `QUEUE_BUSY` | QueueProcessor already processing |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-26 | Initial draft |
| 2026-01-26 | Added `id` to DataItemBase and Message |
| 2026-01-26 | Removed `state` from Message |
| 2026-01-26 | Changed extraction prompts to use `messages_context`/`messages_analyze` |
| 2026-01-26 | Moved `heartbeat_delay_ms` to PersonaEntity (per-persona) |
| 2026-01-26 | Added `queue_paused` to HumanSettings |
| 2026-01-26 | Added `queue_pause()`/`queue_resume()` to StateManager |
| 2026-01-26 | Changed `LLMNextStep` to enum |
| 2026-01-26 | Changed `in_context: boolean` to `context_status: ContextStatus` enum (default/always/never) |
| 2026-01-28 | Added `onMessageRecalled`, `markMessageRead()`, `recallPendingMessages()` |
| 2026-01-28 | Human messages now start `read: false`, marked `read: true` when AI responds |
| 2026-02-02 | **V1.Web Documentation Sync**: Added `onOneShotReturned`, `onContextBoundaryChanged` events |
| 2026-02-02 | Added `HandleOneShot`, `HandlePersonaExpire`, `HandlePersonaExplore`, `HandleDescriptionCheck` to LLMNextStep |
| 2026-02-02 | Added `CeremonyConfig` interface (in HumanSettings.ceremony) |
| 2026-02-02 | Added `is_static` field to PersonaEntity |
| 2026-02-02 | Added `markAllMessagesRead()`, `submitOneShot()` to Processor API |
| 2026-02-02 | Added StateManager methods: `messages_markRead`, `messages_markPendingAsRead`, `messages_countUnread`, `messages_markAllRead`, `messages_remove`, `queue_clearPersonaResponses`, `persona_setContextBoundary` |
| 2026-02-02 | **Group Visibility Redesign**: Replaced `*` wildcard with explicit "General" group |
| 2026-02-02 | Ei now has global visibility (special-cased), `group_primary: "General"`, immutable in UI |
| 2026-02-02 | Empty `persona_groups` on data items treated as `["General"]` for backward compatibility |
| 2026-02-03 | **Provider Accounts System**: Added `ProviderAccount` interface and `ProviderType` enum |
| 2026-02-04 | **Remote Sync Implementation**: Added `SyncCredentials`, `RemoteSync` interface, `SyncResult`, `RemoteCheckResult` |
| 2026-02-04 | Added `getStorageState()`, `restoreFromState()` to Processor API and StateManager |
| 2026-02-26 | **Structured Message Fields**: Replaced `Message.content: string` with `verbal_response?`, `action_response?`, `silence_reason?` |
| 2026-02-27 | **CONTRACTS Audit Sweep**: Full sync with actual codebase (checkpoint system retired, see below) |
| 2026-02-27 | Removed entire Checkpoint system: `Ei_Interface` checkpoint events, Processor checkpoint methods, StateManager `checkpoint_*` methods, Storage checkpoint methods, `Checkpoint` interface |
| 2026-02-27 | Storage interface simplified to `loadState`/`saveState`/`loadBackup`/`moveToBackup` |
| 2026-02-27 | Added `PersonaEntity.id` and `PersonaEntity.display_name` (replaces implicit name-as-key pattern) |
| 2026-02-27 | Fixed `PersonaSummary`: added `id`, `display_name`, `context_boundary`; removed `name` |
| 2026-02-27 | Fixed `QueueStatus`: added `dlq_count` |
| 2026-02-27 | Fixed `HumanSettings`: removed `auto_save_interval_ms`, `name_color`; added `opencode`, `ceremony` |
| 2026-02-27 | Removed `HumanEntity.ceremony_config` (moved to `settings.ceremony`) |
| 2026-02-27 | Fixed `CeremonyConfig`: removed `enabled`, added `dedup_threshold` |
| 2026-02-27 | Added `OpenCodeSettings` interface |
| 2026-02-27 | Added `StateConflictData` interface and `StateConflictResolution` type |
| 2026-02-27 | Added `onSaveAndExitStart`, `onSaveAndExitFinish`, `onStateConflict`, `onStateImported` to `Ei_Interface` |
| 2026-02-27 | All `personaName: string` params across Processor/StateManager APIs updated to `personaId: string` |
| 2026-02-27 | Added Processor methods: `saveAndExit`, `resolveStateConflict`, `resolvePersonaName`, `deleteMessages`, `searchHumanData`, `importState`, `pauseQueue`, `getQueueActiveItems`, `getDLQItems`, `updateQueueItem`, `clearQueue` |
| 2026-02-27 | Added Processor debug methods: `triggerCeremonyNow`, `getCeremonyStatus` |
| 2026-02-27 | Fixed `LLMNextStep`: replaced `HandlePersonaTopicDetection`/`Exploration` with `HandlePersonaTopicScan`/`Match`/`Update`; removed `HandleCeremonyExposure`/`DecayComplete` |
| 2026-02-27 | Added `LLMRequestState` type and `state`/`retry_after` fields to `LLMRequest` |
| 2026-02-27 | Updated Error Codes: removed checkpoint codes, added `LLM_AUTH_ERROR`, `LLM_SERVER_ERROR`, `LLM_REQUEST_ERROR`, `HANDLER_NOT_FOUND`, `HANDLER_ERROR` |
| 2026-03-01 | Added `oneshot_model` to `HumanSettings` for AI-assist wand model override |
| 2026-03-02 | Added `BackupConfig` interface; added `backup?: BackupConfig` to `HumanSettings`; added `saveRollingBackup()` to Storage interface (TUI only) |
| 2026-03-04 | Added `ToolDefinition` interface and Tool Types section |
| 2026-03-04 | Added `tools?: string[]` to `PersonaEntity` |
| 2026-03-04 | Added `tools: ToolDefinition[]` to `StorageState` |
| 2026-03-06 | Added `rewrite_model` to `HumanSettings` for ceremony rewrite phase model override |
| 2026-03-06 | Added `HandleRewriteScan`, `HandleRewriteRewrite` to `LLMNextStep` for item reorganization ceremony |
| 2026-03-14 | **CONTRACTS Overhaul**: Removed TypeScript interface definitions (canonical source is now `src/core/types/*.ts`). Replaced Processor API and StateManager API method lists with prose layer descriptions. Removed: Table of Contents, Architecture Diagram, QueueProcessor API, all Entity Types sections, LLM Types section, Prompt Contracts section. Storage table updated: LocalStorage → IndexedDB (web). Added note on compressed embedding blob storage. Tool Types section moved to AGENTS.md (policy) and README.md (user-facing). |
| 2026-03-27 | Added `channel` to `Quote`: display name of the Channel where captured. Fixed `speaker` to always reflect the actual speaker (persona display_name or "human") rather than the channel name for room quotes. |
| 2026-04-05 | **Persona Ceremony Simplification**: Removed `HandlePersonaTopicScan`, `HandlePersonaTopicMatch`, `HandlePersonaTopicUpdate`, `HandlePersonaExpire`, `HandlePersonaExplore`, `HandleDescriptionCheck` from `LLMNextStep`. Added `HandlePersonaTopicRating`. Ceremony flow simplified to: Dedup → Expose (human extraction + persona topic **rating**) → EventSummary → Decay. Expire, Explore, and DescriptionCheck phases removed entirely. Persona topics now only update `exposure_current` — `perspective`, `approach`, `personal_stake`, `sentiment`, `exposure_desired` are never written by ceremony. |
