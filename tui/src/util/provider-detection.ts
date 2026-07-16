import type { ProviderType } from "../../../src/core/types.js";
import type { ProviderAccount, ModelConfig } from "../../../src/core/types.js";
import { KNOWN_MODEL_LIMITS } from "../../../src/core/constants/known-model-limits.js";

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

// Ei-curated effective limits for known models — canonical definition lives in core
// (src/core/constants/known-model-limits.ts) so llm-client.ts can use it as a call-time
// fallback default too. Re-exported here since this file is the historical import path.
export { KNOWN_MODEL_LIMITS };

// Sort model IDs by version numerically descending so "4-6" correctly beats "4-5".
// Snapshot date suffixes (8-digit YYYYMMDD) are stripped before comparison so that
// "claude-sonnet-4-6" sorts higher than "claude-sonnet-4-5-20250929".
function sortModelsDesc(modelIds: string[]): string[] {
  const stripDate = (id: string) => id.replace(/-\d{8}$/, "");
  return [...modelIds].sort((a, b) => {
    const aParts = stripDate(a).split(/[-.]/).map((p) => (isNaN(Number(p)) ? p : Number(p)));
    const bParts = stripDate(b).split(/[-.]/).map((p) => (isNaN(Number(p)) ? p : Number(p)));
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const av = aParts[i] ?? 0;
      const bv = bParts[i] ?? 0;
      if (av < bv) return 1;
      if (av > bv) return -1;
    }
    return 0;
  });
}

function latestMatch(modelIds: string[], pattern: string): string | undefined {
  const matches = modelIds.filter((id) => id.toLowerCase().includes(pattern));
  if (matches.length === 0) return undefined;
  return sortModelsDesc(matches)[0];
}

// For Anthropic: keep only the single latest model per tier (haiku/sonnet/opus).
// Drops older snapshots and deprecated models (e.g. claude-opus-4-20250514) so the
// initial provider config stays clean. Users can add older models manually if needed.
function filterAnthropicModels(modelIds: string[]): string[] {
  const tiers = ["haiku", "sonnet", "opus"];
  const kept: string[] = [];
  for (const tier of tiers) {
    const latest = latestMatch(modelIds, tier);
    if (latest) kept.push(latest);
  }
  // Preserve any models that don't match a known tier (future-proofing)
  const unknowns = modelIds.filter((id) => !tiers.some((t) => id.toLowerCase().includes(t)));
  return [...kept, ...unknowns];
}

// For OpenAI: the /models endpoint returns everything — TTS, image generation, audio,
// embeddings, moderation, legacy completions, etc. Keep only chat-capable model families
// and trim to one latest per tier so the provider config stays useful.
function filterOpenAIModels(modelIds: string[]): string[] {
  const NON_CHAT_PATTERNS = [
    "tts", "whisper", "dall-e", "embedding", "davinci", "babbage",
    "moderation", "audio", "realtime", "transcribe", "image", "sora",
    "chat-latest", "codex",
  ];
  const isNonChat = (id: string) => {
    const lower = id.toLowerCase();
    return NON_CHAT_PATTERNS.some((p) => lower.includes(p));
  };

  const chatModels = modelIds.filter((id) => !isNonChat(id));

  // Tiers in priority order. Mini variants are their own tier for extraction use.
  const tiers = [
    { name: "o-series",  match: (id: string) => /^o\d/.test(id.toLowerCase()) && !id.toLowerCase().includes("mini") },
    { name: "gpt-5",     match: (id: string) => id.toLowerCase().includes("gpt-5") && !id.toLowerCase().includes("mini") },
    { name: "gpt-4.1",   match: (id: string) => id.toLowerCase().includes("gpt-4.1") && !id.toLowerCase().includes("mini") },
    { name: "gpt-4o",    match: (id: string) => id.toLowerCase().includes("gpt-4o") && !id.toLowerCase().includes("mini") },
    { name: "mini",      match: (id: string) => id.toLowerCase().includes("mini") },
  ];

  const kept: string[] = [];
  const consumed = new Set<string>();

  for (const tier of tiers) {
    const matches = chatModels.filter((id) => tier.match(id) && !consumed.has(id));
    const latest = sortModelsDesc(matches)[0];
    if (latest) {
      kept.push(latest);
      consumed.add(latest);
    }
  }

  return kept;
}

