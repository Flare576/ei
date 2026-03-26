import {
  type LLMResponse,
  type Message,
  type Topic,
  type Person,
  type Quote,
} from "../types.js";
import type { StateManager } from "../state-manager.js";
import type { ItemMatchResult, ExposureImpact, TopicUpdateResult, PersonUpdateResult } from "../../prompts/human/types.js";
import { queueTopicUpdate, queuePersonUpdate, type ExtractionContext } from "../orchestrators/index.js";
import { getEmbeddingService, getTopicEmbeddingText, getPersonEmbeddingText } from "../embedding-service.js";
import { calculateExposureCurrent } from "../utils/exposure.js";


import { resolveMessageWindow, getMessageText, normalizeRoomMessages } from "./utils.js";

export function handleTopicMatch(response: LLMResponse, state: StateManager): void {
  const result = response.parsed as ItemMatchResult | undefined;
  if (!result) {
    console.error("[handleTopicMatch] No parsed result");
    return;
  }

  const personaId = response.request.data.personaId as string;
  const personaDisplayName = response.request.data.personaDisplayName as string;
  const roomId = response.request.data.roomId as string | undefined;
  const { messages_context, messages_analyze } = resolveMessageWindow(response, state);

  let matched_guid = result.matched_guid;
  if (matched_guid === "new") {
    matched_guid = null;
  } else if (matched_guid) {
    const human = state.getHuman();
    const found = human.topics.find(t => t.id === matched_guid);
    if (!found) {
      console.warn(`[handleTopicMatch] matched_guid "${matched_guid}" not found in topics — treating as new`);
      matched_guid = null;
    }
  }
  result.matched_guid = matched_guid;

  const context: ExtractionContext & {
    candidateName: string;
    candidateDescription: string;
    candidateCategory: string;
    extraction_model?: string;
  } = {
    personaId,
    personaDisplayName,
    roomId,
    messages_context,
    messages_analyze,
    candidateName: response.request.data.candidateName as string,
    candidateDescription: response.request.data.candidateDescription as string,
    candidateCategory: response.request.data.candidateCategory as string,
    extraction_model: response.request.data.extraction_model as string | undefined,
  };

  queueTopicUpdate(result, context, state);
  const matched = matched_guid ? `matched GUID "${matched_guid}"` : "no match (new topic)";
  console.log(`[handleTopicMatch] topic "${context.candidateName}": ${matched}`);
}

export function handlePersonMatch(response: LLMResponse, state: StateManager): void {
  const result = response.parsed as ItemMatchResult | undefined;
  if (!result) {
    console.error("[handlePersonMatch] No parsed result");
    return;
  }

  const personaId = response.request.data.personaId as string;
  const personaDisplayName = response.request.data.personaDisplayName as string;
  const roomId = response.request.data.roomId as string | undefined;
  const { messages_context, messages_analyze } = resolveMessageWindow(response, state);

  let matched_guid = result.matched_guid;
  if (matched_guid === "new") {
    matched_guid = null;
  } else if (matched_guid) {
    const human = state.getHuman();
    const found = human.people.find(p => p.id === matched_guid);
    if (!found) {
      console.warn(`[handlePersonMatch] matched_guid "${matched_guid}" not found in people — treating as new`);
      matched_guid = null;
    }
  }
  result.matched_guid = matched_guid;

  const context: ExtractionContext & {
    candidateName: string;
    candidateDescription: string;
    candidateRelationship: string;
    extraction_model?: string;
  } = {
    personaId,
    personaDisplayName,
    roomId,
    messages_context,
    messages_analyze,
    candidateName: response.request.data.candidateName as string,
    candidateDescription: response.request.data.candidateDescription as string,
    candidateRelationship: response.request.data.candidateRelationship as string,
    extraction_model: response.request.data.extraction_model as string | undefined,
  };

  queuePersonUpdate(result, context, state);
  const matched = matched_guid ? `matched GUID "${matched_guid}"` : "no match (new person)";
  console.log(`[handlePersonMatch] person "${context.candidateName}": ${matched}`);
}

