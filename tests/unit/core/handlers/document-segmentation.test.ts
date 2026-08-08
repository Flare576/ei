import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/core/orchestrators/index.js", () => ({
  orchestratePersonaGeneration: vi.fn(),
  queueTopicMatch: vi.fn().mockResolvedValue(undefined),
  queuePersonMatch: vi.fn().mockResolvedValue(undefined),
  queueAllScans: vi.fn(),
}));

vi.mock("../../../../src/core/orchestrators/human-extraction.js", () => ({
  queueAllScans: vi.fn(),
}));

vi.mock("../../../../src/core/embedding-service.js", () => ({
  getEmbeddingService: () => ({
    embed: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
  }),
  getItemEmbeddingText: ({ name, description }: { name: string; description?: string }) =>
    `${name}: ${description ?? ""}`,
  getTopicEmbeddingText: ({ name, description }: { name: string; description?: string }) =>
    `${name}: ${description ?? ""}`,
  getPersonEmbeddingText: ({ name, description }: { name: string; description?: string }) =>
    `${name}: ${description ?? ""}`,
}));

vi.mock("../../../../src/core/llm-client.js", () => ({
  cleanResponseContent: vi.fn((content: string) => content),
  parseJSONResponse: vi.fn(),
}));

import { handleDocumentSegmentation, finishDocumentBatch } from "../../../../src/core/handlers/document-segmentation.js";
import { queueAllScans } from "../../../../src/core/orchestrators/human-extraction.js";
import {
  ContextStatus,
  LLMNextStep,
  LLMRequestType,
  LLMPriority,
  type LLMRequest,
  type LLMResponse,
  type LLMRequestState,
  type Message,
} from "../../../../src/core/types.js";
import { QueueState } from "../../../../src/core/state/index.js";
import type { StateManager } from "../../../../src/core/state-manager.js";
import type { PersonaEntity } from "../../../../src/core/types/entities.js";

// ─── Factories ────────────────────────────────────────────────────────────────

function makeDocRequest(overrides: Partial<{ batchId: string; filename: string; originalContent: string }> = {}): LLMRequest {
  return {
    id: "doc-req-1",
    created_at: new Date().toISOString(),
    attempts: 0,
    state: "pending" as LLMRequestState,
    type: LLMRequestType.Raw,
    priority: LLMPriority.High,
    system: "system",
    user: "user",
    next_step: LLMNextStep.HandleDocumentSegmentation,
    data: {
      batchId: "batch-1",
      filename: "notes.md",
      originalContent: "Original fallback content",
      ...overrides,
    },
  };
}

function makeDocResponse(content: string | null, requestOverrides: Partial<{ batchId: string; filename: string; originalContent: string }> = {}): LLMResponse {
  return {
    request: makeDocRequest(requestOverrides),
    success: content !== null,
    content,
    parsed: undefined,
    error: content === null ? "no content" : undefined,
  };
}

