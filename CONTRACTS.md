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
| `sources` | string[] | Namespaced source identifiers — where items were learned from. Format: "provider:id" (e.g., "opencode:ses_abc123", "cursor:composerId", "codex:threadId"). Grow-only union. |

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
- Drains the external Corrections Queue every tick (see below) — the one place it touches a file (`corrections.json`) directly rather than through StateManager, since that file lives outside StateManager's serialized state entirely

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

### Two-Phase Initialization Pattern

Startup runs two distinct phases. Understanding when to add to each matters:

**Phase 1 — Migrations** (`StateManager.runMigrations()`, runs after state is loaded from storage)

These transform existing data from an old shape to a new one. They fire only when persisted state is present, detect the old format by property presence, and are idempotent (safe to run repeatedly). Use this when:
- A field is renamed or restructured (`verbal_response` → `content`)
- A new field is backfilled from existing data (`learned_by` display names → IDs)
- Data needs to be moved between types (old-style validated facts → topics)

If you're writing a migration, `migrateLearnedOn()` is the reference pattern.

**Phase 2 — Seeds** (`Processor.completeInitialization()`, runs after migrations)

These ensure required structure exists with defaults. They always run — on first load, on every subsequent load — and skip gracefully if the structure is already present. Use this when:
- A new required field or entity must exist for the system to function
- The default value is meaningful regardless of prior state
- The operation is purely additive (never transforms or removes)

If you're writing a seed, `seedSettings()` or `bootstrapTools()` are the reference patterns.

**The rule of thumb**: If you're fixing old data, it's a migration. If you're ensuring new structure exists, it's a seed. A migration that runs on a fresh install should be a no-op. A seed that runs on upgrade should be safe.

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

## Corrections Queue

External writers — the CLI (`ei create/update/remove`, plus the quote-only verbs `ei create quote` / `ei fix quote` / `ei relink quote` / `ei remove quote`) and MCP tools (`ei_create`/`ei_update`/`ei_remove`, plus `ei_quote_create`/`ei_quote_fix`/`ei_quote_relink`) — run in a separate process from any live TUI/daemon and hold no `StateManager` instance to mutate directly. The corrections queue (`$EI_DATA_PATH/corrections.json`) is the only path by which an out-of-process writer changes state.

**`CorrectableType`** (`src/core/corrections.ts`): `"fact" | "topic" | "person" | "quote" | "persona"`. These five strings are the only valid `entity_type` values across both CLI and MCP surfaces — `assertValidCorrection()` rejects anything else.

**Three generic ops** (`src/core/corrections.ts`): `upsert` (insert-or-replace by id, every field taken from `record` as given), `patch` (an RFC 7396 JSON Merge Patch against an entity that must already exist — ADR-029), and `remove`. The discriminator is about SHAPE, not about the CLI verb that produced it: a `patch` record carries a `patch` member and never a `record`, so a caller cannot produce a value that is ambiguous between "full record" and "patch" merely by omitting fields. `patch` is valid for `persona`, `person`, and `topic` only — `assertValidCorrection()` rejects `{op: "patch", entity_type: "fact"}` and `"quote"` explicitly rather than accepting and no-op'ing them, since `fact` keeps full-record replacement permanently (ADR-029's own stated exclusion) and `quote` has its own grammar below. `ei update fact` therefore still queues an `upsert`.

A `patch` record deliberately carries **no embedding**. The authoritative merge happens at drain time against whatever state is actually stored then — `resolveTopicPatchCandidate` / `resolvePersonPatchCandidate` / `resolvePersonaPatchCandidate` (`src/core/corrections.ts`) merge, validate the merged candidate's writable projection against the real Zod candidate schema (`src/core/entity-schemas.ts`), and recompute the vector from the finally-merged text. A write-time embedding smuggled through the wire patch could otherwise overwrite a newer description's vector if another write interleaved before this one drained. A patch that is valid by grammar but invalid once merged onto stored state is rejected wholesale, and a patch whose target id does not exist is rejected too — there is nothing to merge onto.

| Type | create | update | remove | Why |
|------|--------|--------|--------|-----|
| fact | yes | yes (`upsert` — full record) | yes | Shared schema dispatch (`src/cli/corrections-endpoints.ts`). The permanent merge-patch exclusion (ADR-029): no defaults, nothing to merge onto |
| topic / person | yes | yes (`patch` — RFC 7396 merge) | yes | Shared schema dispatch (`src/cli/corrections-endpoints.ts`); merged and validated at drain time, never at write time |
| quote | yes | — | yes | Four dedicated ops of its own, never the generic upsert/remove pair — see **Quote write path** below. The `update` verb is kept but always rejects (ADR-012 tombstone) |
| persona | yes | yes (`patch` — RFC 7396 merge) | yes | Bypasses `corrections-endpoints.ts`'s shared schema entirely — different shape (`PersonaEntity`, not `DataItemBase`), own validation module (`src/cli/persona-corrections.ts`) |

