import YAML from "yaml";
import type {
  ProviderAccount,
  ProviderType,
} from "../../../src/core/types.js";
import { modelGuidToDisplay } from "./yaml-shared.js";

const tokenFormatter = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const formatTokens = (n: number) => tokenFormatter.format(n);

interface EditableModelData {
  name: string;
  model_id?: string;
  token_limit?: number;
  max_output_tokens?: number;
  thinking_budget?: number;
  _delete?: boolean;
}

interface EditableProviderData {
  name: string;
  type: "llm" | "storage";
  url: string;
  api_key?: string;
  default_model?: string;
  token_limit?: number | null;
  extra_headers?: Record<string, string>;
  enabled?: boolean;
  models?: EditableModelData[];
  _delete?: boolean;
}

export interface ProviderYAMLResult {
  account: ProviderAccount;
  _delete: boolean;
}

const PLACEHOLDER_PROVIDER_NAME = "My Provider";
const PLACEHOLDER_PROVIDER_URL = "https://api.example.com/v1";
const PLACEHOLDER_PROVIDER_API_KEY = "your-api-key-or-$ENVAR";
const PLACEHOLDER_PROVIDER_DEFAULT_MODEL = "model-name";

function parseModels(editableModels: EditableModelData[]): import('../../../src/core/types.js').ModelConfig[] {
  const result: import('../../../src/core/types.js').ModelConfig[] = [];
  for (const m of editableModels) {
    if (m._delete) continue;
    const modelId = m.model_id ?? undefined;
    result.push({
      id: crypto.randomUUID(),
      name: m.name,
      model_id: (modelId === null || modelId === m.name) ? undefined : modelId,
      token_limit: m.token_limit ?? undefined,
      max_output_tokens: m.max_output_tokens ?? undefined,
      thinking_budget: m.thinking_budget ?? undefined,
    });
  }
  return result;
}

export function newProviderToYAML(name?: string): string {
  const placeholderData = {
    name: name ?? PLACEHOLDER_PROVIDER_NAME,
    type: "llm",
    url: PLACEHOLDER_PROVIDER_URL,
    api_key: PLACEHOLDER_PROVIDER_API_KEY,
    default_model: PLACEHOLDER_PROVIDER_DEFAULT_MODEL,
    token_limit: null,
    extra_headers: {},
    enabled: true,
  };

  const modelsYAML = [
    "models:",
    "  - name: default",
    "    model_id: default",
    "    token_limit: null",
    "    max_output_tokens: null",
    "    thinking_budget: null",
    "    # _delete: true",
    "# _delete: true   # Delete this entire provider",
  ].join("\n");

  return YAML.stringify(placeholderData, { lineWidth: 0 }).trimEnd() + "\n" + modelsYAML + "\n";
}

