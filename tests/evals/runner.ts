import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

export interface EvalCase {
  description: string;
  tags?: string[];
  prompt: () => { system: string; user: string };
  assert?: Assertion[];
  observe?: true;
}

export type Assertion =
  | { type: "is-json"; schema?: Record<string, unknown> }
  | { type: "llm-judge"; rubric: string };

export interface EvalResult {
  description: string;
  tags: string[];
  passed: boolean;
  response: string;
  assertions: { type: string; passed: boolean; reason: string }[];
  durationMs: number;
}

export interface EvalRunSummary {
  model: string;
  baseURL: string;
  ranAt: string;
  cases: EvalResult[];
  passRate: number;
}

const LOCAL_LLM_BASE_URL = process.env.LOCAL_LLM_BASE_URL ?? "http://localhost:1234/v1";
const LOCAL_LLM_MODEL = process.env.LOCAL_LLM_MODEL ?? "google/gemma-4-26b-a4b";

async function callLLM(system: string, user: string): Promise<string> {
  const res = await fetch(`${LOCAL_LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer local" },
    body: JSON.stringify({
      model: LOCAL_LLM_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.7,
    }),
  });
  if (!res.ok) throw new Error(`LLM call failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0].message.content.trim();
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

  if (assertion.type === "llm-judge") {
    const judgeSystem = `You are an evaluator. Given an LLM response and a rubric, reply with exactly one word: PASS or FAIL, followed by a single sentence explaining why.`;
    const judgeUser = `Rubric: ${assertion.rubric}\n\nResponse to evaluate:\n${response}`;
    const verdict = await callLLM(judgeSystem, judgeUser);
    const passed = verdict.trimStart().toUpperCase().startsWith("PASS");
    return { passed, reason: verdict.replace(/^(PASS|FAIL)[.:,]?\s*/i, "").trim() };
  }

  return { passed: false, reason: `Unknown assertion type` };
}

export async function runEval(
  cases: EvalCase[],
  outputPath: string
): Promise<EvalRunSummary> {
  const results: EvalResult[] = [];

  for (const c of cases) {
    const start = Date.now();
    const { system, user } = c.prompt();
    let response = "";
    let assertionResults: EvalResult["assertions"] = [];

    try {
      response = await callLLM(system, user);
      if (!c.observe && c.assert) {
        assertionResults = await Promise.all(
          c.assert.map(async (a) => {
            const { passed, reason } = await runAssertion(a, response);
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

    results.push({
      description: c.description,
      tags: c.tags ?? [],
      passed: c.observe ? true : assertionResults.every((a) => a.passed),
      response,
      assertions: assertionResults,
      durationMs: Date.now() - start,
    });
  }

  const passed = results.filter((r) => r.passed).length;
  const summary: EvalRunSummary = {
    model: LOCAL_LLM_MODEL,
    baseURL: LOCAL_LLM_BASE_URL,
    ranAt: new Date().toISOString(),
    cases: results,
    passRate: passed / results.length,
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(summary, null, 2));

  return summary;
}

export function printSummary(summary: EvalRunSummary): void {
  const assertCases = summary.cases.filter((r) => r.assertions.length > 0);
  const observeCases = summary.cases.filter((r) => r.assertions.length === 0);
  const passed = assertCases.filter((r) => r.passed).length;

  console.log(`\nModel: ${summary.model}`);
  console.log(`Ran: ${summary.ranAt}`);

  if (assertCases.length > 0) {
    console.log(`\nAssertions: ${passed}/${assertCases.length} passed\n`);
    for (const r of assertCases) {
      const icon = r.passed ? "✓" : "✗";
      console.log(`  ${icon} ${r.description} (${r.durationMs}ms)`);
      for (const a of r.assertions) {
        if (!a.passed) console.log(`      ↳ [${a.type}] ${a.reason}`);
      }
    }
  }

  if (observeCases.length > 0) {
    console.log(`\nObservations (${observeCases.length}):\n`);
    for (const r of observeCases) {
      console.log(`  ── ${r.description} (${r.durationMs}ms)`);
      console.log(`     ${r.response.replace(/\n/g, "\n     ")}`);
    }
  }

  console.log();
}
