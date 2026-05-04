import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LLMNextStep,
  LLMRequestType,
  LLMPriority,
  ContextStatus,
  type LLMRequestState,
  type LLMResponse,
  type LLMRequest,
  type Message,
  type HumanEntity,
} from "../../../../src/core/types.js";

import { handleKnowledgeSynthesis } from "../../../../src/core/handlers/knowledge-synthesis.js";

function createMockHuman(overrides: Partial<HumanEntity> = {}): HumanEntity {
  return {
    entity: "human",
    facts: [],
    topics: [],
    people: [],
    quotes: [],
    last_updated: new Date().toISOString(),
    ...overrides,
  };
}

function createMockStateManager(humanOverrides: Partial<HumanEntity> = {}) {
  const human = createMockHuman(humanOverrides);

  const appendedMessages: Array<{ personaId: string; message: Message }> = [];

  const stateManager = {
    getHuman: vi.fn(() => ({ ...human })),
    setHuman: vi.fn((h: HumanEntity) => Object.assign(human, h)),
    messages_append: vi.fn((personaId: string, message: Message) => {
      appendedMessages.push({ personaId, message });
    }),
    _human: human,
    _appendedMessages: appendedMessages,
  };

  return stateManager;
}

function createMockRequest(data: Record<string, unknown> = {}): LLMRequest {
  return {
    id: "test-request-id",
    created_at: new Date().toISOString(),
    attempts: 0,
    state: "pending" as LLMRequestState,
    type: LLMRequestType.Raw,
    priority: LLMPriority.Normal,
    system: "system prompt",
    user: "user prompt",
    next_step: LLMNextStep.HandleKnowledgeSynthesis,
    data: {
      slug: "my-topic_2026-01-01T00-00-00-000Z",
      subject: "My Topic",
      ...data,
    },
  };
}

function createMockResponse(
  request: LLMRequest,
  content: string | null
): LLMResponse {
  return {
    request,
    success: content !== null,
    content,
    parsed: undefined,
    error: content === null ? "LLM returned no content" : undefined,
  };
}

describe("handleKnowledgeSynthesis", () => {
  let state: ReturnType<typeof createMockStateManager>;

  beforeEach(() => {
    state = createMockStateManager();
    vi.clearAllMocks();
  });

  it("happy path: appends message to emmet with correct fields", () => {
    const request = createMockRequest();
    const response = createMockResponse(request, "# My Topic\n\nThis is the synthesized content.");

    handleKnowledgeSynthesis(response, state as any);

    expect(state.messages_append).toHaveBeenCalledOnce();
    const [personaId, message] = (state.messages_append as ReturnType<typeof vi.fn>).mock.calls[0];

    expect(personaId).toBe("emmet");
    expect(message.role).toBe("system");
    expect(message.content).toBe("# My Topic\n\nThis is the synthesized content.");
    expect(message.external).toBe(true);
    expect(message.read).toBe(true);
    expect(message.context_status).toBe(ContextStatus.Always);
    expect(message.source_tag).toBe("generate:document:my-topic_2026-01-01T00-00-00-000Z");
    expect(message.id).toBeDefined();
    expect(message.timestamp).toBeDefined();
  });

  it("updates processed_documents with type=generated, slug, subject, and created_at", () => {
    const request = createMockRequest({ slug: "test-slug_ts", subject: "Test Subject" });
    const response = createMockResponse(request, "Some synthesized markdown content.");

    handleKnowledgeSynthesis(response, state as any);

    expect(state.setHuman).toHaveBeenCalledOnce();
    const updatedHuman: HumanEntity = (state.setHuman as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const entry = updatedHuman.settings?.document?.processed_documents?.["test-slug_ts"];

    expect(entry).toBeDefined();
    expect(entry?.type).toBe("generated");
    expect(entry?.subject).toBe("Test Subject");
    expect(entry?.created_at).toBeDefined();
  });

  it("preserves existing processed_documents entries when adding a new generated entry", () => {
    const existingState = createMockStateManager({
      settings: {
        document: {
          processed_documents: {
            "existing-slug_ts": { created_at: "2025-01-01T00:00:00.000Z", type: "generated", subject: "Existing Subject" },
          },
        },
      } as any,
    });

    const request = createMockRequest({ slug: "new-slug_ts", subject: "New Subject" });
    const response = createMockResponse(request, "New synthesized content.");

    handleKnowledgeSynthesis(response, existingState as any);

    const updatedHuman: HumanEntity = (existingState.setHuman as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const docs = updatedHuman.settings?.document?.processed_documents;

    expect(docs?.["existing-slug_ts"]).toBeDefined();
    expect(docs?.["existing-slug_ts"]?.subject).toBe("Existing Subject");
    expect(docs?.["new-slug_ts"]).toBeDefined();
    expect(docs?.["new-slug_ts"]?.subject).toBe("New Subject");
  });

  it("empty response content: does NOT write message and does NOT update settings", () => {
    const request = createMockRequest();
    const response = createMockResponse(request, "   ");

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    handleKnowledgeSynthesis(response, state as any);

    expect(state.messages_append).not.toHaveBeenCalled();
    expect(state.setHuman).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("null response content: does NOT write message and does NOT update settings", () => {
    const request = createMockRequest();
    const response = createMockResponse(request, null);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    handleKnowledgeSynthesis(response, state as any);

    expect(state.messages_append).not.toHaveBeenCalled();
    expect(state.setHuman).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("message source_tag follows generate:document:{slug} format", () => {
    const request = createMockRequest({ slug: "philosophy-of-mind_2026-05-04T12-00-00-000Z" });
    const response = createMockResponse(request, "Content about philosophy of mind.");

    handleKnowledgeSynthesis(response, state as any);

    const [, message] = (state.messages_append as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(message.source_tag).toBe("generate:document:philosophy-of-mind_2026-05-04T12-00-00-000Z");
  });
});
