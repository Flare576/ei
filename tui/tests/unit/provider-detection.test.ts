import { test, expect, describe } from "bun:test";
import {
  selectModelsForProvider,
  detectProviders,
  buildProviderAccounts,
  ALL_PROVIDER_NAMES,
  KNOWN_MODEL_LIMITS,
} from "../../src/util/provider-detection";

describe("selectModelsForProvider — Anthropic", () => {
  const anthropicModels = [
    "claude-haiku-4-0",
    "claude-haiku-4-5",
    "claude-sonnet-4-0",
    "claude-sonnet-4-5",
    "claude-opus-4",
  ];

  test("selects latest haiku as extraction model", () => {
    const result = selectModelsForProvider("Anthropic", anthropicModels);
    expect(result.extractionModel).toBe("claude-haiku-4-5");
  });

  test("selects latest sonnet as chat model", () => {
    const result = selectModelsForProvider("Anthropic", anthropicModels);
    expect(result.chatModel).toBe("claude-sonnet-4-5");
  });

  test("selects opus as bonus model", () => {
    const result = selectModelsForProvider("Anthropic", anthropicModels);
    expect(result.bonusModel).toBe("claude-opus-4");
  });

  test("case-insensitive matching for provider name", () => {
    const result = selectModelsForProvider("ANTHROPIC", anthropicModels);
    expect(result.extractionModel).toBe("claude-haiku-4-5");
  });
});

describe("selectModelsForProvider — latest selection (numeric descending)", () => {
  test("multiple haiku versions — picks latest by numeric sort desc", () => {
    const models = ["claude-haiku-3", "claude-haiku-4-5", "claude-haiku-4-0"];
    const result = selectModelsForProvider("Anthropic", models);
    expect(result.extractionModel).toBe("claude-haiku-4-5");
  });

  test("numeric sort: 4-6 beats 4-5 alphabetically ambiguous case", () => {
    const models = ["claude-sonnet-4-5-20250929", "claude-sonnet-4-6"];
    const result = selectModelsForProvider("Anthropic", models);
    expect(result.chatModel).toBe("claude-sonnet-4-6");
  });

  test("single haiku version — selects it", () => {
    const models = ["claude-haiku-4-5", "claude-sonnet-4-5"];
    const result = selectModelsForProvider("Anthropic", models);
    expect(result.extractionModel).toBe("claude-haiku-4-5");
  });

  test("no haiku in list — falls back to first model", () => {
    const models = ["claude-sonnet-4-5", "claude-opus-4"];
    const result = selectModelsForProvider("Anthropic", models);
    expect(result.extractionModel).toBe("claude-sonnet-4-5");
  });

  test("no opus in list — bonusModel is undefined", () => {
    const models = ["claude-haiku-4-5", "claude-sonnet-4-5"];
    const result = selectModelsForProvider("Anthropic", models);
    expect(result.bonusModel).toBeUndefined();
  });
});

describe("selectModelsForProvider — Groq hardcoded", () => {
  test("returns hardcoded extraction model regardless of /models response", () => {
    const result = selectModelsForProvider("Groq", ["some-model", "other-model"]);
    expect(result.extractionModel).toBe("llama-3.1-8b-instant");
  });

  test("returns hardcoded chat model regardless of /models response", () => {
    const result = selectModelsForProvider("Groq", ["some-model", "other-model"]);
    expect(result.chatModel).toBe("llama-3.3-70b-versatile");
  });

  test("hardcoded even with empty model list", () => {
    const result = selectModelsForProvider("Groq", []);
    expect(result.extractionModel).toBe("llama-3.1-8b-instant");
    expect(result.chatModel).toBe("llama-3.3-70b-versatile");
  });

  test("no bonus model for Groq", () => {
    const result = selectModelsForProvider("Groq", ["llama-3.1-8b-instant"]);
    expect(result.bonusModel).toBeUndefined();
  });
});

describe("selectModelsForProvider — empty model list", () => {
  test("Anthropic with empty list — graceful fallback, no crash", () => {
    const result = selectModelsForProvider("Anthropic", []);
    expect(result.extractionModel).toBe("default");
    expect(result.chatModel).toBe("default");
  });

  test("OpenAI with empty list — graceful fallback", () => {
    const result = selectModelsForProvider("OpenAI", []);
    expect(result.extractionModel).toBe("default");
    expect(result.chatModel).toBe("default");
  });

  test("Mistral with empty list — graceful fallback", () => {
    const result = selectModelsForProvider("Mistral", []);
    expect(result.extractionModel).toBe("default");
    expect(result.chatModel).toBe("default");
  });

  test("Gemini with empty list — graceful fallback", () => {
    const result = selectModelsForProvider("Gemini", []);
    expect(result.extractionModel).toBe("default");
    expect(result.chatModel).toBe("default");
  });
});

