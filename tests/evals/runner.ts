import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { hydratePromptPlaceholders } from "../../src/prompts/message-utils.js";
import type { Message } from "../../src/core/types/llm.js";

export function hydratePrompt(
  prompt: { system: string; user: string },
  messages: Message[]
): { system: string; user: string } {
  const map = new Map<string, Message>();
  for (const msg of messages) map.set(msg.id, msg);
  return {
    system: hydratePromptPlaceholders(prompt.system, map),
    user: hydratePromptPlaceholders(prompt.user, map),
  };
}

export interface EvalCase {
  description: string;
  tags?: string[];
  prompt: () => { system: string; user: string } | Promise<{ system: string; user: string }>;
  tools?: unknown[];
  priorMessages?: LLMMessage[];
  assert?: Assertion[];
  observe?: true;
  repeat?: number;
  /**
   * Minimum pass rate across repeated runs (0.0–1.0). Default: 1.0 (all runs must pass).
   * Use for cases with known nondeterminism — tag with "borderline" when setting below 1.0.
   * Example: pass_threshold: 0.67 means 2 of 3 runs must pass.
   */
  pass_threshold?: number;
  /**
   * Extra fields merged into the LLM request body. Use to set provider-specific params
   * without touching the global runner. Example:
   *   extraBody: { reasoning_effort: "none" }  // disable thinking for Gemma via LM Studio
   */
  extraBody?: Record<string, unknown>;
  /** If set, runOnce drives a multi-turn agentic loop: the model's tool calls are executed by
   *  this function and the results fed back into the conversation until the model stops calling
   *  tools or maxTurns is hit. Absent = the original single-shot path (unchanged). */
  toolExecutor?: (call: ToolCallResult) => string | Promise<string>;
  /** Max agentic turns before the loop stops (default 8). Only used when toolExecutor is set. */
  maxTurns?: number;
}

export interface ExtractionExpected {
  name: string;
  value: string;
}

export type Assertion =
  | { type: "is-json"; schema?: Record<string, unknown> }
  | { type: "llm-judge"; rubric: string }
  | { type: "contains-none-of"; field: string; forbidden: string[] }
  | { type: "contains-all-of"; field: string; required: string[] }
  | { type: "json-field-length"; field: string; min?: number; max?: number }
  | { type: "extraction-score"; arrayField: string; nameField: string; valueField: string; expected: ExtractionExpected[]; threshold: number }
  | { type: "tool-calls"; minCalls?: number; maxCalls?: number; requiredTools?: string[]; forbiddenTools?: string[] }
  | { type: "end-state"; name?: string; check: () => boolean | { passed: boolean; reason?: string } | Promise<boolean | { passed: boolean; reason?: string }> };

export interface ToolCallResult {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMMessage {
  role: "user" | "assistant" | "tool" | "system";
  content?: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
}

export interface EvalRun {
  passed: boolean;
  response: string;
  toolCalls: ToolCallResult[];
  assertions: { type: string; passed: boolean; reason: string }[];
  durationMs: number;
  modelDurationMs: number;
  usage: LLMUsage;
}

export interface EvalResult {
  description: string;
  tags: string[];
  runs: EvalRun[];
  passRate: number;
  passed: boolean;
  pass_threshold: number;
}

export interface EvalRunSummary {
  model: string;
  baseURL: string;
  ranAt: string;
  cases: EvalResult[];
  overallPassRate: number;
  totalElapsedMs: number;
}

const LOCAL_LLM_BASE_URL = process.env.LOCAL_LLM_BASE_URL ?? "http://localhost:1234/v1";
const LOCAL_LLM_MODEL = process.env.LOCAL_LLM_MODEL ?? "google/gemma-4-26b-a4b";
const EVAL_NO_THINKING = process.env.EVAL_NO_THINKING === "1";

function resolveProvider(): { baseURL: string; model: string; authHeader: string } {
  const provider = process.env.EVAL_PROVIDER;
  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("EVAL_PROVIDER=anthropic requires ANTHROPIC_API_KEY");
    return {
      baseURL: "https://api.anthropic.com/v1",
      model: process.env.EVAL_MODEL ?? "claude-opus-4-6",
      authHeader: `x-api-key: ${apiKey}`,
    };
  }
  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("EVAL_PROVIDER=openai requires OPENAI_API_KEY");
    return {
      baseURL: "https://api.openai.com/v1",
      model: process.env.EVAL_MODEL ?? "gpt-4o",
      authHeader: `Bearer ${apiKey}`,
    };
  }
  return {
    baseURL: LOCAL_LLM_BASE_URL,
    model: process.env.EVAL_MODEL ?? LOCAL_LLM_MODEL,
    authHeader: "Bearer local",
  };
}