function makeEmmettPersona(): PersonaEntity {
  return {
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
}

// ─── Mock State Factory ───────────────────────────────────────────────────────

function createMockDocState(options: {
  emmett?: PersonaEntity | null;
  existingMessages?: Message[];
  humanSettings?: any;
} = {}) {
  const _appendedMessages: Message[] = [];

  const emmett = options.emmett !== undefined ? options.emmett : makeEmmettPersona();
  const existingMessages = options.existingMessages ?? [];

  return {
    persona_getById: vi.fn((id: string) => id === "emmet" ? emmett : null),
    messages_append: vi.fn((_personaId: string, msg: Message) => {
      _appendedMessages.push(msg);
    }),
    messages_get: vi.fn(() => existingMessages),
    getHuman: vi.fn(() => ({
      settings: options.humanSettings ?? {},
    })),
    setHuman: vi.fn(),
    queue_enqueue: vi.fn(),
    _appendedMessages,
  };
}

// ─── handleDocumentSegmentation ──────────────────────────────────────────────

describe("handleDocumentSegmentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when batchId is missing", () => {
    const state = createMockDocState();
    const response = makeDocResponse("content", { batchId: "" });

    expect(() => handleDocumentSegmentation(response, state as any)).toThrow(
      "[handleDocumentSegmentation] Missing batchId or filename"
    );
  });

  it("throws when filename is missing", () => {
    const state = createMockDocState();
    const response = makeDocResponse("content", { filename: "" });

    expect(() => handleDocumentSegmentation(response, state as any)).toThrow(
      "[handleDocumentSegmentation] Missing batchId or filename"
    );
  });

  it("throws when Emmett persona is not found", () => {
    const state = createMockDocState({ emmett: null });
    const response = makeDocResponse('["segment one"]');

    expect(() => handleDocumentSegmentation(response, state as any)).toThrow(
      "[handleDocumentSegmentation] Emmett persona not found"
    );
  });

  it("writes each segment individually when content is a valid JSON array", () => {
    const state = createMockDocState();
    const response = makeDocResponse('["segment one", "segment two", "segment three"]');

    handleDocumentSegmentation(response, state as any);

    expect(state.messages_append).toHaveBeenCalledTimes(3);
    const contents = state._appendedMessages.map(m => m.content);
    expect(contents).toContain("segment one");
    expect(contents).toContain("segment two");
    expect(contents).toContain("segment three");
  });

  it("extracts and writes segments from markdown-fenced JSON", () => {
    const state = createMockDocState();
    const fenced = '```json\n["first chunk", "second chunk"]\n```';
    const response = makeDocResponse(fenced);

    handleDocumentSegmentation(response, state as any);

    expect(state.messages_append).toHaveBeenCalledTimes(2);
    const contents = state._appendedMessages.map(m => m.content);
    expect(contents).toContain("first chunk");
    expect(contents).toContain("second chunk");
  });

  it("throws a distinct message when no JSON array is found in the response (path 1)", () => {
    const state = createMockDocState();
    const response = makeDocResponse("this is not json at all");

    expect(() => handleDocumentSegmentation(response, state as unknown as StateManager)).toThrow(
      "[handleDocumentSegmentation] Segmentation failed: no JSON array"
    );
    expect(state.messages_append).not.toHaveBeenCalled();
  });

  it("throws a distinct message when the parsed JSON value is not an array (path 2, defensive)", () => {
    const state = createMockDocState();
    const response = makeDocResponse('["placeholder"]');
    const parseSpy = vi.spyOn(JSON, "parse").mockReturnValueOnce({ not: "an array" });

    try {
      expect(() => handleDocumentSegmentation(response, state as unknown as StateManager)).toThrow(
        "[handleDocumentSegmentation] Segmentation failed: the response parsed as valid JSON"
      );
    } finally {
      parseSpy.mockRestore();
    }
    expect(state.messages_append).not.toHaveBeenCalled();
  });

  it("throws a distinct message including the underlying JSON.parse error when the array text is malformed (path 3)", () => {
    const state = createMockDocState();
    const response = makeDocResponse("[not, valid, json]");

    expect(() => handleDocumentSegmentation(response, state as unknown as StateManager)).toThrow(
      "[handleDocumentSegmentation] Segmentation failed: the JSON array in the response could not be parsed — JSON.parse error:"
    );
    expect(state.messages_append).not.toHaveBeenCalled();
  });

  it("throws a distinct message when the parsed array is empty (path 4) — genuinely empty", () => {
    const state = createMockDocState();
    const response = makeDocResponse("[]");

    expect(() => handleDocumentSegmentation(response, state as unknown as StateManager)).toThrow(
      "[handleDocumentSegmentation] Segmentation failed: the response was a valid JSON array but contained zero usable segments"
    );
    expect(state.messages_append).not.toHaveBeenCalled();
  });

  it("throws the same path-4 message when every array entry is blank or non-string, not just for a literal []", () => {
    const state = createMockDocState();
    const response = makeDocResponse('["   ", 42, null, ""]');

    expect(() => handleDocumentSegmentation(response, state as unknown as StateManager)).toThrow(
      "[handleDocumentSegmentation] Segmentation failed: the response was a valid JSON array but contained zero usable segments"
    );
    expect(state.messages_append).not.toHaveBeenCalled();
  });

  it("throws a distinct message when response content is empty (path 5)", () => {
    const state = createMockDocState();
    const response = makeDocResponse(null);

    expect(() => handleDocumentSegmentation(response, state as unknown as StateManager)).toThrow(
      "[handleDocumentSegmentation] Segmentation failed: the LLM response had no content at all"
    );
    expect(state.messages_append).not.toHaveBeenCalled();
  });


  it("writes segments with context_status Always and external true", () => {
    const state = createMockDocState();
    const response = makeDocResponse('["a segment"]');

    handleDocumentSegmentation(response, state as any);

    const msg = state._appendedMessages[0];
    expect(msg.context_status).toBe(ContextStatus.Always);
    expect(msg.external).toBe(true);
    expect(msg.role).toBe("system");
    expect(msg.read).toBe(true);
  });

  it("writes segment IDs with the import:document:<filename>: prefix", () => {
    const state = createMockDocState();
    const response = makeDocResponse('["a segment"]', { filename: "notes.md" });

    handleDocumentSegmentation(response, state as any);

    expect(state._appendedMessages[0].id).toMatch(/^import:document:notes\.md:/);
  });

  it("writes all segments to the emmet persona ID", () => {
    const state = createMockDocState();
    const response = makeDocResponse('["seg one", "seg two"]');

    handleDocumentSegmentation(response, state as any);

    expect(state.messages_append).toHaveBeenCalledWith("emmet", expect.any(Object));
    expect(state.messages_append).toHaveBeenCalledTimes(2);
  });
});

