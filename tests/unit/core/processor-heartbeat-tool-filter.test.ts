/**
 * Bolt: signal-ux-bolt-002-heartbeat-tool-classification
 *
 * Covers D2/R1/AT1 — the heartbeat tool-assembly filter in processor.ts's runLoop:
 * a heartbeat-classified request (HandleHeartbeatCheck, HandleEiHeartbeat, or a
 * HandleToolContinuation whose originalNextStep was either) must never receive
 * add_note/clear_note, while every other tool-bearing request continues to get
 * them exactly as before.
 *
 * The QueueProcessor class is mocked so we can capture the exact `tools` array
 * passed to `.start()` without driving a real LLM call.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Vitest/esbuild's ESM<->CJS interop for zod's dual-export shape resolves
// inconsistently once processor.ts's module graph is partially mocked below
// (a pre-existing environment quirk, not specific to this file) — normalize
// it the same way tests/unit/core/processor-legacy-handler-guard.test.ts does.
vi.mock("zod", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    z: (actual.z ?? actual.default ?? actual) as Record<string, unknown>,
  };
});
import { Processor } from "../../../src/core/processor.js";
import { LLMNextStep, LLMRequestType, LLMPriority, type LLMRequest } from "../../../src/core/types.js";

const startCalls: Array<{ request: LLMRequest; options: { tools?: Array<{ name: string }> } }> = [];

vi.mock("../../../src/core/queue-processor.js", () => {
  class MockQueueProcessor {
    start(request: LLMRequest, _callback: unknown, options: { tools?: Array<{ name: string }> }) {
      startCalls.push({ request, options });
      // Never invoke the callback — the request stays "processing" so the real
      // runLoop never reclaims or re-dispatches it, and we don't need to model
      // an actual LLM round trip to observe the assembled tool list.
    }
    abort() {}
    getState() {
      return "idle";
    }
  }
  return { QueueProcessor: MockQueueProcessor };
});

// Mock handlers/orchestrators exactly as processor-events.test.ts does, so
// Processor.start() doesn't attempt real persona generation/extraction work.
vi.mock("../../../src/core/handlers/index.js", () => ({
  handlers: {
    handlePersonaResponse: vi.fn(),
    handlePersonaGeneration: vi.fn(),
    handleFactFind: vi.fn(),
    handleHumanTopicScan: vi.fn(),
    handleHumanPersonScan: vi.fn(),
    handlePersonaTraitExtraction: vi.fn(),
    handlePersonaTopicDetection: vi.fn(),
    handlePersonaTopicExploration: vi.fn(),
    handleHeartbeatCheck: vi.fn(),
    handleEiHeartbeat: vi.fn(),
    handleOneShot: vi.fn(),
    handleToolContinuation: vi.fn(),
  },
  registerSearchHumanData: vi.fn(),
}));

vi.mock("../../../src/core/orchestrators/index.js", () => ({
  orchestratePersonaGeneration: vi.fn(),
  queueFactFind: vi.fn(),
  queueTopicScan: vi.fn(),
  queuePersonScan: vi.fn(),
  queueAllScans: vi.fn(),
  isNewDay: vi.fn(),
  isPastCeremonyTime: vi.fn(),
  shouldStartCeremony: vi.fn(),
  startCeremony: vi.fn(),
  handleCeremonyProgress: vi.fn(),
  prunePersonaMessages: vi.fn(),
  runHumanCeremony: vi.fn(),
}));

function createMockStorage() {
  return {
    isAvailable: vi.fn().mockReturnValue(true),
    load: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    moveToBackup: vi.fn().mockResolvedValue(undefined),
    loadBackup: vi.fn().mockResolvedValue(null),
    saveRollingBackup: vi.fn().mockResolvedValue(undefined),
    // The real runLoop's checkScheduledTasks() calls drainCorrections() every
    // tick unconditionally (see processor-corrections-drain.test.ts's own
    // createMockStorage, which supplies this for the same reason), and
    // drainCorrections() calls storage.getDataPath() before anything else.
    // Returning "" hits the code's own no-filesystem early return (the same
    // path Web's IndexedDBStorage/LocalStorage take) so the drain is an
    // immediate no-op instead of throwing on a missing mock method.
    getDataPath: vi.fn().mockReturnValue(""),
  };
}

function baseRequest(overrides: Partial<LLMRequest>): LLMRequest {
  return {
    id: "test-request",
    created_at: new Date().toISOString(),
    attempts: 0,
    state: "pending",
    type: LLMRequestType.Response,
    priority: LLMPriority.Normal,
    system: "system",
    user: "user",
    next_step: LLMNextStep.HandlePersonaResponse,
    data: { personaId: "test-persona" },
    ...overrides,
  };
}

/** Drive one Processor through a single queued request and return the tools it assembled. */
async function runRequestAndCaptureTools(request: LLMRequest): Promise<string[]> {
  startCalls.length = 0;
  const storage = createMockStorage();
  storage.load.mockResolvedValue({
    version: 1,
    timestamp: new Date().toISOString(),
    human: {
      entity: "human",
      facts: [],
      traits: [],
      topics: [],
      people: [],
      last_updated: new Date().toISOString(),
    },
    personas: {},
    queue: [request],
    providers: [],
    tools: [],
    settings: {},
  });

  const processor = new Processor({});
  await processor.start(storage as unknown as Parameters<typeof processor.start>[0]);
  // Real runLoop ticks on DEFAULT_LOOP_INTERVAL_MS (100ms) — advance the fake
  // clock past a couple of iterations so it claims and dispatches the queued request.
  await vi.advanceTimersByTimeAsync(300);
  await processor.stop();

  expect(startCalls.length).toBe(1);
  return (startCalls[0].options.tools ?? []).map(t => t.name);
}

