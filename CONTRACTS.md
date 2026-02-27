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
| `validated` | ValidationLevel | Whether/how this fact was validated (`None`, `Ei`, `Human`) |
| `last_ei_asked` | ISO string \| null | When Ei last proactively asked about this Person/Topic |
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

## Processor API (Frontend → Processor)

All methods are **async** and return Promises. The Processor instance is created by the Frontend.

```typescript
interface Processor {
  // === Lifecycle ===
  
  /** Start the processor loop. Call once after construction, passing the storage backend. */
  start(storage: Storage): Promise<void>;
  
  /** Stop the processor loop. Call before app shutdown. */
  stop(): Promise<void>;
  
  /**
   * Abort current LLM operation, sync to remote, and stop.
   * Fires onSaveAndExitStart → (sync) → onSaveAndExitFinish.
   */
  saveAndExit(): Promise<{ success: boolean; error?: string }>;
  
  /**
   * Resolve a pending state conflict (set by onStateConflict).
   * Resumes the processor loop after resolution.
   * @param resolution - "local" (keep local), "server" (pull server), "yolo" (merge both)
   */
  resolveStateConflict(resolution: StateConflictResolution): Promise<void>;
  
  // === Persona Operations ===
  
  /** Get list of all personas with summary info */
  getPersonaList(): Promise<PersonaSummary[]>;
  
  /** Get full persona entity by ID */
  getPersona(personaId: string): Promise<PersonaEntity | null>;
  
  /**
   * Resolve a persona name or alias to its ID.
   * Use this when the user types a name (e.g., "/persona Bob").
   * Returns null if no matching persona is found.
   */
  resolvePersonaName(nameOrAlias: string): Promise<string | null>;
  
  /** Create a new persona from structured user input. Returns the new persona's ID. */
  createPersona(input: PersonaCreationInput): Promise<string>;
  
  /** Archive a persona (soft delete) */
  archivePersona(personaId: string): Promise<void>;
  
  /** Unarchive a persona */
  unarchivePersona(personaId: string): Promise<void>;
  
  /** Permanently delete an archived persona */
  deletePersona(personaId: string, deleteHumanData: boolean): Promise<void>;
  
  /** Update persona fields (model, description, group, etc.) */
  updatePersona(personaId: string, updates: Partial<PersonaEntity>): Promise<void>;
  
  /** Get all known groups across all personas (derived from group_primary + groups_visible) */
  getGroupList(): Promise<string[]>;
  
  // === Message Operations ===
  
  /** Get message history for a persona */
  getMessages(personaId: string, options?: MessageQueryOptions): Promise<Message[]>;
  
  /** Send a message to a persona (queues response) */
  sendMessage(personaId: string, content: string): Promise<void>;
  
  /**
   * Set context boundary for a persona ("New" command).
   * Messages before this timestamp are excluded from LLM context (unless context_status="always").
   * Pass null to clear the boundary.
   */
  setContextBoundary(personaId: string, timestamp: string | null): Promise<void>;
  
  /** Set a message's context status */
  setMessageContextStatus(personaId: string, messageId: string, status: ContextStatus): Promise<void>;
  
  /** Delete specific messages by ID. Returns the removed messages. */
  deleteMessages(personaId: string, messageIds: string[]): Promise<Message[]>;
  
  /** Mark a message as read */
  markMessageRead(personaId: string, messageId: string): Promise<boolean>;
  
  /** Mark all messages as read for a persona, returns count marked */
  markAllMessagesRead(personaId: string): Promise<number>;
  
  /**
   * Recall pending (unread) human messages for editing.
   * Removes the messages from history, cancels queued responses, and returns combined content.
   * Human messages start as read=false and become read=true when the AI responds.
   */
  recallPendingMessages(personaId: string): Promise<string>;
  
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
  
  /**
   * Search human data using semantic similarity (embedding-based).
   * Falls back to substring match if embeddings are unavailable.
   */
  searchHumanData(
    query: string,
    options?: { types?: Array<"fact" | "trait" | "topic" | "person" | "quote">; limit?: number }
  ): Promise<{ facts: Fact[]; traits: Trait[]; topics: Topic[]; people: Person[]; quotes: Quote[] }>;
  
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
  
  // === State Operations ===
  
  /** Export full state as JSON (for download / backup) */
  exportState(): Promise<string>;
  
  /**
   * Import state from a JSON string (restore from backup).
   * Fires onStateImported when complete.
   */
  importState(json: string): Promise<void>;
  
  /** Get current state for remote sync */
  getStorageState(): Promise<StorageState>;
  
  /** Restore state from external source (remote sync, conflict resolution) */
  restoreFromState(state: StorageState): Promise<void>;
  
  // === LLM Queue Operations ===
  
  /**
   * Abort current LLM operation and pause queue processing.
   * Call resumeQueue() to continue processing.
   */
  abortCurrentOperation(): Promise<void>;
  
  /** Resume queue processing after abort */
  resumeQueue(): Promise<void>;
  
  /** Pause queue processing (synchronous). Aborts current operation. */
  pauseQueue(): void;
  
  /** Get queue status */
  getQueueStatus(): Promise<QueueStatus>;
  
  /** Get all active (non-DLQ) queue items */
  getQueueActiveItems(): LLMRequest[];
  
  /** Get all dead-letter queue items */
  getDLQItems(): LLMRequest[];
  
  /** Update a queue item in place. Returns true if found. */
  updateQueueItem(id: string, updates: Partial<LLMRequest>): boolean;
  
  /** Clear all pending queue items. Aborts current operation. Returns count cleared. */
  clearQueue(): Promise<number>;
  
  /**
   * Submit a one-shot LLM request (for AI-assist buttons).
   * Result returned via onOneShotReturned event with matching guid.
   */
  submitOneShot(guid: string, systemPrompt: string, userPrompt: string): Promise<void>;
  
  // === Debug / DevTools Only ===
  // Not for production use. Accessible via browser devtools or TUI debug commands.
  
  /** Manually trigger ceremony, bypassing time checks. */
  triggerCeremonyNow(): void;
  
  /** Get ceremony status (last run, next scheduled run). */
  getCeremonyStatus(): { lastRun: string | null; nextRunTime: string };
}
```

