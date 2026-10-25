/**
 * Rooms never give a Persona a `write` tool. When a request is HandleRoomResponse (or a
 * HandleToolContinuation whose originalNextStep is HandleRoomResponse, on any round), the
 * tool list handed to QueueProcessor.start keeps only `kind === "read"` tools. Deny by
 * default: a tool with no `kind` is excluded. 1:1 and heartbeat lists are unchanged.
 *
 * QueueProcessor is mocked to capture the exact `tools` array passed to `.start()`, using
 * the same seam as processor-heartbeat-tool-filter.test.ts / processor-identity-tools.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("zod", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    z: (actual.z ?? actual.default ?? actual) as Record<string, unknown>,
  };
});
import { Processor } from "../../../src/core/processor.js";
import { filterToolsForRoom } from "../../../src/core/tools/room-filter.js";
import {
  SYSTEM_TOOLS,
  buildPersonaNoteTools,
  buildPersonaIdentityTools,
  buildResolveSignalTool,
} from "../../../src/core/tools/index.js";
import {
  LLMNextStep,
  LLMRequestType,
  LLMPriority,
  type LLMRequest,
  type PersonaEntity,
  type ToolDefinition,
  type ToolProvider,
} from "../../../src/core/types.js";

const startCalls: Array<{ request: LLMRequest; options: { tools?: ToolDefinition[] } }> = [];

vi.mock("../../../src/core/queue-processor.js", () => {
  class MockQueueProcessor {
    start(request: LLMRequest, _callback: unknown, options: { tools?: ToolDefinition[] }) {
      startCalls.push({ request, options });
    }
    abort() {}
    getState() {
      return "idle";
    }
  }
  return { QueueProcessor: MockQueueProcessor };
});

vi.mock("../../../src/core/handlers/index.js", () => ({
  handlers: {
    handlePersonaResponse: vi.fn(),
    handleRoomResponse: vi.fn(),
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

const WRITE_BUILTINS = [
  "add_note",
  "clear_note",
  "edit_topic",
  "edit_trait",
  "resolve_signal",
  "update_description",
];

function createMockStorage() {
  return {
    isAvailable: vi.fn().mockReturnValue(true),
    load: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    moveToBackup: vi.fn().mockResolvedValue(undefined),
    loadBackup: vi.fn().mockResolvedValue(null),
    saveRollingBackup: vi.fn().mockResolvedValue(undefined),
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

function customTool(name: string, extra: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    id: `id-${name}`,
    provider_id: "custom-provider",
    name,
    display_name: name,
    description: name,
    input_schema: { type: "object", properties: {} },
    runtime: "any",
    builtin: false,
    enabled: true,
    created_at: new Date(0).toISOString(),
    ...extra,
  };
}

const PERSISTED_TOOLS: ToolDefinition[] = [
  customTool("custom_read", { kind: "read" }),
  customTool("custom_write", { kind: "write" }),
  customTool("custom_unclassified"),
  customTool("submit_response", { kind: "read", is_submit: true, builtin: true }),
];

const PROVIDER: ToolProvider = {
  id: "custom-provider",
  name: "custom-provider",
  display_name: "Custom",
  builtin: false,
  config: {},
  enabled: true,
  created_at: new Date(0).toISOString(),
};

function makePersona(): PersonaEntity {
  return {
    id: "test-persona",
    display_name: "TestPersona",
    entity: "system",
    aliases: ["TestPersona"],
    short_description: "Short desc",
    long_description: "Long desc",
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: new Date().toISOString(),
    tools: PERSISTED_TOOLS.map(t => t.id),
  };
}

async function runAndCaptureNames(request: LLMRequest): Promise<string[]> {
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
    personas: { "test-persona": { entity: makePersona(), messages: [] } },
    queue: [request],
    providers: [PROVIDER],
    tools: PERSISTED_TOOLS,
    settings: {},
  });

  const processor = new Processor({});
  await processor.start(storage as unknown as Parameters<typeof processor.start>[0]);
  await vi.advanceTimersByTimeAsync(300);
  await processor.stop();

  const matching = startCalls.filter(c => c.request.id === request.id);
  expect(matching).toHaveLength(1);
  return (matching[0].options.tools ?? []).map(t => t.name);
}

describe("filterToolsForRoom", () => {
  const all = [
    ...SYSTEM_TOOLS,
    ...buildPersonaNoteTools("p"),
    ...buildPersonaIdentityTools("p"),
    ...buildResolveSignalTool("p"),
  ];

  it("drops every write built-in and keeps every read built-in", () => {
    const names = filterToolsForRoom(all).map(t => t.name);
    for (const w of WRITE_BUILTINS) expect(names).not.toContain(w);
    for (const t of all.filter(t => t.kind === "read")) expect(names).toContain(t.name);
    expect(names).toContain("find_memory");
    expect(names).toContain("get_my_identity");
  });

  it("is deny-by-default: a tool with no kind is excluded", () => {
    const names = filterToolsForRoom([customTool("no_kind"), customTool("r", { kind: "read" })]).map(t => t.name);
    expect(names).toEqual(["r"]);
  });

  it("ignores heartbeat_eligible (separate axis) and does not mutate its input", () => {
    const input = [
      customTool("write_but_eligible", { kind: "write", heartbeat_eligible: true }),
      customTool("read_but_ineligible", { kind: "read", heartbeat_eligible: false }),
    ];
    const snapshot = [...input];
    expect(filterToolsForRoom(input).map(t => t.name)).toEqual(["read_but_ineligible"]);
    expect(input).toEqual(snapshot);
  });
});

describe("Processor room tool-list assembly", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    startCalls.length = 0;
    vi.useRealTimers();
  });

  it("HandleRoomResponse excludes every write built-in and any write/unclassified custom tool, keeps read tools", async () => {
    const names = await runAndCaptureNames(baseRequest({ next_step: LLMNextStep.HandleRoomResponse }));
    for (const w of [...WRITE_BUILTINS, "custom_write", "custom_unclassified"]) {
      expect(names).not.toContain(w);
    }
    expect(names).toContain("find_memory");
    expect(names).toContain("get_my_identity");
    expect(names).toContain("custom_read");
  });

  it("HandleRoomResponse still carries a granted submit tool (infrastructure, kind read)", async () => {
    const names = await runAndCaptureNames(baseRequest({ next_step: LLMNextStep.HandleRoomResponse }));
    expect(names).toContain("submit_response");
  });

  it("a room HandleToolContinuation (any round) stays write-free", async () => {
    const names = await runAndCaptureNames(
      baseRequest({
        next_step: LLMNextStep.HandleToolContinuation,
        data: { personaId: "test-persona", originalNextStep: LLMNextStep.HandleRoomResponse, toolHistory: [] },
      })
    );
    for (const w of [...WRITE_BUILTINS, "custom_write", "custom_unclassified"]) {
      expect(names).not.toContain(w);
    }
    expect(names).toContain("find_memory");
  });

  it("1:1 HandlePersonaResponse keeps its write built-ins and custom tools (unchanged)", async () => {
    const names = await runAndCaptureNames(baseRequest({ next_step: LLMNextStep.HandlePersonaResponse }));
    for (const w of [...WRITE_BUILTINS, "custom_write", "custom_unclassified", "custom_read"]) {
      expect(names).toContain(w);
    }
  });

  it("a 1:1 HandleToolContinuation keeps its write built-ins (unchanged)", async () => {
    const names = await runAndCaptureNames(
      baseRequest({
        next_step: LLMNextStep.HandleToolContinuation,
        data: { personaId: "test-persona", originalNextStep: LLMNextStep.HandlePersonaResponse, toolHistory: [] },
      })
    );
    for (const w of WRITE_BUILTINS) expect(names).toContain(w);
  });
});
