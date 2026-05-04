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

describe("executeUnsource - processed_documents cleanup", () => {
  it("removes processed_documents[slug] when sourceTag starts with generate:document:", async () => {
    const human = makeHuman({
      settings: {
        document: {
          processed_documents: {
            "test-slug": { created_at: "2026-01-01T00:00:00Z", type: "generated", subject: "Test Subject" },
            "other-slug": { created_at: "2026-01-02T00:00:00Z", type: "generated", subject: "Other Subject" },
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
    expect(updated.settings?.document?.processed_documents?.["test-slug"]).toBeUndefined();
    expect(updated.settings?.document?.processed_documents?.["other-slug"]).toBeDefined();
  });

  it("removes only the targeted import entry, leaving generated entries untouched", async () => {
    const human = makeHuman({
      settings: {
        document: {
          processed_documents: {
            "myfile.md": { created_at: "2026-01-01T00:00:00Z", type: "imported" },
            "keep-me": { created_at: "2026-01-01T00:00:00Z", type: "generated", subject: "Keep" },
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
    expect(updated.settings?.document?.processed_documents?.["keep-me"]).toBeDefined();
  });
});