describe("selectModelsForProvider — OpenAI", () => {
  const realWorldModels = [
    "gpt-4o", "gpt-4o-mini", "gpt-4o-2024-11-20",
    "tts-1", "dall-e-3", "whisper-1", "text-embedding-ada-002",
    "gpt-4.1", "gpt-4.1-mini", "gpt-5", "gpt-5-mini",
    "o3", "o4-mini", "gpt-3.5-turbo",
  ];

  test("selects a mini model as extraction", () => {
    const result = selectModelsForProvider("OpenAI", realWorldModels);
    expect(result.extractionModel.toLowerCase()).toContain("mini");
  });

  test("selects a non-mini chat model", () => {
    const result = selectModelsForProvider("OpenAI", realWorldModels);
    expect(result.chatModel.toLowerCase()).not.toContain("mini");
  });

  test("drops non-chat models (tts, dall-e, whisper, embeddings)", () => {
    const result = selectModelsForProvider("OpenAI", realWorldModels);
    expect(result.chatModel).not.toMatch(/tts|dall-e|whisper|embedding/i);
    expect(result.extractionModel).not.toMatch(/tts|dall-e|whisper|embedding/i);
  });
});

describe("selectModelsForProvider — Mistral", () => {
  test("selects small as extraction, large as chat", () => {
    const models = ["mistral-small-2501", "mistral-large-2411"];
    const result = selectModelsForProvider("Mistral", models);
    expect(result.extractionModel).toBe("mistral-small-2501");
    expect(result.chatModel).toBe("mistral-large-2411");
  });
});

describe("selectModelsForProvider — Gemini", () => {
  const realWorldModels = [
    "models/gemini-2.5-flash", "models/gemini-2.5-pro",
    "models/gemini-2.0-flash", "models/gemini-2.0-flash-001",
    "models/gemini-embedding-001", "models/imagen-4.0-generate-001",
    "models/veo-3.0-generate-001", "models/lyria-3-pro-preview",
    "models/gemini-2.5-flash-preview-tts", "models/gemini-robotics-er-1.5-preview",
    "models/gemma-4-26b-a4b-it", "models/aqa",
  ];

  test("selects latest flash as extraction", () => {
    const result = selectModelsForProvider("Gemini", realWorldModels);
    expect(result.extractionModel.toLowerCase()).toContain("flash");
    expect(result.extractionModel).not.toMatch(/tts|embedding|imagen|veo|lyria|robotics/i);
  });

  test("selects latest pro as chat", () => {
    const result = selectModelsForProvider("Gemini", realWorldModels);
    expect(result.chatModel.toLowerCase()).toContain("pro");
    expect(result.chatModel).not.toMatch(/tts|embedding|imagen|veo|lyria|robotics/i);
  });

  test("drops non-chat models (embedding, imagen, veo, lyria, tts, robotics)", () => {
    const result = selectModelsForProvider("Gemini", realWorldModels);
    for (const model of [result.chatModel, result.extractionModel]) {
      expect(model).not.toMatch(/embedding|imagen|veo|lyria|robotics|gemma/i);
    }
  });
});

