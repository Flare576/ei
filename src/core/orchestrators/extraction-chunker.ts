import type { Message } from "../types.js";
import type { ExtractionContext } from "./human-extraction.js";
import { getMessageContent } from "../handlers/utils.js";
import { getMessageDisplayText } from "../../prompts/message-utils.js";

const DEFAULT_MAX_TOKENS = 10000;
const CHARS_PER_TOKEN = 4;
const CONTEXT_RATIO = 0.15;
const MAX_CONTEXT_TOKENS = 1000;
const ANALYZE_RATIO = 0.85;
const SYSTEM_PROMPT_BUFFER = 1000;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function estimateSingleMessageTokens(message: Message): number {
  // Must match what actually gets hydrated into the provider prompt — includes silence_reason,
  // not just raw content — so admission checks below can't under-price a message relative to
  // what's really sent.
  const text = getMessageDisplayText(message) ?? getMessageContent(message);
  return estimateTokens(text) + 4;
}

function estimateMessageTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + estimateSingleMessageTokens(msg), 0);
}

function fitMessagesFromEnd(messages: Message[], maxTokens: number): Message[] {
  const result: Message[] = [];
  let tokens = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msgTokens = estimateSingleMessageTokens(messages[i]);
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
    const msgTokens = estimateSingleMessageTokens(messages[i]);
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
  const { personaId, channelDisplayName: personaDisplayName, messages_context, messages_analyze } = context;

  if (messages_analyze.length === 0) {
    return {
      chunks: [],
      totalMessages: messages_context.length,
      estimatedTokensPerChunk: 0,
    };
  }

  const availableTokens = maxTokens - SYSTEM_PROMPT_BUFFER;
  const analyzeBudget = Math.floor(availableTokens * ANALYZE_RATIO);

  const totalAnalyzeTokens = estimateMessageTokens(messages_analyze);

  if (totalAnalyzeTokens <= analyzeBudget) {
    const contextBudget = Math.min(Math.floor(CONTEXT_RATIO * totalAnalyzeTokens), MAX_CONTEXT_TOKENS);
    const fittedContext = fitMessagesFromEnd(messages_context, contextBudget);
    return {
      chunks: [{
        personaId,
        channelDisplayName: personaDisplayName,
        messages_context: fittedContext,
        messages_analyze,
      }],
      totalMessages: fittedContext.length + messages_analyze.length,
      estimatedTokensPerChunk: estimateMessageTokens(fittedContext) + totalAnalyzeTokens,
    };
  }

  const chunks: ExtractionContext[] = [];
  let currentContextPool = messages_context;
  let analyzeIndex = 0;

  console.log(`[Chunker] Splitting ${messages_analyze.length} messages (~${totalAnalyzeTokens} tokens) into batches (budget: ${analyzeBudget} tokens/batch)`);

  while (analyzeIndex < messages_analyze.length) {
    const { pulled, nextIndex } = pullMessagesFromStart(
      messages_analyze,
      analyzeIndex,
      analyzeBudget
    );

    if (pulled.length === 0) break;

    const analyzeTokensForChunk = estimateMessageTokens(pulled);
    const contextBudget = Math.min(Math.floor(CONTEXT_RATIO * analyzeTokensForChunk), MAX_CONTEXT_TOKENS);
    const chunkContext = fitMessagesFromEnd(currentContextPool, contextBudget);

    chunks.push({
      personaId,
      channelDisplayName: personaDisplayName,
      messages_context: chunkContext,
      messages_analyze: pulled,
    });

    const chunkTokens = estimateMessageTokens(chunkContext) + analyzeTokensForChunk;
    console.log(`[Chunker] Batch ${chunks.length}: ${chunkContext.length} context + ${pulled.length} analyze msgs (~${chunkTokens} tokens)`);

    currentContextPool = pulled;
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
