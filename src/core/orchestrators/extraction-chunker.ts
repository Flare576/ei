import type { Message } from "../types.js";
import type { ExtractionContext } from "./human-extraction.js";

const DEFAULT_MAX_TOKENS = 10000;
const CHARS_PER_TOKEN = 4;
const CONTEXT_RATIO = 0.15;
const ANALYZE_RATIO = 0.85;
const SYSTEM_PROMPT_BUFFER = 1000;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function estimateMessageTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + estimateTokens(msg.verbal_response ?? '') + 4, 0);
}

function fitMessagesFromEnd(messages: Message[], maxTokens: number): Message[] {
  const result: Message[] = [];
  let tokens = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokens(messages[i].verbal_response ?? '') + 4;
    if (tokens + msgTokens > maxTokens) break;
    result.unshift(messages[i]);
    tokens += msgTokens;
  }

  return result;
}

function pullMessagesFromStart(
  messages: Message[],
  startIndex: number,
  maxTokens: number
): { pulled: Message[]; nextIndex: number } {
  const pulled: Message[] = [];
  let tokens = 0;
  let i = startIndex;

  while (i < messages.length) {
    const msgTokens = estimateTokens(messages[i].verbal_response ?? '') + 4;
    if (tokens + msgTokens > maxTokens && pulled.length > 0) break;
    pulled.push(messages[i]);
    tokens += msgTokens;
    i++;
  }

  return { pulled, nextIndex: i };
}

export interface ChunkedContextResult {
  chunks: ExtractionContext[];
  totalMessages: number;
  estimatedTokensPerChunk: number;
}

export function chunkExtractionContext(
  context: ExtractionContext,
  maxTokens: number = DEFAULT_MAX_TOKENS
): ChunkedContextResult {
  const { personaId, personaDisplayName, messages_context, messages_analyze } = context;

  if (messages_analyze.length === 0) {
    return {
      chunks: [],
      totalMessages: messages_context.length,
      estimatedTokensPerChunk: 0,
    };
  }

  const availableTokens = maxTokens - SYSTEM_PROMPT_BUFFER;
  const contextBudget = Math.floor(availableTokens * CONTEXT_RATIO);
  const analyzeBudget = Math.floor(availableTokens * ANALYZE_RATIO);

  const totalAnalyzeTokens = estimateMessageTokens(messages_analyze);

  if (totalAnalyzeTokens <= analyzeBudget) {
    const fittedContext = fitMessagesFromEnd(messages_context, contextBudget);
    return {
      chunks: [{
        personaId,
        personaDisplayName,
        messages_context: fittedContext,
        messages_analyze,
      }],
      totalMessages: fittedContext.length + messages_analyze.length,
      estimatedTokensPerChunk: estimateMessageTokens(fittedContext) + totalAnalyzeTokens,
    };
  }

  const chunks: ExtractionContext[] = [];
  let currentContext = fitMessagesFromEnd(messages_context, contextBudget);
  let analyzeIndex = 0;

  console.log(`[Chunker] Splitting ${messages_analyze.length} messages (~${totalAnalyzeTokens} tokens) into batches (budget: ${analyzeBudget} tokens/batch)`);

  while (analyzeIndex < messages_analyze.length) {
    const { pulled, nextIndex } = pullMessagesFromStart(
      messages_analyze,
      analyzeIndex,
      analyzeBudget
    );

    if (pulled.length === 0) break;

    chunks.push({
      personaId,
      personaDisplayName,
      messages_context: currentContext,
      messages_analyze: pulled,
    });

    const chunkTokens = estimateMessageTokens(currentContext) + estimateMessageTokens(pulled);
    console.log(`[Chunker] Batch ${chunks.length}: ${currentContext.length} context + ${pulled.length} analyze msgs (~${chunkTokens} tokens)`);

    currentContext = fitMessagesFromEnd(pulled, contextBudget);
    analyzeIndex = nextIndex;
  }

  const avgTokens = chunks.length > 0
    ? Math.floor(chunks.reduce((sum, chunk) =>
        sum + estimateMessageTokens(chunk.messages_context) + estimateMessageTokens(chunk.messages_analyze), 0
      ) / chunks.length)
    : 0;

  return {
    chunks,
    totalMessages: messages_context.length + messages_analyze.length,
    estimatedTokensPerChunk: avgTokens,
  };
}

export function estimateContextTokens(context: ExtractionContext): number {
  return estimateMessageTokens(context.messages_context) +
         estimateMessageTokens(context.messages_analyze) +
         SYSTEM_PROMPT_BUFFER;
}
