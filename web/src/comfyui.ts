/**
 * ComfyUI API Integration
 * 
 * Wraps ComfyUI REST API for Z-Image-Turbo image generation.
 * Port 8000 (not standard 8188) - user's custom setup.
 * 
 * API Flow:
 * 1. POST /prompt with workflow JSON → returns {prompt_id}
 * 2. Poll GET /history/{prompt_id} until complete
 * 3. GET /view?filename={X} to download image
 * 
 * Reference: COMFY_PROMPT_TEMPLATE in src/core/types/entities.ts
 */

import { COMFY_PROMPT_TEMPLATE } from "../../src/core/types/entities";
import type { StateManager } from "../../src/core/state-manager.js";

const COMFYUI_BASE_URL = "http://localhost:8000";
const POLL_INTERVAL_MS = 500; // Check every 500ms
const TIMEOUT_MS = 600000; // 10 minute timeout (ComfyUI cold start can take 400s)

export interface GenerationOptions {
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  seed?: number; // Random if not provided
}

export interface GenerationResult {
  image: Blob;
  prompt: string;
  seed: number;
  width: number;
  height: number;
}

/**
 * Look up enabled image provider from StateManager.
 * Falls back to hardcoded values if not available.
 */
function getImageProvider(stateManager?: StateManager): { url: string; workflow: any } | null {
  if (!stateManager) return null;
  const human = stateManager.getHuman();
  const provider = human.settings?.accounts?.find(
    (acc: any) => acc.type === "image" && acc.enabled
  );
  if (!provider) return null;
  return {
    url: provider.url,
    workflow: provider.workflow_json || COMFY_PROMPT_TEMPLATE
  };
}
interface HistoryResponse {
  [promptId: string]: {
    outputs?: {
      [nodeId: string]: {
        images?: Array<{
          filename: string;
          subfolder: string;
          type: string;
        }>;
      };
    };
    status?: {
      completed?: boolean;
      status_str?: string;
    };
  };
}

/**
 * Check if ComfyUI is reachable
 */
