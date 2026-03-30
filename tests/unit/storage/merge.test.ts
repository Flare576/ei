import { describe, it, expect } from "vitest";
import { yoloMerge } from "../../../src/storage/merge.js";
import { ProviderType } from "../../../src/core/types/enums.js";
import type { StorageState, ToolProvider, ToolDefinition } from "../../../src/core/types.js";
import type { ProviderAccount, ModelConfig, HumanEntity } from "../../../src/core/types/entities.js";

function makeHuman(overrides: Partial<HumanEntity> = {}): HumanEntity {
  return {
    entity: "human",
    facts: [],
    topics: [],
    people: [],
    quotes: [],
    last_updated: "2024-01-01T00:00:00.000Z",
    last_activity: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeState(overrides: Partial<StorageState> = {}): StorageState {
  return {
    version: 1,
    timestamp: "2024-01-01T00:00:00.000Z",
    human: makeHuman(),
    personas: {},
    queue: [],
    providers: [],
    tools: [],
    ...overrides,
  };
}

function makeAccount(overrides: Partial<ProviderAccount> = {}): ProviderAccount {
  return {
    id: crypto.randomUUID(),
    name: "TestProvider",
    type: ProviderType.LLM,
    url: "https://api.example.com",
    created_at: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeModel(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: crypto.randomUUID(),
    name: "test-model",
    ...overrides,
  };
}

function makeToolProvider(name: string): ToolProvider {
  return {
    id: crypto.randomUUID(),
    name,
    display_name: name,
    builtin: false,
    config: {},
    enabled: true,
    created_at: "2024-01-01T00:00:00.000Z",
  };
}

function makeToolDefinition(name: string, providerId: string): ToolDefinition {
  return {
    id: crypto.randomUUID(),
    provider_id: providerId,
    name,
    display_name: name,
    description: `Tool: ${name}`,
    input_schema: {},
    runtime: "any",
    builtin: false,
    enabled: true,
    created_at: "2024-01-01T00:00:00.000Z",
  };
}

/** Build a pair of states for merge testing. preferRemote controls timestamp ordering. */
function pairWithAccounts(
  localAccounts: ProviderAccount[],
  remoteAccounts: ProviderAccount[],
  preferRemote = true,
): { local: StorageState; remote: StorageState } {
  const local = makeState({
    timestamp: preferRemote ? "2024-01-01T00:00:00.000Z" : "2024-06-01T00:00:00.000Z",
    human: makeHuman({ settings: { accounts: localAccounts } }),
  });
  const remote = makeState({
    timestamp: preferRemote ? "2024-06-01T00:00:00.000Z" : "2024-01-01T00:00:00.000Z",
    human: makeHuman({ settings: { accounts: remoteAccounts } }),
  });
  return { local, remote };
}

function getAccounts(result: StorageState): ProviderAccount[] {
  return result.human.settings?.accounts ?? [];
}

describe("yoloMerge() — ProviderAccount (ID-based)", () => {
  it("test 1: same-ID providers merge model counters using max-value", () => {
    const sharedId = "aaaaaaaa-0000-0000-0000-000000000001";
    const modelId = "bbbbbbbb-0000-0000-0000-000000000001";

    const localModel = makeModel({ id: modelId, name: "gpt-4o", total_calls: 10, total_tokens_in: 1000, total_tokens_out: 500 });
    const remoteModel = makeModel({ id: modelId, name: "gpt-4o", total_calls: 5, total_tokens_in: 2000, total_tokens_out: 300 });

    const localAccount = makeAccount({ id: sharedId, name: "OpenAI", models: [localModel] });
    const remoteAccount = makeAccount({ id: sharedId, name: "OpenAI", models: [remoteModel] });

    const { local, remote } = pairWithAccounts([localAccount], [remoteAccount]);
    const result = yoloMerge(local, remote);
    const accounts = getAccounts(result);

    expect(accounts).toHaveLength(1);
    const model = accounts[0].models![0];
    // max of 10 vs 5 = 10; max of 1000 vs 2000 = 2000; max of 500 vs 300 = 500
    expect(model.total_calls).toBe(10);
    expect(model.total_tokens_in).toBe(2000);
    expect(model.total_tokens_out).toBe(500);
  });

  it("test 2: local counter higher → local counter wins", () => {
    const sharedId = "aaaaaaaa-0000-0000-0000-000000000002";
    const modelId = "bbbbbbbb-0000-0000-0000-000000000002";

    const localModel = makeModel({ id: modelId, total_calls: 100, total_tokens_in: 5000, total_tokens_out: 2000 });
    const remoteModel = makeModel({ id: modelId, total_calls: 5, total_tokens_in: 100, total_tokens_out: 50 });

    const { local, remote } = pairWithAccounts(
      [makeAccount({ id: sharedId, models: [localModel] })],
      [makeAccount({ id: sharedId, models: [remoteModel] })],
    );

    const result = yoloMerge(local, remote);
    const model = getAccounts(result)[0].models![0];

    expect(model.total_calls).toBe(100);
    expect(model.total_tokens_in).toBe(5000);
    expect(model.total_tokens_out).toBe(2000);
  });

  it("test 3: remote counter higher → remote counter wins", () => {
    const sharedId = "aaaaaaaa-0000-0000-0000-000000000003";
    const modelId = "bbbbbbbb-0000-0000-0000-000000000003";

    const localModel = makeModel({ id: modelId, total_calls: 5, total_tokens_in: 100, total_tokens_out: 50 });
    const remoteModel = makeModel({ id: modelId, total_calls: 200, total_tokens_in: 9000, total_tokens_out: 4000 });

    const { local, remote } = pairWithAccounts(
      [makeAccount({ id: sharedId, models: [localModel] })],
      [makeAccount({ id: sharedId, models: [remoteModel] })],
    );

    const result = yoloMerge(local, remote);
    const model = getAccounts(result)[0].models![0];

    expect(model.total_calls).toBe(200);
    expect(model.total_tokens_in).toBe(9000);
    expect(model.total_tokens_out).toBe(4000);
  });

  it("test 4: different provider IDs → both kept (duplicates accepted)", () => {
    const localAccount = makeAccount({ id: "aaaaaaaa-0000-0000-0000-000000000004", name: "OpenAI" });
    const remoteAccount = makeAccount({ id: "bbbbbbbb-0000-0000-0000-000000000004", name: "OpenAI" }); // same name, different ID

    const { local, remote } = pairWithAccounts([localAccount], [remoteAccount]);
    const result = yoloMerge(local, remote);
    const accounts = getAccounts(result);

    expect(accounts).toHaveLength(2);
    const ids = accounts.map(a => a.id);
    expect(ids).toContain("aaaaaaaa-0000-0000-0000-000000000004");
    expect(ids).toContain("bbbbbbbb-0000-0000-0000-000000000004");
  });

  it("test 7: remote has models[], local has none → remote models added to merged provider", () => {
    const sharedId = "aaaaaaaa-0000-0000-0000-000000000007";
    const remoteModel = makeModel({ id: "bbbbbbbb-0000-0000-0000-000000000007", name: "claude-opus-4", total_calls: 42 });

    const localAccount = makeAccount({ id: sharedId, models: undefined });
    const remoteAccount = makeAccount({ id: sharedId, models: [remoteModel] });

    const { local, remote } = pairWithAccounts([localAccount], [remoteAccount]);
    const result = yoloMerge(local, remote);
    const accounts = getAccounts(result);

    expect(accounts).toHaveLength(1);
    expect(accounts[0].models).toHaveLength(1);
    expect(accounts[0].models![0].name).toBe("claude-opus-4");
    expect(accounts[0].models![0].total_calls).toBe(42);
  });

  it("test 8: local has models[], remote has none → local models preserved", () => {
    const sharedId = "aaaaaaaa-0000-0000-0000-000000000008";
    const localModel = makeModel({ id: "bbbbbbbb-0000-0000-0000-000000000008", name: "gpt-4o", total_calls: 77 });

    const localAccount = makeAccount({ id: sharedId, models: [localModel] });
    const remoteAccount = makeAccount({ id: sharedId, models: undefined });

    const { local, remote } = pairWithAccounts([localAccount], [remoteAccount]);
    const result = yoloMerge(local, remote);
    const accounts = getAccounts(result);

    expect(accounts).toHaveLength(1);
    expect(accounts[0].models).toHaveLength(1);
    expect(accounts[0].models![0].name).toBe("gpt-4o");
    expect(accounts[0].models![0].total_calls).toBe(77);
  });

  it("test 9: remote has extra model local is missing → both models in result", () => {
    const sharedId = "aaaaaaaa-0000-0000-0000-000000000009";
    const sharedModelId = "bbbbbbbb-0000-0000-0000-000000000009";
    const extraModelId = "cccccccc-0000-0000-0000-000000000009";

    const sharedModel = makeModel({ id: sharedModelId, name: "gpt-4o" });
    const extraModel = makeModel({ id: extraModelId, name: "gpt-4-turbo" });

    const localAccount = makeAccount({ id: sharedId, models: [sharedModel] });
    const remoteAccount = makeAccount({ id: sharedId, models: [sharedModel, extraModel] });

    const { local, remote } = pairWithAccounts([localAccount], [remoteAccount]);
    const result = yoloMerge(local, remote);
    const accounts = getAccounts(result);

    expect(accounts).toHaveLength(1);
    expect(accounts[0].models).toHaveLength(2);
    const modelNames = accounts[0].models!.map(m => m.name);
    expect(modelNames).toContain("gpt-4o");
    expect(modelNames).toContain("gpt-4-turbo");
  });

  it("test 10: last_used comes from whichever side has higher total_calls", () => {
    const sharedId = "aaaaaaaa-0000-0000-0000-000000000010";
    const modelId = "bbbbbbbb-0000-0000-0000-000000000010";

    // Local: higher total_calls but older last_used
    const localModel = makeModel({
      id: modelId,
      total_calls: 500,
      last_used: "2024-01-15T00:00:00.000Z",
    });
    // Remote: lower total_calls but newer last_used (e.g., one sync'd call)
    const remoteModel = makeModel({
      id: modelId,
      total_calls: 10,
      last_used: "2025-06-01T00:00:00.000Z",
    });

    const { local, remote } = pairWithAccounts(
      [makeAccount({ id: sharedId, models: [localModel] })],
      [makeAccount({ id: sharedId, models: [remoteModel] })],
    );

    const result = yoloMerge(local, remote);
    const model = getAccounts(result)[0].models![0];

    // Local has higher total_calls (500 > 10) → local's last_used wins
    expect(model.last_used).toBe("2024-01-15T00:00:00.000Z");
    // But counter takes max
    expect(model.total_calls).toBe(500);
  });

  it("test 10b: last_used from remote when remote has higher total_calls", () => {
    const sharedId = "aaaaaaaa-0000-0000-0000-000000000011";
    const modelId = "bbbbbbbb-0000-0000-0000-000000000011";

    const localModel = makeModel({
      id: modelId,
      total_calls: 3,
      last_used: "2023-01-01T00:00:00.000Z",
    });
    const remoteModel = makeModel({
      id: modelId,
      total_calls: 999,
      last_used: "2025-12-01T00:00:00.000Z",
    });

    const { local, remote } = pairWithAccounts(
      [makeAccount({ id: sharedId, models: [localModel] })],
      [makeAccount({ id: sharedId, models: [remoteModel] })],
    );

    const result = yoloMerge(local, remote);
    const model = getAccounts(result)[0].models![0];

    // Remote has higher total_calls (999 > 3) → remote's last_used wins
    expect(model.last_used).toBe("2025-12-01T00:00:00.000Z");
    expect(model.total_calls).toBe(999);
  });

  it("test: non-counter fields (context_window, max_output_tokens) use preferRemote logic", () => {
    const sharedId = "aaaaaaaa-0000-0000-0000-000000000012";
    const modelId = "bbbbbbbb-0000-0000-0000-000000000012";

    const localModel = makeModel({ id: modelId, context_window: 32000, max_output_tokens: 2000 });
    const remoteModel = makeModel({ id: modelId, context_window: 128000, max_output_tokens: 8000 });

    // preferRemote=true: remote timestamp is newer
    const { local, remote } = pairWithAccounts(
      [makeAccount({ id: sharedId, models: [localModel] })],
      [makeAccount({ id: sharedId, models: [remoteModel] })],
      true,
    );

    const result = yoloMerge(local, remote);
    const model = getAccounts(result)[0].models![0];

    // preferRemote=true → remote's non-counter values win
    expect(model.context_window).toBe(128000);
    expect(model.max_output_tokens).toBe(8000);
  });

  it("test: non-counter fields kept local when preferRemote=false", () => {
    const sharedId = "aaaaaaaa-0000-0000-0000-000000000013";
    const modelId = "bbbbbbbb-0000-0000-0000-000000000013";

    const localModel = makeModel({ id: modelId, context_window: 32000, max_output_tokens: 2000 });
    const remoteModel = makeModel({ id: modelId, context_window: 128000, max_output_tokens: 8000 });

    // preferRemote=false: local timestamp is newer
    const { local, remote } = pairWithAccounts(
      [makeAccount({ id: sharedId, models: [localModel] })],
      [makeAccount({ id: sharedId, models: [remoteModel] })],
      false,
    );

    const result = yoloMerge(local, remote);
    const model = getAccounts(result)[0].models![0];

    // preferRemote=false → local's non-counter values kept
    expect(model.context_window).toBe(32000);
    expect(model.max_output_tokens).toBe(2000);
  });
});

describe("yoloMerge() — ToolProvider and ToolDefinition (name-based, unchanged)", () => {
  it("test 5: ToolProvider merge is still name-based (same name replaces when preferRemote)", () => {
    const localProvider = makeToolProvider("brave");
    const remoteProvider = { ...makeToolProvider("brave"), display_name: "Brave Search UPDATED" };

    const local = makeState({ providers: [localProvider] });
    const remote = makeState({
      timestamp: "2025-01-01T00:00:00.000Z",  // newer → preferRemote=true
      providers: [remoteProvider],
    });
    local.timestamp = "2024-01-01T00:00:00.000Z";

    const result = yoloMerge(local, remote);

    expect(result.providers).toHaveLength(1);
    expect(result.providers[0].name).toBe("brave");
    expect(result.providers[0].display_name).toBe("Brave Search UPDATED");
  });

  it("test 5b: ToolProvider with different names both kept", () => {
    const localProvider = makeToolProvider("brave");
    const remoteProvider = makeToolProvider("tavily");

    const local = makeState({ timestamp: "2024-01-01T00:00:00.000Z", providers: [localProvider] });
    const remote = makeState({ timestamp: "2025-01-01T00:00:00.000Z", providers: [remoteProvider] });

    const result = yoloMerge(local, remote);

    expect(result.providers).toHaveLength(2);
    const names = result.providers.map(p => p.name);
    expect(names).toContain("brave");
    expect(names).toContain("tavily");
  });

  it("test 6: ToolDefinition merge is still name-based (same name replaces when preferRemote)", () => {
    const providerId = crypto.randomUUID();
    const localTool = makeToolDefinition("web_search", providerId);
    const remoteTool = { ...makeToolDefinition("web_search", providerId), description: "UPDATED description" };

    const local = makeState({ timestamp: "2024-01-01T00:00:00.000Z", tools: [localTool] });
    const remote = makeState({ timestamp: "2025-01-01T00:00:00.000Z", tools: [remoteTool] });

    const result = yoloMerge(local, remote);

    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe("web_search");
    expect(result.tools[0].description).toBe("UPDATED description");
  });

  it("test 6b: ToolDefinition with different names both kept", () => {
    const providerId = crypto.randomUUID();
    const localTool = makeToolDefinition("web_search", providerId);
    const remoteTool = makeToolDefinition("news_search", providerId);

    const local = makeState({ timestamp: "2024-01-01T00:00:00.000Z", tools: [localTool] });
    const remote = makeState({ timestamp: "2025-01-01T00:00:00.000Z", tools: [remoteTool] });

    const result = yoloMerge(local, remote);

    expect(result.tools).toHaveLength(2);
    const names = result.tools.map(t => t.name);
    expect(names).toContain("web_search");
    expect(names).toContain("news_search");
  });
});