export async function handleTopicUpdate(response: LLMResponse, state: StateManager): Promise<void> {
  const result = response.parsed as (TopicUpdateResult & { quotes?: Array<{ text: string; reason: string }> }) | undefined;

  if (!result || Object.keys(result).length === 0) {
    console.log("[handleTopicUpdate] No changes needed (empty result)");
    return;
  }

  const isNewItem = response.request.data.isNewItem as boolean;
  const existingItemId = response.request.data.existingItemId as string | undefined;
  const personaId = response.request.data.personaId as string;
  const personaDisplayName = response.request.data.personaDisplayName as string;
  const roomId = response.request.data.roomId as string | undefined;
  const candidateCategory = response.request.data.candidateCategory as string | undefined;

  if (!result.name || !result.description || result.sentiment === undefined) {
    console.error("[handleTopicUpdate] Missing required fields in result");
    return;
  }

  const personaIds = personaId.split("|").filter(Boolean);
  const primaryId = personaIds[0] ?? personaId;

  const now = new Date().toISOString();
  const human = state.getHuman();

  const resolveItemId = (): string => {
    if (isNewItem || !existingItemId) return crypto.randomUUID();
    return human.topics.find(t => t.id === existingItemId) ? existingItemId : crypto.randomUUID();
  };
  const itemId = resolveItemId();

  const persona = state.persona_getById(primaryId);
  const personaGroup = persona?.group_primary ?? null;
  const allPersonaGroups = personaIds
    .map(id => state.persona_getById(id)?.group_primary)
    .filter((g): g is string => g != null);

  const existingTopic = isNewItem ? undefined : human.topics.find(t => t.id === existingItemId);

  let embedding: number[] | undefined;
  try {
    const embeddingService = getEmbeddingService();
    const category = result.category ?? candidateCategory ?? existingTopic?.category;
    const text = getTopicEmbeddingText({ name: result.name, category, description: result.description });
    embedding = await embeddingService.embed(text);
  } catch (err) {
    console.warn(`[handleTopicUpdate] Failed to compute embedding for topic "${result.name}":`, err);
  }

  const exposureImpact = result.exposure_impact as ExposureImpact | undefined;
  const interestedPersonas = isNewItem
    ? personaIds
    : [...new Set([...(existingTopic?.interested_personas ?? []), ...personaIds])];
  const personaGroupsMerged = isNewItem
    ? (allPersonaGroups.length > 0 ? allPersonaGroups : existingTopic?.persona_groups)
    : [...new Set([...(existingTopic?.persona_groups ?? []), ...allPersonaGroups])];

  const topic: Topic = {
    id: itemId,
    name: result.name,
    description: result.description,
    sentiment: result.sentiment,
    category: result.category ?? candidateCategory ?? existingTopic?.category,
    exposure_current: calculateExposureCurrent(exposureImpact, existingTopic?.exposure_current ?? 0),
    exposure_desired: result.exposure_desired ?? 0.5,
    last_updated: now,
    last_mentioned: now,
    learned_by: isNewItem ? primaryId : existingTopic?.learned_by,
    last_changed_by: primaryId,
    interested_personas: interestedPersonas,
    persona_groups: personaGroupsMerged,
    embedding,
  };
  state.human_topic_upsert(topic);

  const allMessages = roomId
    ? normalizeRoomMessages(state.getRoomMessages(roomId), state)
    : state.messages_get(personaId);
  await validateAndStoreQuotes(result.quotes, allMessages, itemId, personaDisplayName, personaGroup, state);

  console.log(`[handleTopicUpdate] ${isNewItem ? "Created" : "Updated"} topic "${result.name}"`);
}

