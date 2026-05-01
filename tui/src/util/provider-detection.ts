import type { ProviderType } from "../../../src/core/types.js";
import type { ProviderAccount, ModelConfig } from "../../../src/core/types.js";

export interface LocalProviderConfig {
  name: string;
  url: string;
  priority: number;
}

export interface CloudProviderConfig {
  name: string;
  envVar: string;
  url: string;
  priority: number;
}

export interface SelectedModels {
  extractionModel: string;
  chatModel: string;
  bonusModel?: string;
}

export interface ProviderDetectionResult {
  name: string;
  url: string;
  apiKey?: string;
  modelIds: string[];
  selected: SelectedModels;
  status: "detected" | "failed";
}

export interface ProviderDetectionStatus {
  name: string;
  detected: boolean;
}

export interface DetectProvidersOptions {
  skipLocalDetect?: boolean;
  skipCloudDetect?: boolean;
  env?: Record<string, string | undefined>;
}

export const LOCAL_PROVIDERS: ReadonlyArray<LocalProviderConfig> = [
  { name: "LMStudio", url: "http://127.0.0.1:1234/v1",  priority: 1 },
  { name: "Ollama",   url: "http://127.0.0.1:11434/v1", priority: 2 },
];

export const CLOUD_PROVIDERS: ReadonlyArray<CloudProviderConfig> = [
  { name: "Anthropic", envVar: "ANTHROPIC_API_KEY", url: "https://api.anthropic.com/v1",                             priority: 3 },
  { name: "OpenAI",    envVar: "OPENAI_API_KEY",    url: "https://api.openai.com/v1",                                priority: 4 },
  { name: "Groq",      envVar: "GROQ_API_KEY",      url: "https://api.groq.com/openai/v1",                          priority: 5 },
  { name: "Mistral",   envVar: "MISTRAL_API_KEY",   url: "https://api.mistral.ai/v1",                               priority: 6 },
  { name: "Gemini",    envVar: "GEMINI_API_KEY",    url: "https://generativelanguage.googleapis.com/v1beta/openai", priority: 7 },
];

export const ALL_PROVIDER_NAMES: ReadonlyArray<string> = [
  ...LOCAL_PROVIDERS.map((p) => p.name),
  ...CLOUD_PROVIDERS.map((p) => p.name),
];

function latestMatch(modelIds: string[], pattern: string): string | undefined {
  const matches = modelIds.filter((id) => id.toLowerCase().includes(pattern));
  if (matches.length === 0) return undefined;
  return [...matches].sort().reverse()[0];
}