### Supporting Types

```typescript
interface PersonaSummary {
  id: string;
  display_name: string;
  aliases: string[];
  short_description?: string;
  is_paused: boolean;
  is_archived: boolean;
  unread_count: number;
  last_activity?: string;
  context_boundary?: string;
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

interface QueueStatus {
  state: "idle" | "busy" | "paused";
  pending_count: number;
  dlq_count: number;
  current_operation?: string;
}

/** Payload for onStateConflict event */
interface StateConflictData {
  localTimestamp: Date;
  remoteTimestamp: Date;
  hasLocalState: boolean;
}

/** Resolution choice for resolveStateConflict() */
type StateConflictResolution = "local" | "server" | "yolo";
```
---

## StateManager API (Processor → StateManager)

The StateManager holds all in-memory state and provides CRUD operations. It does NOT call LLMs directly.

```typescript
interface StateManager {
  // === Lifecycle ===
  
  /** Load state from storage. Call once at startup. */
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
  persona_get(personaId: string): PersonaEntity | null;
  persona_add(entity: PersonaEntity): void;
  persona_update(personaId: string, updates: Partial<PersonaEntity>): boolean;
  persona_archive(personaId: string): boolean;
  persona_unarchive(personaId: string): boolean;
  persona_delete(personaId: string): boolean;
  persona_setContextBoundary(personaId: string, timestamp: string | null): void;
  
  // === Messages ===
  
  messages_get(personaId: string): Message[];
  messages_append(personaId: string, message: Message): void;
  messages_setContextStatus(personaId: string, messageId: string, status: ContextStatus): boolean;
  messages_markRead(personaId: string, messageId: string): boolean;
  messages_markPendingAsRead(personaId: string): number;  // Mark unread human messages as read, returns count
  messages_countUnread(personaId: string): number;
  messages_markAllRead(personaId: string): number;  // Returns count marked
  messages_remove(personaId: string, messageIds: string[]): Message[];  // Returns removed messages
  
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
  queue_clearPersonaResponses(personaId: string, nextStep: string): string[];
  
  /** Get queue length */
  queue_length(): number;
  
  /** Pause queue processing (peekHighest returns null while paused) */
  queue_pause(): void;
  
  /** Resume queue processing */
  queue_resume(): void;
  
  /** Check if queue is paused */
  queue_isPaused(): boolean;
  
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

Storage is an abstraction over persistence backends.

```typescript
interface Storage {
  /** Check if storage is available/configured */
  isAvailable(): Promise<boolean>;
  
  /** Load persisted state. Returns null if no state exists. */
  loadState(): Promise<StorageState | null>;
  
  /** Save current state. */
  saveState(state: StorageState): Promise<void>;
  
  /** Load backup state (used for sync conflict detection). */
  loadBackup(): Promise<StorageState | null>;
  
  /** Move current state file to backup slot. Called after successful remote sync. */
  moveToBackup(): Promise<void>;
}

interface StorageState {
  version: number;
  timestamp: string;           // When this state was saved
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
}

interface HumanSettings {
  default_model?: string;          // Default: from EI_LLM_MODEL env
  queue_paused?: boolean;          // Default: false
  skip_quote_delete_confirm?: boolean;  // Skip confirmation dialog when deleting quotes
  
  // Display preferences
  name_display?: string;           // How user's name appears in chat
  time_mode?: "24h" | "12h" | "local" | "utc";  // Timestamp display format
  
  // Provider accounts (LLM and Storage)
  accounts?: ProviderAccount[];
  
  // Remote sync credentials (encrypted cloud backup)
  sync?: SyncCredentials;
  