describe("handleDocumentSegmentation — degraded-path failure messages (regression: silent-degradation fix)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Cross-checks both tickets at once: the five throw messages above must be
  // pairwise distinct (a human reading the DLQ can tell them apart) AND none
  // of them may trip isPermanentError()'s unanchored regex (queue.ts), or a
  // casually-worded segmentation failure would skip retry entirely and never
  // reach the DLQ the first ticket's fix depends on.
  it("produces five pairwise-distinct messages, none of which the queue misclassifies as permanent", () => {
    const state = createMockDocState();
    const scenarios: Array<{ content: string | null; mockNotArray?: boolean }> = [
      { content: "this is not json at all" },
      { content: '["placeholder"]', mockNotArray: true },
      { content: "[not, valid, json]" },
      { content: "[]" },
      { content: null },
    ];

    const messages: string[] = [];
    for (const scenario of scenarios) {
      const response = makeDocResponse(scenario.content);
      const parseSpy = scenario.mockNotArray
        ? vi.spyOn(JSON, "parse").mockReturnValueOnce({ not: "an array" })
        : undefined;
      try {
        let caught: unknown;
        try {
          handleDocumentSegmentation(response, state as unknown as StateManager);
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(Error);
        messages.push((caught as Error).message);
      } finally {
        parseSpy?.mockRestore();
      }
    }

    expect(messages).toHaveLength(5);
    expect(new Set(messages).size).toBe(5);

    const queue = new QueueState();
    for (const message of messages) {
      const id = queue.enqueue({
        type: LLMRequestType.JSON,
        priority: LLMPriority.Low,
        system: "system",
        user: "user",
        next_step: LLMNextStep.HandleDocumentSegmentation,
        data: {},
      });
      const result = queue.fail(id, message);
      expect(result.dropped).toBe(false);
    }
  });
});

// ─── finishDocumentBatch ──────────────────────────────────────────────────────

describe("finishDocumentBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeDocMessage(filename: string, overrides: Partial<Message> = {}): Message {
    return {
      id: `import:document:${filename}:${crypto.randomUUID()}`,
      role: "system",
      content: "some segment",
      timestamp: new Date().toISOString(),
      read: true,
      context_status: ContextStatus.Always,
      external: true,
      ...overrides,
    };
  }

  it("calls queueAllScans with ExtractionContext scoped to matching doc messages", () => {
    const docMsg1 = makeDocMessage("notes.md");
    const docMsg2 = makeDocMessage("notes.md");
    const otherMsg = makeDocMessage("other.md");

    const state = createMockDocState({ existingMessages: [docMsg1, docMsg2, otherMsg] });

    finishDocumentBatch("batch-1", "notes.md", state as any);

    expect(queueAllScans).toHaveBeenCalledTimes(1);
    const [context] = (queueAllScans as any).mock.calls[0];
    expect(context.personaId).toBe("emmet");
    expect(context.messages_analyze).toContain(docMsg1);
    expect(context.messages_analyze).toContain(docMsg2);
    expect(context.messages_analyze).not.toContain(otherMsg);
  });

  it("forwards extraction_model from document settings to queueAllScans", () => {
    const docMsg = makeDocMessage("notes.md");
    const state = createMockDocState({
      existingMessages: [docMsg],
      humanSettings: { document: { extraction_model: "my-model:fast" } },
    });

    finishDocumentBatch("batch-1", "notes.md", state as any);

    const [, , options] = (queueAllScans as any).mock.calls[0];
    expect(options.extraction_model).toBe("my-model:fast");
  });

  it("passes external_filter: 'only' to queueAllScans", () => {
    const docMsg = makeDocMessage("notes.md");
    const state = createMockDocState({ existingMessages: [docMsg] });

    finishDocumentBatch("batch-1", "notes.md", state as any);

    const [, , options] = (queueAllScans as any).mock.calls[0];
    expect(options.external_filter).toBe("only");
  });

  it("marks filename as processed in human settings regardless of whether messages were found", () => {
    const state = createMockDocState({ existingMessages: [] });

    finishDocumentBatch("batch-1", "notes.md", state as any);

    expect(state.setHuman).toHaveBeenCalledTimes(1);
    const updatedHuman = (state.setHuman as any).mock.calls[0][0];
    expect(updatedHuman.settings.document.processed_documents["notes.md"]).toBeDefined();
    expect(updatedHuman.settings.document.processed_documents["notes.md"].type).toBe("imported");
  });

  it("skips queueAllScans when no matching messages found but still marks processed", () => {
    const state = createMockDocState({ existingMessages: [] });

    finishDocumentBatch("batch-1", "notes.md", state as any);

    expect(queueAllScans).not.toHaveBeenCalled();
    expect(state.setHuman).toHaveBeenCalledTimes(1);
  });

  it("only includes messages with external: true that match the filename prefix", () => {
    const matchingExternal = makeDocMessage("notes.md", { external: true });
    const nonExternal = makeDocMessage("notes.md", { external: false });
    const state = createMockDocState({ existingMessages: [matchingExternal, nonExternal] });

    finishDocumentBatch("batch-1", "notes.md", state as any);

    const [context] = (queueAllScans as any).mock.calls[0];
    expect(context.messages_analyze).toContain(matchingExternal);
    expect(context.messages_analyze).not.toContain(nonExternal);
  });
});
