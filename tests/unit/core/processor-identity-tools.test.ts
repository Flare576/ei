/**
 * Bolt: signal-ux-bolt-001-native-identity-tools (S4 fix)
 *
 * Covers the missing Processor-level integration oracle Beta's review (S4) identified:
 * `buildPersonaIdentityTools`/executor-registration unit assertions alone don't prove
 * a real `Processor` actually wires the four native identity tools (`get_my_identity`,
 * `edit_trait`, `edit_topic`, `update_description`) into its per-request tool-list
 * assembly, nor that heartbeat requests correctly exclude the three writers, nor that
 * each name resolves to a real registered executor (not "No executor for tool: ...")
 * once `Processor.start()` has run.
 *
 * The tool-list-assembly half mirrors `processor-heartbeat-tool-filter.test.ts`'s own
 * QueueProcessor-mocking seam exactly (same mock shape, same request-driving helper) so
 * this file adds coverage for the new tool names without re-deriving that mechanism.
 * The registration/execution half drives the real (unmocked) `executeToolCalls` against
 * the real module-level executor registry that `Processor.start()` populates.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Processor } from "../../../src/core/processor.js";
import { buildPersonaIdentityTools, executeToolCalls } from "../../../src/core/tools/index.js";
import { LLMNextStep, LLMRequestType, LLMPriority, type LLMRequest, type PersonaEntity, type ToolDefinition, type ToolProvider } from "../../../src/core/types.js";

const startCalls: Array<{ request: LLMRequest; options: { tools?: ToolDefinition[] } }> = [];

vi.mock("../../../src/core/queue-processor.js", () => {
  class MockQueueProcessor {
    start(request: LLMRequest, _callback: unknown, options: { tools?: ToolDefinition[] }) {
      startCalls.push({ request, options });
      // Never invoke the callback — the request stays "processing" so the real
      // runLoop never reclaims or re-dispatches it, and we don't need to model
      // an actual LLM round trip to observe the assembled tool list.
    }
    abort() {}
    getState() {
      return "idle";
    }
  }
  return { QueueProcessor: MockQueueProcessor };
});

// Mock handlers/orchestrators exactly as processor-heartbeat-tool-filter.test.ts does, so
// Processor.start() doesn't attempt real persona generation/extraction work.
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

function createMockStorage() {
  return {
    isAvailable: vi.fn().mockReturnValue(true),
    load: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    moveToBackup: vi.fn().mockResolvedValue(undefined),
    loadBackup: vi.fn().mockResolvedValue(null),
    saveRollingBackup: vi.fn().mockResolvedValue(undefined),
    // checkScheduledTasks() calls drainCorrections() every tick unconditionally, which
    // calls storage.getDataPath() first — "" hits the no-filesystem early return so the
    // drain is a no-op instead of throwing on a missing mock method.
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

/**
 * Drive one Processor through a single queued request and return the full ToolDefinition
 * objects QueueProcessor.start was actually given — not just names — so a test can inspect
 * `builtin`/`config` on the assembled per-request tool list. `stateOverrides` lets a test
 * seed persisted personas/tools/providers (e.g. a legacy custom-tool collision) while every
 * other test keeps the previous empty-state defaults.
 */
async function runRequestAndCaptureToolDefinitions(
  request: LLMRequest,
  stateOverrides: {
    personas?: Record<string, { entity: PersonaEntity; messages: unknown[] }>;
    tools?: ToolDefinition[];
    providers?: ToolProvider[];
  } = {}
): Promise<ToolDefinition[]> {
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
    personas: stateOverrides.personas ?? {},
    queue: [request],
    providers: stateOverrides.providers ?? [],
    tools: stateOverrides.tools ?? [],
    settings: {},
  });

  const processor = new Processor({});
  await processor.start(storage as unknown as Parameters<typeof processor.start>[0]);
  await vi.advanceTimersByTimeAsync(300);
  await processor.stop();

  const matchingCalls = startCalls.filter(call => call.request.id === request.id);
  expect(matchingCalls).toHaveLength(1);
  return matchingCalls[0].options.tools ?? [];
}

function makeTestPersonaEntity(): PersonaEntity {
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
  };
}

