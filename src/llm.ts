import OpenAI from "openai";

const client = new OpenAI({
  baseURL: process.env.EI_LLM_BASE_URL || "http://127.0.0.1:1234/v1",
  apiKey: process.env.EI_LLM_API_KEY || "not-needed-for-local",
});

// const MODEL = process.env.EI_LLM_MODEL || "openai/gpt-oss-20b";
const MODEL = process.env.EI_LLM_MODEL || "google/gemma-3-12b";

export class LLMAbortedError extends Error {
  constructor() {
    super("LLM call aborted");
    this.name = "LLMAbortedError";
  }
}

const JSON_REPAIR_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Fix leading zeros: 03 → 0.3, 015 → 0.15
  { pattern: /:\s*0([1-9][0-9]*)([,\s\n\r\]}])/g, replacement: ": 0.$1$2" },
  // Remove trailing commas before ] or }
  { pattern: /,(\s*[\]}])/g, replacement: "$1" },
];

function repairJSON(jsonStr: string): string {
  return JSON_REPAIR_PATTERNS.reduce(
    (str, { pattern, replacement }) => str.replace(pattern, replacement),
    jsonStr
  );
}

export interface LLMOptions {
  signal?: AbortSignal;
  temperature?: number;
}

function isAbortError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.name === "AbortError" || err.message.includes("aborted");
  }
  return false;
}

export async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  options: LLMOptions = {}
): Promise<string | null> {
  const { signal, temperature = 0.7 } = options;
  if (signal?.aborted) {
    throw new LLMAbortedError();
  }

  let response;
  try {
    response = await client.chat.completions.create(
      {
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature,
      },
      { signal }
    );
  } catch (err) {
    if (signal?.aborted || isAbortError(err)) {
      throw new LLMAbortedError();
    }
    throw err;
  }

  if (signal?.aborted) {
    throw new LLMAbortedError();
  }

  const content = response.choices[0]?.message?.content?.trim() ?? null;

  if (!content) return null;

  const noMessagePatterns = [
    /^no message$/i,
    /^\[no message\]$/i,
    /^no response$/i,
    /^\[no response\]$/i,
  ];

  for (const pattern of noMessagePatterns) {
    if (pattern.test(content)) return null;
  }

  return content;
}

export async function callLLMForJSON<T>(
  systemPrompt: string,
  userPrompt: string,
  options: LLMOptions = {}
): Promise<T | null> {
  const response = await callLLM(systemPrompt, userPrompt, options);
  if (!response) return null;

  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  let jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim();

  try {
    return JSON.parse(jsonStr) as T;
  } catch (firstErr) {
    const repaired = repairJSON(jsonStr);
    try {
      console.warn("[LLM] JSON repair applied");
      return JSON.parse(repaired) as T;
    } catch (secondErr) {
      console.error("[LLM] Failed to parse JSON even after repair:");
      console.error("[LLM] Original:", jsonStr.substring(0, 300));
      console.error("[LLM] Repaired:", repaired.substring(0, 300));
      throw new Error(`Invalid JSON from LLM: ${secondErr instanceof Error ? secondErr.message : String(secondErr)}`);
    }
  }
}