### Quote write path

Quotes never use any of the generic `upsert`/`patch`/`remove` correction ops. `entity_type: "quote"` validates against exactly four dedicated ops — `quote.create`, `quote.fix`, `quote.relink`, `quote.remove` (`src/core/corrections.ts`) — and `assertValidCorrection()` rejects a quote record carrying either generic op. A pre-cutover `{op: "upsert", entity_type: "quote", …}` record left queued by an older binary can therefore never apply, at any of the three consumers.

| Op | CLI | MCP | Record shape | Provenance assertion |
|----|-----|-----|--------------|----------------------|
| `quote.create` | `ei create quote --message-id <id> --text "<text>" [--start N --end N]` | `ei_quote_create` | full record, `verified: true`, `data_item_ids`/`persona_groups` must be empty | text matched against the resolved source message; `message_id`/`speaker`/`channel`/`timestamp`/`embedding`/`created_at`/`created_by` are all derived server-side and rejected if the caller supplies them. `start`/`end` are different: optional, and when supplied are a consistency check, not a value — both must be present and both must equal the span the matcher independently found, or the write is refused (see below) |
| `quote.fix` | `ei fix quote --quote-id <id> --text "<text>" [--start N --end N]` | `ei_quote_fix` | full record, `verified: true` | re-verifies text against the quote's **existing** `message_id`; never re-resolves a new source, and the dispatcher overwrites all eight non-text fields from its own current-state copy |
| `quote.relink` | `ei relink quote <id> --to <entity-id,...>` | `ei_quote_relink` | partial: `id`, `data_item_ids`, `attempt_id` only | none — asserts nothing about text or origin, so it is permitted on dangling and orphaned quotes too. `data_item_ids` is a complete replacement list, and every target must resolve to a live fact/topic/person |
| `quote.remove` | `ei remove quote <id>` | `ei_remove` with `entity_type: "quote"` | `id` only | none |

`create` and `fix` are the only two ops that assert a quote's text or provenance, and each either verifies that text against a resolved source message or refuses — there is no third outcome. The four refusals are `no source message to verify against` (orphaned: `message_id` is already `null`), `source message could not be found` (dangling), `quote text not found in source message`, and `offset does not match the resolved text location` (supplied `start`/`end` must both be present and both equal the span the matcher independently found).

`relink` and `remove` carry only the fields they change, precisely so they cannot be a vehicle for asserting text or origin. They are not the only partial shape in the queue any more — ADR-029's `patch` op is also partial by construction — but they remain the only partial shapes that are *fixed*: a `patch` accepts any writable subset of its entity, whereas `quote.relink` and `quote.remove` accept one allowed-key set each and nothing else. `attempt_id` (also present on create/fix) is what lets a caller tell "my own write was declined" from "someone else's was" after a self-drain — see `docs/adr/ADR-008-accepted-write-races.md`.

The `update` verb on a quote — CLI `ei update` with a quote type, MCP `ei_update` with `entity_type: "quote"` — is kept and always rejects, before any schema validation or state load (ADR-012 tombstone). Its message names `ei fix quote`, `ei relink quote`, and `ei remove quote`, so an installed skill that predates this version produces a corrective error instead of a silent wrong write.

**Two drain paths** (`src/cli/corrections-writer.ts` writes, `Processor.drainCorrections()` reads):
- **Live-drain**: if a process holds `ei.lock` (TUI or future daemon), the write appends to `corrections.json` and waits — the live Processor's `runLoop` drains it into `StateManager` every tick (~100ms). No restart needed.
- **Self-drain**: if nothing holds the lock and `state.json` exists, the CLI applies the correction directly to `state.json` itself instead of leaving it queued indefinitely. Safe specifically because no live `StateManager` exists that could later overwrite the write with a stale in-memory copy — this is an intentional, narrow exception to the Processor/StateManager/Storage layering described above.
- **Sync edge case**: no lock, no `state.json`, but `state.backup.json` exists (sync user, TUI currently closed) — queues into `corrections.json` rather than fabricating a `state.json` that would conflict with the next sync pull.

**Atomicity**: both paths serialize through the shared advisory-lock + temp-file-rename primitives in `src/storage/file-lock.ts` (the same module `FileStorage` uses for `state.json` itself) — concurrent writers, live or self-draining, cannot interleave.