export async function handlePersonUpdate(response: LLMResponse, state: StateManager): Promise<void> {
  const result = response.parsed as (PersonUpdateResult & { quotes?: Array<{ text: string; reason: string }> }) | undefined;

  if (!result || Object.keys(result).length === 0) {
    console.log("[handlePersonUpdate] No changes needed (empty result)");
    return;
  }

  const isNewItem = response.request.data.isNewItem as boolean;
  const existingItemId = response.request.data.existingItemId as string | undefined;
  const personaId = response.request.data.personaId as string;
  const personaDisplayName = response.request.data.personaDisplayName as string;
  const roomId = response.request.data.roomId as string | undefined;
  const candidateRelationship = response.request.data.candidateRelationship as string | undefined;

  if (!result.name || !result.description || result.sentiment === undefined) {
    console.error("[handlePersonUpdate] Missing required fields in result");
    return;
  }

  const personaIds = personaId.split("|").filter(Boolean);
  const primaryId = personaIds[0] ?? personaId;

  const now = new Date().toISOString();
  const human = state.getHuman();

  const resolveItemId = (): string => {
    if (isNewItem || !existingItemId) return crypto.randomUUID();
    return human.people.find(p => p.id === existingItemId) ? existingItemId : crypto.randomUUID();
  };
  const itemId = resolveItemId();

  const persona = state.persona_getById(primaryId);
  const personaGroup = persona?.group_primary ?? null;
  const allPersonaGroups = personaIds
    .map(id => state.persona_getById(id)?.group_primary)
    .filter((g): g is string => g != null);

  const existingPerson = isNewItem ? undefined : human.people.find(p => p.id === existingItemId);

  let embedding: number[] | undefined;
  try {
    const embeddingService = getEmbeddingService();
    const relationship = result.relationship ?? candidateRelationship ?? existingPerson?.relationship;
    const text = getPersonEmbeddingText({ name: result.name, relationship, description: result.description });
    embedding = await embeddingService.embed(text);
  } catch (err) {
    console.warn(`[handlePersonUpdate] Failed to compute embedding for person "${result.name}":`, err);
  }

  const exposureImpact = result.exposure_impact as ExposureImpact | undefined;
  const interestedPersonas = isNewItem
    ? personaIds
    : [...new Set([...(existingPerson?.interested_personas ?? []), ...personaIds])];
  const personaGroupsMerged = isNewItem
    ? (allPersonaGroups.length > 0 ? allPersonaGroups : existingPerson?.persona_groups)
    : [...new Set([...(existingPerson?.persona_groups ?? []), ...allPersonaGroups])];

  const person: Person = {
    id: itemId,
    name: result.name,
    description: result.description,
    sentiment: result.sentiment,
    relationship: result.relationship ?? candidateRelationship ?? existingPerson?.relationship ?? "Unknown",
    exposure_current: calculateExposureCurrent(exposureImpact, existingPerson?.exposure_current ?? 0),
    exposure_desired: result.exposure_desired ?? 0.5,
    last_updated: now,
    last_mentioned: now,
    learned_by: isNewItem ? primaryId : existingPerson?.learned_by,
    last_changed_by: primaryId,
    interested_personas: interestedPersonas,
    persona_groups: personaGroupsMerged,
    embedding,
  };
  state.human_person_upsert(person);

  const allMessages = roomId
    ? normalizeRoomMessages(state.getRoomMessages(roomId), state)
    : state.messages_get(personaId);
  await validateAndStoreQuotes(result.quotes, allMessages, itemId, personaDisplayName, personaGroup, state);

  console.log(`[handlePersonUpdate] ${isNewItem ? "Created" : "Updated"} person "${result.name}"`);
}

function normalizeText(text: string): string {
  return text
    .replace(/[\u201C\u201D]/g, '"')              // curly double quotes
    .replace(/[\u2018\u2019\u0060\u00B4]/g, "'")  // curly single, backtick, acute accent
    .replace(/[\u2014\u2013\u2012]/g, '-')         // em-dash, en-dash, figure dash
    .replace(/\u00A0/g, ' ')                       // non-breaking space
    .replace(/[\u2000-\u200F]/g, ' ')              // unicode space variants
    .replace(/\u2026|\.\.\./g, '\u2026');           // normalize both ellipsis forms → unicode ellipsis (1:1)
}

function stripPunctuation(text: string): string {
  // Remove characters LLMs commonly mangle, keep spaces and alphanumeric
  // Strip: punctuation, unicode punctuation variants, curly quotes, dashes, etc.
  // Keep: letters, digits, spaces
  return text
    .replace(/[^\w\s]/gu, ' ')   // replace non-word, non-space with space
    .replace(/\s+/g, ' ')        // collapse multiple spaces
    .trim()
    .toLowerCase();
}

interface WordBoundaryMatch {
  start: number;
  end: number;
  text: string;
}

