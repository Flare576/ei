import { test, expect, describe } from "bun:test";
import {
  selectModelsForProvider,
  detectProviders,
  buildProviderAccounts,
  ALL_PROVIDER_NAMES,
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

describe("selectModelsForProvider — latest selection (lexicographic descending)", () => {
  test("multiple haiku versions — picks latest by lexicographic sort desc", () => {
    const models = ["claude-haiku-3", "claude-haiku-4-5", "claude-haiku-4-0"];
    const result = selectModelsForProvider("Anthropic", models);
    expect(result.extractionModel).toBe("claude-haiku-4-5");
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
  const openaiModels = ["gpt-4o", "gpt-4o-mini", "gpt-4o-2024-11-20"];

  test("selects latest mini as extraction", () => {
    const result = selectModelsForProvider("OpenAI", openaiModels);
    expect(result.extractionModel).toBe("gpt-4o-mini");
  });

  test("selects latest gpt-4o (non-mini) as chat", () => {
    const result = selectModelsForProvider("OpenAI", openaiModels);
    expect(result.chatModel).toBe("gpt-4o-2024-11-20");
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
  test("selects flash as extraction, pro as chat", () => {
    const models = ["gemini-2.0-flash", "gemini-1.5-pro"];
    const result = selectModelsForProvider("Gemini", models);
    expect(result.extractionModel).toBe("gemini-2.0-flash");
    expect(result.chatModel).toBe("gemini-1.5-pro");
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
    const accounts = buildProviderAccounts([{
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

  test("sets api_key on cloud providers", () => {
    const accounts = buildProviderAccounts([{
      name: "Anthropic",
      url: "https://api.anthropic.com/v1",
      apiKey: "sk-test",
      modelIds: ["claude-haiku-4-5"],
      selected: { extractionModel: "claude-haiku-4-5", chatModel: "claude-haiku-4-5" },
      status: "detected",
    }]);

    expect(accounts[0].api_key).toBe("sk-test");
  });

  test("no duplicate model entries when modelIds overlap with selected", () => {
    const accounts = buildProviderAccounts([{
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
