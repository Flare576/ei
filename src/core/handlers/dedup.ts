import { StateManager } from "../state-manager.js";
import { LLMResponse } from "../types.js";
import type { DedupResult } from "../../prompts/ceremony/types.js";
import type { DataItemType, Fact, Topic, Person, PersonIdentifier, Quote } from "../types/data-items.js";
import { getEmbeddingService } from "../embedding-service.js";

/**
 * handleDedupCurate — Process Opus deduplication decisions
 * 
 * This handler receives merge decisions from Opus and applies them:
 * 1. Updates: Entities with revised descriptions/merged data
 * 2. Removes: Duplicate entities to delete (with foreign key updates)
 * 3. Adds: New entities created from consolidation
 * 
 * CRITICAL: Quote foreign keys must be updated BEFORE deletions to maintain
 * referential integrity.
 */
export async function handleDedupCurate(
  response: LLMResponse,
  stateManager: StateManager
): Promise<void> {
  const entity_type = response.request.data.entity_type as DataItemType;
  const entity_ids = response.request.data.entity_ids as string[];
  const state = stateManager.getHuman();
  
  // Validate entity_type
  if (!entity_type || !['topic', 'person'].includes(entity_type)) {
    console.error(`[Dedup] Invalid entity_type: "${entity_type}" (from request data)`, response.request.data);
    return;
  }
  
  // Parse Opus response
  let decisions: DedupResult;
  try {
    decisions = response.parsed as DedupResult;
    if (!decisions || typeof decisions !== 'object') {
      throw new Error("Invalid response format");
    }
  } catch (err) {
    console.error(`[Dedup] Failed to parse Opus response:`, err);
    return;
  }
  
  // Validate response structure
  if (!Array.isArray(decisions.update) || !Array.isArray(decisions.remove) || !Array.isArray(decisions.add)) {
    console.error(`[Dedup] Invalid response structure - missing update/remove/add arrays`);
    return;
  }
  
  console.log(`[Dedup] Processing cluster: ${decisions.update.length} updates, ${decisions.remove.length} removals, ${decisions.add.length} additions`);

  // Pre-compute: for each survivor (replaced_by), union the removed entity's groups.
  // Must happen before any phase mutates state so we read the original values.
  const groupsToMerge = new Map<string, { persona_groups: string[]; interested_personas: string[]; learned_on?: string; identifiers?: PersonIdentifier[] }>();

  // Map entity_type to pluralized state property name
  const pluralMap: Record<string, 'facts' | 'topics' | 'people'> = {
    fact: 'facts',
    topic: 'topics',
    person: 'people'
  };
  const entityList = state[pluralMap[entity_type]];
  
  // Validate entityList exists
  if (!entityList || !Array.isArray(entityList)) {
    console.error(`[Dedup] entityList is ${entityList === undefined ? 'undefined' : 'not an array'} for entity_type="${entity_type}" (looking for state.${entity_type}s)`, {
      entity_type,
      entity_ids,
      stateKeys: Object.keys(state),
      factsExists: !!state.facts,
      topicsExists: !!state.topics,
      peopleExists: !!state.people
    });
    return;
  }
  const entities = entity_ids
    .map((id: string) => entityList.find((e: Fact | Topic | Person) => e.id === id))
    .filter((e: Fact | Topic | Person | undefined): e is (Fact | Topic | Person) => e !== undefined);
  
  if (entities.length === 0) {
    console.warn(`[Dedup] No entities found for cluster (already merged?)`);
    return;
  }

  for (const removal of decisions.remove) {
    const removed = entities.find(e => e.id === removal.to_be_removed);
    if (!removed) continue;
    const acc = groupsToMerge.get(removal.replaced_by) ?? { persona_groups: [], interested_personas: [] };
    const candidates = [acc.learned_on, removed.learned_on].filter(Boolean) as string[];

    let mergedIdentifiers: PersonIdentifier[] | undefined;
    if (entity_type === 'person') {
      const removedPerson = removed as Person;
      const accIdentifiers = acc.identifiers ?? [];
      mergedIdentifiers = [...accIdentifiers];
      for (const id of (removedPerson.identifiers ?? [])) {
        if (!mergedIdentifiers.some(existing => existing.value === id.value)) {
          mergedIdentifiers.push(id);
        }
      }
    }

    groupsToMerge.set(removal.replaced_by, {
      persona_groups: [...new Set([...acc.persona_groups, ...(removed.persona_groups ?? [])])],
      interested_personas: [...new Set([...acc.interested_personas, ...(removed.interested_personas ?? [])])],
      learned_on: candidates.length > 0 ? candidates.sort()[0] : undefined,
      ...(entity_type === 'person' && { identifiers: mergedIdentifiers }),
    });
  }

  const clusterGroups = [...new Set(entities.flatMap(e => e.persona_groups ?? []))];
  const clusterPersonas = [...new Set(entities.flatMap(e => e.interested_personas ?? []))];

  // =========================================================================
  // PHASE 1: Update Quote foreign keys FIRST (before deletions)
  // =========================================================================

  const liveEntityIds = new Set(entityList.map((e: Fact | Topic | Person) => e.id));

  for (const removal of decisions.remove) {
    const quotes = state.quotes.filter((q: Quote) =>
      q.data_item_ids.includes(removal.to_be_removed)
    );
    
    for (const quote of quotes) {
      const updatedIds = quote.data_item_ids
        .map((id: string) => id === removal.to_be_removed ? removal.replaced_by : id)
        .filter((id: string) => liveEntityIds.has(id))         // Drop links to already-merged entities
        .filter((id: string, idx: number, arr: string[]) => arr.indexOf(id) === idx);  // Dedupe
      
      stateManager.human_quote_update(quote.id, {
        data_item_ids: updatedIds
      });
    }
    
    if (quotes.length > 0) {
      console.log(`[Dedup] Updated ${quotes.length} quotes referencing ${removal.to_be_removed}`);
    }
  }
  
  // =========================================================================
  // PHASE 2: Apply updates (merge decisions)
  // =========================================================================
  
  for (const update of decisions.update) {
    const entity = entityList.find((e: Fact | Topic | Person) => e.id === update.id);
    
    if (!entity) {
      console.warn(`[Dedup] Entity ${update.id} not found (already merged?)`);
      continue;  // Graceful skip
    }
    
    // Recalculate embedding if description changed
    let embedding = entity.embedding;
    if (update.description !== entity.description) {
      try {
        const embeddingService = getEmbeddingService();
        embedding = await embeddingService.embed(update.description);
      } catch (err) {
        console.warn(`[Dedup] Failed to recalculate embedding for ${update.id}`, err);
        // Fallback to old embedding if recalculation fails
      }
    }
    
    const mergedFromRemoved = groupsToMerge.get(update.id);
    const minLearned = mergedFromRemoved?.learned_on
      ? [entity.learned_on, mergedFromRemoved.learned_on].filter(Boolean).sort()[0]
      : entity.learned_on;
    const updatedEntity = {
      ...entity,
      name: update.name ?? entity.name,
      description: update.description ?? entity.description,
      sentiment: update.sentiment ?? entity.sentiment,
      last_updated: new Date().toISOString(),
      ...(minLearned !== undefined && { learned_on: minLearned }),
      embedding,
      persona_groups: mergedFromRemoved
        ? [...new Set([...(entity.persona_groups ?? []), ...mergedFromRemoved.persona_groups])]
        : entity.persona_groups,
      interested_personas: mergedFromRemoved
        ? [...new Set([...(entity.interested_personas ?? []), ...mergedFromRemoved.interested_personas])]
        : entity.interested_personas,
      ...(update.strength !== undefined && { strength: update.strength }),
      ...(update.confidence !== undefined && { confidence: update.confidence }),
      ...(update.exposure_current !== undefined && { exposure_current: update.exposure_current }),
      ...(update.exposure_desired !== undefined && { exposure_desired: update.exposure_desired }),
      ...(update.relationship !== undefined && { relationship: update.relationship }),
      ...(update.category !== undefined && { category: update.category }),
      ...(entity_type === 'person' && mergedFromRemoved?.identifiers !== undefined && (() => {
        const existingIds = (entity as Person).identifiers ?? [];
        const result: PersonIdentifier[] = [...existingIds];
        for (const id of mergedFromRemoved.identifiers!) {
          if (!result.some(e => e.value === id.value)) result.push(id);
        }
        return { identifiers: result };
      })()),
    };
    
    // Type-safe cast based on entity_type
    if (entity_type === 'fact') {
      stateManager.human_fact_upsert(updatedEntity as Fact);
    } else if (entity_type === 'topic') {
      stateManager.human_topic_upsert(updatedEntity as Topic);
    } else if (entity_type === 'person') {
      stateManager.human_person_upsert(updatedEntity as Person);
    }
    console.log(`[Dedup] Updated ${entity_type} "${update.name}"`);
  }
  
  // =========================================================================
  // PHASE 3: Apply removals (soft-delete with replaced_by tracking)
  // =========================================================================
  
  for (const removal of decisions.remove) {
    const entity = entityList.find((e: Fact | Topic | Person) => e.id === removal.to_be_removed);
    
    if (!entity) {
      console.warn(`[Dedup] Entity ${removal.to_be_removed} already deleted`);
      continue;  // Graceful skip
    }
    
    // Remove via StateManager (also cleans up quote references)
    const removeMethod = `human_${entity_type}_remove` as 
      'human_fact_remove' | 'human_topic_remove' | 'human_person_remove';
    
    const removed = stateManager[removeMethod](removal.to_be_removed);
    if (removed) {
      console.log(`[Dedup] Removed ${entity_type} "${entity.name}" (merged into ${removal.replaced_by})`);
    }
  }
  
  // =========================================================================
  // PHASE 4: Apply additions (new entities from consolidation)
  // =========================================================================
  
  for (const addition of decisions.add) {
    // Compute embedding for new entity
    let embedding: number[] | undefined;
    try {
      const embeddingService = getEmbeddingService();
      embedding = await embeddingService.embed(addition.description);
    } catch (err) {
      console.warn(`[Dedup] Failed to compute embedding for new entity "${addition.name}"`, err);
      continue;  // Skip this addition if embedding fails
    }
    
    // Generate ID for new entity
    const id = crypto.randomUUID();
    
    const now = new Date().toISOString();
    const newEntity = {
      id,
      type: entity_type,
      name: addition.name,
      description: addition.description,
      sentiment: addition.sentiment ?? 0.0,
      last_updated: now,
      learned_on: now,
      learned_by: "ei",
      last_changed_by: "ei",
      embedding,
      persona_groups: clusterGroups,
      interested_personas: clusterPersonas,
      ...((entity_type === 'topic' || entity_type === 'person') && {
        exposure_current: addition.exposure_current ?? 0.0,
        exposure_desired: addition.exposure_desired ?? 0.5,
        last_ei_asked: null
      }),
      ...(entity_type === 'person' && { identifiers: [], validated_date: '', relationship: addition.relationship ?? 'Unknown' }),
      ...(entity_type === 'topic' && { category: addition.category ?? 'Interest' }),
    };
    
    // Type-safe cast based on entity_type
    if (entity_type === 'topic') {
      stateManager.human_topic_upsert(newEntity as Topic);
    } else if (entity_type === 'person') {
      stateManager.human_person_upsert(newEntity as Person);
    }
    console.log(`[Dedup] Added new ${entity_type} "${addition.name}"`);
  }
}
