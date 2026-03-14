import { StateManager } from "../state-manager.js";
import { LLMRequestType, LLMPriority, LLMNextStep, type DataItemBase } from "../types.js";
import type { DataItemType } from "../types/data-items.js";
import { buildDedupPrompt } from "../../prompts/ceremony/dedup.js";

// =============================================================================
// TYPES
// =============================================================================

type DedupableItem = DataItemBase & { relationship?: string };

interface Cluster {
  ids: string[];
  minSim: number;
  maxSim: number;
  size: number;
}

// =============================================================================
// DEDUP CANDIDATE FINDING (copied from ceremony.ts)
// =============================================================================

const DEDUP_DEFAULT_THRESHOLD = 0.85;  // Lowered from 0.95 based on experimental analysis: 0.95 only catches 3.9% of duplicate name groups, 0.85 catches 46.7%

function findDedupCandidates<T extends DedupableItem>(
  items: T[],
  threshold: number
): Array<{ a: T; b: T; similarity: number }> {
  const withEmbeddings = items.filter(item =>
    item.embedding && item.embedding.length > 0 &&
    item.relationship !== "Persona"
  );

  const candidates: Array<{ a: T; b: T; similarity: number }> = [];

  for (let i = 0; i < withEmbeddings.length; i++) {
    for (let j = i + 1; j < withEmbeddings.length; j++) {
      const a = withEmbeddings[i];
      const b = withEmbeddings[j];
      const dot = a.embedding!.reduce((sum, v, k) => sum + v * b.embedding![k], 0);
      const normA = Math.sqrt(a.embedding!.reduce((sum, v) => sum + v * v, 0));
      const normB = Math.sqrt(b.embedding!.reduce((sum, v) => sum + v * v, 0));
      const similarity = normA && normB ? dot / (normA * normB) : 0;

      if (similarity >= threshold) {
        candidates.push({ a, b, similarity });
      }
    }
  }

  return candidates.sort((x, y) => y.similarity - x.similarity);
}

// =============================================================================
// UNION-FIND CLUSTERING
// =============================================================================

function clusterPairs<T extends DedupableItem>(
  pairs: Array<{ a: T; b: T; similarity: number }>
): Cluster[] {
  const parent = new Map<string, string>();
  
  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  }
  
  function union(x: string, y: string): void {
    const px = find(x), py = find(y);
    if (px !== py) parent.set(px, py);
  }
  
  // Union all pairs
  for (const pair of pairs) {
    union(pair.a.id, pair.b.id);
  }
  
  // Group by root to create clusters
  const clusters = new Map<string, { ids: string[]; sims: number[] }>();
  for (const pair of pairs) {
    const root = find(pair.a.id);
    if (!clusters.has(root)) {
      clusters.set(root, { ids: [], sims: [] });
    }
    const cluster = clusters.get(root)!;
    if (!cluster.ids.includes(pair.a.id)) cluster.ids.push(pair.a.id);
    if (!cluster.ids.includes(pair.b.id)) cluster.ids.push(pair.b.id);
    cluster.sims.push(pair.similarity);
  }
  
  // Convert to Cluster objects
  return Array.from(clusters.values()).map(c => ({
    ids: c.ids,
    minSim: Math.min(...c.sims),
    maxSim: Math.max(...c.sims),
    size: c.ids.length
  }));
}

// =============================================================================
// QUALITY GATES
// =============================================================================

function filterClusters(clusters: Cluster[]): Cluster[] {
  return clusters
    .filter(c => {
      if (c.size > 50) {
        console.warn(`[Dedup] Cluster rejected (size too large): ${c.size} items`);
        return false;
      }
      return true;
    })
    .filter(c => {
      const spread = c.maxSim - c.minSim;
      if (spread > 0.10) {  // 10% threshold
        console.warn(`[Dedup] Cluster rejected (high spread): ${spread.toFixed(3)} range`);
        return false;
      }
      return true;
    });
}

// =============================================================================
// MAIN QUEUEING FUNCTION
// =============================================================================

export function queueDedupPhase(state: StateManager): void {
  const human = state.getHuman();
  const rewriteModel = human.settings?.rewrite_model;
  
  if (!rewriteModel) {
    console.log("[Dedup] rewrite_model not set — skipping dedup phase");
    return;
  }
  
  const threshold = human.settings?.ceremony?.dedup_threshold ?? DEDUP_DEFAULT_THRESHOLD;
  
  console.log(`[Dedup] Starting deduplication phase (threshold: ${threshold})`);
  
  const entityTypes: Array<{ type: DataItemType; items: DedupableItem[] }> = [
    { type: "fact", items: human.facts },
    { type: "topic", items: human.topics },
    { type: "person", items: human.people },
  ];
  
  let totalClusters = 0;
  
  for (const { type, items } of entityTypes) {
    // Find dedup candidates
    const pairs = findDedupCandidates(items, threshold);
    
    if (pairs.length === 0) {
      console.log(`[Dedup] ${type}: No duplicates found`);
      continue;
    }
    
    // Cluster pairs via union-find
    const clusters = clusterPairs(pairs);
    
    // Apply quality gates
    const vettedClusters = filterClusters(clusters);
    
    console.log(`[Dedup] ${type}: ${pairs.length} pairs → ${clusters.length} clusters → ${vettedClusters.length} vetted`);
    
    // Queue Opus curation for each vetted cluster
    for (const cluster of vettedClusters) {
      // Hydrate cluster with full entity data
      const clusterEntities = cluster.ids
        .map(id => items.find(item => item.id === id))
        .filter((item): item is DedupableItem => item !== undefined);
      
      if (clusterEntities.length === 0) {
        console.warn(`[Dedup] Cluster hydration failed - no entities found`);
        continue;
      }
      
      // Build prompt
      const prompt = buildDedupPrompt({
        cluster: clusterEntities,
        itemType: type,
        similarityRange: { min: cluster.minSim, max: cluster.maxSim }
      });
      
      // Queue LLM request
      state.queue_enqueue({
        type: LLMRequestType.JSON,
        priority: LLMPriority.Normal,
        system: prompt.system,
        user: prompt.user,
        next_step: LLMNextStep.HandleDedupCurate,
        model: rewriteModel,
        data: {
          entity_type: type,
          entity_ids: cluster.ids,
          ceremony_progress: 1
        }
      });
      totalClusters++;
    }
  }
  
  console.log(`[Dedup] Queued ${totalClusters} clusters for curation`);
}