export function newProviderFromYAML(yamlContent: string): ProviderAccount {
  const cleaned = yamlContent
    .split('\n')
    .filter(line => !/^\s*#/.test(line))
    .join('\n');
  const data = YAML.parse(cleaned) as EditableProviderData;

  if (!data.name || data.name === PLACEHOLDER_PROVIDER_NAME) {
    throw new Error("Provider name is required");
  }
  if (!data.url || data.url === PLACEHOLDER_PROVIDER_URL) {
    throw new Error("Provider URL is required");
  }
  if (data.api_key === PLACEHOLDER_PROVIDER_API_KEY) {
    data.api_key = undefined;
  }
  if (data.default_model === PLACEHOLDER_PROVIDER_DEFAULT_MODEL) {
    data.default_model = undefined;
  }

  if (data.token_limit !== undefined && data.token_limit !== null && (typeof data.token_limit !== "number" || isNaN(data.token_limit))) {
    throw new Error(`token_limit must be a number (got: ${JSON.stringify(data.token_limit)}). Note: underscore separators (100_000) are not valid in YAML.`);
  }

  const models = parseModels(data.models ?? []);

  return {
    id: crypto.randomUUID(),
    name: data.name,
    type: (data.type === "storage" ? "storage" : "llm") as ProviderType,
    url: data.url,
    api_key: data.api_key,
    default_model: data.default_model,
    token_limit: data.token_limit ?? undefined,
    extra_headers: data.extra_headers && Object.keys(data.extra_headers).length > 0 ? data.extra_headers : undefined,
    enabled: data.enabled ?? true,
    models: models.length > 0 ? models : undefined,
    created_at: new Date().toISOString(),
  };
}

export function providerToYAML(account: ProviderAccount): string {
  const defaultModelDisplay = account.default_model
    ? modelGuidToDisplay(account.default_model, [account])
    : undefined;

  const topData = {
    name: account.name,
    type: account.type as "llm" | "storage",
    url: account.url,
    api_key: account.api_key,
    default_model: defaultModelDisplay,
    token_limit: account.token_limit ?? null,
    extra_headers: account.extra_headers,
    enabled: account.enabled ?? true,
  };

  const topYAML = YAML.stringify(topData, { lineWidth: 0 }).trimEnd();

  const modelLines: string[] = ["models:"];
  const modelList = account.models ?? [];
  if (modelList.length > 0) {
    for (const m of modelList) {
      modelLines.push(`  - name: ${m.name}`);
      modelLines.push(`    model_id: ${m.model_id ?? m.name}`);
      modelLines.push(`    token_limit: ${m.token_limit ?? null}`);
      modelLines.push(`    max_output_tokens: ${m.max_output_tokens ?? null}`);
      modelLines.push(`    thinking_budget: ${m.thinking_budget ?? null}`);
      if (m.total_calls !== undefined || m.total_tokens_in !== undefined) {
        const tokensIn = m.total_tokens_in ?? 0;
        const tokensOut = m.total_tokens_out ?? 0;
        modelLines.push(`    # stats: ${formatTokens(m.total_calls ?? 0)} calls · ${formatTokens(tokensIn)} in / ${formatTokens(tokensOut)} out`);
        if (m.last_used) {
          modelLines.push(`    # used: ${m.last_used}`);
        }
      }
      modelLines.push(`    _delete: false`);
    }
  } else {
    modelLines.push("  - name: default");
    modelLines.push(`    model_id: default`);
    modelLines.push(`    token_limit: null`);
    modelLines.push(`    max_output_tokens: null`);
    modelLines.push(`    thinking_budget: null`);
    modelLines.push("    _delete: false");
  }
  modelLines.push("_delete: false   # Set to true to delete this entire provider");

  return topYAML + "\n" + modelLines.join("\n") + "\n";
}

export function providerFromYAML(yamlContent: string, original: ProviderAccount): ProviderYAMLResult {
  const cleaned = yamlContent
    .split('\n')
    .filter(line => !/^\s*#/.test(line))
    .join('\n');
  const data = YAML.parse(cleaned) as EditableProviderData;

  if (!data.name) {
    throw new Error("Provider name is required");
  }
  if (!data.url) {
    throw new Error("Provider URL is required");
  }

  if (data.token_limit !== undefined && data.token_limit !== null && (typeof data.token_limit !== "number" || isNaN(data.token_limit))) {
    throw new Error(`token_limit must be a number (got: ${JSON.stringify(data.token_limit)}). Note: underscore separators (100_000) are not valid in YAML.`);
  }

  if (data._delete) {
    return { account: original, _delete: true };
  }

  const existingModels = original.models ?? [];
  const parsedModels: import('../../../src/core/types.js').ModelConfig[] = [];
  for (const m of data.models ?? []) {
    if (m._delete) continue;
    const existing = existingModels.find(em => em.name === m.name);
    const modelId = m.model_id ?? undefined;
    parsedModels.push({
      id: existing?.id ?? crypto.randomUUID(),
      name: m.name,
      model_id: (modelId === null || modelId === m.name) ? undefined : modelId,
      token_limit: m.token_limit ?? undefined,
      max_output_tokens: m.max_output_tokens ?? undefined,
      thinking_budget: m.thinking_budget ?? undefined,
      total_calls: existing?.total_calls,
      total_tokens_in: existing?.total_tokens_in,
      total_tokens_out: existing?.total_tokens_out,
      last_used: existing?.last_used,
    });
  }

  const account: ProviderAccount = {
    id: original.id,
    name: data.name,
    type: (data.type === "storage" ? "storage" : "llm") as ProviderType,
    url: data.url,
    api_key: data.api_key,
    default_model: data.default_model,
    token_limit: data.token_limit ?? undefined,
    extra_headers: data.extra_headers && Object.keys(data.extra_headers).length > 0 ? data.extra_headers : undefined,
    enabled: data.enabled ?? true,
    models: parsedModels.length > 0 ? parsedModels : undefined,
    created_at: original.created_at,
  };

  return { account, _delete: false };
}
