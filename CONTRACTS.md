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
9. [LLM Types](#llm-types)
10. [Prompt Contracts](#prompt-contracts)

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
| `confidence` | 0.0-1.0 | How certain we are a fact is accurate |
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
  
  // === Human Entity Events ===
  
  /** Human entity data changed (facts, traits, topics, people) */
  onHumanUpdated?: () => void;
  
  // === System Events ===
  
  /** Queue processor state changed (idle ↔ busy) */
  onQueueStateChanged?: (state: "idle" | "busy") => void;
  
  /** An error occurred that the user should know about */
  onError?: (error: { code: string; message: string }) => void;
  
  /** A checkpoint was persisted to a named save slot */
  onCheckpointPersisted?: (name: string) => void;
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
| `onHumanUpdated` | After any human entity field changes |
| `onQueueStateChanged` | When QueueProcessor transitions between idle/busy |
| `onError` | When a recoverable error occurs (e.g., LLM failure after retries) |
| `onCheckpointPersisted` | After a checkpoint is promoted to a named save slot |

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
  
  /** Create a new persona from user description */
  createPersona(name: string, description: string, model?: string): Promise<void>;
  
  /** Archive a persona (soft delete) */
  archivePersona(name: string): Promise<void>;
  
  /** Unarchive a persona */
  unarchivePersona(name: string): Promise<void>;
  
  /** Permanently delete an archived persona */
  deletePersona(name: string, deleteHumanData: boolean): Promise<void>;
  
  /** Update persona fields (model, description, group, etc.) */
  updatePersona(name: string, updates: Partial<PersonaEntity>): Promise<void>;
  
  // === Message Operations ===
  
  /** Get message history for a persona */
  getMessages(personaName: string, options?: MessageQueryOptions): Promise<Message[]>;
  
  /** Send a message to a persona (queues response) */
  sendMessage(personaName: string, content: string): Promise<void>;
  
  /** Set context window bounds for a persona */
  setContextWindow(personaName: string, start: string, end: string): Promise<void>;
  
  /** Set a message's context status */
  setMessageContextStatus(personaName: string, messageId: string, status: ContextStatus): Promise<void>;
  
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
  
  // === State Operations ===
  
  /** Get list of all checkpoints (ephemeral + persisted), sorted by timestamp */
  getCheckpoints(): Promise<Checkpoint[]>;
  
  /** 
   * Promote an ephemeral checkpoint to a named save slot.
   * @param index - Index from getCheckpoints() (must be ephemeral)
   * @param name - Name for the save slot (cannot be a number string)
   * @throws If index is already persisted or name is invalid
   */
  persistCheckpoint(index: number, name: string): Promise<void>;
  
  /**
   * Restore state from a checkpoint.
   * @param target - Index from getCheckpoints() OR name of persisted checkpoint
   * @returns true if restored, false if target not found
   */
  restoreCheckpoint(target: number | string): Promise<boolean>;
  
  /** Export full state as JSON (for download) */
  exportState(): Promise<string>;
  
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
  index: number;           // Position in the list
  timestamp: string;       // When created
  is_persisted: boolean;   // Ephemeral (false) vs saved (true)
  name?: string;           // Only set if persisted
}

interface QueueStatus {
  state: "idle" | "busy" | "paused";
  pending_count: number;
  current_operation?: string;
}
```

### Checkpoint System

The checkpoint system uses a **video game save slot** model:

1. **Ephemeral checkpoints**: Created automatically (e.g., before destructive operations). Roll off as new ones are created. Default limit: 10.

2. **Persisted checkpoints**: Named save slots that survive rolloff. Default limit: 5 slots.

3. **Restore**: Can restore from any checkpoint (ephemeral or persisted). No "redo"—if you want to undo an undo, create a checkpoint first.

```
Checkpoint List Example:
─────────────────────────────────────────
Index  Timestamp            Persisted  Name
─────────────────────────────────────────
0      2026-01-26T14:00:00  false      -
1      2026-01-26T13:45:00  false      -
2      2026-01-26T13:30:00  true       "before-refactor"
3      2026-01-26T12:00:00  true       "morning-backup"
4      2026-01-26T11:00:00  false      -
─────────────────────────────────────────
```

---

## StateManager API (Processor → StateManager)

The StateManager holds all in-memory state and provides CRUD operations. It does NOT call LLMs directly.

```typescript
interface StateManager {
  // === Lifecycle ===
  
  /** Load state from storage. Call once at startup. */
  initialize(storage: Storage): Promise<void>;
  
  /** Persist current state to storage (auto-save target) */
  persist(): Promise<void>;
  
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
  
  // === Personas ===
  
  persona_getAll(): PersonaEntity[];
  persona_get(name: string): PersonaEntity | null;
  persona_add(name: string, entity: PersonaEntity): void;
  persona_update(name: string, updates: Partial<PersonaEntity>): boolean;
  persona_archive(name: string): boolean;
  persona_unarchive(name: string): boolean;
  persona_delete(name: string): boolean;
  
  // === Messages ===
  
  messages_get(personaName: string): Message[];
  messages_append(personaName: string, message: Message): void;
  messages_setContextStatus(personaName: string, messageId: string, status: ContextStatus): boolean;
  messages_getContextWindow(personaName: string): { start: string; end: string } | null;
  messages_setContextWindow(personaName: string, start: string, end: string): void;
  
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
  
  /** Get queue length */
  queue_length(): number;
  
  /** Pause queue processing (peekHighest returns null while paused) */
  queue_pause(): void;
  
  /** Resume queue processing */
  queue_resume(): void;
  
  /** Check if queue is paused */
  queue_isPaused(): boolean;
  
  // === Checkpoints ===
  
  /** Create an ephemeral checkpoint of current state */
  checkpoint_create(): void;
  
  /** Get all checkpoints (ephemeral + persisted), sorted by timestamp desc */
  checkpoint_list(): Checkpoint[];
  
  /** Promote ephemeral checkpoint to persisted with name */
  checkpoint_persist(index: number, name: string): boolean;
  
  /** Restore state from checkpoint (by index or name) */
  checkpoint_restore(target: number | string): boolean;
  
  // === Settings ===
  
  settings_get<T>(key: string): T | null;
  settings_set<T>(key: string, value: T): void;
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
  /** Load full state, returns null if not found */
  load(): Promise<StorageState | null>;
  
  /** Save full state */
  save(state: StorageState): Promise<void>;
  
  /** Check if storage is available/configured */
  isAvailable(): Promise<boolean>;
  
  /** List persisted checkpoints (named saves) */
  listCheckpoints(): Promise<PersistedCheckpoint[]>;
  
  /** Save a checkpoint to a named slot */
  saveCheckpoint(name: string, state: StorageState): Promise<void>;
  
  /** Load a checkpoint by name */
  loadCheckpoint(name: string): Promise<StorageState | null>;
  
  /** Delete a checkpoint by name */
  deleteCheckpoint(name: string): Promise<boolean>;
}

interface StorageState {
  version: number;
  human: HumanEntity;
  personas: Record<string, {
    entity: PersonaEntity;
    messages: Message[];
  }>;
  queue: LLMRequest[];
  settings: Record<string, unknown>;
}

interface PersistedCheckpoint {
  name: string;
  timestamp: string;
}
```

### Storage Implementations

| Implementation | Description | Priority |
|----------------|-------------|----------|
| `LocalStorage` | Browser localStorage | V1.0 |
| `FileStorage` | Node.js file system (EI_DATA_PATH) | V1.1 (TUI) |
| `RemoteStorage` | flare576.com encrypted sync | V1.2 |

### Save Slot Limits

| Type | Default Limit | Notes |
|------|---------------|-------|
| Ephemeral checkpoints | 10 | In-memory only, roll off FIFO |
| Persisted checkpoints | 5 | Stored via Storage interface |

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
  last_updated: string;
  last_activity: string;  // When human last sent a message (any persona)
  settings?: HumanSettings;
}

interface HumanSettings {
  auto_save_interval_ms?: number;  // Default: 60000 (1 min)
  default_model?: string;          // Default: from EI_LLM_MODEL env
  queue_paused?: boolean;          // Default: false
}
```

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
  topics: Topic[];
  
  // State
  is_paused: boolean;
  pause_until?: string;
  is_archived: boolean;
  archived_at?: string;
  
  // Settings (per-persona)
  heartbeat_delay_ms?: number;     // Default: 1800000 (30 min)
  context_window_hours?: number;   // Default: 8 hours
  
  // Timestamps
  last_updated: string;
  last_activity: string;           // Last message (human or system)
  last_heartbeat?: string;
  last_extraction?: string;
  last_inactivity_ping?: string;
}
```

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
  confidence: number;          // 0.0 to 1.0
  last_confirmed?: string;
}

interface Trait extends DataItemBase {
  strength?: number;           // 0.0 to 1.0
}

interface Topic extends DataItemBase {
  exposure_current: number;    // 0.0 to 1.0
  exposure_desired: number;    // 0.0 to 1.0
}

interface Person extends DataItemBase {
  relationship: string;
  exposure_current: number;    // 0.0 to 1.0
  exposure_desired: number;    // 0.0 to 1.0
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
  HandleEiValidation = "handleEiValidation"
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
| `STORAGE_LOAD_FAILED` | Could not load from storage |
| `STORAGE_SAVE_FAILED` | Could not persist to storage |
| `PERSONA_NOT_FOUND` | Requested persona doesn't exist |
| `PERSONA_ARCHIVED` | Operation not allowed on archived persona |
| `QUEUE_BUSY` | QueueProcessor already processing |
| `CHECKPOINT_NOT_FOUND` | Requested checkpoint doesn't exist |
| `CHECKPOINT_ALREADY_PERSISTED` | Cannot persist an already-persisted checkpoint |
| `CHECKPOINT_INVALID_NAME` | Checkpoint name cannot be a number |

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
