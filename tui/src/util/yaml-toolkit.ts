import YAML from "yaml";
import type { ToolProvider, ToolDefinition } from "../../../src/core/types.js";

interface EditableToolkitData {
  display_name: string;
  enabled: boolean;
  config: Record<string, string>;
  tools?: Record<string, boolean>;
}

export function toolkitToYAML(provider: ToolProvider, tools: ToolDefinition[]): string {
  const toolsMap = tools.length > 0
    ? Object.fromEntries(tools.map(t => [t.display_name, t.enabled]))
    : undefined;
  if (provider.builtin) {
    return YAML.stringify({ enabled: provider.enabled, tools: toolsMap }, { lineWidth: 0 });
  }
  const data: EditableToolkitData = {
    display_name: provider.display_name,
    enabled: provider.enabled,
    config: { ...provider.config },
    tools: toolsMap,
  };
  return YAML.stringify(data, { lineWidth: 0 });
}

export interface ToolkitYAMLResult {
  updates: Partial<Omit<ToolProvider, 'id' | 'created_at'>>;
  toolUpdates: Array<{ id: string; enabled: boolean }>;
}

export function toolkitFromYAML(yamlContent: string, original: ToolProvider, tools: ToolDefinition[]): ToolkitYAMLResult {
  const data = YAML.parse(yamlContent) as EditableToolkitData;

  if (!data.display_name) {
    if (!original.display_name) throw new Error("display_name is required");
    data.display_name = original.display_name;
  }

  const updates: Partial<Omit<ToolProvider, 'id' | 'created_at'>> = {
    display_name: data.display_name,
    enabled: data.enabled ?? original.enabled,
    config: data.config ?? {},
  };

  const toolUpdates: Array<{ id: string; enabled: boolean }> = [];
  if (data.tools) {
    for (const [displayName, enabled] of Object.entries(data.tools)) {
      const tool = tools.find(t => t.display_name === displayName);
      if (tool) toolUpdates.push({ id: tool.id, enabled: Boolean(enabled) });
    }
  }

  return { updates, toolUpdates };
}
