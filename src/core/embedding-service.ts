/**
 * Cross-platform embedding service using all-MiniLM-L6-v2 (384-dim).
 * Bun/Node: fastembed | Browser: @huggingface/transformers (CDN)
 * 
 * Both implementations are loaded lazily to avoid bundler issues.
 */

export const EMBEDDING_DIMENSION = 384;

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }
  
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;
  
  return dot / magnitude;
}

export function findTopK<T extends { id: string; embedding?: number[] }>(
  queryVector: number[],
  candidates: T[],
  k: number
): Array<{ item: T; similarity: number }> {
  const scored = candidates
    .filter(c => c.embedding && c.embedding.length === EMBEDDING_DIMENSION)
    .map(item => ({
      item,
      similarity: cosineSimilarity(queryVector, item.embedding!),
    }))
    .sort((a, b) => b.similarity - a.similarity);
  
  return scored.slice(0, k);
}

export interface EmbeddingService {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  isReady(): boolean;
}

export function getItemEmbeddingText(item: { name: string; description?: string }): string {
  if (item.description) {
    return `${item.name}: ${item.description}`;
  }
  return item.name;
}

// =============================================================================
// FACTORY - Lazy loading based on environment
// =============================================================================

let defaultService: EmbeddingService | null = null;

function isBrowserEnvironment(): boolean {
  const hasProcess = typeof process !== "undefined" && typeof process.versions !== "undefined";
  const hasBun = hasProcess && typeof process.versions.bun !== "undefined";
  const hasNode = hasProcess && typeof process.versions.node !== "undefined";
  const hasDocument = typeof document !== "undefined";
  
  const isTUI = (hasBun || hasNode) && !hasDocument;
  return !isTUI && hasDocument;
}

export function getEmbeddingService(): EmbeddingService {
  if (defaultService) return defaultService;
  
  if (isBrowserEnvironment()) {
    defaultService = createBrowserService();
  } else {
    defaultService = createBunService();
  }
  
  return defaultService;
}

// =============================================================================
// BROWSER IMPLEMENTATION (loaded from CDN, never bundled)
// =============================================================================

const HF_TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1';

function createBrowserService(): EmbeddingService {
  let embedder: any = null;
  let embedderPromise: Promise<any> | null = null;
  let ready = false;

  async function getEmbedder(): Promise<any> {
    if (embedder) return embedder;
    if (embedderPromise) return embedderPromise;
    
    embedderPromise = (async () => {
      const { pipeline, env } = await import(/* @vite-ignore */ HF_TRANSFORMERS_CDN);
      env.allowLocalModels = false;
      embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        dtype: 'fp32',
      });
      return embedder;
    })();
    
    return embedderPromise;
  }

  return {
    async embed(text: string): Promise<number[]> {
      const model = await getEmbedder();
      const result = await model(text, { pooling: 'mean', normalize: true });
      ready = true;
      return Array.from(result.data as Float32Array);
    },
    
    async embedBatch(texts: string[]): Promise<number[][]> {
      const results: number[][] = [];
      for (const text of texts) {
        results.push(await this.embed(text));
      }
      return results;
    },
    
    isReady(): boolean {
      return ready;
    }
  };
}

// =============================================================================
// BUN/NODE IMPLEMENTATION (uses fastembed, loaded dynamically)
// =============================================================================

const FASTEMBED_MODULE = 'fastembed';

function createBunService(): EmbeddingService {
  let embedder: any = null;
  let embedderPromise: Promise<any> | null = null;
  let ready = false;

  function parseFastembedVector(vec: any): number[] {
    if (vec && typeof vec === 'object' && '0' in vec) {
      const arr: number[] = [];
      const keys = Object.keys(vec).filter(k => !isNaN(Number(k)));
      for (let i = 0; i < keys.length; i++) {
        arr.push(vec[i]);
      }
      return arr;
    }
    if (ArrayBuffer.isView(vec)) {
      return Array.from(vec as Float32Array);
    }
    return Array.from(vec as number[]);
  }

  async function getEmbedder(): Promise<any> {
    if (embedder) return embedder;
    if (embedderPromise) return embedderPromise;
    
    embedderPromise = (async () => {
      const mod = await import(/* @vite-ignore */ FASTEMBED_MODULE);
      embedder = await mod.FlagEmbedding.init({ model: mod.EmbeddingModel.AllMiniLML6V2 });
      return embedder;
    })();
    
    return embedderPromise;
  }

  return {
    async embed(text: string): Promise<number[]> {
      const vectors = await this.embedBatch([text]);
      return vectors[0];
    },
    
    async embedBatch(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      
      const model = await getEmbedder();
      const embeddings = model.embed(texts);
      
      const result: number[][] = [];
      for await (const batch of embeddings) {
        if (Array.isArray(batch)) {
          for (const vec of batch) {
            result.push(parseFastembedVector(vec));
          }
        }
      }
      
      ready = true;
      return result;
    },
    
    isReady(): boolean {
      return ready;
    }
  };
}
