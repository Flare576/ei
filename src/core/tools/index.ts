/**
 * Tool execution layer.
 *
 * - Maintains a registry of executors (builtin + future user-registered)
 * - Tracks per-tool call counts within a single interaction
 * - Converts ToolDefinitions into the OpenAI-compatible tool format for the LLM
 * - Executes tool calls and returns ToolResult[]
 */
import type { ToolDefinition } from "../types.js";
import type { ToolCall, ToolResult, ToolExecutor } from "./types.js";
import { dedupeToolsByName } from "./dedupe.js";
import { tavilyWebSearchExecutor, tavilyNewsSearchExecutor } from "./builtin/web-search.js";
import { currentlyPlayingExecutor } from "./builtin/currently-playing.js";
import { likedSongsExecutor } from "./builtin/spotify-liked-songs.js";
import { webFetchExecutor } from "./builtin/web-fetch.js";
import { NOTES_MAX } from "./builtin/persona-notes.js";
// file-read and list-directory are Node-only — imported lazily via registerFileReadExecutor() to avoid
// file-read and list-directory are Node-only — imported lazily via registerFileReadExecutor() to avoid

/** Hard upper limit on total tool calls per interaction, regardless of individual limits. */
export const HARD_TOOL_CALL_LIMIT = 10;

/**
 * System tools — injected unconditionally into every LLM call that uses tools.
 * NOT stored in state.json. NOT user-configurable. Do NOT count against HARD_TOOL_CALL_LIMIT.
 * Enforce their own per-tool limits via max_calls_per_interaction.
 */
export const SYSTEM_TOOLS: ToolDefinition[] = [
  {
    id: "builtin-find-memory",
    provider_id: "ei",
    name: "find_memory",
    display_name: "Find Memory",
    description: "Semantic search of your personal memory — facts, topics, people, and quotes learned across ALL conversations over time, not just this one. Use when the human references something from the past, mentions a person, or asks about a topic you might have learned about. People and topic results include a sentiment field (e.g. '72% positive', 'neutral', '45% slightly negative') indicating how the human generally feels about that person or subject. Supports optional filters: types (array of 'facts', 'topics', 'people', 'quotes'), limit (1-20, default 10), recent (true = sort by recency), persona (filter to what a specific persona has learned — use display name). TYPE GUIDANCE: 'facts' are ONLY user demographics — name, age, job title, location, family structure, physical traits. For interests, opinions, hobbies, or anything the human cares about, use 'topics'. For named individuals, use 'people'. For verbatim things said, use 'quotes'.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for" },
        types: { type: "array", items: { type: "string", enum: ["facts", "topics", "people", "quotes"] }, description: "Filter to specific types" },
        limit: { type: "number", description: "Max results (1-20, default 10)" },
        recent: { type: "boolean", description: "Sort by most recently mentioned instead of relevance" },
        persona: { type: "string", description: "Filter to what a specific persona has learned. Use their display name." },
      },
      required: ["query"],
    },
    runtime: "any",
    builtin: true,
    enabled: true,
    created_at: new Date(0).toISOString(),
    max_calls_per_interaction: 3,
    kind: "read",
  },
  {
    id: "builtin-fetch-memory",
    provider_id: "ei",
    name: "fetch_memory",
    display_name: "Fetch Memory",
    description: "Retrieve the full record for a specific memory by its ID. For most conversational use, find_memory results are sufficient. Use fetch_memory when you need provenance details (which sessions or documents the memory came from) or the raw sentiment score. Returns the complete Fact, Topic, Person, or Quote record including all fields.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The ID of the memory to retrieve" },
      },
      required: ["id"],
    },
    runtime: "any",
    builtin: true,
    enabled: true,
    created_at: new Date(0).toISOString(),
    max_calls_per_interaction: 10,
    kind: "read",
  },
  {
    id: "builtin-fetch-message",
    provider_id: "ei",
    name: "fetch_message",
    display_name: "Fetch Message",
    description: "Retrieve a specific message by its ID, with optional surrounding context. Use when find_memory returns a quote with a message_id and you want to read the original conversation, or when a temporal anchor references a message ID. The 'before' and 'after' parameters return that many additional messages for context (default 0).",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The message ID to retrieve" },
        before: { type: "number", description: "Number of preceding messages to include for context (default 0)" },
        after: { type: "number", description: "Number of following messages to include for context (default 0)" },
      },
      required: ["id"],
    },
    runtime: "any",
    builtin: true,
    enabled: true,
    created_at: new Date(0).toISOString(),
    max_calls_per_interaction: 5,
    kind: "read",
  },
];

