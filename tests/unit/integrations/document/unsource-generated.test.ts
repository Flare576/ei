import { describe, it, expect, vi } from "vitest";
import { executeUnsource, previewUnsource } from "../../../../src/integrations/document/unsource.js";
import type { HumanEntity } from "../../../../src/core/types.js";

function makeHuman(overrides: Partial<HumanEntity> = {}): HumanEntity {
  return {
    id: "human",
    facts: [],
    topics: [],
    people: [],
    quotes: [],
    settings: {},
    ...overrides,
  } as HumanEntity;
}

function makeMockStateManager(human: HumanEntity) {
  let stored = human;
  return {
    getHuman: vi.fn(() => stored),
    setHuman: vi.fn((h: HumanEntity) => { stored = h; }),
    messages_get: vi.fn(() => []),
    messages_remove: vi.fn(),
    facts_delete: vi.fn(),
    topics_delete: vi.fn(),
    people_delete: vi.fn(),
    quotes_delete: vi.fn(),
    facts_update: vi.fn(),
    topics_update: vi.fn(),
    people_update: vi.fn(),
    getStoredHuman: vi.fn(() => stored),
  };
}

describe("executeUnsource - generated_documents cleanup", () => {
  it("removes generated_documents[slug] when sourceTag starts with generate:document:", async () => {
    const human = makeHuman({
      settings: {
        document: {
          generated_documents: {
            "test-slug": { subject: "Test Subject", created_at: "2026-01-01T00:00:00Z" },
            "other-slug": { subject: "Other Subject", created_at: "2026-01-02T00:00:00Z" },
          },
        },
      },
    });

    const state = makeMockStateManager(human);

    const preview = {
      sourceTag: "generate:document:test-slug",
      toDelete: { facts: [], topics: [], people: [], quotes: [] },
      toStrip: { facts: [], topics: [], people: [] },
    };

    await executeUnsource(preview, state as any);

    const updated = state.getHuman();
    expect(updated.settings?.document?.generated_documents?.["test-slug"]).toBeUndefined();
    expect(updated.settings?.document?.generated_documents?.["other-slug"]).toBeDefined();
  });

  it("does not touch generated_documents when sourceTag is import:document:", async () => {
    const human = makeHuman({
      settings: {
        document: {
          processed_documents: {
            "myfile.md": { imported_at: "2026-01-01T00:00:00Z", source_tag: "import:document:myfile.md" },
          },
          generated_documents: {
            "keep-me": { subject: "Keep", created_at: "2026-01-01T00:00:00Z" },
          },
        },
      },
    });

    const state = makeMockStateManager(human);

    const preview = {
      sourceTag: "import:document:myfile.md",
      toDelete: { facts: [], topics: [], people: [], quotes: [] },
      toStrip: { facts: [], topics: [], people: [] },
    };

    await executeUnsource(preview, state as any);

    const updated = state.getHuman();
    expect(updated.settings?.document?.processed_documents?.["myfile.md"]).toBeUndefined();
    expect(updated.settings?.document?.generated_documents?.["keep-me"]).toBeDefined();
  });
});