describe("detectProviders — mock fetch integration", () => {
  const anthropicModels = {
    data: [
      { id: "claude-haiku-4-5" },
      { id: "claude-sonnet-4-5" },
      { id: "claude-opus-4" },
    ],
  };

  function makeMockFetch(
    responses: Record<string, { ok: boolean; body?: unknown }>
  ) {
    return async (url: string): Promise<Response> => {
      const key = Object.keys(responses).find((k) => url.includes(k));
      if (!key) throw new Error(`No mock for ${url}`);
      const resp = responses[key];
      return {
        ok: resp.ok,
        json: async () => resp.body ?? {},
      } as Response;
    };
  }

  test("ANTHROPIC_API_KEY set + 200 → provider detected with correct models", async () => {
    const mockFetch = makeMockFetch({
      "api.anthropic.com": { ok: true, body: anthropicModels },
    });

    const { detected, statuses } = await detectProviders(
      {
        skipLocalDetect: true,
        env: { ANTHROPIC_API_KEY: "sk-test-key" },
      },
      mockFetch
    );

    expect(detected).toHaveLength(1);
    expect(detected[0].name).toBe("Anthropic");
    expect(detected[0].selected.extractionModel).toBe("claude-haiku-4-5");
    expect(detected[0].selected.chatModel).toBe("claude-sonnet-4-5");
    expect(detected[0].selected.bonusModel).toBe("claude-opus-4");

    const anthropicStatus = statuses.find((s) => s.name === "Anthropic");
    expect(anthropicStatus?.detected).toBe(true);
  });

  test("ANTHROPIC_API_KEY set + 401 → provider NOT detected, status is failed", async () => {
    const mockFetch = makeMockFetch({
      "api.anthropic.com": { ok: false },
    });

    const { detected, statuses } = await detectProviders(
      {
        skipLocalDetect: true,
        env: { ANTHROPIC_API_KEY: "sk-invalid-key" },
      },
      mockFetch
    );

    expect(detected.find((d) => d.name === "Anthropic")).toBeUndefined();
    const anthropicStatus = statuses.find((s) => s.name === "Anthropic");
    expect(anthropicStatus?.detected).toBe(false);
  });

  test("no env vars set, skip local — no providers detected, no accounts created", async () => {
    const mockFetch = makeMockFetch({});

    const { detected } = await detectProviders(
      {
        skipLocalDetect: true,
        env: {},
      },
      mockFetch
    );

    expect(detected).toHaveLength(0);
  });

  test("multiple env vars set — all valid providers created, highest-priority first", async () => {
    const mockFetch = makeMockFetch({
      "api.anthropic.com": { ok: true, body: anthropicModels },
      "api.openai.com": {
        ok: true,
        body: { data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] },
      },
    });

    const { detected } = await detectProviders(
      {
        skipLocalDetect: true,
        env: {
          ANTHROPIC_API_KEY: "sk-anthropic",
          OPENAI_API_KEY: "sk-openai",
        },
      },
      mockFetch
    );

    expect(detected).toHaveLength(2);
    expect(detected[0].name).toBe("Anthropic");
    expect(detected[1].name).toBe("OpenAI");
  });

  test("statuses include ALL 7 providers even when only some detected", async () => {
    const mockFetch = makeMockFetch({
      "api.anthropic.com": { ok: true, body: anthropicModels },
    });

    const { statuses } = await detectProviders(
      {
        skipLocalDetect: true,
        env: { ANTHROPIC_API_KEY: "sk-test" },
      },
      mockFetch
    );

    const cloudNames = ["Anthropic", "OpenAI", "Groq", "Mistral", "Gemini"];
    for (const name of cloudNames) {
      expect(statuses.find((s) => s.name === name)).toBeDefined();
    }
  });
});

