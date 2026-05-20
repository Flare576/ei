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

  it("falls back to originalContent as single message when JSON is malformed", () => {
    const state = createMockDocState();
    const response = makeDocResponse("this is not json at all", { originalContent: "Original fallback content" });

    handleDocumentSegmentation(response, state as any);

    expect(state.messages_append).toHaveBeenCalledTimes(1);
    expect(state._appendedMessages[0].content).toBe("Original fallback content");
  });

  it("falls back to originalContent when content is null", () => {
    const state = createMockDocState();
    const response = makeDocResponse(null, { originalContent: "Original fallback content" });

    handleDocumentSegmentation(response, state as any);

    expect(state.messages_append).toHaveBeenCalledTimes(1);
    expect(state._appendedMessages[0].content).toBe("Original fallback content");
  });

  it("falls back to originalContent when JSON parses to empty array", () => {
    const state = createMockDocState();
    const response = makeDocResponse("[]", { originalContent: "Original fallback content" });

    handleDocumentSegmentation(response, state as any);

    expect(state.messages_append).toHaveBeenCalledTimes(1);
    expect(state._appendedMessages[0].content).toBe("Original fallback content");
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
