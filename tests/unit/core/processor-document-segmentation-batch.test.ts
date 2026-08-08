import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Processor } from "../../../src/core/processor.js";
import type { Ei_Interface, LLMResponse } from "../../../src/core/types.js";
import { LLMRequestType, LLMPriority, LLMNextStep } from "../../../src/core/types.js";
import type { PersonaEntity } from "../../../src/core/types/entities.js";

/**
 * Regression test for the fix that pairs document-segmentation-degrades-silently
 * with unbounded-transient-retry-has-no-cap.
 *
 * Once handleDocumentSegmentation() throws instead of silently degrading, a
 * multi-chunk document-import batch (one HandleDocumentSegmentation queue item
 * per chunk, sharing one batchId) can have one chunk permanently fail to the
 * DLQ while its siblings already succeeded. finishDocumentBatch() — which
 * queues extraction and marks the document processed — was previously invoked
 * only from Processor.handleResponse()'s success path, gated on
 * queue_hasPendingDocumentSegments(batchId). If a sibling reaches the DLQ
 * instead of completing, that gate is never re-checked, and the succeeded
 * sibling's already-written segment is orphaned: never queued for extraction,
 * document never marked processed.
 *
 * Drives the REAL Processor.handleResponse() dispatch seam end to end —
 * handlers/index.js AND orchestrators/human-extraction.js are deliberately
 * left unmocked (vi.mock's module-replacement does not intercept ESM imports
 * in this project's current vitest/Node combination — verified directly: even
 * a trivial from-scratch module mocked in isolation still executes its real
 * body — a pre-existing, project-wide condition unrelated to this fix, also
 * visible in the ~37 test files that fail this same way on main today). So
 * this test asserts on real, unmocked, observable StateManager side effects
 * (extraction flag set, document marked processed) rather than on a spy that
 * cannot be installed here, and both fixes participate for real regardless:
 * the real handleDocumentSegmentation throw path, and the real queue
 * MAX_ATTEMPTS(10) cap that converts the repeatedly failing chunk into a
 * permanent DLQ entry. The two tickets are inseparable — fail-loud only
 * produces a visible failure if the retry cap actually terminates it — so
 * this single test exercises both.
 */

interface ResponseHandleableProcessor {
  handleResponse(response: LLMResponse): Promise<void>;
}

interface MockStorage {
  isAvailable: ReturnType<typeof vi.fn>;
  load: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  moveToBackup: ReturnType<typeof vi.fn>;
  loadBackup: ReturnType<typeof vi.fn>;
  saveRollingBackup: ReturnType<typeof vi.fn>;
  getDataPath: () => string;
}

describe("Processor.handleResponse() — document segmentation batch completion on partial DLQ failure", () => {
  let dataDir: string;
  let processor: Processor;
  let storage: MockStorage;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "ei-doc-segment-batch-"));
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

  it("finalizes the batch — marks the document processed and extracts chunk 0's segment — when chunk 1 permanently fails after chunk 0 already succeeded", async () => {
    const mockInterface: Ei_Interface = {};
    processor = new Processor(mockInterface);
    await processor.start(storage as unknown as Parameters<Processor["start"]>[0]);
    processor.pauseQueue();

    const stateManager = processor.getStateManager();
    const emmett: PersonaEntity = {
      id: "emmet",
      display_name: "Emmett",
      entity: "system",
      traits: [],
      topics: [],
      is_paused: false,
      is_archived: false,
      is_static: true,
      last_updated: new Date().toISOString(),
    };
    stateManager.persona_add(emmett);

    const batchId = "batch-partial-failure";
    const filename = "notes.md";

    const chunk0Id = stateManager.queue_enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.Low,
      system: "system",
      user: "user",
      next_step: LLMNextStep.HandleDocumentSegmentation,
      data: { batchId, filename, chunkIndex: 0, originalContent: "chunk zero source" },
    });
    const chunk1Id = stateManager.queue_enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.Low,
      system: "system",
      user: "user",
      next_step: LLMNextStep.HandleDocumentSegmentation,
      data: { batchId, filename, chunkIndex: 1, originalContent: "chunk one source" },
    });

    const chunk0Request = stateManager.getStorageState().queue.find((r) => r.id === chunk0Id);
    const chunk1Request = stateManager.getStorageState().queue.find((r) => r.id === chunk1Id);
    if (!chunk0Request || !chunk1Request) {
      throw new Error("test setup failed: enqueued requests not found in queue");
    }

    // Chunk 0 succeeds — one real segment gets written via the real handler.
    const successResponse: LLMResponse = {
      request: chunk0Request,
      success: true,
      content: '["chunk zero segment"]',
    };
    await (processor as unknown as ResponseHandleableProcessor).handleResponse(successResponse);

    const segmentBeforeFinalize = stateManager
      .messages_get("emmet")
      .find((m) => m.content === "chunk zero segment");
    if (!segmentBeforeFinalize) throw new Error("test setup failed: chunk 0 segment was not written");

    // The batch must NOT finalize yet — chunk 1 is still pending. finishDocumentBatch()
    // hasn't run, so the fact-extraction flag on chunk 0's segment is still unset and
    // the document isn't marked processed.
    expect(segmentBeforeFinalize.f).not.toBe(true);
    expect(stateManager.getHuman().settings?.document?.processed_documents?.[filename]).toBeUndefined();

    // Chunk 1 degrades on every attempt (empty content — path 5 of the
    // silent-degradation fix) and never recovers. Drive it through the real
    // queue-fail path until the MAX_ATTEMPTS(10) cap converts it to a
    // permanent DLQ failure.
    const failingResponse: LLMResponse = {
      request: chunk1Request,
      success: true,
      content: null,
    };
    for (let attempt = 1; attempt <= 10; attempt++) {
      await (processor as unknown as ResponseHandleableProcessor).handleResponse(failingResponse);
    }

    // Chunk 1 reached the DLQ rather than retrying forever.
    expect(chunk1Request.state).toBe("dlq");
    expect(chunk1Request.attempts).toBe(10);
    expect(stateManager.queue_getDLQItems().some((r) => r.id === chunk1Id)).toBe(true);

    // The batch finalized despite chunk 1's permanent failure: chunk 0's
    // already-written segment went through the real extraction pipeline
    // (queueFactFind() unconditionally calls messages_markExtracted(..., "f")
    // on every chunk it processes) and the document is marked processed —
    // chunk 0's segment is not orphaned by chunk 1's DLQ failure.
    const segmentAfterFinalize = stateManager
      .messages_get("emmet")
      .find((m) => m.content === "chunk zero segment");
    expect(segmentAfterFinalize?.f).toBe(true);
    expect(stateManager.getHuman().settings?.document?.processed_documents?.[filename]).toBeDefined();
  });
});
