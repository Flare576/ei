import type { ChatMessage, ProviderAccount, ModelConfig } from "./types.js";
import { KNOWN_MODEL_LIMITS } from "./constants/known-model-limits.js";
import { resolveDataPath } from "./utils/resolve-data-path.js";
const DEFAULT_TOKEN_LIMIT = 8192;
const DEFAULT_MAX_OUTPUT_TOKENS = 8000;

// Lazy verbose network dump — only active when EI_DEBUG_NETWORK_VERBOSE=1.
// Uses dynamic import so the web bundle never pulls in node:fs.
async function writeNetworkDump(
  callNumber: number,
  nextStep: string,
  meta: { model: string; provider: string; latency_ms: number; status_code: number; tokens_in: number; tokens_out: number },
  request: unknown,
  response: unknown
): Promise<void> {
  const dataPath = resolveDataPath();
  if (!dataPath) return;

  try {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const logsDir = join(dataPath as string, "logs");
    mkdirSync(logsDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeName = nextStep.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = join(logsDir, `${timestamp}_call${callNumber}_${safeName}.json`);

    const payload = JSON.stringify({ meta, request, response }, null, 2);
    writeFileSync(filename, payload);
  } catch {
    // Silent — verbose dump failures must never crash the main path
  }
}

export interface ProviderConfig {
  baseURL: string;
  apiKey: string;
  name: string;
}

export interface ResolvedModel {
  provider: string;
  model: string | undefined;
  config: ProviderConfig;
  extraHeaders?: Record<string, string>;
}

export interface LLMCallOptions {
  signal?: AbortSignal;
  temperature?: number;
  /** OpenAI-compatible tools array. When present and non-empty, sent with tool_choice: "auto". */
  tools?: Record<string, unknown>[];
  /** Fire-and-forget callback invoked after a successful response to increment usage counters. */
  onUsageUpdate?: (modelId: string, usage: { calls: number; tokens_in: number; tokens_out: number }) => void;
  /** Queue step name passed through to EI_DEBUG_NETWORK_VERBOSE file dumps. */
  nextStep?: string;
}

export interface LLMRawResponse {
  content: string | null;
  finishReason: string | null;
  /** Raw tool_calls array from the API response, present when finishReason is "tool_calls". */
  rawToolCalls?: unknown[];
  /** The full assistant message object (needed to inject into history for the tool loop). */
  assistantMessage?: Record<string, unknown>;
  /**
   * Extracted thinking/reasoning content, present when the model emits extended thinking.
   * Normalized from three possible API shapes:
   *   1. Separate field: message.reasoning_content (DeepSeek R1, Qwen)
   *   2. Content block array with type='thinking' (Anthropic native API)
   *   3. Inline XML tags: <thinking>...</thinking> — captured before cleanResponseContent strips them
   * Foundation for future 'Beta is thinking...' display in TUI.
   */
  thinking?: string;
}

let llmCallCount = 0;

function resolveApiKey(raw: string | undefined): string {
  if (!raw || !raw.startsWith("$")) return raw ?? "";
  const varName = raw.slice(1);
  const resolved =
    (typeof Bun !== "undefined" && (Bun as { env: Record<string, string> }).env?.[varName]) ||
    (typeof process !== "undefined" && process.env?.[varName]);
  if (!resolved) {
    throw new Error(`Provider API key references env var $${varName}, but it is not set.`);
  }
  return resolved;
}

function isGuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function buildResolvedModel(account: ProviderAccount, model: ModelConfig): ResolvedModel {
  const apiModelId = model.model_id ?? model.name;
  return {
    provider: account.name,
    model: apiModelId === "default" ? undefined : apiModelId,
    config: {
      name: account.name,
      baseURL: account.url,
      apiKey: resolveApiKey(account.api_key),
    },
    extraHeaders: account.extra_headers,
  };
}

export function resolveModelById(
  modelId: string,
  accounts: ProviderAccount[]
): { account: ProviderAccount; model: ModelConfig } | undefined {
  for (const account of accounts) {
    if (!account.enabled || account.type !== "llm") continue;
    const model = account.models?.find((m) => m.id === modelId);
    if (model) return { account, model };
  }
  return undefined;
}

export function getDisplayName(account: ProviderAccount, model: ModelConfig): string {
  if (model.name === "default") return account.name;
  return `${account.name}:${model.name}`;
}

export function resolveModel(modelSpec?: string, accounts?: ProviderAccount[]): ResolvedModel {
  if (!modelSpec) {
    throw new Error("No model specified. Set a provider on this persona with /provider, or set a default_model in settings.");
  }

  if (accounts && isGuid(modelSpec)) {
    const result = resolveModelById(modelSpec, accounts);
    if (result) {
      return buildResolvedModel(result.account, result.model);
    }

    const fallbackAccount = accounts.find((acc) => acc.enabled && acc.type === "llm" && acc.default_model);
    if (fallbackAccount?.default_model) {
      const fallbackResult = resolveModelById(fallbackAccount.default_model, accounts);
      if (fallbackResult) {
        return buildResolvedModel(fallbackResult.account, fallbackResult.model);
      }
    }

    throw new Error(
      `Model "${modelSpec}" not found. It may have been deleted. Update this persona's model in settings.`
    );
  }

  let provider = "";
  let model = modelSpec;

  if (modelSpec.includes(":")) {
    const [p, ...rest] = modelSpec.split(":");
    provider = p;
    model = rest.join(":");
  }

  if (accounts) {
    const searchName = provider || modelSpec;
    const matchingAccount = accounts.find(
      (acc) => acc.name.toLowerCase() === searchName.toLowerCase() && acc.enabled && acc.type === "llm"
    );
    if (matchingAccount) {
      const matchingModel = matchingAccount.models?.find((m) => m.name === model || m.model_id === model);
      if (matchingModel) {
        return buildResolvedModel(matchingAccount, matchingModel);
      }

      if (!provider && matchingAccount.default_model && matchingAccount.models) {
        const defaultModel = matchingAccount.models.find((m) => m.id === matchingAccount.default_model);
        if (defaultModel) {
          return buildResolvedModel(matchingAccount, defaultModel);
        }
      }

      const resolvedModel = provider ? model : (matchingAccount.default_model || model);
      return {
        provider: matchingAccount.name,
        model: resolvedModel,
        config: {
          name: matchingAccount.name,
          baseURL: matchingAccount.url,
          apiKey: resolveApiKey(matchingAccount.api_key),
        },
        extraHeaders: matchingAccount.extra_headers,
      };
    }
  }

  throw new Error(
    `No provider "${provider || modelSpec}" found. Create one with /provider new, or check that it's enabled.`
  );
}

const tokenLimitLoggedModels = new Set<string>();

function findModelAndAccount(
  spec: string,
  accounts: ProviderAccount[]
): { model: ModelConfig | undefined; account: ProviderAccount | undefined } {
  if (spec.includes(":")) {
    const [providerName, ...rest] = spec.split(":");
    const modelName = rest.join(":");
    const account = accounts.find(
      (a) => a.name.toLowerCase() === providerName.toLowerCase() && a.enabled
    );
    const model = account?.models?.find((m) => m.name === modelName || m.model_id === modelName);
    return { model, account };
  }
  // Try matching by model UUID first
  for (const account of accounts) {
    const model = account.models?.find((m) => m.id === spec);
    if (model) return { model, account };
  }
  // Fall back to matching by account name (bare spec like "EG" or "RnP").
  // Mirror resolveModel()'s bare-spec branch: a bare account-name spec resolves to
  // the account's default_model for the actual API call, so the ModelConfig used
  // here for capability defaults (temperature_disabled, max_output_tokens, token_limit)
  // must be that SAME model — not always undefined.
  //
  // default_model isn't reliably a GUID: buildProviderAccounts() (auto-detect/onboarding)
  // stamps it with the raw model NAME, not the newly-generated ModelConfig id — only a
  // manual pick through the model-picker UI rewrites it to a GUID afterward. Match all
  // three shapes so a freshly auto-detected account (the most common real-world state)
  // resolves correctly too, not just one that's been through the picker.
  const accountByName = accounts.find(
    (a) => a.name.toLowerCase() === spec.toLowerCase() && a.enabled
  );
  if (accountByName) {
    const defaultModel = accountByName.default_model
      ? accountByName.models?.find(
          (m) =>
            m.id === accountByName.default_model ||
            m.name === accountByName.default_model ||
            m.model_id === accountByName.default_model
        )
      : undefined;
    return { model: defaultModel, account: accountByName };
  }
  return { model: undefined, account: undefined };
}

export function resolveTokenLimit(
  modelSpec?: string,
  accounts?: ProviderAccount[]
): number {
  const spec = modelSpec || "";

  if (accounts && spec) {
    const { model, account } = findModelAndAccount(spec, accounts);

    if (model?.token_limit) {
      logTokenLimit(spec, "model-config", model.token_limit);
      return model.token_limit;
    }

    if (account?.token_limit) {
      const displayName = spec.includes(":") ? spec.split(":").slice(1).join(":") : spec;
      logTokenLimit(displayName, "user-override", account.token_limit);
      return account.token_limit;
    }
  }

  logTokenLimit(spec, "default", DEFAULT_TOKEN_LIMIT);
  return DEFAULT_TOKEN_LIMIT;
}

function logTokenLimit(model: string, source: string, tokens: number): void {
  if (tokenLimitLoggedModels.has(model)) return;
  tokenLimitLoggedModels.add(model);

  const budget = Math.floor(tokens * 0.75);
  if (source === "default") {
    console.warn(`[TokenLimit] Unknown model "${model}" — using conservative default (${DEFAULT_TOKEN_LIMIT})`);
  } else {
    console.debug(`[TokenLimit] ${model}: ${source} → ${tokens} tokens (extraction budget: ${budget})`);
  }
}

export async function callLLMRaw(
  systemPrompt: string,
  userPrompt: string,
  messages: ChatMessage[] = [],
  modelSpec?: string,
  options: LLMCallOptions = {},
  accounts?: ProviderAccount[]
): Promise<LLMRawResponse> {
  llmCallCount++;
  
  const { signal, temperature = 0.7, onUsageUpdate, nextStep = "unknown" } = options;
  
  if (signal?.aborted) {
    throw new Error("LLM call aborted");
  }
  
  const { model, config, extraHeaders } = resolveModel(modelSpec, accounts);
  const { model: modelConfig } = (accounts && modelSpec)
    ? findModelAndAccount(modelSpec, accounts)
    : { model: undefined };
  const knownLimits = modelConfig ? KNOWN_MODEL_LIMITS[modelConfig.model_id ?? modelConfig.name] : undefined;
  const effectiveTemperatureDisabled = modelConfig?.temperature_disabled ?? knownLimits?.temperature_disabled ?? false;
  const effectiveMaxOutputTokens = modelConfig?.max_output_tokens ?? knownLimits?.max_output_tokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  
  const chatMessages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...messages,
    ...(userPrompt ? [{ role: "user" as const, content: userPrompt }] : []),
  ];
  
  const finalMessages = ensureUserFirst(chatMessages);
  
  if (finalMessages.length !== chatMessages.length) {
    console.log(`[LLM] Injected user-first placeholder (${chatMessages.length} → ${finalMessages.length} messages)`);
  }
  
  const totalChars = finalMessages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
  const estimatedTokens = Math.ceil(totalChars / 4);
  const modelLabel = model ?? "default";
  console.log(`[LLM] Call #${llmCallCount} — ${config.name}:${modelLabel}, ~${estimatedTokens} tokens est.`);
  const _llmCallStart = Date.now();
  
  const normalizedBaseURL = config.baseURL.replace(/\/+$/, "");
  
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    ...(extraHeaders || {}),
  };
  
  // Anthropic requires this header for browser-based CORS access
  if (normalizedBaseURL.includes("anthropic.com")) {
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  }
  
  // Omit temperature for models that don't accept it (e.g. Anthropic extended-thinking models).
  // Also omit when thinking_budget > 0: Anthropic rejects temperature alongside thinking params.
  const sendTemperature =
    !effectiveTemperatureDisabled &&
    !(modelConfig?.thinking_budget !== undefined && modelConfig.thinking_budget > 0);

  const requestBody: Record<string, unknown> = {
    ...(model !== undefined && { model }),
    messages: finalMessages,
    ...(sendTemperature && { temperature }),
    max_tokens: effectiveMaxOutputTokens,
  };

  if (modelConfig?.thinking_budget !== undefined) {
    if (modelConfig.thinking_budget === 0) {
      // Universal kill switch across all known providers. Non-conflicting — each reads
      // whichever field it understands and ignores the rest.
      requestBody.reasoning_effort = "none";  // Ollama, OpenAI-compat
      requestBody.enable_thinking = false;    // Rapid-MLX
    } else {
      // Pass all on-signals: providers that honor the token budget get it (Qwen3, Anthropic),
      // providers that reduce thinking to on/off use reasoning_effort or enable_thinking.
      requestBody.reasoning_effort = "high";
      requestBody.enable_thinking = true;
      requestBody.think = { budget_tokens: modelConfig.thinking_budget };
    }
  }

  if (options.tools && options.tools.length > 0) {
    requestBody.tools = options.tools;
    requestBody.tool_choice = "auto";
  }

  const response = await fetch(`${normalizedBaseURL}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
    signal,
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error (${response.status}): ${errorText}`);
  }
  
  const data = await response.json();

  const _llmLatency = Date.now() - _llmCallStart;
  const tokensIn = data.usage?.prompt_tokens ?? data.usage?.input_tokens ?? 0;
  const tokensOut = data.usage?.completion_tokens ?? data.usage?.output_tokens ?? 0;
  console.log(`[LLM] Response #${llmCallCount} — ${response.status} ${_llmLatency}ms | in: ${tokensIn} out: ${tokensOut}`);

  const isVerbose = (typeof process !== "undefined" && process.env?.EI_DEBUG_NETWORK_VERBOSE === "1") ||
    (typeof Bun !== "undefined" && (Bun as { env: Record<string, string> }).env?.EI_DEBUG_NETWORK_VERBOSE === "1");
  if (isVerbose) {
    void writeNetworkDump(
      llmCallCount,
      nextStep,
      { model: modelLabel, provider: config.name, latency_ms: _llmLatency, status_code: response.status, tokens_in: tokensIn, tokens_out: tokensOut },
      requestBody,
      data
    );
  }

  if (onUsageUpdate && modelConfig) {
    onUsageUpdate(modelConfig.id, { calls: 1, tokens_in: tokensIn, tokens_out: tokensOut });
  }

  const choice = data.choices?.[0];
  
  const assistantMessage = choice?.message as Record<string, unknown> | undefined;
  const rawToolCalls = Array.isArray(choice?.message?.tool_calls)
    ? (choice.message.tool_calls as unknown[])
    : undefined;

  // =========================================================================
  // Extract thinking content — normalize across all three API shapes.
  // =========================================================================
  let thinking: string | undefined;
  let textContent: string | null = (choice?.message?.content as string | null) ?? null;

  // Shape 1: Separate reasoning_content field (DeepSeek R1, Alibaba Qwen)
  const reasoningField = (choice?.message as Record<string, unknown> | undefined)?.reasoning_content;
  if (typeof reasoningField === "string" && reasoningField.trim()) {
    thinking = reasoningField.trim();
  }

  // Shape 2: Content block array with type='thinking' (Anthropic native API)
  if (Array.isArray(choice?.message?.content)) {
    const blocks = choice.message.content as Array<Record<string, unknown>>;
    const thinkingBlocks = blocks
      .filter((b) => b.type === "thinking" && typeof b.thinking === "string")
      .map((b) => b.thinking as string);
    const textBlocks = blocks
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string);
    if (thinkingBlocks.length > 0) {
      thinking = (thinking ? thinking + "\n" : "") + thinkingBlocks.join("\n");
    }
    textContent = textBlocks.join("\n") || null;
  }

  // Shape 3: Inline XML tags — capture before cleanResponseContent strips them downstream.
  if (!thinking && typeof textContent === "string") {
    const inlineMatch = textContent.match(/<\s*think(?:ing)?\s*>([\s\S]*?)<\s*\/\s*think(?:ing)?\s*>/i);
    if (inlineMatch) {
      thinking = inlineMatch[1].trim();
    }
  }

  if (thinking) {
    console.log(`[LLM] Extended thinking detected (${thinking.length} chars)`);
  }

  let finalToolCalls = rawToolCalls;
  if ((!rawToolCalls || rawToolCalls.length === 0) && choice?.finish_reason === "stop" && typeof textContent === "string" && textContent.trimStart().startsWith("<|tool_call>")) {
    const rescued = rescueGemmaToolCalls(textContent);
    if (rescued.length > 0) {
      console.log(`[LLM] Rescued ${rescued.length} tool call(s) from content (Gemma native format)`);
      finalToolCalls = rescued;
      textContent = null;
      if (choice) (choice as Record<string, unknown>).finish_reason = "tool_calls";
    }
  }

  return {
    content: textContent,
    finishReason: choice?.finish_reason ?? null,
    rawToolCalls: finalToolCalls,
    assistantMessage,
    ...(thinking ? { thinking } : {}),
  };
}

