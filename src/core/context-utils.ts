import type { Message, HumanEntity, Quote, DataItemBase } from "./types.js";
import { ContextStatus as ContextStatusEnum } from "./types.js";

// =============================================================================
// CONTEXT FILTERING
// =============================================================================

export function filterMessagesForContext(
  messages: Message[],
  contextBoundary: string | undefined,
  contextWindowMs: number
): Message[] {
  if (messages.length === 0) return [];

  const now = Date.now();
  const windowStartMs = now - contextWindowMs;
  const boundaryMs = contextBoundary ? new Date(contextBoundary).getTime() : 0;

  return messages.filter((msg) => {
    if (msg.external === true) return false;
    if (msg.context_status === ContextStatusEnum.Always) return true;
    if (msg.context_status === ContextStatusEnum.Never) return false;

    const msgMs = new Date(msg.timestamp).getTime();

    if (msgMs < windowStartMs) return false;
    if (contextBoundary && msgMs < boundaryMs) return false;

    return true;
  });
}

// =============================================================================
// EMBEDDING STRIPPING - Remove embeddings from data items before returning to FE
// Embeddings are internal implementation details for similarity search.
// =============================================================================

export function stripDataItemEmbedding<T extends DataItemBase>(item: T): T {
  const { embedding, ...rest } = item;
  return rest as T;
}

export function stripQuoteEmbedding(quote: Quote): Quote {
  const { embedding, ...rest } = quote;
  return rest;
}

export function stripHumanEmbeddings(human: HumanEntity): HumanEntity {
  return {
    ...human,
    facts: (human.facts ?? []).map(stripDataItemEmbedding),
    topics: (human.topics ?? []).map(stripDataItemEmbedding),
    people: (human.people ?? []).map(stripDataItemEmbedding),
    quotes: (human.quotes ?? []).map(stripQuoteEmbedding),
  };
}