const PROVIDER = resolveProvider();

interface LLMCallOptions {
  tools?: unknown[];
  priorMessages?: LLMMessage[];
  extraBody?: Record<string, unknown>;
}

interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
}

interface LLMCallResult {
  content: string;
  toolCalls: ToolCallResult[];
  usage: LLMUsage;
}

async function callLLM(system: string, user: string, options: LLMCallOptions = {}): Promise<LLMCallResult> {
  const messages: LLMMessage[] = [
    { role: "system", content: system },
    ...(user ? [{ role: "user" as const, content: user }] : []),
    ...(options.priorMessages ?? []),
  ];

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (PROVIDER.authHeader.startsWith("x-api-key:")) {
    headers["x-api-key"] = PROVIDER.authHeader.slice("x-api-key: ".length);
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers["Authorization"] = PROVIDER.authHeader;
  }

  const body: Record<string, unknown> = {
    model: PROVIDER.model,
    messages,
    temperature: 0.7,
    ...options.extraBody,
  };
  if (options.tools?.length) body.tools = options.tools;

  const res = await fetch(`${PROVIDER.baseURL}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LLM call failed: ${res.status} ${await res.text()}`);

  const data = (await res.json()) as {
    choices: Array<{
      message: {
        content?: string;
        tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
      };
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      completion_tokens_details?: { reasoning_tokens?: number };
    };
  };

  const message = data.choices[0].message;
  const toolCalls: ToolCallResult[] = (message.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })(),
  }));

  return {
    content: message.content?.trim() ?? "",
    toolCalls,
    usage: {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    },
  };
}

function extractJSON(raw: string): unknown {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1].trim() : raw.trim();
  return JSON.parse(candidate);
}

function validateSchema(value: unknown, schema: Record<string, unknown>): string | null {
  if (schema.required && Array.isArray(schema.required)) {
    for (const key of schema.required as string[]) {
      if (typeof value !== "object" || value === null || !(key in value)) {
        return `Missing required field: "${key}"`;
      }
    }
  }
  return null;
}