/** Default max calls per tool if not set on the ToolDefinition. */
const DEFAULT_MAX_CALLS = 3;

// =============================================================================
// Executor registry
// =============================================================================

const executorRegistry = new Map<string, ToolExecutor>();

/** Register a tool executor. Call once at startup per builtin. */
export function registerExecutor(executor: ToolExecutor): void {
  executorRegistry.set(executor.name, executor);
}

// Register builtins. find_memory is registered lazily via registerFindMemoryExecutor()
// because it requires Processor.searchHumanData injection.
registerExecutor(tavilyWebSearchExecutor);
registerExecutor(tavilyNewsSearchExecutor);
registerExecutor(currentlyPlayingExecutor);
registerExecutor(likedSongsExecutor);
registerExecutor(webFetchExecutor);
// file_read and list_directory are registered lazily via registerFileReadExecutor() — Node/TUI only.

/**
 * Register the find_memory executor — called by Processor after it's initialized,
 * injecting its own searchHumanData method to avoid circular imports.
 */
export function registerFindMemoryExecutor(executor: ToolExecutor): void {
  executorRegistry.set(executor.name, executor);
}

export function registerFetchMemoryExecutor(executor: ToolExecutor): void {
  executorRegistry.set(executor.name, executor);
}

export function registerFetchMessageExecutor(executor: ToolExecutor): void {
  executorRegistry.set(executor.name, executor);
}

export function registerPersonaNoteExecutors(executor1: ToolExecutor, executor2: ToolExecutor): void {
  executorRegistry.set(executor1.name, executor1);
  executorRegistry.set(executor2.name, executor2);
}

/**
 * Build per-request ToolDefinition objects for the persona notes tools, injecting the
 * current personaId via config so the shared executor knows which persona to update.
 */
export function buildPersonaNoteTools(personaId: string): ToolDefinition[] {
  const now = new Date(0).toISOString();
  return [
    {
      id: `builtin-add-note-${personaId}`,
      provider_id: "ei",
      name: "add_note",
      display_name: "Add Note",
      description: `In Ei, your system prompt can change from one turn to the next — Ei is constantly trying to provide you relevant, up-to-date information about the user and the world. If you see something in your system prompt that you don't immediately want to bring up, but want to remember, use this tool to record it for later. Additionally, if you need to remember something but cannot or should not say it directly in conversation, you can use this tool to make a note as well. Notes appear in your system prompt as a numbered list so you always see them. Limit: ${NOTES_MAX} notes (oldest evicted when full).`,
      input_schema: {
        type: "object",
        properties: {
          text: { type: "string", description: "The note to remember. Keep it concise." },
        },
        required: ["text"],
      },
      config: { persona_id: personaId },
      runtime: "any",
      builtin: true,
      enabled: true,
      created_at: now,
      max_calls_per_interaction: 5,
      heartbeat_eligible: false,
      kind: "write",
    },
    {
      id: `builtin-clear-note-${personaId}`,
      provider_id: "ei",
      name: "clear_note",
      display_name: "Clear Note",
      description: "Remove a note from your scratchpad by its 1-based index (matching the numbered list in your system prompt). Use when you no longer need to track something — e.g., after you've addressed it in conversation.",
      input_schema: {
        type: "object",
        properties: {
          index: { type: "number", description: "1-based index of the note to remove" },
        },
        required: ["index"],
      },
      config: { persona_id: personaId },
      runtime: "any",
      builtin: true,
      enabled: true,
      created_at: now,
      max_calls_per_interaction: 5,
      heartbeat_eligible: false,
      kind: "write",
    },
  ];
}

export function registerPersonaIdentityExecutors(
  getMyIdentity: ToolExecutor,
  editTrait: ToolExecutor,
  editTopic: ToolExecutor,
  updateDescription: ToolExecutor
): void {
  executorRegistry.set(getMyIdentity.name, getMyIdentity);
  executorRegistry.set(editTrait.name, editTrait);
  executorRegistry.set(editTopic.name, editTopic);
  executorRegistry.set(updateDescription.name, updateDescription);
}

