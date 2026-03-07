import {
  LLMRequestType,
  LLMPriority,
  LLMNextStep,
  ValidationLevel,
  type LLMResponse,
  type Fact,
  type Trait,
  type Topic,
  type Person,
  type Quote,
  type DataItemBase,
} from "../types.js";
import type { StateManager } from "../state-manager.js";
import type {
  RewriteItemType,
  RewriteScanResult,
  RewriteResult,
  RewriteSubjectMatch,
} from "../../prompts/ceremony/types.js";
import { buildRewritePrompt } from "../../prompts/ceremony/rewrite.js";
import { getEmbeddingService, getItemEmbeddingText } from "../embedding-service.js";

// =============================================================================
// REWRITE HANDLER INJECTION
// searchHumanData lives on Processor — inject it at startup to avoid circular deps.
// Same pattern as registerReadMemoryExecutor in tools/index.ts.
// =============================================================================

type SearchHumanDataFn = (
  query: string,
  options?: { types?: Array<'fact' | 'trait' | 'topic' | 'person' | 'quote'>; limit?: number }
) => Promise<{
  facts: Fact[];
  traits: Trait[];
  topics: Topic[];
  people: Person[];
  quotes: Quote[];
}>;

let _searchHumanData: SearchHumanDataFn | null = null;

/** Called by Processor at startup to inject searchHumanData for rewrite handlers. */
export function registerSearchHumanData(fn: SearchHumanDataFn): void {
  _searchHumanData = fn;
}

/**
 * handleRewriteScan — Phase 1 of Rewrite.
 * LLM returns an array of subject strings found in the bloated item.
 * For each subject we search the knowledge base, then queue Phase 2.
 */
export async function handleRewriteScan(response: LLMResponse, state: StateManager): Promise<void> {
  const itemId = response.request.data.itemId as string;
  const itemType = response.request.data.itemType as RewriteItemType;
  const rewriteModel = response.request.data.rewriteModel as string;

  if (!itemId || !itemType) {
    console.error("[handleRewriteScan] Missing itemId or itemType in request data");
    return;
  }

  const subjects = response.parsed as RewriteScanResult | undefined;
  if (!subjects || !Array.isArray(subjects) || subjects.length === 0) {
    console.log(`[handleRewriteScan] No extra subjects found for ${itemType} "${itemId}" — item is cohesive`);
    return;
  }

  if (!_searchHumanData) {
    console.error("[handleRewriteScan] searchHumanData not injected — cannot search for matches");
    return;
  }

  // Re-read the item from current state (it may have changed since scan was queued)
  const human = state.getHuman();
  const allItems: DataItemBase[] = [
    ...human.facts, ...human.traits, ...human.topics, ...human.people,
  ];
  const currentItem = allItems.find(i => i.id === itemId);
  if (!currentItem) {
    console.warn(`[handleRewriteScan] Item ${itemId} no longer exists — skipping rewrite`);
    return;
  }

  // Search for matches per subject, excluding the original item
  const subjectMatches: RewriteSubjectMatch[] = [];
  for (const searchTerm of subjects) {
    try {
      const results = await _searchHumanData(searchTerm, {
        types: ["fact", "trait", "topic", "person"],
        limit: 4,  // fetch 4 so we can exclude original and still have 3
      });
      const allMatches: DataItemBase[] = [
        ...results.facts, ...results.traits, ...results.topics, ...results.people,
      ].filter(m => m.id !== itemId);  // exclude original
      subjectMatches.push({ searchTerm, matches: allMatches.slice(0, 3) });
    } catch (err) {
      console.warn(`[handleRewriteScan] Search failed for "${searchTerm}":`, err);
      subjectMatches.push({ searchTerm, matches: [] });
    }
  }

  // Build Phase 2 prompt and queue it
  const prompt = buildRewritePrompt({
    item: currentItem,
    itemType,
    subjects: subjectMatches,
  });

  state.queue_enqueue({
    type: LLMRequestType.JSON,
    priority: LLMPriority.Normal,
    system: prompt.system,
    user: prompt.user,
    next_step: LLMNextStep.HandleRewriteRewrite,
    model: rewriteModel,
    data: {
      itemId,
      itemType,
    },
  });

  console.log(`[handleRewriteScan] Queued Phase 2 for ${itemType} "${currentItem.name}" with ${subjectMatches.length} subject(s)`);
}

/**
 * handleRewriteRewrite — Phase 2 of Rewrite.
 * LLM returns { existing: [...], new: [...] }.
 * Upsert existing items by id, create new items with defensive defaults + embeddings.
 */