function findQuoteByWords(quoteText: string, msgText: string): WordBoundaryMatch | null {
  const strippedQuote = stripPunctuation(quoteText);
  const quoteWords = strippedQuote.split(' ').filter(w => w.length > 0);

  if (quoteWords.length < 3) return null;  // Too short to trust — require at least 3 words

  // Build word token list from original message with original positions
  const wordTokens: Array<{ word: string; start: number; end: number }> = [];
  const wordRegex = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = wordRegex.exec(msgText)) !== null) {
    wordTokens.push({
      word: stripPunctuation(match[0]),
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  // Find contiguous sequence of words matching the quote words
  for (let i = 0; i <= wordTokens.length - quoteWords.length; i++) {
    let allMatch = true;
    for (let j = 0; j < quoteWords.length; j++) {
      if (wordTokens[i + j].word !== quoteWords[j]) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) {
      const startToken = wordTokens[i];
      const endToken = wordTokens[i + quoteWords.length - 1];
      return {
        start: startToken.start,
        end: endToken.end,
        text: msgText.slice(startToken.start, endToken.end),
      };
    }
  }

  return null;
}

async function validateAndStoreQuotes(
  candidates: Array<{ text: string; reason: string }> | undefined,
  messages: Message[],
  dataItemId: string,
  personaName: string,
  personaGroup: string | null,
  state: StateManager
): Promise<void> {
  if (!candidates || candidates.length === 0) return;
  
  for (const candidate of candidates) {
    let found = false;
    for (const message of messages) {
      const msgText = getMessageText(message);

      // Level 1: normalized exact match
      const normalizedMsg = normalizeText(msgText);
      const normalizedQuote = normalizeText(candidate.text);
      const start = normalizedMsg.indexOf(normalizedQuote);

      let matchStart: number;
      let matchEnd: number;
      let matchText: string;
      let matchLevel: string;

      if (start !== -1) {
        matchStart = start;
        matchEnd = start + candidate.text.length;
        matchText = candidate.text;
        matchLevel = "exact";
      } else {
        // Level 2: word-boundary fallback
        const wordMatch = findQuoteByWords(candidate.text, msgText);
        if (!wordMatch) continue;
        matchStart = wordMatch.start;
        matchEnd = wordMatch.end;
        matchText = wordMatch.text;
        matchLevel = "word-boundary";
      }

      const existing = state.human_quote_getForMessage(message.id);
      const overlapping = existing.find(q =>
        q.start !== null && q.end !== null &&
        matchStart < q.end && matchEnd > q.start
      );

      if (overlapping) {
        const mergedStart = Math.min(matchStart, overlapping.start!);
        const mergedEnd = Math.max(matchEnd, overlapping.end!);
        const mergedText = msgText.slice(mergedStart, mergedEnd);

        const mergedDataItemIds = overlapping.data_item_ids.includes(dataItemId)
          ? overlapping.data_item_ids
          : [...overlapping.data_item_ids, dataItemId];
        const group = personaGroup || "General";
        const mergedGroups = overlapping.persona_groups.includes(group)
          ? overlapping.persona_groups
          : [...overlapping.persona_groups, group];

        let embedding = overlapping.embedding;
        if (mergedText !== overlapping.text) {
          try {
            const embeddingService = getEmbeddingService();
            embedding = await embeddingService.embed(mergedText);
          } catch (err) {
            console.warn(`[extraction] Failed to recompute embedding for merged quote: "${mergedText.slice(0, 30)}..."`, err);
          }
        }

        state.human_quote_update(overlapping.id, {
          start: mergedStart,
          end: mergedEnd,
          text: mergedText,
          data_item_ids: mergedDataItemIds,
          persona_groups: mergedGroups,
          embedding,
        });
        console.log(`[extraction] Merged overlapping quote: "${mergedText.slice(0, 50)}..." (${mergedStart}-${mergedEnd})`);
        found = true;
        break;
      }

      let embedding: number[] | undefined;
      try {
        const embeddingService = getEmbeddingService();
        embedding = await embeddingService.embed(matchText);
      } catch (err) {
        console.warn(`[extraction] Failed to compute embedding for quote: "${matchText.slice(0, 30)}..."`, err);
      }

      const quote: Quote = {
        id: crypto.randomUUID(),
        message_id: message.id,
        data_item_ids: [dataItemId],
        persona_groups: [personaGroup || "General"],
        text: matchText,
        speaker: message.role === "human" ? "human" : personaName,
        timestamp: message.timestamp,
        start: matchStart,
        end: matchEnd,
        created_at: new Date().toISOString(),
        created_by: "extraction",
        embedding,
      };
      state.human_quote_add(quote);
      if (matchLevel === "word-boundary") {
        console.log(`[extraction] Captured quote (word-boundary match): "${matchText.slice(0, 50)}..."`);
      } else {
        console.log(`[extraction] Captured quote: "${matchText.slice(0, 50)}..."`);
      }
      found = true;
      break;
    }
    if (!found) {
      console.warn(`[extraction] Quote not found in messages (both levels), skipping: "${candidate.text?.slice(0, 50)}..."`);
    }
  }
}



