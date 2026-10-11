/**
 * Whole-turn fixture: drives a complete conversational turn through the real
 * Processor run loop -> real QueueProcessor -> real handler -> real StateManager,
 * with only the LLM call (`callLLMRaw`) replaced by a script. Continuation
 * re-enqueues travel through the real queue, exactly as in production.
 *
 * Usage
 *   1. The including test file MUST mock the LLM client at module scope, keeping
 *      every other export real:
 *        vi.mock("../../../src/core/llm-client.js", async (importOriginal) => ({
 *          ...(await importOriginal<typeof import("../../../src/core/llm-client.js")>()),
 *          callLLMRaw: vi.fn(),
 *        }));
 *      Do NOT mock `tools/index.js` in the same file unless it passes through to the
 *      real implementation; the fixture registers real executors with it.
 *   2. `const fx = await createTurnFixture({ onMessageAdded, onRoomMessageAdded })`
 *      builds a started Processor with a fresh persona (`fx.personaId`, paused so no
 *      scheduled work interferes), an FFA room containing it (`fx.roomId`), and
 *      spies on the interface (`fx.spies`). Call `await fx.stop()` in afterEach.
 *   3. `fx.script([...])` queues the scripted LLM rounds in order. Build rounds with
 *      `stopRound`, `toolRound`, `submitRound` and `malformedToolRound`. An entry may
 *      also be a function `(ctx) => round`, called when that LLM call is made —
 *      which is also the moment every earlier round has been fully handled, so it
 *      is the hook for observing mid-turn state (`ctx.index` is the 0-based call
 *      number). `fx.llmCalls` records every call (`messages` is the history sent).
 *   4. `fx.registerTool({ ... })` persists an enabled custom tool assigned to a
 *      persona and registers a real executor under a unique name; `fx.registerExecutor`
 *      only registers an executor (for names the Processor already offers, such as
 *      `find_memory`, `edit_trait` or a submit tool).
 *   5. Start a turn with `fx.sendPersonaTurn()`, `fx.sendRoomTurn()`,
 *      `fx.sendHeartbeatCheck()` or `fx.sendEiHeartbeat({ offeredId })`, then
 *      `await fx.settle()` — it resolves when the queue is empty and idle, and
 *      rejects if the turn raised an error or the script was not fully consumed.
 *   6. Assert on `fx.messages()` / `fx.roomMessages()` / `fx.eiMessages()` (the rows
 *      actually written) and on `fx.spies`.
 */
import { vi, type Mock } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Processor } from "../../src/core/processor.js";
import { callLLMRaw } from "../../src/core/llm-client.js";
import { registerExecutor } from "../../src/core/tools/index.js";
import type { ToolExecutor } from "../../src/core/tools/types.js";
import {
  ContextStatus,
  LLMNextStep,
  LLMPriority,
  LLMRequestType,
  RoomMode,
} from "../../src/core/types.js";
import type {
  Ei_Interface,
  Fact,
  Message,
  RoomMessage,
  ToolDefinition,
} from "../../src/core/types.js";
import type { PersonaEntity } from "../../src/core/types/entities.js";
import type { StateManager } from "../../src/core/state-manager.js";

// =============================================================================
// Scripted LLM rounds
// =============================================================================

export interface ScriptedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** The value `callLLMRaw` resolves with for one scripted LLM call. */
export interface LLMRound {
  content: string | null;
  finishReason: string;
  rawToolCalls?: unknown[];
  assistantMessage?: unknown;
  thinking?: string;
}

export interface LLMCallContext {
  index: number;
  messages: unknown[];
}

export type ScriptEntry = LLMRound | ((ctx: LLMCallContext) => LLMRound | Promise<LLMRound>);

export interface RecordedLLMCall {
  system: string;
  user: string;
  messages: Array<{ role: string; content: string | null; tool_call_id?: string; name?: string }>;
  nextStep?: string;
}

function rawToolCalls(calls: ScriptedToolCall[]): unknown[] {
  return calls.map((call) => ({
    id: call.id,
    type: "function",
    function: { name: call.name, arguments: JSON.stringify(call.arguments) },
  }));
}