describe("Processor identity-tool wiring (S4)", () => {
  describe("per-request tool-list assembly", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      startCalls.length = 0;
      vi.useRealTimers();
    });

    it("a normal HandlePersonaResponse request's assembled tools include all four identity tool names", async () => {
      const names = (
        await runRequestAndCaptureToolDefinitions(
          baseRequest({ next_step: LLMNextStep.HandlePersonaResponse, data: { personaId: "test-persona" } })
        )
      ).map(t => t.name);
      expect(names).toContain("get_my_identity");
      expect(names).toContain("edit_trait");
      expect(names).toContain("edit_topic");
      expect(names).toContain("update_description");
    });

    it("a direct HandleHeartbeatCheck request's assembled tools include get_my_identity but exclude the three writers", async () => {
      const names = (
        await runRequestAndCaptureToolDefinitions(
          baseRequest({ next_step: LLMNextStep.HandleHeartbeatCheck, data: { personaId: "test-persona" } })
        )
      ).map(t => t.name);
      expect(names).toContain("get_my_identity");
      expect(names).not.toContain("edit_trait");
      expect(names).not.toContain("edit_topic");
      expect(names).not.toContain("update_description");
    });

    it("a HandleToolContinuation whose originalNextStep was HandleHeartbeatCheck behaves the same as a direct heartbeat", async () => {
      const names = (
        await runRequestAndCaptureToolDefinitions(
          baseRequest({
            next_step: LLMNextStep.HandleToolContinuation,
            data: { personaId: "test-persona", originalNextStep: LLMNextStep.HandleHeartbeatCheck },
          })
        )
      ).map(t => t.name);
      expect(names).toContain("get_my_identity");
      expect(names).not.toContain("edit_trait");
      expect(names).not.toContain("edit_topic");
      expect(names).not.toContain("update_description");
    });

    it("a HandleToolContinuation whose originalNextStep was HandleEiHeartbeat behaves the same as a direct heartbeat", async () => {
      const names = (
        await runRequestAndCaptureToolDefinitions(
          baseRequest({
            next_step: LLMNextStep.HandleToolContinuation,
            data: { personaId: "ei", originalNextStep: LLMNextStep.HandleEiHeartbeat },
          })
        )
      ).map(t => t.name);
      expect(names).toContain("get_my_identity");
      expect(names).not.toContain("edit_trait");
      expect(names).not.toContain("edit_topic");
      expect(names).not.toContain("update_description");
    });

    it("a legacy persisted custom tool named edit_trait, assigned to the caller persona but config-bound to a different persona, collapses to exactly one native definition bound to the caller", async () => {
      const legacyTool: ToolDefinition = {
        id: "legacy-edit-trait",
        provider_id: "legacy-provider",
        name: "edit_trait",
        display_name: "Legacy Edit Trait",
        description: "A persisted custom tool that happens to share a reserved native name.",
        input_schema: { type: "object", properties: {} },
        runtime: "any",
        builtin: false,
        config: { persona_id: "attacker-persona" },
        enabled: true,
        created_at: new Date(0).toISOString(),
      };
      const legacyToolSnapshot = JSON.parse(JSON.stringify(legacyTool));

      const provider: ToolProvider = {
        id: "legacy-provider",
        name: "legacy-provider",
        display_name: "Legacy Provider",
        builtin: false,
        config: {},
        enabled: true,
        created_at: new Date(0).toISOString(),
      };

      const callerPersona = { ...makeTestPersonaEntity(), tools: ["legacy-edit-trait"] };

      const tools = await runRequestAndCaptureToolDefinitions(
        baseRequest({ next_step: LLMNextStep.HandlePersonaResponse, data: { personaId: "test-persona" } }),
        {
          personas: { "test-persona": { entity: callerPersona, messages: [] } },
          tools: [legacyTool],
          providers: [provider],
        }
      );

      const editTraitDefs = tools.filter(t => t.name === "edit_trait");
      expect(editTraitDefs).toHaveLength(1);
      expect(editTraitDefs[0].builtin).toBe(true);
      expect(editTraitDefs[0].config).toEqual({ persona_id: "test-persona" });

      // Assembly/dedupe reads the persisted legacy record but never mutates it.
      expect(legacyTool).toEqual(legacyToolSnapshot);
    });
  });

  describe("real registration resolves to real executors", () => {
    it("each of the four identity tool names resolves through executeToolCalls to a real executor (not 'No executor') after Processor.start()", async () => {
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
        personas: {
          "test-persona": { entity: makeTestPersonaEntity(), messages: [] },
        },
        queue: [],
        providers: [],
        tools: [],
        settings: {},
      });

      const processor = new Processor({});
      await processor.start(storage as unknown as Parameters<typeof processor.start>[0]);

      const tools = buildPersonaIdentityTools("test-persona");
      const callCounts = new Map<string, number>();
      const totalCalls = { count: 0 };

      const { results: getResults } = await executeToolCalls(
        [{ id: "call-1", name: "get_my_identity", arguments: {} }],
        tools,
        callCounts,
        totalCalls
      );
      expect(getResults[0].error).toBe(false);
      expect(JSON.parse(getResults[0].result)).toMatchObject({ short_description: "Short desc" });

      const { results: traitResults } = await executeToolCalls(
        [{ id: "call-2", name: "edit_trait", arguments: { action: "add", name: "Curious", description: "D", sentiment: 0.5 } }],
        tools,
        callCounts,
        totalCalls
      );
      expect(traitResults[0].error).toBe(false);
      expect(JSON.parse(traitResults[0].result).added).toBe(true);

      const { results: topicResults } = await executeToolCalls(
        [
          {
            id: "call-3",
            name: "edit_topic",
            arguments: {
              action: "add",
              name: "Cooking",
              perspective: "P",
              approach: "A",
              personal_stake: "S",
              sentiment: 0.5,
              exposure_current: 0.5,
              exposure_desired: 0.5,
            },
          },
        ],
        tools,
        callCounts,
        totalCalls
      );
      expect(topicResults[0].error).toBe(false);
      expect(JSON.parse(topicResults[0].result).added).toBe(true);

      const { results: descResults } = await executeToolCalls(
        [{ id: "call-4", name: "update_description", arguments: { short_description: "New Short" } }],
        tools,
        callCounts,
        totalCalls
      );
      expect(descResults[0].error).toBe(false);
      expect(JSON.parse(descResults[0].result)).toEqual({ updated: true, short_description: "New Short" });

      // None of the four calls hit the "No executor for tool" rejection path.
      for (const r of [...getResults, ...traitResults, ...topicResults, ...descResults]) {
        expect(r.error).toBe(false);
        expect(r.result).not.toContain("No executor");
      }

      await processor.stop();
    });
  });
});