/**
 * Ensures the message array starts with a user message after system.
 * Some models (Gemma, Mistral) require system → user → assistant ordering.
 */
function ensureUserFirst(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length === 0) return [];
  
  const result = [...messages];
  
  if (result[0].role === "system" && result.length > 1 && result[1].role === "assistant") {
    result.splice(1, 0, { role: "user", content: "(conversation start)" });
  }
  
  return result;
}

const JSON_REPAIR_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\/\/[^\n]*/g, replacement: "" },
  { pattern: /\\'/g, replacement: "'" },
  { pattern: /:\s*(\d{4}-\d{2}-\d{2}T[^"}\],\n]+)/g, replacement: ': "$1"' },
  { pattern: /:\s*0([1-9][0-9]*)([,\s\n\r\]}])/g, replacement: ": 0.$1$2" },
  { pattern: /,(\s*[\]}])/g, replacement: "$1" },
  { pattern: /"(\s*\n[ \t]+"[a-zA-Z_][a-zA-Z0-9_]*"\s*:)/g, replacement: '",$1' },
];

export function repairJSON(jsonStr: string): string {
  let repaired = JSON_REPAIR_PATTERNS.reduce(
    (str, { pattern, replacement }) => str.replace(pattern, replacement),
    jsonStr
  );
  
  const quoteCount = (repaired.match(/(?<!\\)"/g) || []).length;
  if (quoteCount % 2 !== 0) {
    repaired += '"';
  }
  
  const openBraces = (repaired.match(/{/g) || []).length;
  const closeBraces = (repaired.match(/}/g) || []).length;
  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/\]/g) || []).length;
  
  for (let i = 0; i < openBrackets - closeBrackets; i++) {
    repaired += "]";
  }
  for (let i = 0; i < openBraces - closeBraces; i++) {
    repaired += "}";
  }
  
  return repaired;
}