/** A round that stops with a plain reply. */
export function stopRound(content: string, thinking?: string): LLMRound {
  return { content, finishReason: "stop", ...(thinking !== undefined ? { thinking } : {}) };
}

/** A round that requests one or more tool calls in a single response. */
export function toolRound(calls: ScriptedToolCall[], thinking?: string): LLMRound {
  const raw = rawToolCalls(calls);
  return {
    content: null,
    finishReason: "tool_calls",
    rawToolCalls: raw,
    assistantMessage: { role: "assistant", content: null, tool_calls: raw },
    ...(thinking !== undefined ? { thinking } : {}),
  };
}

/**
 * A round that calls a submit tool, optionally batched with other calls. The
 * other calls are requested in the same response and are expected to be discarded.
 */
export function submitRound(
  submitName: string,
  submitArguments: Record<string, unknown>,
  options: { thinking?: string; alongside?: ScriptedToolCall[]; id?: string } = {},
): LLMRound {
  return toolRound(
    [...(options.alongside ?? []), { id: options.id ?? "submit-call", name: submitName, arguments: submitArguments }],
    options.thinking,
  );
}

/** A tool_calls round whose calls are malformed so they parse to none (the turn is treated as a stop). */
export function malformedToolRound(content: string, thinking?: string): LLMRound {
  return {
    content,
    finishReason: "tool_calls",
    rawToolCalls: [{ type: "function", function: { name: "no_id_here", arguments: "{}" } }],
    ...(thinking !== undefined ? { thinking } : {}),
  };
}

// =============================================================================
// Fixture
// =============================================================================

export interface TurnFixtureOptions {
  /** Runs inside the `onMessageAdded` spy, before it returns. */
  onMessageAdded?: (personaId: string) => void;
  /** Runs inside the `onRoomMessageAdded` spy, before it returns. */
  onRoomMessageAdded?: (roomId: string) => void;
}

export interface RegisterToolOptions {
  /** Defaults to a unique generated name. */
  name?: string;
  /** Omit the key entirely to model a definition with no `kind`. */
  kind?: "read" | "write";
  /** Result string, or a function of the arguments. Defaults to a unique string. */
  result?: string | ((args: Record<string, unknown>) => string);
  /** Make the executor throw this message (the executor reports a tool error). */
  throws?: string;
  maxCallsPerInteraction?: number;
  /** Persona to assign the tool to; defaults to the fixture persona. */
  personaId?: string;
}

export interface RegisteredTool {
  name: string;
  definition: ToolDefinition;
  /** Arguments of every real execution, in order. */
  executions: Array<Record<string, unknown>>;
}

export interface TurnFixture {
  processor: Processor;
  stateManager: StateManager;
  personaId: string;
  personaName: string;
  roomId: string;
  spies: {
    onMessageAdded: Mock<(personaId: string) => void>;
    onRoomMessageAdded: Mock<(roomId: string) => void>;
    onError: Mock<(error: unknown) => void>;
  };
  llmCalls: RecordedLLMCall[];
  script(entries: ScriptEntry[]): void;
  registerExecutor(executor: ToolExecutor): void;
  registerTool(options?: RegisterToolOptions): RegisteredTool;
  sendPersonaTurn(): void;
  sendRoomTurn(): void;
  sendHeartbeatCheck(): void;
  /**
   * Queues an Ei heartbeat turn. `offeredId` is the one item id the request offers
   * (a persona id, or an id from `addFact`); omit it for the id-less Temporal Anchor path.
   */
  sendEiHeartbeat(options?: { offeredId?: string }): void;
  /** Persists a fact the Ei heartbeat can name by id. */
  addFact(id: string): Fact;
  messages(): Message[];
  roomMessages(): RoomMessage[];
  eiMessages(): Message[];
  settle(): Promise<void>;
  stop(): Promise<void>;
}

const SETTLE_TIMEOUT_MS = 15_000;
const POLL_MS = 25;

let uniqueCounter = 0;
export function uniqueName(prefix: string): string {
  uniqueCounter += 1;
  return `${prefix}_${uniqueCounter}_${crypto.randomUUID().slice(0, 8).replace(/-/g, "")}`;
}