async function runAssertion(
  assertion: Assertion,
  response: string
): Promise<{ passed: boolean; reason: string }> {
  if (assertion.type === "is-json") {
    try {
      const parsed = extractJSON(response);
      if (assertion.schema) {
        const err = validateSchema(parsed, assertion.schema);
        if (err) return { passed: false, reason: err };
      }
      return { passed: true, reason: "Valid JSON" };
    } catch {
      return { passed: false, reason: "Response is not valid JSON" };
    }
  }

  if (assertion.type === "extraction-score") {
    let parsed: Record<string, unknown>;
    try {
      parsed = extractJSON(response) as Record<string, unknown>;
    } catch {
      return { passed: false, reason: "Response is not valid JSON — cannot score extraction" };
    }

    const extracted = (parsed[assertion.arrayField] as Record<string, unknown>[] | undefined) ?? [];
    const extractedNames = extracted.map((e) => String(e[assertion.nameField] ?? "").toLowerCase());

    const matched: string[] = [];
    const missed: string[] = [];

    for (const exp of assertion.expected) {
      const idx = extractedNames.indexOf(exp.name.toLowerCase());
      if (idx !== -1) {
        matched.push(exp.name);
      } else {
        missed.push(exp.name);
      }
    }

    const unexpected = extracted
      .map((e) => String(e[assertion.nameField] ?? ""))
      .filter((n) => !assertion.expected.some((e) => e.name.toLowerCase() === n.toLowerCase()));

    const recall = assertion.expected.length > 0 ? matched.length / assertion.expected.length : 1;
    const precision = extracted.length > 0
      ? (extracted.length - unexpected.length) / extracted.length
      : 1;
    const score = (recall + precision) / 2;
    const passed = score >= assertion.threshold;

    const parts = [
      `Score: ${(score * 100).toFixed(0)}% (recall: ${(recall * 100).toFixed(0)}%, precision: ${(precision * 100).toFixed(0)}%)`,
      `Matched ${matched.length}/${assertion.expected.length} expected.`,
    ];
    if (missed.length) parts.push(`Missed: ${missed.join(", ")}.`);
    if (unexpected.length) parts.push(`Unexpected (not in expected set): ${unexpected.join(", ")}.`);

    return { passed, reason: parts.join(" ") };
  }

  if (assertion.type === "json-field-length") {
    let parsed: Record<string, unknown>;
    try {
      parsed = extractJSON(response) as Record<string, unknown>;
    } catch {
      return { passed: false, reason: "Response is not valid JSON — cannot check field length" };
    }
    const parts = assertion.field.split(".");
    let value: unknown = parsed;
    for (const part of parts) {
      value = (value as Record<string, unknown>)?.[part];
    }
    const len = typeof value === "string" ? value.length : -1;
    if (len === -1) return { passed: false, reason: `Field "${assertion.field}" is not a string` };
    if (assertion.min !== undefined && len < assertion.min)
      return { passed: false, reason: `Field "${assertion.field}" is ${len} chars, below minimum ${assertion.min}` };
    if (assertion.max !== undefined && len > assertion.max)
      return { passed: false, reason: `Field "${assertion.field}" is ${len} chars, above maximum ${assertion.max}` };
    return { passed: true, reason: `Field "${assertion.field}" is ${len} chars (within ${assertion.min ?? 0}–${assertion.max ?? "∞"})` };
  }

  if (assertion.type === "contains-none-of") {
    let parsed: Record<string, unknown>;
    try {
      parsed = extractJSON(response) as Record<string, unknown>;
    } catch {
      return { passed: false, reason: "Response is not valid JSON — cannot check fields" };
    }
    const fieldValue = String(parsed[assertion.field] ?? "");
    const hit = assertion.forbidden.find((phrase) =>
      fieldValue.toLowerCase().includes(phrase.toLowerCase())
    );
    return hit
      ? { passed: false, reason: `Field "${assertion.field}" contains forbidden phrase: "${hit}"` }
      : { passed: true, reason: `No forbidden phrases found in "${assertion.field}"` };
  }

  if (assertion.type === "contains-all-of") {
    let parsed: Record<string, unknown>;
    try {
      parsed = extractJSON(response) as Record<string, unknown>;
    } catch {
      return { passed: false, reason: "Response is not valid JSON — cannot check fields" };
    }
    const parts = assertion.field.split(".");
    let value: unknown = parsed;
    for (const part of parts) {
      const idx = parseInt(part, 10);
      if (!isNaN(idx)) {
        value = (value as unknown[])?.[idx];
      } else {
        value = (value as Record<string, unknown>)?.[part];
      }
    }
    const fieldValue = Array.isArray(value)
      ? value.map((v) => String(v ?? "")).join(" ").toLowerCase()
      : String(value ?? "").toLowerCase();
    const missing = assertion.required.filter(
      (phrase) => !fieldValue.includes(phrase.toLowerCase())
    );
    return missing.length === 0
      ? { passed: true, reason: `All ${assertion.required.length} required phrases found` }
      : { passed: false, reason: `Missing from "${assertion.field}": ${missing.map((p) => `"${p}"`).join(", ")}` };
  }

  if (assertion.type === "tool-calls") {
    const toolCallsJson = response;
    let calls: ToolCallResult[] = [];
    try {
      const parsed = JSON.parse(toolCallsJson);
      calls = Array.isArray(parsed) ? parsed as ToolCallResult[] : [];
    } catch { calls = []; }

    if (assertion.minCalls !== undefined && calls.length < assertion.minCalls)
      return { passed: false, reason: `Expected at least ${assertion.minCalls} tool call(s), got ${calls.length}` };
    if (assertion.maxCalls !== undefined && calls.length > assertion.maxCalls)
      return { passed: false, reason: `Expected at most ${assertion.maxCalls} tool call(s), got ${calls.length}` };

    for (const required of assertion.requiredTools ?? []) {
      if (!calls.some((c) => c.name === required))
        return { passed: false, reason: `Required tool "${required}" was not called` };
    }
    for (const forbidden of assertion.forbiddenTools ?? []) {
      if (calls.some((c) => c.name === forbidden))
        return { passed: false, reason: `Forbidden tool "${forbidden}" was called` };
    }
    return { passed: true, reason: `${calls.length} tool call(s) — constraints satisfied` };
  }

  if (assertion.type === "llm-judge") {
    const judgeSystem = `You are an evaluator. Given an LLM response and a rubric, reply with exactly one word: PASS or FAIL, followed by a single sentence explaining why.`;
    const judgeUser = `Rubric: ${assertion.rubric}\n\nResponse to evaluate:\n${response}`;
    const { content: verdict } = await callLLM(judgeSystem, judgeUser);
    const passed = verdict.trimStart().toUpperCase().startsWith("PASS");
    return { passed, reason: verdict.replace(/^(PASS|FAIL)[.:,]?\s*/i, "").trim() };
  }

  return { passed: false, reason: `Unknown assertion type` };
}