export async function handleRewriteRewrite(response: LLMResponse, state: StateManager): Promise<void> {
  const itemId = response.request.data.itemId as string;
  const itemType = response.request.data.itemType as RewriteItemType;

  if (!itemId || !itemType) {
    console.error("[handleRewriteRewrite] Missing itemId or itemType in request data");
    return;
  }

  const result = response.parsed as RewriteResult | undefined;
  if (!result || (!result.existing?.length && !result.new?.length)) {
    console.log(`[handleRewriteRewrite] No changes returned for ${itemType} "${itemId}"`);
    return;
  }

  const human = state.getHuman();
  const now = new Date().toISOString();

  // Look up the original item to inherit persona_groups
  const allItems: DataItemBase[] = [
    ...human.facts, ...human.traits, ...human.topics, ...human.people,
  ];
  const originalItem = allItems.find(i => i.id === itemId);
  const inheritedGroups = originalItem?.persona_groups;

  // Helper: resolve actual type from existing records (don't trust LLM's type field)
  const resolveExistingType = (id: string): RewriteItemType | null => {
    if (human.facts.find(f => f.id === id)) return "fact";
    if (human.traits.find(t => t.id === id)) return "trait";
    if (human.topics.find(t => t.id === id)) return "topic";
    if (human.people.find(p => p.id === id)) return "person";
    return null;
  };

  let existingCount = 0;
  let newCount = 0;

  // --- Process existing items ---
  for (const item of result.existing ?? []) {
    if (!item.id || !item.name || !item.description) {
      console.warn(`[handleRewriteRewrite] Skipping existing item with missing fields: ${JSON.stringify(item).slice(0, 100)}`);
      continue;
    }

    // Resolve type from actual records, not from LLM response
    const resolvedType = resolveExistingType(item.id);
    if (!resolvedType) {
      console.warn(`[handleRewriteRewrite] Existing item id "${item.id}" not found in human data — skipping`);
      continue;
    }

    let embedding: number[] | undefined;
    try {
      const embeddingService = getEmbeddingService();
      const text = getItemEmbeddingText({ name: item.name, description: item.description });
      embedding = await embeddingService.embed(text);
    } catch (err) {
      console.warn(`[handleRewriteRewrite] Failed to compute embedding for existing ${resolvedType} "${item.name}":`, err);
    }

    switch (resolvedType) {
      case "fact": {
        const existing = human.facts.find(f => f.id === item.id)!;
        state.human_fact_upsert({
          ...existing,
          name: item.name,
          description: item.description,
          sentiment: item.sentiment ?? existing.sentiment,
          last_updated: now,
          embedding,
        });
        break;
      }
      case "trait": {
        const existing = human.traits.find(t => t.id === item.id)!;
        state.human_trait_upsert({
          ...existing,
          name: item.name,
          description: item.description,
          sentiment: item.sentiment ?? existing.sentiment,
          strength: item.strength ?? existing.strength,
          last_updated: now,
          embedding,
        });
        break;
      }
      case "topic": {
        const existing = human.topics.find(t => t.id === item.id)!;
        state.human_topic_upsert({
          ...existing,
          name: item.name,
          description: item.description,
          sentiment: item.sentiment ?? existing.sentiment,
          last_updated: now,
          embedding,
        });
        break;
      }
      case "person": {
        const existing = human.people.find(p => p.id === item.id)!;
        state.human_person_upsert({
          ...existing,
          name: item.name,
          description: item.description,
          sentiment: item.sentiment ?? existing.sentiment,
          last_updated: now,
          embedding,
        });
        break;
      }
    }
    existingCount++;
  }

  // --- Process new items ---
  for (const item of result.new ?? []) {
    if (!item.type || !item.name || !item.description) {
      console.warn(`[handleRewriteRewrite] Skipping new item with missing fields: ${JSON.stringify(item).slice(0, 100)}`);
      continue;
    }

    let embedding: number[] | undefined;
    try {
      const embeddingService = getEmbeddingService();
      const text = getItemEmbeddingText({ name: item.name, description: item.description });
      embedding = await embeddingService.embed(text);
    } catch (err) {
      console.warn(`[handleRewriteRewrite] Failed to compute embedding for new ${item.type} "${item.name}":`, err);
    }

    const baseFields = {
      id: crypto.randomUUID(),
      name: item.name,
      description: item.description,
      sentiment: item.sentiment ?? 0,
      last_updated: now,
      learned_by: "ei",
      persona_groups: inheritedGroups,
      embedding,
    };

    switch (item.type) {
      case "fact": {
        const fact: Fact = {
          ...baseFields,
          validated: ValidationLevel.None,
          validated_date: now,
        };
        state.human_fact_upsert(fact);
        break;
      }
      case "trait": {
        const trait: Trait = {
          ...baseFields,
          strength: item.strength ?? 0.5,
        };
        state.human_trait_upsert(trait);
        break;
      }
      case "topic": {
        if (!item.category) {
          console.warn(`[handleRewriteRewrite] New topic "${item.name}" missing category — defaulting to "Interest"`);
        }
        const topic: Topic = {
          ...baseFields,
          category: item.category ?? "Interest",
          exposure_current: 0.5,
          exposure_desired: 0.5,
        };
        state.human_topic_upsert(topic);
        break;
      }
      case "person": {
        if (!item.relationship) {
          console.warn(`[handleRewriteRewrite] New person "${item.name}" missing relationship — defaulting to "Unknown"`);
        }
        const person: Person = {
          ...baseFields,
          relationship: item.relationship ?? "Unknown",
          exposure_current: 0.5,
          exposure_desired: 0.5,
        };
        state.human_person_upsert(person);
        break;
      }
      default:
        console.warn(`[handleRewriteRewrite] Unknown type "${item.type}" for new item "${item.name}" — skipping`);
    }
    newCount++;
  }

  console.log(`[handleRewriteRewrite] Complete for ${itemType} "${itemId}": ${existingCount} existing updated, ${newCount} new created`);
}