export async function isComfyUIAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${COMFYUI_BASE_URL}/system_stats`, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Introspect workflow to find prompt input node
 * 
 * Fetches /object_info schema from ComfyUI to find nodes with STRING inputs.
 * Returns the first node in the workflow that has a text/string input field.
 * 
 * @param url - ComfyUI base URL
 * @param workflow - Workflow JSON to search
 * @returns {nodeId, fieldName} for prompt injection, or null if none found
 */
async function introspectWorkflow(url: string, workflow: any): Promise<{ nodeId: string; fieldName: string } | null> {
  try {
    const response = await fetch(`${url}/object_info`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    
    if (!response.ok) {
      console.error(`Failed to fetch /object_info: ${response.status}`);
      return null;
    }
    
    const objectInfo = await response.json();
    
    // Search workflow nodes for STRING inputs
    for (const [nodeId, nodeData] of Object.entries(workflow)) {
      if (typeof nodeData !== "object" || !nodeData || !nodeData.class_type) continue;
      
      const classType = nodeData.class_type;
      const nodeSchema = objectInfo[classType];
      
      if (!nodeSchema?.input?.required) continue;
      
      // Find first STRING input
      for (const [fieldName, fieldSchema] of Object.entries(nodeSchema.input.required)) {
        const schema = fieldSchema as any;
        if (Array.isArray(schema) && schema[0] === "STRING") {
          return { nodeId, fieldName };
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error("Introspection failed:", error);
    return null;
  }
}

/**
 * Generate an image using ComfyUI
 * 
 * @param prompt - Text prompt for image generation
 * @param options - Optional generation parameters (width, height, steps, cfg, seed)
 * @returns Promise<GenerationResult> with image Blob and metadata
 * @throws Error if ComfyUI is unavailable, generation fails, or times out
 */
export async function generateImage(
  prompt: string,
  stateManager?: StateManager,
  options: GenerationOptions = {}
): Promise<GenerationResult> {
  // Get provider configuration or use defaults
  const provider = getImageProvider(stateManager);
  const baseUrl = provider?.url || "http://localhost:8000";
  const workflowTemplate = provider?.workflow || COMFY_PROMPT_TEMPLATE;
  
  // 1. Clone workflow template and introspect for prompt node
  const workflow = structuredClone(workflowTemplate);
  
  // Introspect to find prompt node dynamically
  const promptNode = await introspectWorkflow(baseUrl, workflow);
  
  if (!promptNode) {
    throw new Error("No prompt input found in workflow. Cannot inject prompt.");
  }
  
  // Inject prompt into detected node
  if (!workflow[promptNode.nodeId]?.inputs) {
    throw new Error(`Invalid workflow: node ${promptNode.nodeId} missing inputs`);
  }
  workflow[promptNode.nodeId].inputs[promptNode.fieldName] = prompt;
  
  // Inject dimensions (node "57:13")
  if (options.width && workflow["57:13"]?.inputs) {
    workflow["57:13"].inputs.width = options.width;
  }
  if (options.height && workflow["57:13"]?.inputs) {
    workflow["57:13"].inputs.height = options.height;
  }
  
  // Inject sampler settings (node "57:3")
  if (options.steps && workflow["57:3"]?.inputs) {
    workflow["57:3"].inputs.steps = options.steps;
  }
  if (options.cfg !== undefined && workflow["57:3"]?.inputs) {
    workflow["57:3"].inputs.cfg = options.cfg;
  }
  if (options.seed !== undefined && workflow["57:3"]?.inputs) {
    workflow["57:3"].inputs.seed = options.seed;
  } else if (workflow["57:3"]?.inputs) {
    // Generate random seed if not provided
    workflow["57:3"].inputs.seed = Math.floor(Math.random() * 1000000000000000);
  }
  
  // Extract actual values for metadata
  const actualWidth = workflow["57:13"]?.inputs?.width || 768;
  const actualHeight = workflow["57:13"]?.inputs?.height || 768;
  const actualSeed = workflow["57:3"]?.inputs?.seed || 0;
  
  // 2. POST workflow to /prompt
  const promptResponse = await fetch(`${baseUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow }),
  });
  
  if (!promptResponse.ok) {
    const errorText = await promptResponse.text();
    throw new Error(`ComfyUI prompt submission failed: ${errorText}`);
  }
  
  const { prompt_id } = await promptResponse.json();
  if (!prompt_id) {
    throw new Error("ComfyUI did not return a prompt_id");
  }
  
  // 3. Poll /history/{prompt_id} until complete
  const startTime = Date.now();
  let imageFilename: string | null = null;
  
  while (Date.now() - startTime < TIMEOUT_MS) {
    const historyResponse = await fetch(`${baseUrl}/history/${prompt_id}`);
    
    if (!historyResponse.ok) {
      throw new Error(`Failed to fetch history for prompt_id ${prompt_id}`);
    }
    
    const history: HistoryResponse = await historyResponse.json();
    const promptData = history[prompt_id];
    
    if (!promptData) {
      // Not in history yet, wait and retry
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      continue;
    }
    
    // Check if generation completed
    const outputs = promptData.outputs;
    if (outputs) {
      // Find SaveImage node (node "9" in our workflow)
      const saveImageOutput = outputs["9"];
      if (saveImageOutput?.images && saveImageOutput.images.length > 0) {
        imageFilename = saveImageOutput.images[0].filename;
        break;
      }
    }
    
    // Check for errors
    const status = promptData.status;
    if (status?.status_str === "error") {
      throw new Error("ComfyUI generation failed with error status");
    }
    
    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  
  if (!imageFilename) {
    throw new Error(`Timeout: Image generation did not complete within ${TIMEOUT_MS / 1000}s`);
  }
  
  // 4. GET /view to download image
  const imageResponse = await fetch(
    `${baseUrl}/view?filename=${encodeURIComponent(imageFilename)}`
  );
  
  if (!imageResponse.ok) {
    throw new Error(`Failed to download image: ${imageFilename}`);
  }
  
  const imageBlob = await imageResponse.blob();
  
  return {
    image: imageBlob,
    prompt,
    seed: actualSeed,
    width: actualWidth,
    height: actualHeight,
  };
}

/**
 * Regenerate an image with a new random seed
 * (Same prompt, different result)
 */
export async function regenerateImage(
  prompt: string,
  stateManager?: StateManager,
  options: Omit<GenerationOptions, "seed"> = {}
): Promise<GenerationResult> {
  // Force new random seed
  return generateImage(prompt, stateManager, {
    ...options,
    seed: Math.floor(Math.random() * 1000000000000000),
  });
}
