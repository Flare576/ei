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
  | { type: "tool-calls"; minCalls?: number; maxCalls?: number; requiredTools?: string[]; forbiddenTools?: string[] };

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
}

export interface EvalResult {
  description: string;
  tags: string[];
  runs: EvalRun[];
  passRate: number;
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

function resolveProvider(): { baseURL: string; model: string; authHeader: string } {
  const provider = process.env.EVAL_PROVIDER;
  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("EVAL_PROVIDER=anthropic requires ANTHROPIC_API_KEY");
    return {
      baseURL: "https://api.anthropic.com/v1",
      model: process.env.EVAL_MODEL ?? "claude-opus-4-6-20251201",
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
}

interface LLMCallResult {
  content: string;
  toolCalls: ToolCallResult[];
}

async function callLLM(system: string, user: string, options: LLMCallOptions = {}): Promise<LLMCallResult> {
  const messages: LLMMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
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

async function runOnce(c: EvalCase): Promise<EvalRun> {
  const start = Date.now();
  const { system, user } = await c.prompt();
  let response = "";
  let toolCalls: ToolCallResult[] = [];
  let assertionResults: EvalRun["assertions"] = [];

  try {
    const result = await callLLM(system, user, {
      tools: c.tools,
      priorMessages: c.priorMessages,
    });
    response = result.content;
    toolCalls = result.toolCalls;

    const responseForAssertions = toolCalls.length > 0 && !response
      ? JSON.stringify(toolCalls)
      : response;

    if (!c.observe && c.assert) {
      assertionResults = await Promise.all(
        c.assert.map(async (a) => {
          const { passed, reason } = await runAssertion(a, responseForAssertions);
          return { type: a.type, passed, reason };
        })
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    assertionResults = (c.assert ?? []).map((a) => ({
      type: a.type,
      passed: false,
      reason: msg,
    }));
  }

  return {
    passed: c.observe ? true : assertionResults.every((a) => a.passed),
    response,
    toolCalls,
    assertions: assertionResults,
    durationMs: Date.now() - start,
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
    results.push({
      description: c.description,
      tags: c.tags ?? [],
      runs,
      passRate: passCount / runs.length,
    });
  }

  const overallPassRate =
    results.reduce((sum, r) => sum + r.passRate, 0) / results.length;
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
    const fullyPassed = assertCases.filter((r) => r.passRate === 1).length;
    console.log(`\nAssertions: ${fullyPassed}/${assertCases.length} fully passed\n`);
    for (const r of assertCases) {
      const isRepeated = r.runs.length > 1;
      const icon = r.passRate === 1 ? "✓" : r.passRate === 0 ? "✗" : "~";
      const repeatLabel = isRepeated
        ? ` [${Math.round(r.passRate * 100)}% over ${r.runs.length} runs]`
        : ` (${r.runs[0].durationMs}ms)`;
      console.log(`  ${icon} ${r.description}${repeatLabel}`);

      if (isRepeated) {
        r.runs.forEach((run, i) => {
          const runIcon = run.passed ? "✓" : "✗";
          console.log(`      run ${i + 1}: ${runIcon} (${run.durationMs}ms)`);
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
      const run = r.runs[0];
      console.log(`  ── ${r.description} (${run.durationMs}ms)`);
      if (run.toolCalls.length > 0) {
        console.log(`     tool_calls: ${JSON.stringify(run.toolCalls, null, 2).replace(/\n/g, "\n     ")}`);
      }
      if (run.response) {
        console.log(`     ${run.response.replace(/\n/g, "\n     ")}`);
      }
    }
  }

  console.log();
}