/**
 * Build per-request ToolDefinition objects for the four native identity tools, injecting the
 * current personaId via config so the shared executors know which persona to read/write.
 * get_my_identity is read-only and left at heartbeat_eligible's default (true); the three
 * write tools are each explicitly heartbeat_eligible: false (D1).
 */
export function buildPersonaIdentityTools(personaId: string): ToolDefinition[] {
  const now = new Date(0).toISOString();
  return [
    {
      id: `builtin-get-my-identity-${personaId}`,
      provider_id: "ei",
      name: "get_my_identity",
      display_name: "Get My Identity",
      description: "Retrieve your own complete identity: every current trait and topic, each carrying a stable id, plus your short and long description. Use this before edit_trait/edit_topic to look up the id of the item you want to change, or just to see your full current self-model.",
      input_schema: {
        type: "object",
        properties: {},
      },
      config: { persona_id: personaId },
      runtime: "any",
      builtin: true,
      enabled: true,
      created_at: now,
      max_calls_per_interaction: 5,
      kind: "read",
    },
    {
      id: `builtin-edit-trait-${personaId}`,
      provider_id: "ei",
      name: "edit_trait",
      display_name: "Edit Trait",
      description: "Add, remove, or update one of your own traits. action: \"add\" requires name, description, and sentiment (-1 to 1; strength 0-1 is optional) and mints a fresh id. action: \"remove\" requires the id of an existing trait and deletes exactly that one. action: \"update\" requires the id of an existing trait plus one or more fields to change (name, description, sentiment, strength) — only the supplied fields are changed. Look up ids via get_my_identity first.",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["add", "remove", "update"], description: "Which operation to perform." },
          id: { type: "string", description: "Existing trait id — required for remove/update." },
          name: { type: "string", description: "Trait name — required for add." },
          description: { type: "string", description: "Trait description — required for add." },
          sentiment: { type: "number", description: "Sentiment from -1 to 1 — required for add." },
          strength: { type: "number", description: "Optional strength from 0 to 1." },
        },
        required: ["action"],
      },
      config: { persona_id: personaId },
      runtime: "any",
      builtin: true,
      enabled: true,
      created_at: now,
      max_calls_per_interaction: 5,
      heartbeat_eligible: false,
      kind: "write",
    },
    {
      id: `builtin-edit-topic-${personaId}`,
      provider_id: "ei",
      name: "edit_topic",
      display_name: "Edit Topic",
      description: "Add, remove, or update one of your own topics. action: \"add\" requires name, perspective, approach, personal_stake, sentiment (-1 to 1), exposure_current (0-1), and exposure_desired (0-1), and mints a fresh id. action: \"remove\" requires the id of an existing topic and deletes exactly that one. action: \"update\" requires the id of an existing topic plus one or more fields to change — only the supplied fields are changed. Look up ids via get_my_identity first.",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["add", "remove", "update"], description: "Which operation to perform." },
          id: { type: "string", description: "Existing topic id — required for remove/update." },
          name: { type: "string", description: "Topic name — required for add." },
          perspective: { type: "string", description: "Your view/opinion on this topic — required for add." },
          approach: { type: "string", description: "How you prefer to engage with this topic — required for add." },
          personal_stake: { type: "string", description: "Why this topic matters to you personally — required for add." },
          sentiment: { type: "number", description: "Sentiment from -1 to 1 — required for add." },
          exposure_current: { type: "number", description: "How recently discussed, 0 to 1 — required for add." },
          exposure_desired: { type: "number", description: "How much you want to discuss it, 0 to 1 — required for add." },
        },
        required: ["action"],
      },
      config: { persona_id: personaId },
      runtime: "any",
      builtin: true,
      enabled: true,
      created_at: now,
      max_calls_per_interaction: 5,
      heartbeat_eligible: false,
      kind: "write",
    },
    {
      id: `builtin-update-description-${personaId}`,
      provider_id: "ei",
      name: "update_description",
      display_name: "Update Description",
      description: "Update your own short and/or long description. Supply short_description and/or long_description — only the supplied field(s) change, the other is left untouched. Changing long_description recomputes your description embedding.",
      input_schema: {
        type: "object",
        properties: {
          short_description: { type: "string", description: "New short description. Omit to leave unchanged." },
          long_description: { type: "string", description: "New long description. Omit to leave unchanged." },
        },
      },
      config: { persona_id: personaId },
      runtime: "any",
      builtin: true,
      enabled: true,
      created_at: now,
      max_calls_per_interaction: 5,
      heartbeat_eligible: false,
      kind: "write",
    },
  ];
}

