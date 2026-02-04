# EI V1 - Contracts & Interface Definitions

This document is the **Source of Truth** for naming conventions, interface contracts, and data shapes in EI V1.

> **For AI Agents**: If a ticket uses a different name for something defined here, **STOP and ASK**. This document supersedes ticket descriptions.

---

## Table of Contents

1. [Naming Conventions](#naming-conventions)
2. [Architecture Overview](#architecture-overview)
3. [Ei_Interface (Processor → Frontend)](#ei_interface-processor--frontend)
4. [Processor API (Frontend → Processor)](#processor-api-frontend--processor)
5. [StateManager API (Processor → StateManager)](#statemanager-api-processor--statemanager)
6. [QueueProcessor API](#queueprocessor-api)
7. [Storage Interface](#storage-interface)
8. [Entity Types](#entity-types)
9. [Group Visibility Model](#group-visibility-model)
10. [LLM Types](#llm-types)
11. [Prompt Contracts](#prompt-contracts)

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

### Semantic Field Names

These field names have **specific meanings** and should be used consistently:

| Field | Type | Meaning |
|-------|------|---------|
| `exposure_current` | 0.0-1.0 | How recently/frequently this has been discussed |
| `exposure_desired` | 0.0-1.0 | How much the entity wants to discuss this |
| `sentiment` | -1.0 to 1.0 | Emotional valence (negative to positive) |
| `strength` | 0.0-1.0 | How strongly a trait manifests |
| `validated` | ValidationLevel | Whether fact has been acknowledged (none/ei/human) |
| `validated_date` | ISO string | When validation state last changed |
| `last_updated` | ISO string | When this record was last modified |
| `last_activity` | ISO string | When the user last interacted with this entity |

> **V0 Migration Note**: `level_current` → `exposure_current`, `level_ideal` → `exposure_desired`

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                 │
│  (React SPA / Future TUI)                                       │
│                                                                  │
│  Creates: Ei_Interface (event handlers)                         │
│  Calls: Processor API methods                                   │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          │ Ei_Interface (events)
                          │ Processor API (async methods)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                         PROCESSOR                                │
│                                                                  │
│  - Primary execution loop                                        │
│  - Scheduled task orchestration                                  │
│  - Handler dispatch for LLM responses                           │
│  - Frontend notification via Ei_Interface                       │
│                                                                  │
│  Owns: StateManager, QueueProcessor                             │
└─────────────────────────┬───────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
          ▼               ▼               ▼
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│ StateManager│   │QueueProcessor│   │   Storage   │
│             │   │             │   │             │
│ In-memory   │   │ Single LLM  │   │ Persistence │
│ state CRUD  │   │ executor    │   │ abstraction │
│ LLM queue   │   │             │   │             │
└─────────────┘   └─────────────┘   └─────────────┘
```

---

## Ei_Interface (Processor → Frontend)

The Frontend provides these event handlers when instantiating the Processor. All handlers are **optional**.

> **Design Decision**: Events carry minimal payload—just enough for the FE to know which subset of state to re-fetch. This lets the FE manage its own redux-style state efficiently.

```typescript
interface Ei_Interface {
  // === Persona Events ===
  
  /** A new persona was created and is ready */
  onPersonaAdded?: () => void;
  
  /** A persona was archived or deleted */
  onPersonaRemoved?: () => void;
  
  /** A persona's entity data changed (traits, topics, description, model, etc.) */
  onPersonaUpdated?: (personaName: string) => void;
  
  // === Message Events ===
  
  /** A message was added to a persona's history (human or system) */
  onMessageAdded?: (personaName: string) => void;
  
  /** A message is being processed (LLM call in progress) */
  onMessageProcessing?: (personaName: string) => void;
  
  /** A message was queued for processing */
  onMessageQueued?: (personaName: string) => void;
  
  /** Pending human messages were recalled (for edit). Payload includes combined content for input field. */
  onMessageRecalled?: (personaName: string, content: string) => void;
  
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
  
  /** Queue processor state changed (idle ↔ busy) */
  onQueueStateChanged?: (state: "idle" | "busy") => void;
  
  /** An error occurred that the user should know about */
  onError?: (error: { code: string; message: string }) => void;
  
  // === Checkpoint Events ===
  
  /** A checkpoint operation is starting. UI should disable checkpoint interactions until onCheckpointCreated/Deleted fires. */
  onCheckpointStart?: () => void;
  
  /** A checkpoint was created. If index provided, it was manual save (10-14). No index = auto-save (0-9). */
  onCheckpointCreated?: (index?: number) => void;
  
  /** A checkpoint was restored. UI should refresh all state. */
  onCheckpointRestored?: (index: number) => void;
  
  /** A manual checkpoint was deleted (slots 10-14 only) */
  onCheckpointDeleted?: (index: number) => void;
  
  // === One-Shot Events ===
  
  /** A one-shot LLM request completed (for AI-assist buttons) */
  onOneShotReturned?: (guid: string, content: string) => void;
  
  // === Context Events ===
  
  /** A persona's context boundary changed (via "New" command) */
  onContextBoundaryChanged?: (personaName: string) => void;
}
```

### Event Emission Rules

| Event | Emitted When |
|-------|--------------|
| `onPersonaAdded` | After `persona_add` completes in StateManager |
| `onPersonaRemoved` | After `persona_archive` or `persona_delete` completes |
| `onPersonaUpdated` | After any persona entity field changes |
| `onMessageAdded` | After a message is appended to history |
| `onMessageProcessing` | When QueueProcessor starts a response-type request |
| `onMessageQueued` | When a user message is added and response is queued |
| `onMessageRecalled` | When pending human messages are recalled via `recallPendingMessages` |
| `onHumanUpdated` | After any human entity field changes |
| `onQueueStateChanged` | When QueueProcessor transitions between idle/busy |
| `onError` | When a recoverable error occurs (e.g., LLM failure after retries) |
| `onCheckpointStart` | Before any checkpoint save/delete/restore operation begins |
| `onCheckpointCreated` | After auto-save (no index) or manual save (with index 10-14) |
| `onCheckpointRestored` | After state is restored from a checkpoint |
| `onCheckpointDeleted` | After a manual checkpoint (10-14) is deleted |
| `onOneShotReturned` | When a one-shot LLM request completes (AI-assist buttons) |
| `onContextBoundaryChanged` | When `setContextBoundary` updates a persona's boundary |

---

## Processor API (Frontend → Processor)

All methods are **async** and return Promises. The Processor instance is created by the Frontend.

```typescript
interface Processor {
  // === Lifecycle ===
  
  /** Start the processor loop. Call once after construction. */
  start(): Promise<void>;
  
  /** Stop the processor loop. Call before app shutdown. */
  stop(): Promise<void>;
  
  // === Persona Operations ===
  
  /** Get list of all personas with summary info */
  getPersonaList(): Promise<PersonaSummary[]>;
  
  /** Get full persona entity by name */
  getPersona(name: string): Promise<PersonaEntity | null>;
  
  /** Create a new persona from structured user input */
  createPersona(input: PersonaCreationInput): Promise<void>;
  
  /** Archive a persona (soft delete) */
  archivePersona(name: string): Promise<void>;
  
  /** Unarchive a persona */
  unarchivePersona(name: string): Promise<void>;
  
  /** Permanently delete an archived persona */
  deletePersona(name: string, deleteHumanData: boolean): Promise<void>;
  
  /** Update persona fields (model, description, group, etc.) */
  updatePersona(name: string, updates: Partial<PersonaEntity>): Promise<void>;
  
  /** Get all known groups across all personas (derived from group_primary + groups_visible) */
  getGroupList(): Promise<string[]>;
  
  // === Message Operations ===
  
  /** Get message history for a persona */
  getMessages(personaName: string, options?: MessageQueryOptions): Promise<Message[]>;
  
  /** Send a message to a persona (queues response) */
  sendMessage(personaName: string, content: string): Promise<void>;
  
  /** Set context window bounds for a persona */
  setContextWindow(personaName: string, start: string, end: string): Promise<void>;
  
  /** 
   * Set context boundary for a persona ("New" command).
   * Messages before this timestamp are excluded from LLM context (unless context_status="always").
   * Pass null to clear the boundary.
   */
  setContextBoundary(personaName: string, timestamp: string | null): Promise<void>;
  
  /** Set a message's context status */
  setMessageContextStatus(personaName: string, messageId: string, status: ContextStatus): Promise<void>;
  
  /** Mark a message as read */
  markMessageRead(personaName: string, messageId: string): Promise<boolean>;
  
  /** Mark all messages as read for a persona, returns count marked */
  markAllMessagesRead(personaName: string): Promise<number>;
  
  /** 
   * Recall pending (unread) human messages for editing.
   * Removes the messages from history, cancels queued responses, and returns combined content.
   * Human messages start as read=false and become read=true when the AI responds.
   */
  recallPendingMessages(personaName: string): Promise<string>;
  
  // === Human Entity Operations ===
  
  /** Get the human entity */
  getHuman(): Promise<HumanEntity>;
  
  /** Update human entity fields */
  updateHuman(updates: Partial<HumanEntity>): Promise<void>;
  
  /** Add/update a fact (matched by id) */
  upsertFact(fact: Fact): Promise<void>;
  
  /** Add/update a trait (matched by id) */
  upsertTrait(trait: Trait): Promise<void>;
  
  /** Add/update a topic (matched by id) */
  upsertTopic(topic: Topic): Promise<void>;
  
  /** Add/update a person (matched by id) */
  upsertPerson(person: Person): Promise<void>;
  
   /** Remove a data item by type and id */
   removeDataItem(type: "fact" | "trait" | "topic" | "person", id: string): Promise<void>;
   
   // === Quote Operations ===
   
   /** Add a new quote */
   addQuote(quote: Quote): Promise<void>;
   
   /** Update an existing quote by id */
   updateQuote(id: string, updates: Partial<Quote>): Promise<void>;
   
   /** Remove a quote by id */
   removeQuote(id: string): Promise<void>;
   
   /** Get quotes with optional filtering */
   getQuotes(filter?: { message_id?: string; data_item_id?: string }): Promise<Quote[]>;
   
   /** Get all quotes for a specific message */
   getQuotesForMessage(messageId: string): Promise<Quote[]>;
   
   // === Checkpoint Operations ===
  
  /** Get list of all checkpoints, sorted by timestamp desc */
  getCheckpoints(): Promise<Checkpoint[]>;
  
  /** 
   * Create a manual checkpoint in a save slot.
   * @param index - Slot 10-14 only
   * @param name - Display name for the save (FE provides default if user doesn't)
   * @throws If index is not 10-14
   */
  createCheckpoint(index: number, name: string): Promise<void>;
  
  /**
   * Delete a manual checkpoint.
   * @param index - Slot 10-14 only (cannot delete auto-saves)
   * @throws If index is not 10-14
   */
  deleteCheckpoint(index: number): Promise<void>;
  
  /**
   * Restore state from a checkpoint.
   * @param index - Slot index (0-14)
   * @returns true if restored, false if slot is empty
   */
  restoreCheckpoint(index: number): Promise<boolean>;
  
  /** Export full state as JSON (for download) */
  exportState(): Promise<string>;
  
  // === State Operations ===
  
  /** Get current state for remote sync */
  getStorageState(): Promise<StorageState>;
  
  /** Restore state from external source (remote sync, conflict resolution) */
  restoreFromState(state: StorageState): Promise<void>;
  
  // === Templates ===
  
  /** Get persona creation template (for editor UI) */
  getPersonaCreationTemplate(): Promise<string>;
  
  // === LLM Operations ===
  
  /** 
   * Abort current LLM operation and pause queue processing.
   * Call resumeQueue() to continue processing.
   */
  abortCurrentOperation(): Promise<void>;
  
  /** Resume queue processing after abort */
  resumeQueue(): Promise<void>;
  
  /** Get queue status */
  getQueueStatus(): Promise<QueueStatus>;
  
  /** 
   * Submit a one-shot LLM request (for AI-assist buttons).
   * Result returned via onOneShotReturned event with matching guid.
   */
  submitOneShot(guid: string, systemPrompt: string, userPrompt: string): Promise<void>;
}
```

### Supporting Types

```typescript
interface PersonaSummary {
  name: string;
  aliases: string[];
  short_description?: string;
  is_paused: boolean;
  is_archived: boolean;
  unread_count: number;
  last_activity?: string;
}

interface MessageQueryOptions {
  /** Return only messages after this timestamp */
  after?: string;
  /** Return only messages before this timestamp */
  before?: string;
  /** Maximum number of messages to return */
  limit?: number;
  /** Whether to include messages outside context window */
  includeOutOfContext?: boolean;
}

interface Checkpoint {
  index: number;           // Slot number: 0-9 = auto-save, 10-14 = manual save
  timestamp: string;       // When created
  name?: string;           // Display name (manual saves should have one)
}

interface QueueStatus {
  state: "idle" | "busy" | "paused";
  pending_count: number;
  current_operation?: string;
}
```

### Checkpoint System

The checkpoint system uses a **video game save slot** model:

| Slot Range | Type | Behavior |
|------------|------|----------|
| 0-9 | Auto-save | System creates every 60s. FIFO ring buffer—oldest drops when full. Cannot be deleted by user. |
| 10-14 | Manual save | User creates on demand. Can be overwritten or deleted. |

**Auto-save flow:**
1. Every 60s, Processor calls `StateManager.checkpoint_saveAuto()`
2. StateManager calls `Storage.saveAutoCheckpoint(state)`
3. Storage writes to next available slot in 0-9, dropping slot 0 if full
4. Processor fires `onCheckpointCreated()` (no index)

**Manual save flow:**
1. User selects slot (10-14) and provides name
2. FE calls `Processor.createCheckpoint(index, name)`
3. Processor calls `StateManager.checkpoint_saveManual(index, name)`
4. StateManager calls `Storage.saveManualCheckpoint(index, name, state)`
5. Processor fires `onCheckpointCreated(index)`

**Restore**: Load any slot (0-14) into memory. If you want to undo a restore, manually save first.

```
Checkpoint Slots Example:
───────────────────────────────────────────────
Slot   Type       Timestamp            Name
───────────────────────────────────────────────
0      auto       2026-01-26T13:00:00  -
1      auto       2026-01-26T13:01:00  -
...
9      auto       2026-01-26T13:09:00  -
10     manual     2026-01-26T12:00:00  "before-refactor"
11     manual     2026-01-26T10:00:00  "morning-backup"
12     (empty)    -                    -
13     (empty)    -                    -
14     (empty)    -                    -
───────────────────────────────────────────────
```

---

## StateManager API (Processor → StateManager)

The StateManager holds all in-memory state and provides CRUD operations. It does NOT call LLMs directly.

```typescript
interface StateManager {
  // === Lifecycle ===
  
  /** Load newest checkpoint from storage. Call once at startup. */
  initialize(storage: Storage): Promise<void>;
  
  // === Human Entity ===
  
  getHuman(): HumanEntity;
  setHuman(entity: HumanEntity): void;
  
  // Convenience methods (modify in place, update last_updated)
  // All upsert/remove methods match by `id` field
  human_fact_upsert(fact: Fact): void;
  human_fact_remove(id: string): boolean;
  human_trait_upsert(trait: Trait): void;
  human_trait_remove(id: string): boolean;
  human_topic_upsert(topic: Topic): void;
  human_topic_remove(id: string): boolean;
   human_person_upsert(person: Person): void;
   human_person_remove(id: string): boolean;
   
   // Quote operations
   human_quote_add(quote: Quote): void;
   human_quote_update(id: string, updates: Partial<Quote>): boolean;
   human_quote_remove(id: string): boolean;
   human_quote_getForMessage(messageId: string): Quote[];
   human_quote_getForDataItem(dataItemId: string): Quote[];
   
   // === Personas ===
  
  persona_getAll(): PersonaEntity[];
  persona_get(name: string): PersonaEntity | null;
  persona_add(name: string, entity: PersonaEntity): void;
  persona_update(name: string, updates: Partial<PersonaEntity>): boolean;
  persona_archive(name: string): boolean;
  persona_unarchive(name: string): boolean;
  persona_delete(name: string): boolean;
  persona_setContextBoundary(name: string, timestamp: string | null): void;
  
  // === Messages ===
  
  messages_get(personaName: string): Message[];
  messages_append(personaName: string, message: Message): void;
  messages_setContextStatus(personaName: string, messageId: string, status: ContextStatus): boolean;
  messages_getContextWindow(personaName: string): { start: string; end: string } | null;
  messages_setContextWindow(personaName: string, start: string, end: string): void;
  messages_markRead(personaName: string, messageId: string): boolean;
  messages_markPendingAsRead(personaName: string): number;  // Mark unread human messages as read, returns count
  messages_countUnread(personaName: string): number;
  messages_markAllRead(personaName: string): number;  // Returns count marked
  messages_remove(personaName: string, messageIds: string[]): Message[];  // Returns removed messages
  
  // === LLM Queue ===
  
  /** Add request to queue, returns generated ID */
  queue_enqueue(request: Omit<LLMRequest, "id" | "created_at" | "attempts">): string;
  
  /** Get highest priority non-processing request (marks as processing). Returns null if paused. */
  queue_peekHighest(): LLMRequest | null;
  
  /** Mark request as complete (removes from queue) */
  queue_complete(id: string): void;
  
  /** Mark request as failed (increments attempts, may dead-letter) */
  queue_fail(id: string, error?: string): void;
  
  /** Get all pending ei_validation items (for heartbeat) */
  queue_getValidations(): LLMRequest[];
  
  /** Clear specific validation items */
  queue_clearValidations(ids: string[]): void;
  
  /** Clear pending response requests for a persona (used when canceling/recalling) */
  queue_clearPersonaResponses(personaName: string, nextStep: string): string[];
  
  /** Get queue length */
  queue_length(): number;
  
  /** Pause queue processing (peekHighest returns null while paused) */
  queue_pause(): void;
  
  /** Resume queue processing */
  queue_resume(): void;
  
  /** Check if queue is paused */
  queue_isPaused(): boolean;
  
  // === Checkpoints ===
  
  /** Create an auto-save checkpoint (slots 0-9, FIFO) */
  checkpoint_saveAuto(): Promise<void>;
  
  /** 
   * Create a manual checkpoint.
   * @param index - Slot 10-14 only
   * @param name - Display name for the save
   */
  checkpoint_saveManual(index: number, name: string): Promise<void>;
  
  /** Get all checkpoints (0-14), sorted by timestamp desc */
  checkpoint_list(): Promise<Checkpoint[]>;
  
  /** 
   * Delete a manual checkpoint.
   * @param index - Must be 10-14 (cannot delete auto-saves)
   */
  checkpoint_delete(index: number): Promise<boolean>;
  
/** 
    * Restore state from checkpoint slot.
    * @param index - Slot 0-14
    */
  checkpoint_restore(index: number): Promise<boolean>;
  
  // === State Export/Import ===
  
  /** Get current state for external use (remote sync, export) */
  getStorageState(): StorageState;
  
  /** Restore state from external source (remote sync, conflict resolution) */
  restoreFromState(state: StorageState): void;
}
```

---

## QueueProcessor API

The QueueProcessor executes LLM calls one at a time. It does NOT manage the queue—that's StateManager's job.

```typescript
interface QueueProcessor {
  /** Get current state */
  getState(): "idle" | "busy";
  
  /** 
   * Start processing a request. 
   * Throws if not idle.
   * Calls callback when complete (success or failure).
   */
  start(request: LLMRequest, callback: (response: LLMResponse) => void): void;
  
  /** Abort current operation */
  abort(): void;
}
```

---

## Storage Interface

Storage is an abstraction over persistence backends. Uses an **array-based** checkpoint system for simplicity.

```typescript
interface Storage {
  /** Check if storage is available/configured */
  isAvailable(): Promise<boolean>;
  
  /** Get all checkpoints with metadata */
  listCheckpoints(): Promise<Checkpoint[]>;
  
  /** Load checkpoint by index. 0-9 = auto-save, 10-14 = manual. */
  loadCheckpoint(index: number): Promise<StorageState | null>;
  
  /** Save an auto-checkpoint. Appends to array, drops oldest if > 10. */
  saveAutoCheckpoint(state: StorageState): Promise<void>;
  
  /** Save a manual checkpoint to slot 10-14. */
  saveManualCheckpoint(index: number, name: string, state: StorageState): Promise<void>;
  
  /** Delete a manual checkpoint. Cannot delete auto-saves (0-9). */
  deleteManualCheckpoint(index: number): Promise<boolean>;
}

interface StorageState {
  version: number;
  timestamp: string;           // When this checkpoint was created
  human: HumanEntity;
  personas: Record<string, {
    entity: PersonaEntity;
    messages: Message[];
  }>;
  queue: LLMRequest[];
}
```

### Storage Implementations

| Implementation | Description | Priority |
|----------------|-------------|----------|
| `LocalStorage` | Browser localStorage | V1.0 |
| `FileStorage` | Node.js file system (EI_DATA_PATH) | V1.1 (TUI) |
| `RemoteStorage` | flare576.com encrypted sync | V1.2 |

### Checkpoint Indices

| Index Range | Type | Count | Behavior |
|-------------|------|-------|----------|
| 0-9 | Auto-save | 10 | Array: newest pushed to end, oldest shifted from front. Index 0 = oldest, 9 = newest. |
| 10-14 | Manual save | 5 | Individual slots. User-managed, can overwrite or delete. |

**UI Display**: Auto-saves should be shown oldest-first (index 0 at top) so users can easily select "revert to N minutes ago".

**Race Condition Handling**: `onCheckpointStart` fires before any checkpoint operation. UI should disable checkpoint interactions until `onCheckpointCreated` or `onCheckpointDeleted` fires.

### RemoteSync Interface

The RemoteSync module handles encrypted cloud backup to flare576.com. It's a singleton configured at app startup.

```typescript
interface RemoteSync {
  /** Configure with user credentials. Call on app startup if sync enabled. */
  configure(username: string, passphrase: string): Promise<void>;
  
  /** Check if sync is configured */
  isConfigured(): boolean;
  
  /** Sync current state to remote (encrypts before upload) */
  sync(state: StorageState): Promise<SyncResult>;
  
  /** Fetch remote state (decrypts after download) */
  fetch(): Promise<StorageState | null>;
  
  /** Check if remote has newer data than local */
  checkRemote(localTimestamp: string): Promise<RemoteCheckResult>;
  
  /** Clear configuration (disable sync) */
  clear(): void;
}

interface SyncResult {
  success: boolean;
  error?: string;
  rateLimited?: boolean;
  retryAfter?: number;  // Seconds until rate limit resets
}

interface RemoteCheckResult {
  hasRemote: boolean;
  remoteNewer: boolean;
  remoteTimestamp?: string;
  localTimestamp?: string;
}
```

**Security Model:**
1. Credentials never leave the browser unencrypted
2. User ID derived via PBKDF2(username:passphrase) → AES-GCM encrypt static string
3. State encrypted with same derived key + random IV
4. Server stores only encrypted blobs—cannot decrypt

**Rate Limiting:** 3 uploads per hour per user. Server returns 429 with Retry-After header if exceeded.

---

## Entity Types

### HumanEntity

```typescript
interface HumanEntity {
  entity: "human";
  facts: Fact[];
  traits: Trait[];
  topics: Topic[];
  people: Person[];
  quotes: Quote[];
  last_updated: string;
  last_activity: string;  // When human last sent a message (any persona)
  settings?: HumanSettings;
  
  // Extraction tracking (when each data type was last seeded for extraction)
  last_seeded_fact?: string;    // ISO timestamp
  last_seeded_trait?: string;   // ISO timestamp
  last_seeded_topic?: string;   // ISO timestamp
  last_seeded_person?: string;  // ISO timestamp
  
  // Ceremony configuration
  ceremony_config?: CeremonyConfig;
}

interface HumanSettings {
  auto_save_interval_ms?: number;  // Default: 60000 (1 min)
  default_model?: string;          // Default: from EI_LLM_MODEL env
  queue_paused?: boolean;          // Default: false
  skip_quote_delete_confirm?: boolean;  // Skip confirmation dialog when deleting quotes
  
  // Display preferences
  name_display?: string;           // How user's name appears in chat
  name_color?: string;             // User's name color in chat
  time_mode?: "24h" | "12h" | "local" | "utc";  // Timestamp display format
  
  // Provider accounts (LLM and Storage)
  accounts?: ProviderAccount[];
  
  // Remote sync credentials (encrypted cloud backup)
  sync?: SyncCredentials;
}

interface SyncCredentials {
  username: string;
  passphrase: string;
}

enum ProviderType {
  LLM = "llm",
  Storage = "storage",
}

/**
 * ProviderAccount - Configuration for external service connections
 * 
 * Used for both LLM providers (OpenRouter, Bedrock, etc.) and storage providers
 * (flare576.com, Dropbox, Google Drive, etc.).
 * 
 * Model specification format: `account-name:model` (e.g., `MyOpenRouter:mistralai/mistral-7b`)
 * Falls back to environment variables if no matching account is found.
 */
interface ProviderAccount {
  id: string;                      // UUID
  name: string;                    // User-defined display name (e.g., "OpenRouter-Free", "Work Bedrock")
  type: ProviderType;              // "llm" | "storage"
  url: string;                     // Base URL for API (e.g., "https://openrouter.ai/api/v1")
  
  // Auth - use api_key for Bearer token, or username+password for basic/custom auth
  api_key?: string;                // Bearer token auth (most common)
  username?: string;               // Basic auth or custom (for storage providers)
  password?: string;               // Basic auth or custom (for storage providers)
  
  // LLM-specific
  default_model?: string;          // Default model for this account
  
  // Provider-specific extras (e.g., OpenRouter needs HTTP-Referer, X-Title)
  extra_headers?: Record<string, string>;
  
  // Metadata
  enabled?: boolean;               // Default: true
  created_at: string;              // ISO timestamp
}

interface CeremonyConfig {
  enabled: boolean;               // Whether nightly ceremony runs
  time: string;                   // "HH:MM" format (e.g., "03:00")
  last_ceremony?: string;         // ISO timestamp of last run
  decay_rate?: number;            // Exposure decay rate (default: 0.1)
  explore_threshold?: number;     // Days before topic exploration triggers (default: 3)
}
```

### PersonaCreationInput

User-provided data for creating a new persona. All fields except `name` are optional.
The system will preserve user-provided data verbatim and use LLM to fill gaps.

```typescript
interface PersonaCreationInput {
  name: string;                    // Primary name (required)
  aliases?: string[];              // Additional names
  long_description?: string;       // User's description (preserved verbatim)
  short_description?: string;      // User's summary (or LLM generates from long_description)
  traits?: Partial<Trait>[];       // User-defined traits (preserved, LLM adds more if sparse)
  topics?: Partial<Topic>[];       // User-defined topics (preserved, LLM adds more if sparse)
  model?: string;                  // LLM model override
  group_primary?: string;          // Group membership
  groups_visible?: string[];       // Additional group visibility
}
```

**Generation behavior:**
- `long_description`: Preserved verbatim. If provided, LLM generates `short_description` as summary.
- `short_description`: If not provided, LLM generates from `long_description`.
- `traits`: User traits preserved. LLM adds more if count < 3.
- `topics`: User topics preserved. LLM adds more if count < 3.

### PersonaEntity

```typescript
interface PersonaEntity {
  entity: "system";
  
  // Identity
  aliases?: string[];
  short_description?: string;
  long_description?: string;
  model?: string;
  
  // Groups
  group_primary?: string | null;
  groups_visible?: string[];
  
  // Data
  traits: Trait[];
  topics: PersonaTopic[];
  
  // State
  is_paused: boolean;
  pause_until?: string;
  is_archived: boolean;
  archived_at?: string;
  is_static: boolean;            // Static personas skip Ceremony phases
  
  // Settings (per-persona)
  heartbeat_delay_ms?: number;     // Default: 1800000 (30 min)
  context_window_hours?: number;   // Default: 8 hours
  context_boundary?: string;       // ISO timestamp - messages before this excluded from LLM context
  
  // Timestamps
  last_updated: string;
  last_activity: string;           // Last message (human or system)
  last_heartbeat?: string;
  last_extraction?: string;
  last_inactivity_ping?: string;
}
```

### PersonaTopic

Persona topics are distinct from Human topics (`Topic`). While Human topics track what the user knows/feels about subjects (shared across personas via groups), PersonaTopic tracks how each persona engages with topics (persona-local).

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (UUID) |
| `name` | string | Topic name |
| `perspective` | string | The persona's view/opinion on this topic |
| `approach` | string | How they prefer to engage with this topic |
| `personal_stake` | string | Why this topic matters to them personally |
| `sentiment` | -1.0 to 1.0 | How they feel about it |
| `exposure_current` | 0.0 to 1.0 | How recently/frequently discussed |
| `exposure_desired` | 0.0 to 1.0 | How much they want to discuss |
| `last_updated` | ISO string | When this record was last modified |

```typescript
interface PersonaTopic {
  id: string;
  name: string;
  perspective: string;
  approach: string;
  personal_stake: string;
  sentiment: number;
  exposure_current: number;
  exposure_desired: number;
  last_updated: string;
}
```

**Key differences from Human Topic:**
- No `description` field - replaced by structured `perspective`, `approach`, `personal_stake`
- No `learned_by` - persona topics aren't "learned", they're generated during Ceremony
- No `persona_groups` - persona topics are local to each persona, no cross-visibility needed

**Migration**: Existing persona topics with `description` field should map `description` → `perspective`, with `approach` and `personal_stake` empty until populated by Ceremony.

### Data Items

All data items have an `id` field for stable identification across edits.

```typescript
interface DataItemBase {
  id: string;                  // Stable unique identifier (UUID)
  name: string;
  description: string;
  sentiment: number;           // -1.0 to 1.0
  last_updated: string;
  learned_by?: string;         // Which persona discovered this
  persona_groups?: string[];   // Visibility control
}

interface Fact extends DataItemBase {
  validated: ValidationLevel;  // none | ei | human
  validated_date: string;      // When validation state changed
}

enum ValidationLevel {
  None = "none",     // Fresh data, never acknowledged
  Ei = "ei",         // Ei mentioned it to user (don't mention again)
  Human = "human",   // User explicitly confirmed (locked)
}

interface Trait extends DataItemBase {
  strength?: number;           // 0.0 to 1.0
}

interface Topic extends DataItemBase {
  category?: string;           // Interest|Goal|Dream|Conflict|Concern|Fear|Hope|Plan|Project
  exposure_current: number;    // 0.0 to 1.0
  exposure_desired: number;    // 0.0 to 1.0
}

interface Person extends DataItemBase {
  relationship: string;
  exposure_current: number;    // 0.0 to 1.0
  exposure_desired: number;    // 0.0 to 1.0
}

interface Quote {
  id: string;                    // UUID (use crypto.randomUUID())
  message_id: string | null;     // FK to Message.id (nullable for manual quotes)
  data_item_ids: string[];       // FK[] to DataItemBase.id
  persona_groups: string[];      // Visibility groups
  text: string;                  // The quote content
  speaker: "human" | string;     // Who said it (persona name or "human")
  timestamp: string;             // ISO timestamp (from original message)
  start: number | null;          // Character offset in message (null = can't highlight)
  end: number | null;            // Character offset in message (null = can't highlight)
  created_at: string;            // ISO timestamp when captured
  created_by: "extraction" | "human";  // How it was created
}
```

### Message

```typescript
interface Message {
  id: string;                  // Unique identifier
  role: "human" | "system";
  content: string;
  timestamp: string;
  read: boolean;               // Has human seen this system message?
  context_status: ContextStatus;
}

enum ContextStatus {
  /** Include if within context window bounds */
  Default = "default",
  /** Always include regardless of window bounds */
  Always = "always",
  /** Never include regardless of window bounds */
  Never = "never"
}
```

**Context Resolution Logic**:
1. If `context_status === "always"` → include
2. If `context_status === "never"` → exclude
3. If `context_status === "default"` → include if timestamp is within persona's context window bounds

> **Note**: The `state` field from V0 has been removed. Message processing state is now tracked via the LLM queue, not on individual messages.

> **Future**: Batch message context updates (e.g., "add this conversation to context") will be added post-V1.0. The `onMessagesChanged` event is reserved for this.

---

## Group Visibility Model

Groups control which data (facts, traits, topics, people, quotes) personas can see.

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
- Bypasses group filtering entirely—sees all data regardless of groups

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

## LLM Types

### LLMRequest

```typescript
interface LLMRequest {
  id: string;                  // Generated UUID
  created_at: string;
  attempts: number;
  last_attempt?: string;
  
  // Request details
  type: LLMRequestType;
  priority: LLMPriority;
  
  // Prompt
  system: string;
  user: string;
  messages?: ChatMessage[];    // For conversation context
  
  // Routing
  next_step: LLMNextStep;      // Handler name for response
  model?: string;              // Override model
  
  // Context (passed through to handler)
  data: Record<string, unknown>;
}

enum LLMRequestType {
  Response = "response",       // Conversational response
  JSON = "json",              // Structured data extraction
  Raw = "raw"                 // Unprocessed response
}

enum LLMPriority {
  High = "high",
  Normal = "normal",
  Low = "low"
}

enum LLMNextStep {
  // Response handling
  HandlePersonaResponse = "handlePersonaResponse",
  
  // Persona creation
  HandlePersonaGeneration = "handlePersonaGeneration",
  HandlePersonaDescriptions = "handlePersonaDescriptions",
  
  // Extraction (human) - Step 1: Scan
  HandleHumanFactScan = "handleHumanFactScan",
  HandleHumanTraitScan = "handleHumanTraitScan",
  HandleHumanTopicScan = "handleHumanTopicScan",
  HandleHumanPersonScan = "handleHumanPersonScan",
  
  // Extraction (human) - Step 2: Match
  HandleHumanItemMatch = "handleHumanItemMatch",
  
  // Extraction (human) - Step 3: Update
  HandleHumanItemUpdate = "handleHumanItemUpdate",
  
  // Extraction (persona)
  HandlePersonaTraitExtraction = "handlePersonaTraitExtraction",
  HandlePersonaTopicDetection = "handlePersonaTopicDetection",
  HandlePersonaTopicExploration = "handlePersonaTopicExploration",
  
  // Heartbeat
  HandleHeartbeatCheck = "handleHeartbeatCheck",
  HandleEiHeartbeat = "handleEiHeartbeat",
  
  // Validation
  HandleEiValidation = "handleEiValidation",
  
  // One-Shot (AI-assist buttons)
  HandleOneShot = "handleOneShot",
  
  // Ceremony System
  HandleCeremonyExposure = "handleCeremonyExposure",
  HandleCeremonyDecayComplete = "handleCeremonyDecayComplete",
  HandlePersonaExpire = "handlePersonaExpire",
  HandlePersonaExplore = "handlePersonaExplore",
  HandleDescriptionCheck = "handleDescriptionCheck"
}
```

### LLMResponse

```typescript
interface LLMResponse {
  request: LLMRequest;         // Original request (for context)
  success: boolean;
  content: string | null;      // Raw content
  parsed?: unknown;            // Parsed JSON (if type === "json")
  error?: string;              // Error message (if failed)
  finish_reason?: string;      // From LLM API
}
```

### ChatMessage

```typescript
interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
```

---

## Prompt Contracts

All prompt builders are **synchronous** and receive pre-fetched data. They return `{ system: string; user: string }`.

### Prompt Naming Convention

```
build{Purpose}{Target?}Prompt

Examples:
- buildResponsePrompt(data)
- buildPersonaGenerationPrompt(data)
- buildHumanFactScanPrompt(data)
- buildHeartbeatCheckPrompt(data)
```

### Message Splitting Convention

For prompts that need to distinguish between "context" and "messages to analyze", the Processor pre-splits the arrays:

```typescript
// GOOD: Processor does the splitting
interface ScanPromptData {
  messages_context: Message[];   // Earlier messages for context
  messages_analyze: Message[];   // Recent messages to analyze
  persona_name: string;
}

// BAD: Prompt receives split_index and does its own slicing
interface ScanPromptData {
  messages: Message[];
  split_index: number;           // DON'T DO THIS
}
```

**Rule**: Prompts should do minimal data manipulation. The Processor is responsible for:
- Fetching data
- Filtering by visibility
- Splitting message arrays
- Computing deltas

### Prompt Data Contracts

#### Response Prompts

```typescript
// buildResponsePrompt
interface ResponsePromptData {
  persona: {
    name: string;
    aliases: string[];
    short_description?: string;
    long_description?: string;
    traits: Trait[];
    topics: Topic[];
  };
  human: {
    facts: Fact[];       // Filtered by visibility
    traits: Trait[];     // Filtered by visibility
    topics: Topic[];     // Filtered by visibility
    people: Person[];    // Filtered by visibility
    quotes: Quote[];     // Filtered by visibility, limited to 10 most recent
  };
  visible_personas: Array<{ name: string; short_description?: string }>;
  delay_ms: number;      // Time since last message
}

// buildHeartbeatCheckPrompt
interface HeartbeatCheckPromptData {
  persona: {
    name: string;
    traits: Trait[];
    topics: Topic[];
  };
  human: {
    topics: Topic[];     // Filtered, with engagement gaps
    people: Person[];    // Filtered, with engagement gaps
  };
  recent_history: Message[];
  inactive_personas?: Array<{
    name: string;
    days_inactive: number;
  }>;
}
```

#### Extraction Prompts

```typescript
// buildHumanFactScanPrompt (Step 1)
interface FactScanPromptData {
  messages_context: Message[];   // Earlier messages for context
  messages_analyze: Message[];   // Recent messages to analyze
  persona_name: string;
}

// buildHumanTraitScanPrompt (Step 1)
interface TraitScanPromptData {
  messages_context: Message[];
  messages_analyze: Message[];
  persona_name: string;
}

// buildHumanTopicScanPrompt (Step 1)
interface TopicScanPromptData {
  messages_context: Message[];
  messages_analyze: Message[];
  persona_name: string;
}

// buildHumanPersonScanPrompt (Step 1)
interface PersonScanPromptData {
  messages_context: Message[];
  messages_analyze: Message[];
  persona_name: string;
  known_persona_names: string[];  // To avoid confusing personas with people
}

// buildHumanItemMatchPrompt (Step 2)
interface ItemMatchPromptData {
  data_type: "fact" | "trait" | "topic" | "person";
  item_name: string;
  item_value: string;
  existing_items: Array<{ name: string; description: string }>;
}

// buildHumanItemUpdatePrompt (Step 3)
interface ItemUpdatePromptData {
  data_type: "fact" | "trait" | "topic" | "person";
  existing_item: DataItemBase | null;
  messages_context: Message[];
  messages_analyze: Message[];
  persona_name: string;
  new_item_name?: string;   // If creating new
  new_item_value?: string;  // If creating new
}
```

#### Generation Prompts

```typescript
// buildPersonaGenerationPrompt
interface PersonaGenerationPromptData {
  name: string;
  description: string;
}

// buildPersonaDescriptionsPrompt
interface PersonaDescriptionsPromptData {
  name: string;
  aliases: string[];
  traits: Trait[];
  topics: Topic[];
}
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
| `STORAGE_LOAD_FAILED` | Could not load checkpoint from storage |
| `STORAGE_SAVE_FAILED` | Could not save checkpoint to storage |
| `PERSONA_NOT_FOUND` | Requested persona doesn't exist |
| `PERSONA_ARCHIVED` | Operation not allowed on archived persona |
| `QUEUE_BUSY` | QueueProcessor already processing |
| `CHECKPOINT_SLOT_EMPTY` | Requested checkpoint slot is empty |
| `CHECKPOINT_INVALID_SLOT` | Slot index out of range (must be 0-14) |
| `CHECKPOINT_SLOT_PROTECTED` | Cannot delete auto-save slots (0-9) |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-26 | Initial draft |
| 2026-01-26 | Added `id` to DataItemBase and Message |
| 2026-01-26 | Removed `state` from Message |
| 2026-01-26 | Changed extraction prompts to use `messages_context`/`messages_analyze` |
| 2026-01-26 | Moved `heartbeat_delay_ms` to PersonaEntity (per-persona) |
| 2026-01-26 | Redesigned checkpoint system (video game save slots) |
| 2026-01-26 | Added `queue_paused` to HumanSettings |
| 2026-01-26 | Added `queue_pause()`/`queue_resume()` to StateManager |
| 2026-01-26 | Changed `LLMNextStep` to enum |
| 2026-01-26 | Changed `in_context: boolean` to `context_status: ContextStatus` enum (default/always/never) |
| 2026-01-26 | **Checkpoint system overhaul**: Slots 0-9 auto-save (FIFO), slots 10-14 manual save |
| 2026-01-26 | Removed `persist()`, `checkpoint_persist()` from StateManager |
| 2026-01-26 | Removed `load()`, `save()`, `loadCheckpoint()`, `listCheckpoints()` from Storage |
| 2026-01-26 | Added `timestamp` to StorageState |
| 2026-01-26 | Removed `PersistedCheckpoint` interface (no longer needed) |
| 2026-01-26 | Replaced `onCheckpointPersisted` with `onCheckpointCreated` and `onCheckpointDeleted` |
| 2026-01-27 | **Simplified checkpoint storage**: Array-based auto-saves instead of slot-based ring buffer |
| 2026-01-27 | Added `onCheckpointStart` event for UI race condition handling |
| 2026-01-27 | Storage interface simplified: `listCheckpoints`, `loadCheckpoint`, `saveAutoCheckpoint`, `saveManualCheckpoint`, `deleteManualCheckpoint` |
| 2026-01-28 | **E005 UI Polish**: Added `onMessageRecalled`, `onCheckpointRestored` events |
| 2026-01-28 | Added `recallPendingMessages()`, `markMessageRead()` to Processor API |
| 2026-01-28 | Human messages now start `read: false`, marked `read: true` when AI responds |
| 2026-02-02 | **V1.Web Documentation Sync**: Added `onOneShotReturned`, `onContextBoundaryChanged` events |
| 2026-02-02 | Added 6 LLMNextStep handlers: `HandleOneShot`, `HandleCeremonyExposure`, `HandleCeremonyDecayComplete`, `HandlePersonaExpire`, `HandlePersonaExplore`, `HandleDescriptionCheck` |
| 2026-02-02 | Added `CeremonyConfig` interface for nightly ceremony configuration |
| 2026-02-02 | Added `name_display`, `name_color`, `time_mode` to HumanSettings |
| 2026-02-02 | Added `last_seeded_*` fields and `ceremony_config` to HumanEntity |
| 2026-02-02 | Added `is_static` field to PersonaEntity |
| 2026-02-02 | Added `markAllMessagesRead()`, `submitOneShot()` to Processor API |
| 2026-02-02 | Fixed StateManager: `checkpoint_create()` → `checkpoint_saveAuto()` + `checkpoint_saveManual()` |
| 2026-02-02 | Added StateManager methods: `messages_markRead`, `messages_markPendingAsRead`, `messages_countUnread`, `messages_markAllRead`, `messages_remove`, `queue_clearPersonaResponses`, `persona_setContextBoundary` |
| 2026-02-02 | **Naming convention fix**: Renamed `lastSeeded_*` → `last_seeded_*` in HumanEntity |
| 2026-02-02 | **Group Visibility Redesign**: Replaced `*` wildcard with explicit "General" group |
| 2026-02-02 | Ei now has global visibility (special-cased), `group_primary: "General"`, immutable in UI |
| 2026-02-02 | Empty `persona_groups` on data items treated as `["General"]` for backward compatibility |
| 2026-02-02 | Added Group Visibility Model section to documentation |
| 2026-02-03 | **Provider Accounts System**: Added `ProviderAccount` interface and `ProviderType` enum |
| 2026-02-03 | Added `accounts?: ProviderAccount[]` to HumanSettings for LLM and Storage provider management |
| 2026-02-04 | **Remote Sync Implementation**: Added `SyncCredentials` interface to HumanSettings |
| 2026-02-04 | Added `RemoteSync` interface with `configure()`, `sync()`, `fetch()`, `checkRemote()`, `clear()` |
| 2026-02-04 | Added `SyncResult` and `RemoteCheckResult` types |
| 2026-02-04 | Added `getStorageState()`, `restoreFromState()` to Processor API |
| 2026-02-04 | Added `getStorageState()`, `restoreFromState()` to StateManager API