describe("buildProviderAccounts", () => {
  test("chat model appears first in models array", () => {
    const { accounts } = buildProviderAccounts([{
      name: "Anthropic",
      url: "https://api.anthropic.com/v1",
      apiKey: "sk-test",
      modelIds: ["claude-haiku-4-5", "claude-sonnet-4-5"],
      selected: { extractionModel: "claude-haiku-4-5", chatModel: "claude-sonnet-4-5" },
      status: "detected",
    }]);

    expect(accounts).toHaveLength(1);
    expect(accounts[0].models![0].name).toBe("claude-sonnet-4-5");
    expect(accounts[0].default_model).toBe("claude-sonnet-4-5");
  });

  test("sets api_key to env var reference on known cloud providers", () => {
    const { accounts } = buildProviderAccounts([{
      name: "Anthropic",
      url: "https://api.anthropic.com/v1",
      apiKey: "sk-test",
      modelIds: ["claude-haiku-4-5"],
      selected: { extractionModel: "claude-haiku-4-5", chatModel: "claude-haiku-4-5" },
      status: "detected",
    }]);

    expect(accounts[0].api_key).toBe("$ANTHROPIC_API_KEY");
  });

  test("passes api_key through for unknown providers", () => {
    const { accounts } = buildProviderAccounts([{
      name: "MyCustomProvider",
      url: "https://my-llm.example.com/v1",
      apiKey: "sk-custom-key",
      modelIds: ["my-model"],
      selected: { extractionModel: "my-model", chatModel: "my-model" },
      status: "detected",
    }]);

    expect(accounts[0].api_key).toBe("sk-custom-key");
  });

  test("suggestedRewriteModelId is set to bonus model GUID when bonus model present", () => {
    const { accounts, suggestedRewriteModelId } = buildProviderAccounts([{
      name: "Anthropic",
      url: "https://api.anthropic.com/v1",
      apiKey: "sk-test",
      modelIds: ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-7"],
      selected: { extractionModel: "claude-haiku-4-5", chatModel: "claude-sonnet-4-5", bonusModel: "claude-opus-4-7" },
      status: "detected",
    }]);

    const opusModel = accounts[0].models!.find((m) => m.name === "claude-opus-4-7");
    expect(suggestedRewriteModelId).toBeDefined();
    expect(suggestedRewriteModelId).toBe(opusModel!.id);
  });

  test("suggestedRewriteModelId is undefined when no bonus model", () => {
    const { suggestedRewriteModelId } = buildProviderAccounts([{
      name: "Anthropic",
      url: "https://api.anthropic.com/v1",
      apiKey: "sk-test",
      modelIds: ["claude-haiku-4-5", "claude-sonnet-4-5"],
      selected: { extractionModel: "claude-haiku-4-5", chatModel: "claude-sonnet-4-5" },
      status: "detected",
    }]);

    expect(suggestedRewriteModelId).toBeUndefined();
  });

  test("suggestedRewriteModelId uses first provider with a bonus model", () => {
    const { suggestedRewriteModelId, accounts } = buildProviderAccounts([
      {
        name: "Anthropic",
        url: "https://api.anthropic.com/v1",
        apiKey: "sk-test",
        modelIds: ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-7"],
        selected: { extractionModel: "claude-haiku-4-5", chatModel: "claude-sonnet-4-5", bonusModel: "claude-opus-4-7" },
        status: "detected",
      },
      {
        name: "OpenAI",
        url: "https://api.openai.com/v1",
        apiKey: "sk-oai",
        modelIds: ["gpt-4o", "o3"],
        selected: { extractionModel: "gpt-4o-mini", chatModel: "o3", bonusModel: "o3" },
        status: "detected",
      },
    ]);

    const anthropicOpus = accounts[0].models!.find((m) => m.name === "claude-opus-4-7");
    expect(suggestedRewriteModelId).toBe(anthropicOpus!.id);
  });

  test("no duplicate model entries when modelIds overlap with selected", () => {
    const { accounts } = buildProviderAccounts([{
      name: "Anthropic",
      url: "https://api.anthropic.com/v1",
      modelIds: ["claude-haiku-4-5", "claude-sonnet-4-5"],
      selected: { extractionModel: "claude-haiku-4-5", chatModel: "claude-sonnet-4-5" },
      status: "detected",
    }]);

    const names = accounts[0].models!.map((m) => m.name);
    const uniqueNames = [...new Set(names)];
    expect(names).toHaveLength(uniqueNames.length);
  });
});

describe("selectModelsForProvider — Anthropic filters to latest per tier", () => {
  const realWorldModels = [
    "claude-haiku-4-5-20251001",
    "claude-opus-4-1-20250805",
    "claude-opus-4-20250514",
    "claude-opus-4-5-20251101",
    "claude-opus-4-6",
    "claude-opus-4-7",
    "claude-sonnet-4-20250514",
    "claude-sonnet-4-5-20250929",
    "claude-sonnet-4-6",
  ];

  test("selects only the single latest haiku as extraction model", () => {
    const result = selectModelsForProvider("Anthropic", realWorldModels);
    expect(result.extractionModel).toBe("claude-haiku-4-5-20251001");
  });

  test("selects only the single latest sonnet as chat model", () => {
    const result = selectModelsForProvider("Anthropic", realWorldModels);
    expect(result.chatModel).toBe("claude-sonnet-4-6");
  });

  test("selects only the single latest opus as bonus model", () => {
    const result = selectModelsForProvider("Anthropic", realWorldModels);
    expect(result.bonusModel).toBe("claude-opus-4-7");
  });
});