function renderTranscript(messages: LLMMessage[]): string {
  return messages
    .map((m) => {
      if (m.role === "assistant") {
        const calls = (m.tool_calls ?? [])
          .map((t) => `  → ${t.function.name}(${t.function.arguments})`)
          .join("\n");
        return `ASSISTANT: ${m.content ?? ""}${calls ? "\n" + calls : ""}`;
      }
      if (m.role === "tool") return `TOOL[${m.name}] → ${m.content ?? ""}`;
      return `${m.role.toUpperCase()}: ${m.content ?? ""}`;
    })
    .join("\n\n");
}

// Multi-turn agentic loop: model calls tools → toolExecutor runs them → results fed back → repeat.
async function runAgenticLoop(
  system: string,
  user: string,
  c: EvalCase,
  extraBody: Record<string, unknown> | undefined,
): Promise<{ finalContent: string; allToolCalls: ToolCallResult[]; transcript: string; modelDurationMs: number; usage: LLMUsage }> {
  const messages: LLMMessage[] = [...(c.priorMessages ?? [])];
  if (user) messages.push({ role: "user", content: user });
  const allToolCalls: ToolCallResult[] = [];
  let finalContent = "";
  let modelDurationMs = 0;
  const usage: LLMUsage = { promptTokens: 0, completionTokens: 0, reasoningTokens: 0 };
  const maxTurns = c.maxTurns ?? 8;

  for (let turn = 0; turn < maxTurns; turn++) {
    const ms = Date.now();
    const r = await callLLM(system, "", { tools: c.tools, priorMessages: messages, extraBody });
    modelDurationMs += Date.now() - ms;
    usage.promptTokens += r.usage.promptTokens;
    usage.completionTokens += r.usage.completionTokens;
    usage.reasoningTokens += r.usage.reasoningTokens;
    finalContent = r.content;

    const assistantMsg: LLMMessage = { role: "assistant" };
    if (r.content) assistantMsg.content = r.content;
    if (r.toolCalls.length) {
      assistantMsg.tool_calls = r.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      }));
    }
    messages.push(assistantMsg);

    if (!r.toolCalls.length) break; // model is done — no more tool calls

    for (const call of r.toolCalls) {
      allToolCalls.push(call);
      let result: string;
      try {
        result = await c.toolExecutor!(call);
      } catch (e) {
        result = JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
      }
      messages.push({ role: "tool", tool_call_id: call.id, name: call.name, content: result });
    }
  }

  return { finalContent, allToolCalls, transcript: renderTranscript(messages), modelDurationMs, usage };
}

