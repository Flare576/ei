import OpenAI from "openai";

const client = new OpenAI({
  baseURL: process.env.EI_LLM_BASE_URL || "http://127.0.0.1:1234/v1",
  apiKey: process.env.EI_LLM_API_KEY || "not-needed-for-local",
});

const MODEL = process.env.EI_LLM_MODEL || "openai/gpt-oss-20b";
const MAX_TOKENS = 2000;

export class LLMAbortedError extends Error {
  constructor() {
    super("LLM call aborted");
    this.name = "LLMAbortedError";
  }
}

const JSON_REPAIR_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /:\s*0([1-9])([,\s\n\r\]}])/g, replacement: ": 0.$1$2" },
  { pattern: /,(\s*[\]}])/g, replacement: "$1" },
  { pattern: /'/g, replacement: '"' },
];

function repairJSON(jsonStr: string): string {
  return JSON_REPAIR_PATTERNS.reduce(
    (str, { pattern, replacement }) => str.replace(pattern, replacement),
    jsonStr
  );
}

export async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal
): Promise<string | null> {
  if (signal?.aborted) {
    throw new LLMAbortedError();
  }

  const response = await client.chat.completions.create(
    {
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: MAX_TOKENS,
      temperature: 0.7,
    },
    { signal }
  );

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
  signal?: AbortSignal
): Promise<T | null> {
  const response = await callLLM(systemPrompt, userPrompt, signal);
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