// =============================================================================
// Gemma native tool call rescue
// =============================================================================

/**
 * Gemma (via LM Studio) occasionally emits tool calls in `content` instead of
 * `tool_calls`, using its native token format:
 *
 *   <|tool_call>call:FUNCTION{param:<|"|>string value<|"|>,bool:true}<tool_call|>
 *
 * This parser extracts those calls and converts them to OpenAI-compatible shape
 * so the rest of the pipeline (parseToolCalls → executeToolCalls) sees a clean
 * contract. Call it when finish_reason is "stop" and tool_calls is empty.
 */
export function rescueGemmaToolCalls(content: string): unknown[] {
  const CALL_RE = /<\|tool_call>call:(\w+)\{([\s\S]*?)\}<tool_call\|>/g;
  const STRING_PARAM_RE = /(\w+):<\|"?\|>([\s\S]*?)<\|"?\|>/g;
  const SCALAR_PARAM_RE = /(\w+):(true|false|-?\d+\.?\d*)/g;

  const rescued: unknown[] = [];
  let callMatch: RegExpExecArray | null;

  while ((callMatch = CALL_RE.exec(content)) !== null) {
    const fnName = callMatch[1];
    const argsStr = callMatch[2];
    const args: Record<string, unknown> = {};

    let m: RegExpExecArray | null;
    STRING_PARAM_RE.lastIndex = 0;
    while ((m = STRING_PARAM_RE.exec(argsStr)) !== null) {
      args[m[1]] = m[2];
    }

    SCALAR_PARAM_RE.lastIndex = 0;
    while ((m = SCALAR_PARAM_RE.exec(argsStr)) !== null) {
      if (!(m[1] in args)) {
        const v = m[2];
        args[m[1]] = v === "true" ? true : v === "false" ? false : Number(v);
      }
    }

    rescued.push({
      id: crypto.randomUUID(),
      type: "function",
      function: { name: fnName, arguments: JSON.stringify(args) },
    });
  }

  return rescued;
}