/** Register the `resolve_signal` executor — called by Processor once at
 * startup (Bolt 003 D2), same shared-registry pattern as
 * registerPersonaNoteExecutors above. Not persona-specific itself: the
 * executor resolves which persona it's bound to per-call, from the
 * `config.persona_id` a per-request ToolDefinition (built by
 * buildResolveSignalTool below) injects. */
export function registerResolveSignalExecutor(executor: ToolExecutor): void {
  executorRegistry.set(executor.name, executor);
}

/**
 * Build the per-request ToolDefinition for `resolve_signal` (Bolt 003
 * D2/D4), injecting the current personaId via config so the shared
 * executor knows which persona's own signals it may resolve — same
 * per-request injection pattern as buildPersonaNoteTools above.
 * `heartbeat_eligible: false` (D2): a write-capable tool, never
 * reachable from a heartbeat-classified request.
 */
export function buildResolveSignalTool(personaId: string): ToolDefinition[] {
  const now = new Date(0).toISOString();
  return [
    {
      id: `builtin-resolve-signal-${personaId}`,
      provider_id: "ei",
      name: "resolve_signal",
      display_name: "Resolve Signal",
      description: "Confirm or dismiss one of your own EmergentSignals — a candidate or recurring pattern Ei has noticed about you (identity, voice, behavior) or the human you're talking with is testifying to. Confirming marks it reviewed (agreed, worth keeping as evidence); dismissing marks it dismissed (not accurate, or not worth tracking). This ONLY transitions the signal's own status — it never changes your traits/topics/description directly, and it cannot affect a signal belonging to any other persona. Use ei_signal_list (if you have MCP access) or your own system prompt's signal surfacing to find a signal's id first.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "The id of the EmergentSignal to resolve (yours only)." },
          action: { type: "string", enum: ["confirm", "dismiss"], description: "\"confirm\" marks the signal reviewed; \"dismiss\" marks it dismissed." },
        },
        required: ["id", "action"],
      },
      config: { persona_id: personaId },
      runtime: "any",
      builtin: true,
      enabled: true,
      created_at: now,
      max_calls_per_interaction: 5,
      heartbeat_eligible: false,
      kind: "write",
    },
  ];
}

/**
 * Register the file_read, list_directory, directory_tree, search_files, grep, and get_file_info
 * executors — called by Processor on TUI/Node only.
 * Dynamic import prevents node:fs/promises from being bundled in the web build.
 */
export async function registerFileReadExecutor(): Promise<void> {
  const { fileReadExecutor } = await import("./builtin/file-read.js");
  const { listDirectoryExecutor } = await import("./builtin/list-directory.js");
  const { directoryTreeExecutor } = await import("./builtin/directory-tree.js");
  const { searchFilesExecutor } = await import("./builtin/search-files.js");
  const { grepExecutor } = await import("./builtin/grep.js");
  const { getFileInfoExecutor } = await import("./builtin/get-file-info.js");
  executorRegistry.set(fileReadExecutor.name, fileReadExecutor);
  executorRegistry.set(listDirectoryExecutor.name, listDirectoryExecutor);
  executorRegistry.set(directoryTreeExecutor.name, directoryTreeExecutor);
  executorRegistry.set(searchFilesExecutor.name, searchFilesExecutor);
  executorRegistry.set(grepExecutor.name, grepExecutor);
  executorRegistry.set(getFileInfoExecutor.name, getFileInfoExecutor);
}

// =============================================================================
// OpenAI tool format conversion
// =============================================================================

/** Convert ToolDefinition[] into the OpenAI-compatible `tools` array for the API request. */
export function toOpenAITools(tools: ToolDefinition[]): Record<string, unknown>[] {
  return tools.map(t => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,

    },
  }));
}

/**
 * Returns the first tool call in the batch that maps to an is_submit tool, or undefined.
 * When a submit tool is called, its arguments ARE the structured response — no execution needed.
 */
export function findSubmitToolCall(
  toolCalls: ToolCall[],
  activeTools: ToolDefinition[]
): ToolCall | undefined {
  const submitNames = new Set(
    activeTools.filter(t => t.is_submit).map(t => t.name)
  );
  return toolCalls.find(call => submitNames.has(call.name));
}

