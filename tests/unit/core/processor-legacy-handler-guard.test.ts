import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Processor } from "../../../src/core/processor.js";
import { LLMNextStep, LLMRequestType, LLMPriority } from "../../../src/core/types.js";
import type { Ei_Interface, LLMRequest, StorageState } from "../../../src/core/types.js";
import { createDefaultTestState } from "../../helpers/mock-storage.js";

/**
 * Bolt-001 D3/R4/AT4: a persisted queue request whose next_step has no
 * registered handler (the exact upgrade-time state a legacy
 * `handleReflectionCritic` entry is left in after the Critic's deletion)
 * must be deleted by Processor.runLoop() before dispatch — never handed to
 * QueueProcessor.start()/callLLMRaw(), and never left behind in the DLQ.
 */

// Vitest/esbuild's ESM<->CJS interop for zod's dual-export shape resolves
// inconsistently once processor.ts's module graph is partially mocked below
// (a pre-existing environment quirk, not specific to this guard) — normalize
// it the same way tests/unit/core/merge-patch-pipeline-parity.test.ts does.
vi.mock("zod", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    z: (actual.z ?? actual.default ?? actual) as Record<string, unknown>,
  };
});

// Mock the handler registry with a fixed, known-registered set. The legacy
// "handleReflectionCritic" string is deliberately absent, reproducing the
// exact post-deletion condition the guard defends against.
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

// Spy on QueueProcessor.start()/getState() without touching real dispatch
// (callLLMRaw lives behind it) — the guard must prevent it from ever being
// reached with the legacy request's content.
const queueProcessorStartSpy = vi.fn();
const queueProcessorGetStateSpy = vi.fn().mockReturnValue("idle");
vi.mock("../../../src/core/queue-processor.js", () => ({
  QueueProcessor: vi.fn().mockImplementation(() => ({
    getState: queueProcessorGetStateSpy,
    start: queueProcessorStartSpy,
  })),
}));

function createMockInterface(): Ei_Interface {
  return {
    onPersonaAdded: vi.fn(),
    onPersonaRemoved: vi.fn(),
    onPersonaUpdated: vi.fn(),
    onMessageAdded: vi.fn(),
    onMessageProcessing: vi.fn(),
    onMessageQueued: vi.fn(),
    onMessageRecalled: vi.fn(),
    onHumanUpdated: vi.fn(),
    onQueueStateChanged: vi.fn(),
    onError: vi.fn(),
    onStateImported: vi.fn(),
    onOneShotReturned: vi.fn(),
  };
}

function createMockStorage(preloadState?: StorageState | null) {
  return {
    isAvailable: vi.fn().mockReturnValue(true),
    load: vi.fn().mockResolvedValue(preloadState ?? null),
    save: vi.fn().mockResolvedValue(undefined),
    moveToBackup: vi.fn().mockResolvedValue(undefined),
    loadBackup: vi.fn().mockResolvedValue(null),
  };
}

function makeLegacyRequest(state: "pending" | "processing", id: string): LLMRequest {
  return {
    id,
    created_at: new Date().toISOString(),
    attempts: 0,
    state,
    type: LLMRequestType.Response,
    priority: LLMPriority.High,
    system: "legacy system prompt",
    // Stored prompt content the guard must never let reach the LLM/DLQ.
    user: "STORED PERSON LOG: sensitive persona reflection content",
    next_step: "handleReflectionCritic" as LLMNextStep,
    data: {},
  };
}

function makeControlRequest(id: string): LLMRequest {
  return {
    id,
    created_at: new Date().toISOString(),
    attempts: 0,
    state: "pending",
    type: LLMRequestType.Response,
    priority: LLMPriority.Low,
    system: "control system prompt",
    user: "control user prompt",
    next_step: LLMNextStep.HandlePersonaResponse,
    data: {},
  };
}

async function waitForLoopTicks(advanceMs = 500): Promise<void> {
  // DEFAULT_LOOP_INTERVAL_MS is 100ms; advance the fake clock deterministically
  // so runLoop()'s fire-and-forget claim/guard/delete cycle gets several ticks
  // without depending on real wall-clock time.
  await vi.advanceTimersByTimeAsync(advanceMs);
}

describe("Processor.runLoop() legacy-handler deletion guard (Bolt-001 D3/R4/AT4)", () => {
  let processor: Processor;

  beforeEach(() => {
    vi.useFakeTimers();
    queueProcessorStartSpy.mockClear();
    queueProcessorGetStateSpy.mockClear().mockReturnValue("idle");
    processor = new Processor(createMockInterface());
  });

  afterEach(async () => {
    await processor.stop();
    vi.useRealTimers();
  });

  it("deletes a persisted 'pending' legacy request instead of dispatching it, and leaves the control entry untouched", async () => {
    const state = createDefaultTestState();
    const legacyId = "legacy-pending-1";
    const controlId = "control-1";
    state.queue = [makeLegacyRequest("pending", legacyId), makeControlRequest(controlId)];

    const storage = createMockStorage(state);
    await processor.start(storage);
    await waitForLoopTicks();

    const queue = processor.getStateManager().getStorageState().queue;
    expect(queue.find((r) => r.id === legacyId)).toBeUndefined();

    // Never dispatched with its stored content.
    for (const call of queueProcessorStartSpy.mock.calls) {
      const dispatched = call[0] as LLMRequest;
      expect(dispatched.id).not.toBe(legacyId);
      expect(dispatched.user).not.toContain("STORED PERSON LOG");
    }

    // Never lands in the DLQ.
    expect(processor.getStateManager().queue_getDLQItems().find((r) => r.id === legacyId)).toBeUndefined();

    // Unrelated control entry survives.
    expect(queue.find((r) => r.id === controlId)).toBeDefined();
  });

  it("deletes a persisted 'processing' legacy request instead of dispatching it, and leaves the control entry untouched", async () => {
    const state = createDefaultTestState();
    const legacyId = "legacy-processing-1";
    const controlId = "control-2";
    state.queue = [makeLegacyRequest("processing", legacyId), makeControlRequest(controlId)];

    const storage = createMockStorage(state);
    await processor.start(storage);
    await waitForLoopTicks();

    const queue = processor.getStateManager().getStorageState().queue;
    expect(queue.find((r) => r.id === legacyId)).toBeUndefined();

    for (const call of queueProcessorStartSpy.mock.calls) {
      const dispatched = call[0] as LLMRequest;
      expect(dispatched.id).not.toBe(legacyId);
      expect(dispatched.user).not.toContain("STORED PERSON LOG");
    }

    expect(processor.getStateManager().queue_getDLQItems().find((r) => r.id === legacyId)).toBeUndefined();
    expect(queue.find((r) => r.id === controlId)).toBeDefined();
  });
});
