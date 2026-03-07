import type { ToolProvider, ToolDefinition } from "./types.js";
import { StateManager } from "./state-manager.js";

// =============================================================================
// TOOL PROVIDER API
// =============================================================================

export function getToolProviderList(sm: StateManager): ToolProvider[] {
  return sm.tools_getProviders();
}

export function getToolProvider(sm: StateManager, id: string): ToolProvider | null {
  return sm.tools_getProviderById(id);
}

export async function addToolProvider(
  sm: StateManager,
  provider: Omit<ToolProvider, "id" | "created_at">
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const newProvider: ToolProvider = { ...provider, id, created_at: now };
  sm.tools_addProvider(newProvider);
  return id;
}

export async function updateToolProvider(
  sm: StateManager,
  id: string,
  updates: Partial<Omit<ToolProvider, "id" | "created_at">>
): Promise<boolean> {
  return sm.tools_updateProvider(id, updates);
}

export async function removeToolProvider(sm: StateManager, id: string): Promise<boolean> {
  // Cascade: unassign all tools from this provider from all personas before removing
  const providerTools = sm.tools_getAll().filter((t) => t.provider_id === id);
  const providerToolIds = new Set(providerTools.map((t) => t.id));
  if (providerToolIds.size > 0) {
    const personas = sm.persona_getAll();
    for (const persona of personas) {
      if (persona.tools?.some((tid) => providerToolIds.has(tid))) {
        await sm.persona_update(persona.id, {
          tools: persona.tools.filter((tid) => !providerToolIds.has(tid)),
        });
      }
    }
  }
  return sm.tools_removeProvider(id);
}

// =============================================================================
// TOOL API
// =============================================================================

export function getToolList(sm: StateManager): ToolDefinition[] {
  return sm.tools_getAll();
}

export function getTool(sm: StateManager, id: string): ToolDefinition | null {
  return sm.tools_getById(id);
}

export async function addTool(
  sm: StateManager,
  tool: Omit<ToolDefinition, "id" | "created_at">
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const newTool: ToolDefinition = { ...tool, id, created_at: now };
  sm.tools_add(newTool);
  return id;
}

export async function updateTool(
  sm: StateManager,
  id: string,
  updates: Partial<Omit<ToolDefinition, "id" | "created_at">>
): Promise<boolean> {
  return sm.tools_update(id, updates);
}

export async function removeTool(sm: StateManager, id: string): Promise<boolean> {
  // Remove this tool from all persona tool lists before deleting
  const personas = sm.persona_getAll();
  for (const persona of personas) {
    if (persona.tools?.includes(id)) {
      await sm.persona_update(persona.id, {
        tools: persona.tools.filter((t) => t !== id),
      });
    }
  }
  return sm.tools_remove(id);
}