// For Gemini: the /models endpoint returns chat models, embedding models, image/video
// generation (Imagen, Veo), audio (Lyria), TTS variants, robotics previews, and research
// models. Keep only plain gemini-N.N-flash and gemini-N.N-pro chat families, latest per tier.
function filterGeminiModels(modelIds: string[]): string[] {
  const NON_CHAT_PATTERNS = [
    "embedding", "imagen", "veo", "lyria", "robotics", "tts", "audio",
    "native-audio", "computer-use", "deep-research", "aqa", "live",
    "-image-", "gemma",
  ];
  const isNonChat = (id: string) => {
    const lower = id.toLowerCase();
    return NON_CHAT_PATTERNS.some((p) => lower.includes(p));
  };

  const chatModels = modelIds.filter((id) => !isNonChat(id));

  const tiers = ["pro", "flash"];
  const kept: string[] = [];
  const consumed = new Set<string>();

  for (const tier of tiers) {
    const latest = latestMatch(chatModels.filter((id) => !consumed.has(id)), tier);
    if (latest) {
      kept.push(latest);
      consumed.add(latest);
    }
  }

  return kept;
}

function filterModelsForProvider(providerName: string, modelIds: string[]): string[] {
  const name = providerName.toLowerCase();
  if (name === "anthropic") return filterAnthropicModels(modelIds);
  if (name === "openai")    return filterOpenAIModels(modelIds);
  if (name === "gemini")    return filterGeminiModels(modelIds);
  return modelIds;
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
    const filtered = filterAnthropicModels(modelIds);
    return {
      extractionModel: latestMatch(filtered, "haiku") ?? filtered[0],
      chatModel:       latestMatch(filtered, "sonnet") ?? filtered[0],
      bonusModel:      latestMatch(filtered, "opus"),
    };
  }

  if (name === "openai") {
    const filtered = filterOpenAIModels(modelIds);
    const list = filtered.length > 0 ? filtered : modelIds;
    return {
      extractionModel: latestMatch(list, "mini") ?? list[0],
      chatModel:       list[0],
    };
  }

  if (name === "mistral") {
    return {
      extractionModel: latestMatch(modelIds, "small") ?? modelIds[0],
      chatModel:       latestMatch(modelIds, "large") ?? modelIds[0],
    };
  }

  if (name === "gemini") {
    const filtered = filterGeminiModels(modelIds);
    const list = filtered.length > 0 ? filtered : modelIds;
    return {
      extractionModel: latestMatch(list, "flash") ?? list[0],
      chatModel:       latestMatch(list, "pro")   ?? list[0],
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
  const env = options.env ?? (Bun.env as Record<string, string | undefined>);
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

export interface ProviderBootstrapResult {
  accounts: ProviderAccount[];
  suggestedRewriteModelId?: string;
}

export function buildProviderAccounts(
  detected: ProviderDetectionResult[]
): ProviderBootstrapResult {
  let suggestedRewriteModelId: string | undefined;

  const accounts = detected.map((d) => {
    const makeModel = (modelName: string): ModelConfig => {
      const limits = KNOWN_MODEL_LIMITS[modelName];
      return {
        id: crypto.randomUUID(),
        name: modelName,
        ...(limits?.token_limit !== undefined && { token_limit: limits.token_limit }),
        ...(limits?.max_output_tokens !== undefined && { max_output_tokens: limits.max_output_tokens }),
        ...(limits?.temperature_disabled === true && { temperature_disabled: true }),
      };
    };
    const seenNames = new Set<string>();
    const models: ModelConfig[] = [];

    const pushIfNew = (name: string): ModelConfig => {
      if (!seenNames.has(name)) {
        seenNames.add(name);
        const model = makeModel(name);
        models.push(model);
        return model;
      }
      return models.find((m) => m.name === name)!;
    };

    pushIfNew(d.selected.chatModel);
    pushIfNew(d.selected.extractionModel);
    if (d.selected.bonusModel) {
      const bonusConfig = pushIfNew(d.selected.bonusModel);
      if (!suggestedRewriteModelId) {
        suggestedRewriteModelId = bonusConfig.id;
      }
    }
    const modelList = filterModelsForProvider(d.name, d.modelIds);
    for (const id of modelList) pushIfNew(id);

    const cloudConfig = CLOUD_PROVIDERS.find((p) => p.name === d.name);
    const apiKey = cloudConfig ? `$${cloudConfig.envVar}` : d.apiKey;

    return {
      id: crypto.randomUUID(),
      name: d.name,
      type: "llm" as ProviderType,
      url: d.url,
      api_key: apiKey,
      enabled: true,
      created_at: new Date().toISOString(),
      default_model: d.selected.chatModel,
      models,
    };
  });

  return { accounts, suggestedRewriteModelId };
}