describe("KNOWN_MODEL_LIMITS", () => {
  test("haiku-4-5 has conservative token_limit of 100k", () => {
    expect(KNOWN_MODEL_LIMITS["claude-haiku-4-5-20251001"]?.token_limit).toBe(100000);
  });

  test("opus-4-7 has max_output_tokens of 128k", () => {
    expect(KNOWN_MODEL_LIMITS["claude-opus-4-7"]?.max_output_tokens).toBe(128000);
  });

  test("opus-4-6 has max_output_tokens of 128k", () => {
    expect(KNOWN_MODEL_LIMITS["claude-opus-4-6"]?.max_output_tokens).toBe(128000);
  });

  test("sonnet-4-6 has max_output_tokens of 64k", () => {
    expect(KNOWN_MODEL_LIMITS["claude-sonnet-4-6"]?.max_output_tokens).toBe(64000);
  });

  test("opus-4-8 has temperature_disabled: true (model always uses extended thinking)", () => {
    expect(KNOWN_MODEL_LIMITS["claude-opus-4-8"]?.temperature_disabled).toBe(true);
  });

  test("opus-4-8 has standard limits (200k context, 128k output)", () => {
    expect(KNOWN_MODEL_LIMITS["claude-opus-4-8"]?.token_limit).toBe(200000);
    expect(KNOWN_MODEL_LIMITS["claude-opus-4-8"]?.max_output_tokens).toBe(128000);
  });

  test("older models do not have temperature_disabled set", () => {
    // Only models that always-use-thinking get this flag; older models accept temperature normally.
    expect(KNOWN_MODEL_LIMITS["claude-opus-4-7"]?.temperature_disabled).toBeUndefined();
    expect(KNOWN_MODEL_LIMITS["claude-sonnet-4-6"]?.temperature_disabled).toBeUndefined();
    expect(KNOWN_MODEL_LIMITS["claude-haiku-4-5-20251001"]?.temperature_disabled).toBeUndefined();
  });
});