export function selectModelsForProvider(
  providerName: string,
  modelIds: string[]
): SelectedModels {
  const name = providerName.toLowerCase();

  if (name === "groq") {
    return {
      extractionModel: "llama-3.1-8b-instant",
      chatModel: "llama-3.3-70b-versatile",
    };
  }

  if (modelIds.length === 0) {
    return { extractionModel: "default", chatModel: "default" };
  }

  if (name === "anthropic") {
    return {
      extractionModel: latestMatch(modelIds, "haiku") ?? modelIds[0],
      chatModel:       latestMatch(modelIds, "sonnet") ?? modelIds[0],
      bonusModel:      latestMatch(modelIds, "opus"),
    };
  }

  if (name === "openai") {
    const gpt4oNonMini = modelIds.filter(
      (id) => id.toLowerCase().includes("gpt-4o") && !id.toLowerCase().includes("mini")
    );
    return {
      extractionModel: latestMatch(modelIds, "mini") ?? modelIds[0],
      chatModel: gpt4oNonMini.length > 0
        ? [...gpt4oNonMini].sort().reverse()[0]
        : modelIds[0],
    };
  }

  if (name === "mistral") {
    return {
      extractionModel: latestMatch(modelIds, "small") ?? modelIds[0],
      chatModel:       latestMatch(modelIds, "large") ?? modelIds[0],
    };
  }

  if (name === "gemini") {
    return {
      extractionModel: latestMatch(modelIds, "flash") ?? modelIds[0],
      chatModel:       latestMatch(modelIds, "pro")   ?? modelIds[0],
    };
  }

  return { extractionModel: modelIds[0], chatModel: modelIds[0] };
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

function buildAuthHeaders(url: string, apiKey: string | undefined): Record<string, string> {
  if (!apiKey) return {};
  if (url.includes("api.anthropic.com")) {
    return {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };
  }
  return { "Authorization": `Bearer ${apiKey}` };
}

async function probeModels(
  url: string,
  apiKey: string | undefined,
  fetchFn: FetchFn
): Promise<string[] | null> {
  try {
    const headers = buildAuthHeaders(url, apiKey);
    const response = await fetchFn(`${url}/models`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const json = await response.json() as { data?: Array<{ id: string }> };
    return (json.data ?? []).map((m) => m.id).filter(Boolean);
  } catch {
    return null;
  }
}

export async function detectProviders(
  options: DetectProvidersOptions = {},
  fetchFn: FetchFn = fetch
): Promise<{
  detected: ProviderDetectionResult[];
  statuses: ProviderDetectionStatus[];
}> {
  const env = options.env ?? (process.env as Record<string, string | undefined>);
  const detected: ProviderDetectionResult[] = [];
  const statuses: ProviderDetectionStatus[] = [];

  const localResults = await Promise.all(
    LOCAL_PROVIDERS.map(async (provider) => {
      if (options.skipLocalDetect) return { provider, modelIds: null };
      const modelIds = await probeModels(provider.url, undefined, fetchFn);
      return { provider, modelIds };
    })
  );

  for (const { provider, modelIds } of localResults) {
    const ok = modelIds !== null;
    statuses.push({ name: provider.name, detected: ok });
    if (ok) {
      detected.push({
        name: provider.name,
        url: provider.url,
        modelIds: modelIds!,
        selected: selectModelsForProvider(provider.name, modelIds!),
        status: "detected",
      });
    }
  }

  const cloudResults = await Promise.all(
    CLOUD_PROVIDERS.map(async (provider) => {
      const apiKey = env[provider.envVar];
      if (!apiKey) return { provider, apiKey: undefined, modelIds: null };
      if (options.skipCloudDetect) return { provider, apiKey, modelIds: null };
      const modelIds = await probeModels(provider.url, apiKey, fetchFn);
      return { provider, apiKey, modelIds };
    })
  );

  for (const { provider, apiKey, modelIds } of cloudResults) {
    const ok = modelIds !== null;
    statuses.push({ name: provider.name, detected: ok });
    if (ok) {
      detected.push({
        name: provider.name,
        url: provider.url,
        apiKey,
        modelIds: modelIds!,
        selected: selectModelsForProvider(provider.name, modelIds!),
        status: "detected",
      });
    }
  }

  return { detected, statuses };
}

export function buildProviderAccounts(
  detected: ProviderDetectionResult[]
): ProviderAccount[] {
  return detected.map((d) => {
    const makeModel = (modelName: string): ModelConfig => ({
      id: crypto.randomUUID(),
      name: modelName,
    });

    const seenNames = new Set<string>();
    const models: ModelConfig[] = [];

    const pushIfNew = (name: string) => {
      if (!seenNames.has(name)) {
        seenNames.add(name);
        models.push(makeModel(name));
      }
    };

    pushIfNew(d.selected.chatModel);
    pushIfNew(d.selected.extractionModel);
    if (d.selected.bonusModel) pushIfNew(d.selected.bonusModel);
    for (const id of d.modelIds) pushIfNew(id);

    return {
      id: crypto.randomUUID(),
      name: d.name,
      type: "llm" as ProviderType,
      url: d.url,
      api_key: d.apiKey,
      enabled: true,
      created_at: new Date().toISOString(),
      default_model: d.selected.chatModel,
      models,
    };
  });
}
