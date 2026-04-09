import YAML from "yaml";
import type {
  PersonaEntity,
  PersonaTrait,
  PersonaTopic,
  ToolDefinition,
  ProviderAccount,
} from "../../../src/core/types.js";
import { modelGuidToDisplay, displayToModelGuid } from "./yaml-shared.js";
import { parseDuration, formatDuration } from "./duration.js";

const PLACEHOLDER_LONG_DESC = "Detailed description of this persona's personality, background, and role";

interface YAMLTrait {
  name: string;
  description: string;
  sentiment: number;
  strength: number;
}

interface YAMLPersonaTopic {
  name: string;
  perspective: string;
  approach: string;
  personal_stake: string;
  exposure_current: number;
  exposure_desired: number;
}

interface EditablePersonaData {
  display_name?: string;
  aliases?: string[];
  short_description?: string;
  long_description?: string;
  model?: string | null;
  group_primary?: string | null;
  groups_visible?: Record<string, boolean>[];
  traits: YAMLTrait[];
  topics: YAMLPersonaTopic[];
  heartbeat_delay_ms?: string | null;
  context_window_hours?: number | null;
  is_paused?: boolean;
  pause_until?: string;
  is_static?: boolean;
  include_message_timestamps?: boolean;
  tools?: Record<string, Record<string, boolean>>;
}

const PLACEHOLDER_TRAIT: YAMLTrait = {
  name: "Example Trait",
  description: "Delete this placeholder or modify it to define a real trait",
  sentiment: 0,
  strength: 0.5,
};

const PLACEHOLDER_TOPIC: YAMLPersonaTopic = {
  name: "Example Topic",
  perspective: "How this persona views or thinks about this topic",
  approach: "How this persona prefers to engage with this topic",
  personal_stake: "Why this topic matters to this persona personally",
  exposure_current: 0.5,
  exposure_desired: 0.5,
};