describe("buildProviderAccounts — known model limits", () => {
  test("populates token_limit and max_output_tokens for known Anthropic models", () => {
    const { accounts } = buildProviderAccounts([{
      name: "Anthropic",
      url: "https://api.anthropic.com/v1",
      apiKey: "sk-test",
      modelIds: ["claude-haiku-4-5-20251001", "claude-sonnet-4-6"],
      selected: { extractionModel: "claude-haiku-4-5-20251001", chatModel: "claude-sonnet-4-6" },
      status: "detected",
    }]);

    const haiku = accounts[0].models!.find((m) => m.name === "claude-haiku-4-5-20251001");
    expect(haiku?.token_limit).toBe(100000);
    expect(haiku?.max_output_tokens).toBe(64000);

    const sonnet = accounts[0].models!.find((m) => m.name === "claude-sonnet-4-6");
    expect(sonnet?.max_output_tokens).toBe(64000);
  });

  test("unknown models get no token_limit or max_output_tokens", () => {
    const { accounts } = buildProviderAccounts([{
      name: "Anthropic",
      url: "https://api.anthropic.com/v1",
      apiKey: "sk-test",
      modelIds: ["claude-future-model-99"],
      selected: { extractionModel: "claude-future-model-99", chatModel: "claude-future-model-99" },
      status: "detected",
    }]);

    const model = accounts[0].models!.find((m) => m.name === "claude-future-model-99");
    expect(model?.token_limit).toBeUndefined();
    expect(model?.max_output_tokens).toBeUndefined();
  });

  test("Anthropic: only latest-per-tier models appear in accounts — older snapshots dropped", () => {
    const { accounts } = buildProviderAccounts([{
      name: "Anthropic",
      url: "https://api.anthropic.com/v1",
      apiKey: "sk-test",
      modelIds: [
        "claude-opus-4-20250514",
        "claude-opus-4-6",
        "claude-opus-4-7",
        "claude-sonnet-4-20250514",
        "claude-sonnet-4-5-20250929",
        "claude-sonnet-4-6",
        "claude-haiku-4-5-20251001",
      ],
      selected: { extractionModel: "claude-haiku-4-5-20251001", chatModel: "claude-sonnet-4-6", bonusModel: "claude-opus-4-7" },
      status: "detected",
    }]);

    const names = accounts[0].models!.map((m) => m.name);
    expect(names).not.toContain("claude-opus-4-20250514");
    expect(names).not.toContain("claude-sonnet-4-20250514");
    expect(names).not.toContain("claude-sonnet-4-5-20250929");
    expect(names).not.toContain("claude-opus-4-6");
    expect(names).toContain("claude-haiku-4-5-20251001");
    expect(names).toContain("claude-sonnet-4-6");
    expect(names).toContain("claude-opus-4-7");
  });

  test("OpenAI: drops non-chat models, keeps chat families", () => {
    const { accounts } = buildProviderAccounts([{
      name: "OpenAI",
      url: "https://api.openai.com/v1",
      apiKey: "sk-test",
      modelIds: ["gpt-4o-2024-11-20", "gpt-4o-mini", "tts-1", "dall-e-3", "whisper-1", "text-embedding-ada-002"],
      selected: { extractionModel: "gpt-4o-mini", chatModel: "gpt-4o-2024-11-20" },
      status: "detected",
    }]);

    const names = accounts[0].models!.map((m) => m.name);
    expect(names).toContain("gpt-4o-2024-11-20");
    expect(names).toContain("gpt-4o-mini");
    expect(names).not.toContain("tts-1");
    expect(names).not.toContain("dall-e-3");
    expect(names).not.toContain("whisper-1");
    expect(names).not.toContain("text-embedding-ada-002");
  });

  test("Gemini: drops non-chat models, keeps flash/pro", () => {
    const { accounts } = buildProviderAccounts([{
      name: "Gemini",
      url: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: "gai-test",
      modelIds: ["models/gemini-2.5-flash", "models/gemini-2.5-pro", "models/gemini-embedding-001", "models/imagen-4.0-generate-001"],
      selected: { extractionModel: "models/gemini-2.5-flash", chatModel: "models/gemini-2.5-pro" },
      status: "detected",
    }]);

    const names = accounts[0].models!.map((m) => m.name);
    expect(names).toContain("models/gemini-2.5-flash");
    expect(names).toContain("models/gemini-2.5-pro");
    expect(names).not.toContain("models/gemini-embedding-001");
    expect(names).not.toContain("models/imagen-4.0-generate-001");
  });

  test("local providers (LMStudio) keep all modelIds unfiltered", () => {
    const { accounts } = buildProviderAccounts([{
      name: "LMStudio",
      url: "http://127.0.0.1:1234/v1",
      modelIds: ["google/gemma-4-26b-a4b", "qwen/qwen3.5-35b-a3b", "text-embedding-nomic-embed-text-v1.5"],
      selected: { extractionModel: "google/gemma-4-26b-a4b", chatModel: "google/gemma-4-26b-a4b" },
      status: "detected",
    }]);

    const names = accounts[0].models!.map((m) => m.name);
    expect(names).toContain("google/gemma-4-26b-a4b");
    expect(names).toContain("qwen/qwen3.5-35b-a3b");
    expect(names).toContain("text-embedding-nomic-embed-text-v1.5");
  });

  test("claude-opus-4-8 gets temperature_disabled: true when auto-configured", () => {
    // Oracle: claude-opus-4-8 always uses extended thinking and Anthropic's API
    // rejects temperature for this model. The flag must flow from KNOWN_MODEL_LIMITS
    // through buildProviderAccounts so the LLM client can suppress the field.
    const { accounts } = buildProviderAccounts([{
      name: "Anthropic",
      url: "https://api.anthropic.com/v1",
      apiKey: "sk-test",
      modelIds: ["claude-opus-4-8", "claude-sonnet-4-6"],
      selected: { extractionModel: "claude-sonnet-4-6", chatModel: "claude-sonnet-4-6", bonusModel: "claude-opus-4-8" },
      status: "detected",
    }]);

    const opus = accounts[0].models!.find((m) => m.name === "claude-opus-4-8");
    expect(opus?.temperature_disabled).toBe(true);
  });

  test("models without temperature_disabled in KNOWN_MODEL_LIMITS do not get the flag", () => {
    const { accounts } = buildProviderAccounts([{
      name: "Anthropic",
      url: "https://api.anthropic.com/v1",
      apiKey: "sk-test",
      modelIds: ["claude-opus-4-7", "claude-sonnet-4-6"],
      selected: { extractionModel: "claude-sonnet-4-6", chatModel: "claude-sonnet-4-6", bonusModel: "claude-opus-4-7" },
      status: "detected",
    }]);

    const opus47 = accounts[0].models!.find((m) => m.name === "claude-opus-4-7");
    expect(opus47?.temperature_disabled).toBeUndefined();

    const sonnet = accounts[0].models!.find((m) => m.name === "claude-sonnet-4-6");
    expect(sonnet?.temperature_disabled).toBeUndefined();
  });

  test("unknown models do not get temperature_disabled", () => {
    const { accounts } = buildProviderAccounts([{
      name: "Anthropic",
      url: "https://api.anthropic.com/v1",
      apiKey: "sk-test",
      modelIds: ["claude-future-model-99"],
      selected: { extractionModel: "claude-future-model-99", chatModel: "claude-future-model-99" },
      status: "detected",
    }]);

    const model = accounts[0].models!.find((m) => m.name === "claude-future-model-99");
    expect(model?.temperature_disabled).toBeUndefined();
  });
});