export async function createTurnFixture(options: TurnFixtureOptions = {}): Promise<TurnFixture> {
  const dataDir = mkdtempSync(join(tmpdir(), "ei-turn-capture-"));
  const storage = {
    isAvailable: vi.fn().mockResolvedValue(true),
    load: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    moveToBackup: vi.fn().mockResolvedValue(undefined),
    loadBackup: vi.fn().mockResolvedValue(null),
    saveRollingBackup: vi.fn().mockResolvedValue(undefined),
    getDataPath: () => dataDir,
  };

  const spies = {
    onMessageAdded: vi.fn((personaId: string) => options.onMessageAdded?.(personaId)),
    onRoomMessageAdded: vi.fn((roomId: string) => options.onRoomMessageAdded?.(roomId)),
    onError: vi.fn(),
  };
  const ei_interface: Ei_Interface = {
    onMessageAdded: spies.onMessageAdded,
    onRoomMessageAdded: spies.onRoomMessageAdded,
    onError: spies.onError,
  };

  const processor = new Processor(ei_interface);
  await processor.start(storage as unknown as Parameters<Processor["start"]>[0]);
  const stateManager = processor.getStateManager();

  const personaId = `turn-persona-${crypto.randomUUID().slice(0, 8)}`;
  const personaName = "Turn Persona";
  const persona: PersonaEntity = {
    id: personaId,
    display_name: personaName,
    entity: "system",
    traits: [],
    topics: [],
    is_paused: true,
    is_archived: false,
    is_static: false,
    last_updated: new Date().toISOString(),
    last_heartbeat: new Date().toISOString(),
    tools: [],
  };
  stateManager.persona_add(persona);

  const room = stateManager.addRoom({
    display_name: `Turn Room ${personaId}`,
    mode: RoomMode.FreeForAll,
    persona_ids: [personaId],
    initial_message: "room opener",
  });
  const roomId = room.id;

  const providerId = `turn-provider-${crypto.randomUUID().slice(0, 8)}`;
  stateManager.tools_addProvider({
    id: providerId,
    name: providerId,
    display_name: "Turn fixture provider",
    builtin: false,
    config: {},
    enabled: true,
    created_at: new Date().toISOString(),
  });

  const llmCalls: RecordedLLMCall[] = [];
  let scriptEntries: ScriptEntry[] = [];
  let scriptConsumed = 0;
  let scriptTotal = 0;

  vi.mocked(callLLMRaw).mockImplementation((async (
    system: string,
    user: string,
    messages: Array<{ role: string; content: string | null; tool_call_id?: string; name?: string }>,
    _model: unknown,
    callOptions?: { nextStep?: string },
  ) => {
    const index = scriptConsumed;
    llmCalls.push({
      system,
      user,
      messages: messages.map((m) => ({ ...m })),
      nextStep: callOptions?.nextStep,
    });
    const entry = scriptEntries[index];
    if (!entry) throw new Error(`turn fixture: LLM script exhausted at call ${index}`);
    scriptConsumed += 1;
    return typeof entry === "function" ? entry({ index, messages: llmCalls[index].messages }) : entry;
  }) as unknown as typeof callLLMRaw);

  const enqueuedIds = new Set<string>();
  const enqueue = (request: Parameters<StateManager["queue_enqueue"]>[0]): void => {
    enqueuedIds.add(stateManager.queue_enqueue(request));
  };

  const fixture: TurnFixture = {
    processor,
    stateManager,
    personaId,
    personaName,
    roomId,
    spies,
    llmCalls,

    script(entries) {
      scriptEntries = entries;
      scriptConsumed = 0;
      scriptTotal = entries.length;
      llmCalls.length = 0;
    },

    registerExecutor(executor) {
      registerExecutor(executor);
    },

    registerTool(toolOptions = {}) {
      const name = toolOptions.name ?? uniqueName("turn_tool");
      const executions: Array<Record<string, unknown>> = [];
      const resultOption = toolOptions.result ?? `result-of-${name}`;
      registerExecutor({
        name,
        execute: async (args) => {
          executions.push(args);
          if (toolOptions.throws) throw new Error(toolOptions.throws);
          return typeof resultOption === "function" ? resultOption(args) : resultOption;
        },
      });
      const definition: ToolDefinition = {
        id: `turn-tool-id-${name}`,
        provider_id: providerId,
        name,
        display_name: name,
        description: `${name} (fixture tool)`,
        input_schema: { type: "object", properties: {} },
        runtime: "any",
        builtin: false,
        enabled: true,
        created_at: new Date().toISOString(),
        ...(toolOptions.maxCallsPerInteraction !== undefined
          ? { max_calls_per_interaction: toolOptions.maxCallsPerInteraction }
          : {}),
        ...(toolOptions.kind !== undefined ? { kind: toolOptions.kind } : {}),
      };
      stateManager.tools_add(definition);
      const owner = toolOptions.personaId ?? personaId;
      const current = stateManager.persona_getById(owner)?.tools ?? [];
      stateManager.persona_update(owner, { tools: [...current, definition.id] });
      return { name, definition, executions };
    },

    sendPersonaTurn() {
      stateManager.messages_append(personaId, {
        id: `human-${crypto.randomUUID()}`,
        role: "human",
        content: "hello there",
        timestamp: new Date().toISOString(),
        read: true,
        context_status: ContextStatus.Default,
      });
      enqueue({
        type: LLMRequestType.Raw,
        priority: LLMPriority.High,
        system: "persona system",
        user: "persona user",
        next_step: LLMNextStep.HandlePersonaResponse,
        model: "test:model",
        data: { personaId, personaDisplayName: personaName },
      });
    },

    sendRoomTurn() {
      const parent = stateManager.getRoomMessages(roomId)[0];
      enqueue({
        type: LLMRequestType.Raw,
        priority: LLMPriority.Room,
        system: "room system",
        user: "room user",
        next_step: LLMNextStep.HandleRoomResponse,
        model: "test:model",
        data: { roomId, personaId, personaDisplayName: personaName, parentMessageId: parent?.id ?? null },
      });
    },

    sendHeartbeatCheck() {
      enqueue({
        type: LLMRequestType.JSON,
        priority: LLMPriority.Low,
        system: "heartbeat system",
        user: "heartbeat user",
        next_step: LLMNextStep.HandleHeartbeatCheck,
        model: "test:model",
        data: { personaId, personaDisplayName: personaName },
      });
    },

    sendEiHeartbeat(heartbeatOptions = {}) {
      enqueue({
        type: LLMRequestType.JSON,
        priority: LLMPriority.Low,
        system: "ei heartbeat system",
        user: "ei heartbeat user",
        next_step: LLMNextStep.HandleEiHeartbeat,
        model: "test:model",
        data: {
          personaId: "ei",
          isTUI: false,
          newPersonIds: [],
          offeredIds: heartbeatOptions.offeredId ? [heartbeatOptions.offeredId] : [],
        },
      });
    },

    addFact(id) {
      const fact: Fact = {
        id,
        name: `Fact ${id}`,
        description: `Description of ${id}`,
        sentiment: 0,
        last_updated: new Date().toISOString(),
        validated_date: "2020-01-01T00:00:00.000Z",
      };
      stateManager.human_fact_upsert(fact);
      return fact;
    },

    messages: () => stateManager.messages_get(personaId),
    roomMessages: () => stateManager.getRoomMessages(roomId),
    eiMessages: () => stateManager.messages_get("ei"),

    async settle() {
      const deadline = Date.now() + SETTLE_TIMEOUT_MS;
      const queueProcessor = (processor as unknown as { queueProcessor: { getState(): string } }).queueProcessor;
      let quietPolls = 0;
      while (Date.now() < deadline) {
        if (spies.onError.mock.calls.length > 0) {
          throw new Error(`turn fixture: turn raised an error: ${JSON.stringify(spies.onError.mock.calls[0][0])}`);
        }
        const queueEmpty = stateManager.getStorageState().queue.length === 0;
        quietPolls = queueEmpty && queueProcessor.getState() === "idle" ? quietPolls + 1 : 0;
        if (quietPolls >= 3) {
          if (scriptConsumed !== scriptTotal) {
            throw new Error(`turn fixture: ${scriptTotal - scriptConsumed} scripted LLM round(s) were never requested`);
          }
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
      throw new Error("turn fixture: turn did not settle in time");
    },

    async stop() {
      await processor.stop();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };

  return fixture;
}