describe("Processor heartbeat tool-list classification (Bolt 002)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    startCalls.length = 0;
    vi.useRealTimers();
  });

  it("excludes add_note/clear_note for a direct HandleHeartbeatCheck request", async () => {
    const names = await runRequestAndCaptureTools(
      baseRequest({ next_step: LLMNextStep.HandleHeartbeatCheck, data: { personaId: "test-persona" } })
    );
    expect(names).not.toContain("add_note");
    expect(names).not.toContain("clear_note");
    // A legacy, field-absent SYSTEM_TOOLS entry (no heartbeat_eligible declared) must
    // remain present — guards D1's "absent-is-eligible" default and the Bolt's Non-Goal
    // that no other existing tool is reclassified by this filter.
    expect(names).toContain("find_memory");
  });

  it("excludes add_note/clear_note for a direct HandleEiHeartbeat request", async () => {
    const names = await runRequestAndCaptureTools(
      baseRequest({ next_step: LLMNextStep.HandleEiHeartbeat, data: {} })
    );
    expect(names).not.toContain("add_note");
    expect(names).not.toContain("clear_note");
  });

  it("excludes add_note/clear_note for a HandleToolContinuation whose originalNextStep was HandleHeartbeatCheck", async () => {
    const names = await runRequestAndCaptureTools(
      baseRequest({
        next_step: LLMNextStep.HandleToolContinuation,
        data: { personaId: "test-persona", originalNextStep: LLMNextStep.HandleHeartbeatCheck },
      })
    );
    expect(names).not.toContain("add_note");
    expect(names).not.toContain("clear_note");
    // Same guard as above, for the continuation path.
    expect(names).toContain("find_memory");
  });

  it("excludes add_note/clear_note for a HandleToolContinuation whose originalNextStep was HandleEiHeartbeat (later continuation round)", async () => {
    const names = await runRequestAndCaptureTools(
      baseRequest({
        next_step: LLMNextStep.HandleToolContinuation,
        data: { personaId: "ei", originalNextStep: LLMNextStep.HandleEiHeartbeat },
      })
    );
    expect(names).not.toContain("add_note");
    expect(names).not.toContain("clear_note");
  });

  it("still includes add_note/clear_note for a HandlePersonaResponse request", async () => {
    const names = await runRequestAndCaptureTools(
      baseRequest({ next_step: LLMNextStep.HandlePersonaResponse, data: { personaId: "test-persona" } })
    );
    expect(names).toContain("add_note");
    expect(names).toContain("clear_note");
  });

  it("still includes add_note/clear_note for a HandleToolContinuation whose originalNextStep was NOT heartbeat-classified", async () => {
    const names = await runRequestAndCaptureTools(
      baseRequest({
        next_step: LLMNextStep.HandleToolContinuation,
        data: { personaId: "test-persona", originalNextStep: LLMNextStep.HandlePersonaResponse },
      })
    );
    expect(names).toContain("add_note");
    expect(names).toContain("clear_note");
  });

  // Bolt 003 D2 (signal-ux-bolt-003-signal-resolution-hardening): resolve_signal
  // is registered heartbeat_eligible: false at buildResolveSignalTool's own
  // ToolDefinition site — same filter as add_note/clear_note above, extended
  // to this Bolt's own native tool.
  it("excludes resolve_signal for a direct HandleHeartbeatCheck request", async () => {
    const names = await runRequestAndCaptureTools(
      baseRequest({ next_step: LLMNextStep.HandleHeartbeatCheck, data: { personaId: "test-persona" } })
    );
    expect(names).not.toContain("resolve_signal");
  });

  it("excludes resolve_signal for a HandleToolContinuation whose originalNextStep was HandleHeartbeatCheck", async () => {
    const names = await runRequestAndCaptureTools(
      baseRequest({
        next_step: LLMNextStep.HandleToolContinuation,
        data: { personaId: "test-persona", originalNextStep: LLMNextStep.HandleHeartbeatCheck },
      })
    );
    expect(names).not.toContain("resolve_signal");
  });

  it("still includes resolve_signal for an ordinary HandlePersonaResponse request", async () => {
    const names = await runRequestAndCaptureTools(
      baseRequest({ next_step: LLMNextStep.HandlePersonaResponse, data: { personaId: "test-persona" } })
    );
    expect(names).toContain("resolve_signal");
  });
});