// =============================================================================
// Tool call execution
// =============================================================================

/**
 * Execute a batch of tool calls.
 * - Tracks call counts; tools that have hit their limit are skipped.
 * - Catastrophic failures (throws) → error=true; tool is marked for removal.
 * - Returns results and which tools should be dropped from subsequent LLM calls.
 */
export async function executeToolCalls(
  calls: ToolCall[],
  tools: ToolDefinition[],
  callCounts: Map<string, number>,
  totalCalls: { count: number },
  onProviderConfigUpdate?: (providerId: string, updates: Record<string, string>) => void
): Promise<{ results: ToolResult[]; exhaustedToolNames: Set<string> }> {
  const results: ToolResult[] = [];
  const exhaustedToolNames = new Set<string>();
  const toolsByName = new Map(dedupeToolsByName(tools).map(t => [t.name, t]));

  for (const call of calls) {
    const isSystemTool = SYSTEM_TOOLS.some(t => t.name === call.name);

    if (!isSystemTool && totalCalls.count >= HARD_TOOL_CALL_LIMIT) {
      console.log(`[Tools] Hard limit (${HARD_TOOL_CALL_LIMIT}) reached — skipping remaining tool calls`);
      break;
    }

    const definition = toolsByName.get(call.name);
    if (!definition) {
      console.warn(`[Tools] Unknown tool requested: ${call.name}`);
      results.push({
        tool_call_id: call.id,
        name: call.name,
        result: JSON.stringify({ error: `Unknown tool: ${call.name}` }),
        error: false,
      });
      continue;
    }

    const maxCalls = definition.max_calls_per_interaction ?? DEFAULT_MAX_CALLS;
    const currentCount = callCounts.get(call.name) ?? 0;

    if (currentCount >= maxCalls) {
      console.log(`[Tools] ${call.name} hit max_calls_per_interaction (${maxCalls}) — skipping`);
      exhaustedToolNames.add(call.name);
      results.push({
        tool_call_id: call.id,
        name: call.name,
        result: JSON.stringify({ error: `Tool call limit reached for ${call.name}` }),
        error: false,
      });
      continue;
    }

    const executor = executorRegistry.get(call.name);
    if (!executor) {
      console.warn(`[Tools] No executor registered for: ${call.name}`);
      results.push({
        tool_call_id: call.id,
        name: call.name,
        result: JSON.stringify({ error: `No executor for tool: ${call.name}` }),
        error: true,
      });
      exhaustedToolNames.add(call.name);
      continue;
    }

    callCounts.set(call.name, currentCount + 1);
    if (!isSystemTool) {
      totalCalls.count++;
    }

    const newCount = currentCount + 1;
    if (newCount >= maxCalls) {
      exhaustedToolNames.add(call.name);
    }

    try {
      console.log(`[Tools] Executing ${call.name} (call ${newCount}/${maxCalls})`);
      const onConfigUpdate = onProviderConfigUpdate && definition.provider_id
        ? (updates: Record<string, string>) => onProviderConfigUpdate(definition.provider_id, updates)
        : undefined;
      const result = await executor.execute(call.arguments, definition.config, onConfigUpdate);
      results.push({
        tool_call_id: call.id,
        name: call.name,
        result,
        error: false,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[Tools] ${call.name} failed: ${errMsg}`);
      results.push({
        tool_call_id: call.id,
        name: call.name,
        result: JSON.stringify({ error: `Tool unavailable: ${errMsg}` }),
        error: true,
      });
      exhaustedToolNames.add(call.name);
    }
  }

  return { results, exhaustedToolNames };
}

/**
 * Parse tool_calls from the raw LLM API response choice message.
 * Returns empty array if no tool calls or on malformed JSON.
 */
export function parseToolCalls(rawToolCalls: unknown[]): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const raw of rawToolCalls) {
    try {
      const tc = raw as { id?: string; type?: string; function?: { name?: string; arguments?: string } };
      if (tc.type !== "function" || !tc.id || !tc.function?.name) continue;
      const args = JSON.parse(tc.function.arguments ?? "{}");
      calls.push({ id: tc.id, name: tc.function.name, arguments: args });
    } catch (err) {
      console.warn("[Tools] Malformed tool_call entry — skipping:", err);
    }
  }
  return calls;
}
