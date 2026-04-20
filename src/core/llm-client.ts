import type { ChatMessage, ProviderAccount, ModelConfig } from "./types.js";
const DEFAULT_TOKEN_LIMIT = 8192;
const DEFAULT_MAX_OUTPUT_TOKENS = 8000;

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
      apiKey: account.api_key || "",
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
          apiKey: matchingAccount.api_key || "",
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
  // Fall back to matching by account name (bare spec like "EG" or "RnP")
  const accountByName = accounts.find(
    (a) => a.name.toLowerCase() === spec.toLowerCase() && a.enabled
  );
  if (accountByName) return { model: undefined, account: accountByName };
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
    console.log(`[TokenLimit] ${model}: ${source} → ${tokens} tokens (extraction budget: ${budget})`);
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
  
  const { signal, temperature = 0.7, onUsageUpdate } = options;
  
  if (signal?.aborted) {
    throw new Error("LLM call aborted");
  }
  
  const { model, config, extraHeaders } = resolveModel(modelSpec, accounts);
  const { model: modelConfig } = (accounts && modelSpec)
    ? findModelAndAccount(modelSpec, accounts)
    : { model: undefined };
  
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
  console.log(`[LLM] Call #${llmCallCount} - ~${estimatedTokens} tokens (${totalChars} chars)`);
  
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
  
  const requestBody: Record<string, unknown> = {
    ...(model !== undefined && { model }),
    messages: finalMessages,
    temperature,
    max_tokens: modelConfig?.max_output_tokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
  };

  if (modelConfig?.thinking_budget !== undefined) {
    requestBody.think = { budget_tokens: modelConfig.thinking_budget };
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

  if (onUsageUpdate && modelConfig) {
    const tokensIn = data.usage?.prompt_tokens ?? data.usage?.input_tokens ?? 0;
    const tokensOut = data.usage?.completion_tokens ?? data.usage?.output_tokens ?? 0;
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
      // Handles 'thinking prose...\n{...json...}' responses from extended-thinking models.
      const outerMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (outerMatch) {
        const extracted = outerMatch[0];
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
