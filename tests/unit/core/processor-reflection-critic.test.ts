import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Processor } from "../../../src/core/processor.js";
import type { Ei_Interface, LLMResponse } from "../../../src/core/types.js";
import { LLMRequestType, LLMPriority, LLMNextStep } from "../../../src/core/types.js";

/**
 * I22 regression: handleReflectionCritic() must check external_reflection_only
 * before validating the parsed critic result, so a malformed/null response for
 * an already-opted-out Persona is skipped rather than thrown. A throw here
 * matters beyond the handler itself — Processor.handleResponse() (processor.ts
 * :999-1001,1197-1210) converts any handler throw into queue_fail(), which
 * schedules a retry unless the error is classified permanent. This suite
 * drives the REAL handleReflectionCritic through the REAL Processor dispatch
 * seam (handlers/index.js is deliberately left unmocked) and asserts the
 * queue's actual disposition — completed vs. still-pending-with-a-retry —
 * which is a different, stronger claim than "the handler didn't throw" or
 * "neither write occurred" (already covered at the unit level in
 * tests/unit/core/handlers/reflection.test.ts).
 *
 * orchestrators/index.js is mocked exactly like sibling Processor test files
 * (see processor-corrections-drain.test.ts) so the background runLoop's
 * ceremony/extraction checks stay inert. pauseQueue() additionally freezes
 * the loop's own claim-and-dispatch of pending requests, so our manually
 * enqueued request is never raced by a real (unmocked) LLM dispatch attempt.
 */

// Narrow structural cast onto the private method under test — the same
// seam-exposure pattern processor-corrections-drain.test.ts uses for
// drainCorrections(), named here for handleResponse().
interface ResponseHandleableProcessor {
  handleResponse(response: LLMResponse): Promise<void>;
}

vi.mock("../../../src/core/orchestrators/index.js", () => ({
  orchestratePersonaGeneration: vi.fn(),
  queueFactFind: vi.fn(),
  queueTopicScan: vi.fn(),
  queuePersonScan: vi.fn(),
  queueAllScans: vi.fn(),
  isNewDay: vi.fn(),
  isPastCeremonyTime: vi.fn(),
  shouldStartCeremony: vi.fn(() => false),
  startCeremony: vi.fn(),
  handleCeremonyProgress: vi.fn(),
  prunePersonaMessages: vi.fn(),
  runHumanCeremony: vi.fn(),
  queueReflectionDrain: vi.fn(),
  queueUserDedupRequest: vi.fn(),
  queueRoomCapture: vi.fn(),
  queuePersonaCapture: vi.fn(),
  checkAndQueueRoomExtraction: vi.fn(),
  queueTargetedPersonUpdate: vi.fn(),
  queueTargetedTopicUpdate: vi.fn(),
}));

interface MockStorage {
  isAvailable: ReturnType<typeof vi.fn>;
  load: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  moveToBackup: ReturnType<typeof vi.fn>;
  loadBackup: ReturnType<typeof vi.fn>;
  saveRollingBackup: ReturnType<typeof vi.fn>;
  getDataPath: () => string;
}

describe("Processor.handleResponse() \u2014 reflection critic queue disposition (I22)", () => {
  let dataDir: string;
  let processor: Processor;
  let storage: MockStorage;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "ei-reflection-critic-"));
    storage = {
      isAvailable: vi.fn().mockResolvedValue(true),
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(undefined),
      moveToBackup: vi.fn().mockResolvedValue(undefined),
      loadBackup: vi.fn().mockResolvedValue(null),
      saveRollingBackup: vi.fn().mockResolvedValue(undefined),
      getDataPath: () => dataDir,
    };
  });

  afterEach(async () => {
    await processor.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("completes the request instead of failing it into a retry when a malformed critic result arrives for an already-opted-out persona", async () => {
    const mockInterface: Ei_Interface = {};
    processor = new Processor(mockInterface);
    await processor.start(storage as unknown as Parameters<Processor["start"]>[0]);
    processor.pauseQueue();

    const stateManager = processor.getStateManager();
    const personaId = "persona-i22";
    const personaDisplayName = "I22 Target";
    // is_paused: true, matching the sibling drain-test convention, so the
    // background runLoop's own heartbeat scheduling has nothing to do for
    // this fixture regardless of the pauseQueue() call above.
    stateManager.persona_add({
      id: personaId,
      display_name: personaDisplayName,
      entity: "system",
      aliases: [personaDisplayName],
      traits: [],
      topics: [],
      is_paused: true,
      is_archived: false,
      is_static: false,
      last_updated: new Date().toISOString(),
    });

    const requestId = stateManager.queue_enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.Low,
      system: "system",
      user: "user",
      next_step: LLMNextStep.HandleReflectionCritic,
      data: { personaId, personaDisplayName },
    });
    const request = stateManager.getStorageState().queue.find((r) => r.id === requestId);
    if (!request) throw new Error("test setup failed: enqueued request not found in queue");

    // In-flight race: the critic was queued while the Persona was still
    // ordinary; the flag flips to true before the (malformed) response
    // is handled.
    stateManager.persona_update(personaId, { external_reflection_only: true });

    const response: LLMResponse = {
      request,
      success: true,
      content: "{}",
      parsed: {}, // malformed: missing critique field
    };

    await (processor as unknown as ResponseHandleableProcessor).handleResponse(response);

    // queue_complete() removes the item entirely; queue_fail() leaves it in
    // the queue with state:"pending", attempts:1, and a retry_after backoff.
    // Undefined is the only outcome consistent with "completed, not retried".
    const finalRequest = stateManager.getStorageState().queue.find((r) => r.id === requestId);
    expect(finalRequest).toBeUndefined();
  });
});
