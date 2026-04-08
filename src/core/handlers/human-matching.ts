import {
  type LLMResponse,
  type Message,
  type Topic,
  type Person,
  type Quote,
} from "../types.js";
import type { PersonIdentifier } from "../types/data-items.js";
import type { StateManager } from "../state-manager.js";
import type { ItemMatchResult, ExposureImpact, TopicUpdateResult, PersonUpdateResult } from "../../prompts/human/types.js";
import { queueTopicUpdate, queuePersonUpdate, type ExtractionContext } from "../orchestrators/index.js";
import { getEmbeddingService, getTopicEmbeddingText, getPersonEmbeddingText } from "../embedding-service.js";
import { calculateExposureCurrent } from "../utils/exposure.js";


import { resolveMessageWindow, getMessageText, normalizeRoomMessages } from "./utils.js";
import { sanitizeEiPersonaIdentifiers } from "../utils/identifier-utils.js";

export function handleTopicMatch(response: LLMResponse, state: StateManager): void {
  const result = response.parsed as ItemMatchResult | undefined;
  if (!result) {
    throw new Error("[handleTopicMatch] No parsed result");
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
    throw new Error("[handlePersonMatch] No parsed result");
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

  const resolvedName = result.name || existingTopic?.name;
  const resolvedDescription = typeof result.description === 'string' ? result.description : existingTopic?.description;

  if (!resolvedName || !resolvedDescription || result.sentiment === undefined) {
    throw new Error(`[handleTopicUpdate] Missing required fields: name=${resolvedName}, description=${!!resolvedDescription}, sentiment=${result.sentiment}`);
  }

  let embedding: number[] | undefined;
  try {
    const embeddingService = getEmbeddingService();
    const category = result.category ?? candidateCategory ?? existingTopic?.category;
    const text = getTopicEmbeddingText({ name: resolvedName, category, description: resolvedDescription });
    embedding = await embeddingService.embed(text);
  } catch (err) {
    console.warn(`[handleTopicUpdate] Failed to compute embedding for topic "${resolvedName}":`, err);
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
    name: resolvedName,
    description: resolvedDescription,
    sentiment: result.sentiment,
    category: result.category ?? candidateCategory ?? existingTopic?.category,
    exposure_current: calculateExposureCurrent(exposureImpact, existingTopic?.exposure_current ?? 0),
    exposure_desired: result.exposure_desired ?? 0.5,
    last_updated: now,
    learned_on: isNewItem ? now : existingTopic?.learned_on,
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

  console.log(`[handleTopicUpdate] ${isNewItem ? "Created" : "Updated"} topic "${resolvedName}"`);
}

export async function handlePersonUpdate(response: LLMResponse, state: StateManager): Promise<void> {
  const result = response.parsed as (PersonUpdateResult & {
    identifiers?: PersonIdentifier[];
    identifiers_to_add?: PersonIdentifier[];
    quotes?: Array<{ text: string; reason: string }>;
  }) | undefined;

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
  const candidateIdentifiers = (response.request.data.candidateIdentifiers ?? []) as PersonIdentifier[];

  if (!result.description || result.sentiment === undefined) {
    throw new Error(`[handlePersonUpdate] Missing required fields: description=${!!result.description}, sentiment=${result.sentiment}`);
  }

  const candidateName = response.request.data.candidateName as string;
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
    const text = getPersonEmbeddingText({ name: candidateName, relationship, description: result.description });
    embedding = await embeddingService.embed(text);
  } catch (err) {
    console.warn(`[handlePersonUpdate] Failed to compute embedding for person "${candidateName}":`, err);
  }

  const exposureImpact = result.exposure_impact as ExposureImpact | undefined;
  const interestedPersonas = isNewItem
    ? personaIds
    : [...new Set([...(existingPerson?.interested_personas ?? []), ...personaIds])];
  const personaGroupsMerged = isNewItem
    ? (allPersonaGroups.length > 0 ? allPersonaGroups : existingPerson?.persona_groups)
    : [...new Set([...(existingPerson?.persona_groups ?? []), ...allPersonaGroups])];

  let resolvedIdentifiers: PersonIdentifier[];
  if (isNewItem) {
    const llmIdentifiers: PersonIdentifier[] = sanitizeEiPersonaIdentifiers(
      (result.identifiers ?? []).map(i => ({
        type: i.type,
        value: i.value,
        ...(i.is_primary ? { is_primary: i.is_primary } : {}),
      })),
      state
    );
    const allCandidateIds = [...llmIdentifiers, ...candidateIdentifiers];
    if (allCandidateIds.length === 0) {
      const hasSpace = candidateName.includes(' ');
      allCandidateIds.push({ type: hasSpace ? "full_name" : "nickname", value: candidateName, is_primary: true });
    }
    const deduped: PersonIdentifier[] = [];
    for (const id of allCandidateIds) {
      if (!deduped.some(e => e.value === id.value)) {
        deduped.push(id);
      }
    }
    resolvedIdentifiers = deduped;
  } else {
    const base = [...(existingPerson?.identifiers ?? [])];
    const sanitizedToAdd = sanitizeEiPersonaIdentifiers(result.identifiers_to_add ?? [], state);
    for (const id of sanitizedToAdd) {
      if (!base.some(e => e.value === id.value)) {
        base.push({ type: id.type, value: id.value, ...(id.is_primary ? { is_primary: id.is_primary } : {}) });
      }
    }
    resolvedIdentifiers = base;
  }

  const person: Person = {
    id: itemId,
    name: candidateName,
    description: result.description,
    sentiment: result.sentiment,
    relationship: result.relationship ?? candidateRelationship ?? existingPerson?.relationship ?? "Unknown",
    exposure_current: calculateExposureCurrent(exposureImpact, existingPerson?.exposure_current ?? 0),
    exposure_desired: result.exposure_desired ?? 0.5,
    identifiers: resolvedIdentifiers,
    validated_date: isNewItem ? '' : (existingPerson?.validated_date ?? ''),
    last_updated: now,
    learned_on: isNewItem ? now : existingPerson?.learned_on,
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

  const primaryValue = resolvedIdentifiers.find(i => i.is_primary)?.value ?? candidateName;
  const resolvedName = (!primaryValue || primaryValue.toLowerCase() === 'unknown')
    ? (result.relationship ?? candidateRelationship ?? '(unknown)')
    : primaryValue;
  console.log(`[handlePersonUpdate] ${isNewItem ? "Created" : "Updated"} person "${resolvedName}"`);
}


function normalizeText(text: string): string {
  return text
    .replace(/[\u201C\u201D]/g, '"')              // curly double quotes
    .replace(/[\u2018\u2019\u0060\u00B4]/g, "'")  // curly single, backtick, acute accent
    .replace(/[\u2014\u2013\u2012]/g, '-')         // em-dash, en-dash, figure dash
    .replace(/\u00A0/g, ' ')                       // non-breaking space
    .replace(/[\u2000-\u200F]/g, ' ');              // unicode space variants
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

export interface WordBoundaryMatch {
  start: number;
  end: number;
  text: string;
}

export function expandToWordBoundaries(text: string, start: number, end: number): WordBoundaryMatch {
  // Only walk backward if start is mid-word (not already at a word boundary)
  if (start > 0 && !/\s/.test(text[start]))
    while (start > 0 && !/\s/.test(text[start - 1])) start--;
  // Only walk forward if end is mid-word
  if (end > 0 && !/\s/.test(text[end - 1]))
    while (end < text.length && !/\s/.test(text[end])) end++;
  return { start, end, text: text.slice(start, end) };
}

export function findQuoteByWords(quoteText: string, msgText: string): WordBoundaryMatch | null {
  const strippedQuote = stripPunctuation(quoteText);
  const quoteWords = strippedQuote.split(' ').filter(w => w.length > 0);

  if (quoteWords.length < 2) return null;  // Too short to trust — require at least 2 words

  // Build word token list from original message with original positions.
  // Each \S+ token is re-split into sub-tokens (sharing the parent's start/end)
  // so that contractions stripped by stripPunctuation (e.g. don't → "don t")
  // align correctly with quoteWords which is also split on spaces.
  const wordTokens: Array<{ word: string; start: number; end: number }> = [];
  const wordRegex = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = wordRegex.exec(msgText)) !== null) {
    const tokenStart = match.index;
    const tokenEnd = match.index + match[0].length;
    const stripped = stripPunctuation(match[0]);
    const subWords = stripped.split(' ').filter(w => w.length > 0);
    for (const sub of subWords) {
      wordTokens.push({ word: sub, start: tokenStart, end: tokenEnd });
    }
  }

  // Find contiguous sequence of word tokens matching the quote words
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
      return expandToWordBoundaries(msgText, startToken.start, endToken.end);
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
        const expanded = expandToWordBoundaries(msgText, start, start + candidate.text.length);
        matchStart = expanded.start;
        matchEnd = expanded.end;
        matchText = expanded.text;
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
        speaker: message.role === "human" ? "human" : (message.speaker_name ?? personaName),
        channel: personaName,
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