  // OpenCode integration settings
  opencode?: OpenCodeSettings;
  
  // Nightly ceremony configuration
  ceremony?: CeremonyConfig;
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
  token_limit?: number;            // Context window override (tokens). Used for extraction chunking.
  
  // Provider-specific extras (e.g., OpenRouter needs HTTP-Referer, X-Title)
  extra_headers?: Record<string, string>;
  
  // Metadata
  enabled?: boolean;               // Default: true
  created_at: string;              // ISO timestamp
}

interface CeremonyConfig {
  time: string;                   // "HH:MM" format (e.g., "09:00")
  last_ceremony?: string;         // ISO timestamp of last run
  decay_rate?: number;            // Exposure decay rate (default: 0.1)
  explore_threshold?: number;     // Days before topic exploration triggers (default: 3)
  dedup_threshold?: number;       // Cosine similarity threshold for dedup candidates (default: 0.85)
}
```

interface OpenCodeSettings {
  integration?: boolean;           // Whether OpenCode integration is enabled
  polling_interval_ms?: number;   // How often to check for new sessions (default: 1800000 = 30 min)
  last_sync?: string;             // ISO timestamp of last sync
  extraction_point?: string;      // ISO timestamp cursor for single-session archive scan
  processed_sessions?: Record<string, string>;  // sessionId → ISO timestamp of last import
}

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
  id: string;                    // UUID (or "ei" for built-in Ei persona)
  display_name: string;          // What shows in UI (user's chosen name)
  entity: "system";
  
  // Identity
  aliases?: string[];            // For fuzzy matching (user types "/persona Bob")
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
  learned_by?: string;         // Persona ID (UUID) that originally discovered this item
  last_changed_by?: string;    // Persona ID (UUID) that most recently updated this item
  persona_groups?: string[];   // Visibility control
}

interface Fact extends DataItemBase {
  validated: ValidationLevel;
}

enum ValidationLevel {
  None = "none",               // Fresh data, never acknowledged
  Ei = "ei",                   // Ei mentioned it to user (don't mention again)
  Human = "human"              // User explicitly confirmed (locked
}

interface Trait extends DataItemBase {
  strength?: number;           // 0.0 to 1.0
}

interface Topic extends DataItemBase {
  category?: string;           // Interest|Goal|Dream|Conflict|Concern|Fear|Hope|Plan|Project
  exposure_current: number;    // 0.0 to 1.0
  exposure_desired: number;    // 0.0 to 1.0
  last_ei_asked?: string | null; // When Ei last proactively asked about this
}

interface Person extends DataItemBase {
  relationship: string;
  exposure_current: number;    // 0.0 to 1.0
  exposure_desired: number;    // 0.0 to 1.0
  last_ei_asked?: string | null; // When Ei last proactively asked about this
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
  verbal_response?: string;   // Human text or persona's spoken reply
  action_response?: string;   // Stage direction / action the persona performs
  silence_reason?: string;    // Why the persona chose not to respond (not shown to LLM)
  timestamp: string;
  read: boolean;               // Has human seen this system message?
  context_status: ContextStatus;
  
  // Extraction completion flags (omit when false to save space)
  // Single-letter names minimize storage overhead for large message histories
  f?: boolean;                 // Fact extraction completed
  r?: boolean;                 // tRait extraction completed
  p?: boolean;                 // Person extraction completed
  o?: boolean;                 // tOpic extraction completed
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

> **Migration**: On load, if a persisted message has the old `content` field but no `verbal_response`, `content` is moved to `verbal_response`. This is a "fix on read" migration — no separate migration step needed.

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
  retry_after?: string;        // ISO timestamp — don't retry until after this time
  state: LLMRequestState;      // "pending" | "processing" | "dlq"
  
  // Request details
  type: LLMRequestType;
  priority: LLMPriority;
  
  // Prompt
  system: string;
  user: string;
  
  // Routing
  next_step: LLMNextStep;      // Handler name for response
  model?: string;              // Override model
  
  // Context (passed through to handler)
  data: Record<string, unknown>;
}

type LLMRequestState = "pending" | "processing" | "dlq";

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
  
  // Extraction (persona) - Step 1: Scan
  HandlePersonaTraitExtraction = "handlePersonaTraitExtraction",
  HandlePersonaTopicScan = "handlePersonaTopicScan",
  
  // Extraction (persona) - Step 2: Match
  HandlePersonaTopicMatch = "handlePersonaTopicMatch",
  
  // Extraction (persona) - Step 3: Update
  HandlePersonaTopicUpdate = "handlePersonaTopicUpdate",
  
  // Heartbeat
  HandleHeartbeatCheck = "handleHeartbeatCheck",
  HandleEiHeartbeat = "handleEiHeartbeat",
  
  // One-Shot (AI-assist buttons)
  HandleOneShot = "handleOneShot",
  
  // Ceremony System
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