describe("ALL_PROVIDER_NAMES", () => {
  test("contains all 7 expected providers in priority order", () => {
    expect(ALL_PROVIDER_NAMES).toEqual([
      "LMStudio", "Ollama", "Anthropic", "OpenAI", "Groq", "Mistral", "Gemini",
    ]);
  });
});

describe("auth headers — each provider uses the correct scheme", () => {
  function captureHeaders(expectedUrl: string) {
    const captured: Record<string, string>[] = [];
    const mockFetch = async (url: string, init?: RequestInit) => {
      if (url.startsWith(expectedUrl)) {
        captured.push((init?.headers ?? {}) as Record<string, string>);
      }
      return new Response(JSON.stringify({ data: [{ id: "test-model" }] }), { status: 200 });
    };
    return { captured, mockFetch };
  }

  test("Anthropic: uses x-api-key + anthropic-version, NOT Authorization Bearer", async () => {
    const { captured, mockFetch } = captureHeaders("https://api.anthropic.com");
    await detectProviders({ env: { ANTHROPIC_API_KEY: "sk-ant-test" } }, mockFetch);
    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0]["x-api-key"]).toBe("sk-ant-test");
    expect(captured[0]["anthropic-version"]).toBe("2023-06-01");
    expect(captured[0]["Authorization"]).toBeUndefined();
  });

  test("OpenAI: uses Authorization Bearer from OPENAI_API_KEY", async () => {
    const { captured, mockFetch } = captureHeaders("https://api.openai.com");
    await detectProviders({ env: { OPENAI_API_KEY: "sk-oai-test" } }, mockFetch);
    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0]["Authorization"]).toBe("Bearer sk-oai-test");
    expect(captured[0]["x-api-key"]).toBeUndefined();
  });

  test("Groq: uses Authorization Bearer from GROQ_API_KEY", async () => {
    const { captured, mockFetch } = captureHeaders("https://api.groq.com");
    await detectProviders({ env: { GROQ_API_KEY: "gsk-test" } }, mockFetch);
    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0]["Authorization"]).toBe("Bearer gsk-test");
    expect(captured[0]["x-api-key"]).toBeUndefined();
  });

  test("Mistral: uses Authorization Bearer from MISTRAL_API_KEY", async () => {
    const { captured, mockFetch } = captureHeaders("https://api.mistral.ai");
    await detectProviders({ env: { MISTRAL_API_KEY: "mst-test" } }, mockFetch);
    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0]["Authorization"]).toBe("Bearer mst-test");
    expect(captured[0]["x-api-key"]).toBeUndefined();
  });

  test("Gemini: uses Authorization Bearer from GEMINI_API_KEY", async () => {
    const { captured, mockFetch } = captureHeaders("https://generativelanguage.googleapis.com");
    await detectProviders({ env: { GEMINI_API_KEY: "gai-test" } }, mockFetch);
    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0]["Authorization"]).toBe("Bearer gai-test");
    expect(captured[0]["x-api-key"]).toBeUndefined();
  });

  test("local providers: no auth headers sent", async () => {
    const captured: Record<string, string>[] = [];
    const mockFetch = async (_url: string, init?: RequestInit) => {
      captured.push((init?.headers ?? {}) as Record<string, string>);
      return new Response(JSON.stringify({ data: [{ id: "local-model" }] }), { status: 200 });
    };
    await detectProviders({ env: {}, skipCloudDetect: true }, mockFetch);
    for (const headers of captured) {
      expect(headers["Authorization"]).toBeUndefined();
      expect(headers["x-api-key"]).toBeUndefined();
    }
  });
});