**Scope**: filesystem-only. Web (`IndexedDBStorage`) never writes or reads `corrections.json` — the CLI/MCP tools that produce it are Node/Bun-only.

**Event note**: `drainCorrections()` emits `onHumanUpdated` after applying a batch, regardless of which `CorrectableType`s were in it — including `quote` and `persona` corrections. This differs from the type-specific events (`onQuoteAdded`, `onPersonaUpdated`, etc.) an equivalent in-process `StateManager` mutation triggers; a frontend that only refetches personas/quotes on their dedicated events will miss corrections-driven changes to them.

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

## Person Identifiers

A `Person` record has an `identifiers` array (`PersonIdentifier[]` in `src/core/types/data-items.ts`). This replaces the previous single-name model.

### Matching Policy

**All identifier values participate in matching, regardless of type.** The `type` field is purely descriptive metadata — it tells you *why* this value identifies the person, not whether to use it for matching. If you add `{ type: "flibidy", value: "Krashley" }`, the system will match on "Krashley".

### `name` Sync Rule

`DataItemBase.name` is retained for backward compatibility but is no longer user-facing. State manager derives `name` from the primary identifier on every write:

```
name = identifiers.find(i => i.is_primary)?.value ?? identifiers[0]?.value ?? name
```

Code that reads `person.name` continues to work transparently. The UI never exposes a "Name" field — the card heading is the primary identifier's value.

### Pre-Migration State

Records with `identifiers: []` are in the pre-migration state. `name` still functions as the fallback for all code. The ceremony migration step (replaces `Dedup.Person`) populates identifiers for these records via an Opus call with `read_memory` access. `HumanSettings.people_migration_complete` flags when all records are migrated.

### `Ei Persona` Type

**The type is persisted exactly as typed and matched case-insensitively.** The canonical form is `Ei Persona` — capitalised, space-separated — and that is what seeders write, but a value the user typed as `ei persona` is stored that way and still matches. The string is user-visible and meant to read like a label, so its casing is theirs to choose. Every semantic consumer lowercases before comparing (`i.type.toLowerCase() === 'ei persona'`).

**The separator is not flexible.** `ei_persona` is not a variant spelling — it matches nothing, and because lookups return an empty result rather than an error, it fails *silently*. Earlier revisions of this document used the underscored form; it was never the stored value, and it has resurfaced in docs and comments repeatedly since. If you are writing a lookup, lowercase and compare against `'ei persona'` with a space.

A special identifier type that links a `Person` record to a `PersonaEntity` in the same Ei instance. The `value` is the **Persona's id** — not the display name — so the link survives persona renames. Resolve to a display name via `state.persona_getById(value)?.display_name` for UI.

Note the id is not always a UUID: the reserved personas `ei` and `emmet` carry those literal strings as their ids. Code or documentation asserting a UUID shape is wrong for them.

**A `Person` record carries at most one `Ei Persona` link, and a Persona is linked from at most one `Person` record.** This is decided — see `docs/adr/ADR-006-ei-persona-link-multiplicity.md`, status Accepted. Note **at most**: most Person records have no Persona link and should not have one. `identifiers: []` is valid. The constraint forbids a second link in either direction, not the absence of a first.

An earlier design deliberately allowed a many-to-many graph so a composite persona could be expressed as overlapping links, and earlier revisions of this section documented that. It is rejected. A composite gets its own Person record instead: `Person:King_Einstein <-> Persona:King_Einstein`, alongside the standalone pairs.

**Write-time prevention now exists at three ingress points; pre-existing data is not migrated.** The LLM person-update handler (`handlePersonUpdate`), CLI/MCP full-record person writes (both drain modes), and dedup's identifier union each run a shared guard (`guardPersonaLinks`, `src/core/utils/identifier-utils.ts`) immediately before persisting: a write that would create a second link applies everything else in the payload, drops only the offending link(s) — both, with no precedence, if the write introduces two at once — and reports the refusal through the `ei` persona thread (a self-drain reports synchronously to its own caller instead). No startup detector or repair pass exists, so data already in the many shape before this guard existed is untouched until a human edits it (ADR-010).

Two consequences for anyone writing against this section today:

- **Links are not user-initiated, and their presence is not evidence a human intended them.** Earlier revisions of this document said the system never auto-links without confirmation. That describes a workflow which no longer exists. A link is now most often created *implicitly*, as a side effect of creating a Persona or updating a Person record; the LLM person-update handler and dedup also create them outright. Explicit user linking is the rare path, not the rule.
- **Enumerate all linked records regardless — never take the first.** The write-time guard above stops *new* violations; it does not migrate data that was already in the many shape, and it does not change any consumer's own read-side logic. Code that assumes one link will still silently pick an arbitrary record on old data. For the reflection critic, that means clearing the wrong log.

### Built-in Identifier Types

These are suggested types for UI discoverability (dropdowns, autocomplete). They carry no special behavior — any string is valid and stored as-is. All values participate in matching equally.

| Type | Description |
|------|-------------|
| `full_name` | Legal or full birth name |
| `nickname` | Informal name, diminutive, pet name |
| `email` | Email address |
| `github` | GitHub username |
| `discord` | Discord username |
| `roblox` | Roblox username |
| `reddit` | Reddit username |
| `twitter` | Twitter/X handle |
| `ff14` | Final Fantasy XIV character name |
| `Ei Persona` | Links to a Persona in this Ei instance (value = the Persona's id — **not** always a UUID; reserved personas `ei` and `emmet` use those literal strings). See the `Ei Persona` Type section above. |

The user can add any type string. Types are NOT unique — multiple identifiers with the same type are valid (e.g., two `nickname` entries). Type values are stored and displayed exactly as typed — no normalization.

**On the casing in this table:** these are written lowercase for readability, but stored values are capitalised as the user or seeder typed them — `Email`, `GitHub`, `Ei Persona`. Matching is case-insensitive, so the casing here is harmless. The **separator** is not: `Ei Persona` is space-separated, and a lookup written against `ei_persona` matches nothing and returns empty without erroring.

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
| 2026-04-06 | **learned_on timestamp**: Added `learned_on?: string` to `DataItemBase`. Immutable ISO timestamp set at item creation; pairs with `learned_by`. Startup migration backfills existing records from `last_updated`. Dedup merge preserves earliest `learned_on` across merged items. Shown as read-only in TUI YAML (`# [read-only] learned_on: ...`) and in web data card footer. Not included in embedding text. |
| 2026-04-06 | **People Matching Enhancement**: Replaced LLM-based Scan→Match→Update pipeline with Scan→StructuredLookup→Update. `HandlePersonMatch` removed from `LLMNextStep`. Matching is now synchronous: exact identifier-value lookup (type-agnostic) then Levenshtein fuzzy fallback (threshold ≤2 for names <8 chars, ≤3 otherwise). Scan prompt extended to extract optional `identifiers[]`. Person update prompt split: `identifiers_to_add` (updates, additive) vs `identifiers` (new records). New people get `validated_date: ''`; heartbeat introduces them to Ei once. UI (web + TUI) stamps `validated_date` on first user interaction. Ceremony topic auto-dedup (`queueDedupPhase`) retired; user-triggered dedup (`queueUserDedupRequest`) remains. Dedup handler now unions `identifiers[]` when merging person records. `human_person_getByIdentifier` type param made optional for type-agnostic lookup. `levenshtein()` + `normalizeForMatch()` added to `src/core/utils/`. |
| 2026-04-06 | **People Schema Enhancement**: Added `PersonIdentifier` interface and `identifiers: PersonIdentifier[]` to `Person`. `DataItemBase.name` retained for backward compat — state manager syncs from primary identifier on every write. Added `people_migration_complete?: boolean` to `HumanSettings`. Added `HandlePersonIdentifierMigration` to `LLMNextStep`. Ceremony `Dedup.Person` step replaced by `Person Migration` step (same `ceremony_progress: 1` slot). Migration queues one Opus + `read_memory` call per unmigrated person; short-circuits when `people_migration_complete = true`. Added `human_person_getByIdentifier(type, value)` to StateManager. Person editor (web) gains identifiers UI; TUI `/me people` command shows identifiers as YAML list-of-maps. See "Person Identifiers" section above for matching policy and built-in types. |
| 2026-07-11 | **Model Settings Split**: Deprecated `HumanSettings.default_model` (read-only for one release; migration via `migrateModelSplit()` copies it forward). Added `conversation_model` (chat responses) and `extraction_model` (background extraction/analysis, optional). Extraction call sites (`human-extraction`, `persona-topics`, `room-extraction`, document importer) resolve via 3-tier fallback: per-call `options.extraction_model` → `HumanSettings.extraction_model` → `HumanSettings.conversation_model`. `oneshot_model`/`rewrite_model` unaffected. |
| 2026-08-01 | Added `external_reflection_only?: boolean` to `PersonaEntity` (default `false`). When set, Ei's automatic Reflection critic skips that Persona at **both** queue time (`queueReflectionPhase`) and handler time (`handleReflectionCritic`), so an external agent-aware reflection can process the PersonLog before it is cleared. The handler gate must suppress **both** of that function's writes — the log clear and the `pending_update` write — since they are independent. Exposed in TUI YAML, the web persona settings tab, and CLI/MCP. Rationale and rejected alternatives: `docs/adr/ADR-007-external-reflection-only.md`. |
| 2026-08-01 | The persona relationship block (`--format prompt`) now reports the linked PersonLog's character count, and past `PERSON_LOG_REFLECTION_THRESHOLD` adds a cue for the agent to raise reflection with the user. A count only — no log content crosses that boundary, enforced by the builder accepting `number \| undefined` rather than a record. Reaches OMP and OpenCode (base and OMO); the other four harnesses receive it when GitHub #94 lands. |
| 2026-08-01 | Corrected this document's spelling of the `Ei Persona` identifier type, which appeared here as `ei_persona` but is stored and matched as `Ei Persona`. A lookup written against the underscored form matches nothing and fails silently. Also recorded that persona ids are not universally UUID-shaped — reserved personas `ei` and `emmet` use those literal strings. Cardinality of the inverse link (several `Person` records sharing one persona id) is unresolved and tracked in `docs/adr/ADR-006-ei-persona-link-multiplicity.md`, status Proposed; settled regardless is that consumers must enumerate all linked records rather than taking the first. |
| 2026-08-02 | **Quote attestation**: quote corrections split from the generic `upsert`/`remove` pair into four dedicated ops (`quote.create`, `quote.fix`, `quote.relink`, `quote.remove`) with per-op allowed-key validation; `create`/`fix` verify caller text against a resolved source message or refuse; `relink`/`remove` carry only the fields they change and assert no provenance; both create/fix and relink carry a caller-minted `attempt_id` for per-call skip attribution. Quote `create` and `remove` are now supported externally, and the `update` verb on a quote is a permanent-reject tombstone (`docs/adr/ADR-012-sunset-with-a-path-forward.md`). New `ResolvedMessage` resolver contract (`src/cli/retrieval.ts`) supplies the `speaker`/`channel`/`timestamp` a created quote records, and distinguishes room messages from direct ones via `container.kind`. `migrateMessageIds()` now requires the quote text to match a candidate message's content before qualifying that quote's `message_id`. |
| 2026-08-07 | **Merge-patch write semantics (ADR-029) + field-visibility sweep (ADR-031)**: added the generic `patch` op (`{op: "patch", entity_type: "persona"\|"person"\|"topic", id, patch, timestamp}`) implementing RFC 7396 JSON Merge Patch for external updates — an omitted field is left unchanged, `null` removes a member, and the merge is performed and validated at drain time (against whichever state is actually stored then), never at write time; embeddings are recomputed there from the finally-merged text rather than carried on the wire. `fact` is the permanent exclusion and keeps `upsert`/full-record replacement; `patch` naming `fact` or `quote` is rejected. Topic/Person/Persona write shapes are now derived from one raw shape declaration each via `deriveSchemaPair` (`src/core/entity-schemas.ts`) into create/patch/candidate forms, shared verbatim by the CLI parse path and core's drain-time candidate validation. Under ADR-031, every System Hidden and System Visible field left the external write shapes entirely (`exposure_current`, `exposure_desired`, `last_ei_asked`, `rewrite_length_floor`, `embedding`, `learned_on`, `last_mentioned`, `learned_by`, `last_changed_by`, `sources`, `interested_personas`, `persona_groups`, and the persona in-app settings) and System Hidden fields are also stripped from every external read and write response (System Visible fields remain readable); `id`/`type`/`last_updated`/`linked_quotes` are an explicit allowlist stripped rather than rejected for fact/topic/person, so the `ei --id` → edit → `ei update` round-trip still parses (persona's own read-shape allowlist is wider — see `src/cli/README.md`). |
| 2026-08-09 | **Harness identity hooks**: Claude Code, Codex, Cursor, and base Pi each gained a session-start identity hook injecting the same `<ei-relationship>` block OMP and OpenCode already used — closing GitHub #94's acceptance criterion (all six harnesses now receive it; line above dated 2026-08-01 describing it as pending is superseded). Memory-hook dedup extended to all five hook-based harnesses; Cursor's accumulated-view render made per-`conversation_id` rather than global; the Pi extension's `Bun`-only `$` import (unresolvable by Pi's jiti loader) replaced with `node:child_process`, fixing an install that previously threw at load time on every real Pi install. |