async function runOnce(c: EvalCase): Promise<EvalRun> {
  const start = Date.now();
  const { system, user } = await c.prompt();
  const extraBody = EVAL_NO_THINKING ? { ...c.extraBody, reasoning_effort: "none" } : c.extraBody;
  let response = "";
  let toolCalls: ToolCallResult[] = [];
  let responseForAssertions = "";
  let assertionResults: EvalRun["assertions"] = [];
  let modelDurationMs = 0;
  let usage: LLMUsage = { promptTokens: 0, completionTokens: 0, reasoningTokens: 0 };

  try {
    if (c.toolExecutor) {
      const loop = await runAgenticLoop(system, user, c, extraBody);
      response = loop.finalContent;
      toolCalls = loop.allToolCalls;
      responseForAssertions = loop.transcript;
      modelDurationMs = loop.modelDurationMs;
      usage = loop.usage;
    } else {
      const modelStart = Date.now();
      const result = await callLLM(system, user, { tools: c.tools, priorMessages: c.priorMessages, extraBody });
      modelDurationMs = Date.now() - modelStart;
      response = result.content;
      toolCalls = result.toolCalls;
      usage = result.usage;
      responseForAssertions = toolCalls.length > 0 && !response ? JSON.stringify(toolCalls) : response;
    }

    if (!c.observe && c.assert) {
      assertionResults = await Promise.all(
        c.assert.map(async (a) => {
          if (a.type === "end-state") {
            const raw = await a.check();
            const norm = typeof raw === "boolean" ? { passed: raw, reason: raw ? "end-state ok" : "end-state check failed" } : raw;
            return { type: a.type, passed: norm.passed, reason: norm.reason ?? "" };
          }
          const { passed, reason } = await runAssertion(a, responseForAssertions);
          return { type: a.type, passed, reason };
        }),
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    assertionResults = (c.assert ?? []).map((a) => ({ type: a.type, passed: false, reason: msg }));
  }

  return {
    passed: c.observe ? true : assertionResults.every((a) => a.passed),
    response,
    toolCalls,
    assertions: assertionResults,
    durationMs: Date.now() - start,
    modelDurationMs,
    usage,
  };
}

export async function runEval(
  cases: EvalCase[],
  outputPath: string
): Promise<EvalRunSummary> {
  const filterArg = process.argv.find(a => a.startsWith("--filter="))?.slice("--filter=".length);
  const activeFilter = filterArg ?? process.env.EVAL_FILTER;
  if (activeFilter) {
    const needle = activeFilter.toLowerCase();
    cases = cases.filter(c =>
      c.description.toLowerCase().includes(needle) ||
      (c.tags ?? []).some(t => t.toLowerCase().includes(needle))
    );
    if (cases.length === 0) {
      console.error(`No eval cases matched filter: "${activeFilter}"`);
      process.exit(1);
    }
    console.log(`Filter "${activeFilter}" matched ${cases.length} case(s)`);
  }

  const results: EvalResult[] = [];
  const suiteStart = Date.now();

  for (const c of cases) {
    const n = c.repeat ?? 1;
    const runs: EvalRun[] = [];
    for (let i = 0; i < n; i++) {
      const caseStart = Date.now();
      const label = n > 1 ? `  ${c.description} [${i + 1}/${n}]` : `  ${c.description}`;
      process.stdout.write(`${label}...\r`);
      runs.push(await runOnce(c));
      const elapsed = ((Date.now() - caseStart) / 1000).toFixed(1);
      process.stdout.write(`${label} (${elapsed}s)   \r`);
    }
    process.stdout.write("\n");

    const passCount = runs.filter((r) => r.passed).length;
    const passRate = passCount / runs.length;
    const threshold = c.pass_threshold ?? 1.0;
    results.push({
      description: c.description,
      tags: c.tags ?? [],
      runs,
      passRate,
      passed: c.observe ? true : passRate >= threshold,
      pass_threshold: threshold,
    });
  }

  const overallPassRate = results.length > 0
    ? results.filter(r => r.passed).length / results.length
    : 1;
  const totalElapsedMs = Date.now() - suiteStart;

  const summary: EvalRunSummary = {
    model: PROVIDER.model,
    baseURL: PROVIDER.baseURL,
    ranAt: new Date().toISOString(),
    cases: results,
    overallPassRate,
    totalElapsedMs,
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(summary, null, 2));

  return summary;
}

export function printSummary(summary: EvalRunSummary): void {
  const assertCases = summary.cases.filter((r) => r.runs.some((run) => run.assertions.length > 0));
  const observeCases = summary.cases.filter((r) => r.runs.every((run) => run.assertions.length === 0));

  const mins = Math.floor(summary.totalElapsedMs / 60000);
  const secs = ((summary.totalElapsedMs % 60000) / 1000).toFixed(1);
  const elapsed = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  console.log(`\nModel: ${summary.model}`);
  console.log(`Ran: ${summary.ranAt} (total: ${elapsed})`);

  if (assertCases.length > 0) {
    const fullyPassed = assertCases.filter((r) => r.passed).length;
    console.log(`\nAssertions: ${fullyPassed}/${assertCases.length} passed\n`);
    for (const r of assertCases) {
      const isRepeated = r.runs.length > 1;
      const icon = r.passed ? "✓" : "✗";
      const thresholdLabel = r.pass_threshold < 1.0 ? ` (threshold: ${Math.round(r.pass_threshold * 100)}%)` : "";
      const formatTokens = (run: EvalRun) => {
        const { promptTokens, completionTokens, reasoningTokens } = run.usage;
        if (completionTokens === 0) return "";
        const contentTokens = completionTokens - reasoningTokens;
        const tps = run.modelDurationMs > 0 ? (completionTokens / (run.modelDurationMs / 1000)).toFixed(0) : "?";
        const reasoningPct = reasoningTokens > 0 ? ` reason=${reasoningTokens}` : "";
        return ` | model=${run.modelDurationMs}ms ${tps}tok/s in=${promptTokens} out=${contentTokens}${reasoningPct}`;
      };

      const repeatLabel = isRepeated
        ? ` [${Math.round(r.passRate * 100)}% over ${r.runs.length} runs${thresholdLabel}]`
        : ` (${r.runs[0].durationMs}ms${formatTokens(r.runs[0])})`;
      console.log(`  ${icon} ${r.description}${repeatLabel}`);

      if (isRepeated) {
        r.runs.forEach((run, i) => {
          const runIcon = run.passed ? "✓" : "✗";
          console.log(`      run ${i + 1}: ${runIcon} (${run.durationMs}ms${formatTokens(run)})`);
          for (const a of run.assertions) {
            if (!a.passed) console.log(`           ↳ [${a.type}] ${a.reason}`);
          }
        });
      } else {
        for (const a of r.runs[0].assertions) {
          if (!a.passed) console.log(`      ↳ [${a.type}] ${a.reason}`);
          else if (a.type === "extraction-score") console.log(`      ↳ [score] ${a.reason}`);
        }
      }
    }
  }

  if (observeCases.length > 0) {
    console.log(`\nObservations (${observeCases.length}):\n`);
    for (const r of observeCases) {
      const isRepeated = r.runs.length > 1;
      const toolCallCount = r.runs.filter(run => run.toolCalls.length > 0).length;
      const repeatLabel = isRepeated ? ` [${toolCallCount}/${r.runs.length} called tool]` : "";
      console.log(`  ── ${r.description}${repeatLabel}`);
      for (const [i, run] of r.runs.entries()) {
        const { promptTokens, completionTokens, reasoningTokens } = run.usage;
        const contentTokens = completionTokens - reasoningTokens;
        const tps = run.modelDurationMs > 0 && completionTokens > 0 ? ` ${(completionTokens / (run.modelDurationMs / 1000)).toFixed(0)}tok/s` : "";
        const tokenLabel = completionTokens > 0 ? ` in=${promptTokens} out=${contentTokens}${reasoningTokens > 0 ? ` reason=${reasoningTokens}` : ""}${tps}` : "";
        const timeLabel = `model=${run.modelDurationMs}ms total=${run.durationMs}ms${tokenLabel}`;
        const runLabel = isRepeated ? `     run ${i + 1} (${timeLabel})` : `     (${timeLabel})`;
        console.log(runLabel);
        if (run.toolCalls.length > 0) {
          console.log(`     tool_calls: ${JSON.stringify(run.toolCalls, null, 2).replace(/\n/g, "\n     ")}`);
        }
        if (run.response) {
          console.log(`     ${run.response.replace(/\n/g, "\n     ")}`);
        }
      }
    }
  }

  console.log();
}