function findOutermostObject(str: string): string | null {
  const start = str.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < str.length; i++) {
    const ch = str[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return str.slice(start, i + 1);
    }
  }

  return null;
}

export function parseJSONResponse(content: string): unknown {
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : content.trim();

  try {
    return JSON.parse(jsonStr);
  } catch {
    try {
      const repaired = repairJSON(jsonStr);
      return JSON.parse(repaired);
    } catch {
      // Last resort: extract the outermost {...} block from mixed prose/JSON content.
      // Bracket-depth scan (not greedy regex) stops at the first valid close so extra
      // trailing braces from models like Gemma are excluded from the extracted slice.
      const extracted = findOutermostObject(jsonStr);
      if (extracted) {
        try {
          return JSON.parse(extracted);
        } catch {
          return JSON.parse(repairJSON(extracted));
        }
      }
      // Nothing worked — re-throw so the caller gets a proper failure.
      throw new Error(`No parseable JSON found in response (${jsonStr.length} chars)`);
    }
  }
}

export function cleanResponseContent(content: string): string {
  return content
    // Complete paired blocks (space-tolerant, case-insensitive)
    .replace(/<\s*think\s*>[\s\S]*?<\s*\/\s*think\s*>/gi, "")
    .replace(/<\s*thinking\s*>[\s\S]*?<\s*\/\s*thinking\s*>/gi, "")
    // Seed-OSS (ByteDance) namespaced thinking tags — always paired
    .replace(/<seed:think>[\s\S]*?<\/seed:think>/gi, "")
    // Seed-OSS budget reflection tokens (may appear outside stripped think block)
    .replace(/<seed:cot_budget_reflect>[\s\S]*?<\/seed:cot_budget_reflect>/gi, "")
    // Orphaned closing tag with content before it (MiniMax / streaming accumulation)
    .replace(/^[\s\S]*?<\s*\/\s*think(?:ing)?\s*>/i, "")
    // Remaining orphaned closing tags
    .replace(/<\s*\/\s*think(?:ing)?\s*>/gi, "")
    // Remaining orphaned opening tags
    .replace(/<\s*think(?:ing)?\s*>/gi, "")
    .trim();
}
