import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PersonaEntity, HumanEntity, Message } from "../../../src/core/types.js";
import { ContextStatus } from "../../../src/core/types.js";

vi.mock("../../../src/core/embedding-service.js", () => ({
  getEmbeddingService: vi.fn().mockResolvedValue({
    embed: vi.fn().mockResolvedValue(new Float32Array(384)),
  }),
  findTopK: vi.fn().mockReturnValue([]),
}));

import { buildResponsePromptData } from "../../../src/core/prompt-context-builder.js";

const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();
const HOUR = 60 * 60 * 1000;
const WINDOW_MS = 8 * HOUR;

function makeMessage(id: string, timestampMs: number, status: ContextStatus = ContextStatus.Default): Message {
  return {
    id,
    role: "human",
    content: `content of ${id}`,
    timestamp: new Date(timestampMs).toISOString(),
    read: true,
    context_status: status,
  };
}

function makePersona(overrides: Partial<PersonaEntity> = {}): PersonaEntity {
  return {
    id: "p1",
    entity: "system",
    display_name: "TestPersona",
    aliases: [],
    short_description: "test",
    long_description: "test persona",
    traits: [],
    topics: [],
    facts: [],
    people: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: new Date().toISOString(),
    last_heartbeat: new Date().toISOString(),
    heartbeat_delay_ms: 999999999,
    context_window_ms: WINDOW_MS,
    ...overrides,
  };
}

function makeHuman(): HumanEntity {
  return {
    entity: "human",
    facts: [],
    topics: [],
    people: [],
    quotes: [],
    last_updated: new Date().toISOString(),
    settings: {},
  };
}

function makeSM(persona: PersonaEntity, messages: Message[]) {
  const alwaysMessages = messages.filter(m => m.context_status === ContextStatus.Always);
  return {
    persona_getById: vi.fn(() => persona),
    getHuman: vi.fn(() => makeHuman()),
    messages_get: vi.fn(() => messages),
    messages_getAlways: vi.fn(() => alwaysMessages),
    persona_getAll: vi.fn(() => [persona]),
  };
}

describe("buildResponsePromptData — temporal_anchors", () => {
  beforeEach(() => vi.clearAllMocks());

  it("includes an always message outside the context window as a temporal anchor", async () => {
    const persona = makePersona();
    const oldAlways = makeMessage("old-always", Date.now() - 24 * HOUR, ContextStatus.Always);
    const sm = makeSM(persona, [oldAlways]);

    const result = await buildResponsePromptData(sm as any, persona, false);

    expect(result.temporal_anchors).toHaveLength(1);
    expect(result.temporal_anchors[0].id).toBe("old-always");
  });

  it("does NOT include an always message within the context window as a temporal anchor", async () => {
    const persona = makePersona();
    const recentAlways = makeMessage("recent-always", Date.now() - 1 * HOUR, ContextStatus.Always);
    const sm = makeSM(persona, [recentAlways]);

    const result = await buildResponsePromptData(sm as any, persona, false);

    expect(result.temporal_anchors).toHaveLength(0);
  });

  it("anchors always messages before context_boundary regardless of window", async () => {
    const boundaryTs = ago(2 * HOUR);
    const persona = makePersona({ context_boundary: boundaryTs });
    const beforeBoundary = makeMessage("before-boundary", Date.now() - 4 * HOUR, ContextStatus.Always);
    const afterBoundary = makeMessage("after-boundary", Date.now() - 1 * HOUR, ContextStatus.Always);
    const sm = makeSM(persona, [beforeBoundary, afterBoundary]);

    const result = await buildResponsePromptData(sm as any, persona, false);

    const anchorIds = result.temporal_anchors.map(a => a.id);
    expect(anchorIds).toContain("before-boundary");
    expect(anchorIds).not.toContain("after-boundary");
  });

  it("returns no temporal anchors when all always messages are within the window", async () => {
    const persona = makePersona();
    const m1 = makeMessage("a1", Date.now() - 1 * HOUR, ContextStatus.Always);
    const m2 = makeMessage("a2", Date.now() - 2 * HOUR, ContextStatus.Always);
    const sm = makeSM(persona, [m1, m2]);

    const result = await buildResponsePromptData(sm as any, persona, false);

    expect(result.temporal_anchors).toHaveLength(0);
  });

  it("returns no temporal anchors when there are no always messages at all", async () => {
    const persona = makePersona();
    const m1 = makeMessage("d1", Date.now() - 1 * HOUR, ContextStatus.Default);
    const sm = makeSM(persona, [m1]);

    const result = await buildResponsePromptData(sm as any, persona, false);

    expect(result.temporal_anchors).toHaveLength(0);
  });

  it("splits correctly when some always messages are in-window and some are out", async () => {
    const persona = makePersona();
    const inWindow = makeMessage("in-window", Date.now() - 1 * HOUR, ContextStatus.Always);
    const outOfWindow = makeMessage("out-of-window", Date.now() - 48 * HOUR, ContextStatus.Always);
    const sm = makeSM(persona, [inWindow, outOfWindow]);

    const result = await buildResponsePromptData(sm as any, persona, false);

    const anchorIds = result.temporal_anchors.map(a => a.id);
    expect(anchorIds).toContain("out-of-window");
    expect(anchorIds).not.toContain("in-window");
  });
});