function buildPersonaToolsMap(
  enabledToolIds: string[],
  allTools: ToolDefinition[],
  allProviders: import('../../../src/core/types.js').ToolProvider[]
): Record<string, Record<string, boolean>> | undefined {
  if (allTools.length === 0) return undefined;
  const enabledSet = new Set(enabledToolIds);
  const result: Record<string, Record<string, boolean>> = {};
  for (const provider of allProviders.filter(p => p.enabled)) {
    const providerTools = allTools.filter(t => t.provider_id === provider.id);
    if (providerTools.length === 0) continue;
    result[provider.display_name] = Object.fromEntries(
      providerTools.map(t => [t.display_name, enabledSet.has(t.id)])
    );
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function resolvePersonaToolsFromMap(
  toolsMap: Record<string, Record<string, boolean>> | undefined,
  allTools: ToolDefinition[],
  allProviders: import('../../../src/core/types.js').ToolProvider[]
): string[] | undefined {
  if (!toolsMap) return undefined;
  const enabledIds: string[] = [];
  for (const [providerDisplayName, toolToggles] of Object.entries(toolsMap)) {
    const provider = allProviders.find(p => p.display_name === providerDisplayName);
    if (!provider) continue;
    for (const [toolDisplayName, enabled] of Object.entries(toolToggles)) {
      if (!enabled) continue;
      const tool = allTools.find(t => t.provider_id === provider.id && t.display_name === toolDisplayName);
      if (tool) enabledIds.push(tool.id);
    }
  }
  return enabledIds.length > 0 ? enabledIds : [];
}

export function newPersonaToYAML(name: string, allTools?: ToolDefinition[], allProviders?: import('../../../src/core/types.js').ToolProvider[]): string {
  const toolsMap = buildPersonaToolsMap([], allTools ?? [], allProviders ?? []);

  const data: EditablePersonaData = {
    display_name: name,
    long_description: PLACEHOLDER_LONG_DESC,
    model: undefined,
    group_primary: "General",
    groups_visible: [{ General: true }],
    traits: [PLACEHOLDER_TRAIT],
    topics: [PLACEHOLDER_TOPIC],
    tools: toolsMap,
  };

  return YAML.stringify(data, {
    lineWidth: 0,
  });
}

export function newPersonaFromYAML(yamlContent: string, allTools?: ToolDefinition[], allProviders?: import('../../../src/core/types.js').ToolProvider[]): Partial<PersonaEntity> {
  const data = YAML.parse(yamlContent) as EditablePersonaData;

  const isTraitPlaceholder = (t: YAMLTrait) =>
    t.name === PLACEHOLDER_TRAIT.name &&
    t.description === PLACEHOLDER_TRAIT.description;

  const traits: PersonaTrait[] = [];
  for (const t of data.traits ?? []) {
    if (isTraitPlaceholder(t)) continue;
    traits.push({
      id: crypto.randomUUID(),
      name: t.name,
      description: t.description,
      sentiment: t.sentiment ?? 0,
      strength: t.strength,
      last_updated: new Date().toISOString(),
    });
  }

  const isTopicPlaceholder = (t: YAMLPersonaTopic) =>
    t.name === PLACEHOLDER_TOPIC.name &&
    t.perspective === PLACEHOLDER_TOPIC.perspective;

  const topics: PersonaTopic[] = [];
  for (const t of data.topics ?? []) {
    if (isTopicPlaceholder(t)) continue;
    topics.push({
      id: crypto.randomUUID(),
      name: t.name,
      perspective: t.perspective,
      approach: t.approach,
      personal_stake: t.personal_stake,
      sentiment: 0,
      exposure_current: t.exposure_current,
      exposure_desired: t.exposure_desired,
      last_updated: new Date().toISOString(),
    });
  }

  const stripPlaceholder = (value: string | undefined, placeholder: string): string | undefined => {
    return value === placeholder ? undefined : value;
  };

  const groupsVisible: string[] = [];
  for (const groupRecord of data.groups_visible ?? []) {
    for (const [groupName, isVisible] of Object.entries(groupRecord)) {
      if (isVisible) groupsVisible.push(groupName);
    }
  }

  return {
    long_description: stripPlaceholder(data.long_description, PLACEHOLDER_LONG_DESC),
    model: data.model ?? undefined,
    group_primary: data.group_primary ?? "General",
    groups_visible: groupsVisible.length > 0 ? groupsVisible : ["General"],
    traits,
    topics,
    heartbeat_delay_ms: data.heartbeat_delay_ms == null
      ? undefined
      : parseDuration(data.heartbeat_delay_ms) ?? undefined,
    context_window_hours: data.context_window_hours ?? undefined,
    tools: resolvePersonaToolsFromMap(data.tools, allTools ?? [], allProviders ?? []),
  };
}

export function personaToYAML(persona: PersonaEntity, allGroups?: string[], allTools?: ToolDefinition[], allProviders?: import('../../../src/core/types.js').ToolProvider[], accounts?: ProviderAccount[]): string {
  const useTraitPlaceholder = persona.traits.length === 0;
  const useTopicPlaceholder = persona.topics.length === 0;

  const groupsForYAML: Record<string, boolean>[] = [];
  const visibleSet = new Set(persona.groups_visible ?? []);
  const groupsToShow = allGroups ?? persona.groups_visible ?? [];
  for (const groupName of groupsToShow) {
    groupsForYAML.push({ [groupName]: visibleSet.has(groupName) });
  }

  const toolsMap = buildPersonaToolsMap(persona.tools ?? [], allTools ?? [], allProviders ?? []);

  const modelDisplay = (persona.model && accounts && accounts.length > 0)
    ? modelGuidToDisplay(persona.model, accounts)
    : persona.model;

  const data: EditablePersonaData = {
    display_name: persona.display_name,
    aliases: persona.aliases,
    short_description: persona.short_description,
    long_description: persona.long_description || PLACEHOLDER_LONG_DESC,
    model: modelDisplay ?? null,
    group_primary: persona.group_primary,
    groups_visible: groupsForYAML,
    traits: useTraitPlaceholder
      ? [PLACEHOLDER_TRAIT]
      : persona.traits.map(({ name, description, sentiment, strength }) => ({ name, description, sentiment: sentiment ?? 0, strength: strength ?? 0.5 })),
    topics: useTopicPlaceholder
      ? [PLACEHOLDER_TOPIC]
      : persona.topics.map(({ name, perspective, approach, personal_stake, exposure_current, exposure_desired }) => ({
          name, perspective, approach, personal_stake, exposure_current, exposure_desired
        })),
    heartbeat_delay_ms: persona.heartbeat_delay_ms ? formatDuration(persona.heartbeat_delay_ms) : null,
    context_window_hours: persona.context_window_hours ?? null,
    is_paused: persona.is_paused || undefined,
    pause_until: persona.pause_until,
    is_static: persona.is_static || undefined,
    include_message_timestamps: persona.include_message_timestamps || undefined,
    tools: toolsMap,
  };

  return YAML.stringify(data, {
    lineWidth: 0,
  });
}

export interface PersonaYAMLResult {
  updates: Partial<PersonaEntity>;
  deletedTraitIds: string[];
  deletedTopicIds: string[];
}

export function personaFromYAML(yamlContent: string, original: PersonaEntity, allTools?: ToolDefinition[], allProviders?: import('../../../src/core/types.js').ToolProvider[], accounts?: ProviderAccount[]): PersonaYAMLResult {
  const data = YAML.parse(yamlContent) as EditablePersonaData;

  const deletedTraitIds: string[] = [];
  const deletedTopicIds: string[] = [];

  const isTraitPlaceholder = (t: YAMLTrait) =>
    t.name === PLACEHOLDER_TRAIT.name &&
    t.description === PLACEHOLDER_TRAIT.description;

  const traits: PersonaTrait[] = [];
  for (const t of data.traits ?? []) {
    if (isTraitPlaceholder(t)) continue;
    const existing = original.traits.find(orig => orig.name === t.name);
    traits.push({
      id: existing?.id ?? crypto.randomUUID(),
      name: t.name,
      description: t.description,
      sentiment: t.sentiment ?? existing?.sentiment ?? 0,
      strength: t.strength,
      last_updated: new Date().toISOString(),
    });
  }

  for (const orig of original.traits) {
    if (!traits.some(t => t.id === orig.id)) {
      deletedTraitIds.push(orig.id);
    }
  }

  const isTopicPlaceholder = (t: YAMLPersonaTopic) =>
    t.name === PLACEHOLDER_TOPIC.name &&
    t.perspective === PLACEHOLDER_TOPIC.perspective;

  const topics: PersonaTopic[] = [];
  for (const t of data.topics ?? []) {
    if (isTopicPlaceholder(t)) continue;
    const existing = original.topics.find(orig => orig.name === t.name);
    topics.push({
      id: existing?.id ?? crypto.randomUUID(),
      name: t.name,
      perspective: t.perspective,
      approach: t.approach,
      personal_stake: t.personal_stake,
      sentiment: existing?.sentiment ?? 0,
      exposure_current: t.exposure_current,
      exposure_desired: t.exposure_desired,
      last_updated: new Date().toISOString(),
    });
  }

  for (const orig of original.topics) {
    if (!topics.some(t => t.id === orig.id)) {
      deletedTopicIds.push(orig.id);
    }
  }

  const stripPlaceholder = (value: string | undefined, placeholder: string): string | undefined => {
    return value === placeholder ? undefined : value;
  };

  const groupsVisible: string[] = [];
  for (const groupRecord of data.groups_visible ?? []) {
    for (const [groupName, isVisible] of Object.entries(groupRecord)) {
      if (isVisible) groupsVisible.push(groupName);
    }
  }

  let resolvedModel: string | undefined = data.model ?? undefined;
  if (data.model && accounts && accounts.length > 0) {
    const guid = displayToModelGuid(data.model, accounts);
    if (guid !== undefined) {
      resolvedModel = guid;
    } else if (data.model.includes(':')) {
      throw new Error(`Model "${data.model}" not found. Use "ProviderName:modelName" format with a valid provider and model.`);
    }
  }

  const updates: Partial<PersonaEntity> = {
    display_name: data.display_name,
    aliases: data.aliases,
    short_description: data.short_description,
    long_description: stripPlaceholder(data.long_description, PLACEHOLDER_LONG_DESC),
    model: resolvedModel,
    group_primary: data.group_primary,
    groups_visible: groupsVisible,
    traits,
    topics,
    heartbeat_delay_ms: data.heartbeat_delay_ms == null
      ? undefined
      : parseDuration(data.heartbeat_delay_ms) ?? undefined,
    context_window_hours: data.context_window_hours ?? undefined,
    is_paused: data.is_paused ?? false,
    pause_until: data.pause_until,
    is_static: data.is_static ?? false,
    include_message_timestamps: data.include_message_timestamps ?? false,
    tools: resolvePersonaToolsFromMap(data.tools, allTools ?? [], allProviders ?? []),
    last_updated: new Date().toISOString(),
  };

  return { updates, deletedTraitIds, deletedTopicIds };
}

// =============================================================================
// PERSONA PREVIEW SERIALIZATION (from-person generation flow)
// =============================================================================

export function descriptionEntryToYAML(personaName: string): string {
  return `# New Persona: ${personaName}
# Describe who this persona is. This will be used to generate traits and topics.
# Save to generate • :q to cancel.

description: |
  
`;
}

export function descriptionFromYAML(content: string): { description: string; relationship?: string } {
  const data = YAML.parse(content) as { description?: string; relationship?: string };
  if (!data) throw new Error("Failed to parse YAML");

  const description = (data.description ?? "").replace(/\n/g, " ").trim();
  const relationship = data.relationship?.trim() || undefined;

  return { description, relationship };
}

export function personaPreviewToYAML(
  preview: import('../../../src/prompts/generation/types.js').PersonaGenerationResult,
  personaName: string,
  personName?: string,
  previousLongDescription?: string
): string {
  const normalizeLine = (s: string) => s.replace(/\n/g, ' ').trim();

  const headerLines: string[] = [
    `# Persona Preview: ${personaName}`,
  ];
  if (personName) {
    headerLines.push(`# Source: ${personName}`);
  }
  headerLines.push(`# Edit or delete entries. Save or quit to apply • :cq to cancel.`);
  headerLines.push(``);
  if (previousLongDescription) {
    headerLines.push(`# Previously: ${normalizeLine(previousLongDescription)}`);
  }

  const longDescYAML = `long_description: ${JSON.stringify(normalizeLine(preview.long_description))}`;
  const shortDescYAML = `short_description: ${JSON.stringify(normalizeLine(preview.short_description ?? ''))}`;
  const aliasesLine = (preview.aliases && preview.aliases.length > 0)
    ? `aliases: ${preview.aliases.join(', ')}`
    : null;

  const traitsYAML = YAML.stringify(
    { traits: preview.traits.map(t => ({
      name: t.name,
      description: t.description,
      sentiment: Math.round(t.sentiment * 100) / 100,
      strength: Math.round(t.strength * 100) / 100,
    }))},
    { lineWidth: 0 }
  );

  const topicsYAML = YAML.stringify(
    { topics: preview.topics.map(t => ({
      name: t.name,
      perspective: t.perspective,
      approach: t.approach,
      personal_stake: t.personal_stake,
      sentiment: Math.round(t.sentiment * 100) / 100,
      exposure_current: Math.round(t.exposure_current * 100) / 100,
      exposure_desired: Math.round(t.exposure_desired * 100) / 100,
    }))},
    { lineWidth: 0 }
  );

  return [
    headerLines.join('\n'),
    longDescYAML,
    shortDescYAML,
    ...(aliasesLine ? [aliasesLine] : []),
    traitsYAML.trimEnd(),
    topicsYAML.trimEnd(),
    '',
  ].join('\n');
}

interface PreviewYAMLData {
  long_description?: string;
  short_description?: string;
  traits?: Array<{
    name: string;
    description: string;
    sentiment?: number;
    strength?: number;
  }>;
  topics?: Array<{
    name: string;
    perspective: string;
    approach: string;
    personal_stake: string;
    sentiment?: number;
    exposure_current?: number;
    exposure_desired?: number;
  }>;
}

export function personaPreviewFromYAML(content: string): { long_description: string; short_description?: string; aliases?: string[]; traits: PersonaTrait[]; topics: PersonaTopic[] } {
  const data = YAML.parse(content) as PreviewYAMLData & { aliases?: string };
  if (!data) throw new Error("Failed to parse YAML");

  const long_description = (data.long_description ?? "").replace(/\n/g, ' ').trim();
  const short_description = data.short_description?.replace(/\n/g, ' ').trim() || undefined;

  const traits: PersonaTrait[] = (data.traits ?? []).map(t => ({
    id: crypto.randomUUID(),
    name: t.name,
    description: t.description,
    sentiment: t.sentiment ?? 0,
    strength: t.strength ?? 0.5,
    last_updated: new Date().toISOString(),
  }));

  const topics: PersonaTopic[] = (data.topics ?? []).map(t => ({
    id: crypto.randomUUID(),
    name: t.name,
    perspective: t.perspective,
    approach: t.approach,
    personal_stake: t.personal_stake,
    sentiment: t.sentiment ?? 0,
    exposure_current: t.exposure_current ?? 0.5,
    exposure_desired: t.exposure_desired ?? 0.5,
    last_updated: new Date().toISOString(),
  }));

  const aliases = data.aliases
    ? data.aliases.split(',').map((s: string) => s.trim()).filter(Boolean)
    : undefined;

  return { long_description, short_description, aliases, traits, topics };
}
