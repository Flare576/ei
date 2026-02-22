import YAML from "yaml";
import type { 
  PersonaEntity, 
  HumanEntity, 
  HumanSettings,
  CeremonyConfig,
  OpenCodeSettings,
  Fact, 
  Trait, 
  Topic, 
  Person,
  PersonaTopic,
  ProviderAccount,
  ProviderType,
  Quote,
} from "../../../src/core/types.js";

// =============================================================================
// TYPES FOR YAML EDITING
// =============================================================================

interface EditableTrait extends Trait {
  _delete?: boolean;
}

interface EditableTopic extends Topic {
  _delete?: boolean;
}

interface EditableFact extends Fact {
  _delete?: boolean;
}

interface EditablePerson extends Person {
  _delete?: boolean;
}

interface EditablePersonaData {
  display_name?: string;
  aliases?: string[];
  short_description?: string;
  long_description?: string;
  model?: string;
  group_primary?: string | null;
  groups_visible?: Record<string, boolean>[];
  traits: YAMLTrait[];
  topics: YAMLPersonaTopic[];
  heartbeat_delay_ms?: number;
  context_window_hours?: number;
  is_paused?: boolean;
  pause_until?: string;
  is_static?: boolean;
}

interface EditableHumanData {
  facts: EditableFact[];
  traits: EditableTrait[];
  topics: EditableTopic[];
  people: EditablePerson[];
}

// =============================================================================
// PLACEHOLDER MARKERS (stripped on parse if unchanged)
// =============================================================================

const PLACEHOLDER_LONG_DESC = "Detailed description of this persona's personality, background, and role";

// Placeholder types without id/_delete - these are for YAML display only
interface YAMLTrait {
  name: string;
  description: string;
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

const PLACEHOLDER_TRAIT: YAMLTrait = {
  name: "Example Trait",
  description: "Delete this placeholder or modify it to define a real trait",
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

// =============================================================================
// PERSONA SERIALIZATION
// =============================================================================

/**
 * Generate YAML skeleton for a NEW persona (doesn't exist yet)
 */
export function newPersonaToYAML(name: string): string {
  const data: EditablePersonaData = {
    display_name: name,
    long_description: PLACEHOLDER_LONG_DESC,
    model: undefined,
    group_primary: "General",
    groups_visible: [{ General: true }],
    traits: [PLACEHOLDER_TRAIT],
    topics: [PLACEHOLDER_TOPIC],
  };
  
  return YAML.stringify(data, { 
    lineWidth: 0,
  });
}

/**
 * Parse YAML for a NEW persona (creates PersonaEntity from scratch)
 */
export function newPersonaFromYAML(yamlContent: string): Partial<PersonaEntity> {
  const data = YAML.parse(yamlContent) as EditablePersonaData;
  
  const isTraitPlaceholder = (t: YAMLTrait) => 
    t.name === PLACEHOLDER_TRAIT.name && 
    t.description === PLACEHOLDER_TRAIT.description;

  const traits: Trait[] = [];
  for (const t of data.traits ?? []) {
    if (isTraitPlaceholder(t)) {
      continue;
    }
    traits.push({
      id: crypto.randomUUID(),
      name: t.name,
      description: t.description,
      strength: t.strength,
      sentiment: 0,
      last_updated: new Date().toISOString(),
    });
  }
  
  const isTopicPlaceholder = (t: YAMLPersonaTopic) => 
    t.name === PLACEHOLDER_TOPIC.name && 
    t.perspective === PLACEHOLDER_TOPIC.perspective;

  const topics: PersonaTopic[] = [];
  for (const t of data.topics ?? []) {
    if (isTopicPlaceholder(t)) {
      continue;
    }
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
  
  // Convert Record<string, boolean>[] to string[] - only include groups with true value
  const groupsVisible: string[] = [];
  for (const groupRecord of data.groups_visible ?? []) {
    for (const [groupName, isVisible] of Object.entries(groupRecord)) {
      if (isVisible) {
        groupsVisible.push(groupName);
      }
    }
  }
  
  return {
    long_description: stripPlaceholder(data.long_description, PLACEHOLDER_LONG_DESC),
    model: data.model,
    group_primary: data.group_primary ?? "General",
    groups_visible: groupsVisible.length > 0 ? groupsVisible : ["General"],
    traits,
    topics,
    heartbeat_delay_ms: data.heartbeat_delay_ms,
    context_window_hours: data.context_window_hours,
  };
}

export function personaToYAML(persona: PersonaEntity, allGroups?: string[]): string {
  const useTraitPlaceholder = persona.traits.length === 0;
  const useTopicPlaceholder = persona.topics.length === 0;
  
  const groupsForYAML: Record<string, boolean>[] = [];
  const visibleSet = new Set(persona.groups_visible ?? []);
  const groupsToShow = allGroups ?? persona.groups_visible ?? [];
  for (const groupName of groupsToShow) {
    groupsForYAML.push({ [groupName]: visibleSet.has(groupName) });
  }
  
  const data: EditablePersonaData = {
    display_name: persona.display_name,
    aliases: persona.aliases,
    short_description: persona.short_description,
    long_description: persona.long_description || PLACEHOLDER_LONG_DESC,
    model: persona.model,
    group_primary: persona.group_primary,
    groups_visible: groupsForYAML,
    traits: useTraitPlaceholder 
      ? [PLACEHOLDER_TRAIT]
      : persona.traits.map(({ name, description, strength }) => ({ name, description, strength: strength ?? 0.5 })),
    topics: useTopicPlaceholder
      ? [PLACEHOLDER_TOPIC]
      : persona.topics.map(({ name, perspective, approach, personal_stake, exposure_current, exposure_desired }) => ({ 
          name, perspective, approach, personal_stake, exposure_current, exposure_desired 
        })),
    heartbeat_delay_ms: persona.heartbeat_delay_ms,
    context_window_hours: persona.context_window_hours,
    is_paused: persona.is_paused || undefined,
    pause_until: persona.pause_until,
    is_static: persona.is_static || undefined,
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

export function personaFromYAML(yamlContent: string, original: PersonaEntity): PersonaYAMLResult {
  const data = YAML.parse(yamlContent) as EditablePersonaData;
  
  const deletedTraitIds: string[] = [];
  const deletedTopicIds: string[] = [];
  
  const isTraitPlaceholder = (t: YAMLTrait) => 
    t.name === PLACEHOLDER_TRAIT.name && 
    t.description === PLACEHOLDER_TRAIT.description;

  const traits: Trait[] = [];
  for (const t of data.traits ?? []) {
    if (isTraitPlaceholder(t)) {
      continue;
    }
    const existing = original.traits.find(orig => orig.name === t.name);
    traits.push({
      id: existing?.id ?? crypto.randomUUID(),
      name: t.name,
      description: t.description,
      strength: t.strength,
      sentiment: existing?.sentiment ?? 0,
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
    if (isTopicPlaceholder(t)) {
      continue;
    }
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
      if (isVisible) {
        groupsVisible.push(groupName);
      }
    }
  }
  
  const updates: Partial<PersonaEntity> = {
    display_name: data.display_name,
    aliases: data.aliases,
    short_description: data.short_description,
    long_description: stripPlaceholder(data.long_description, PLACEHOLDER_LONG_DESC),
    model: data.model,
    group_primary: data.group_primary,
    groups_visible: groupsVisible,
    traits,
    topics,
    heartbeat_delay_ms: data.heartbeat_delay_ms,
    context_window_hours: data.context_window_hours,
    is_paused: data.is_paused ?? false,
    pause_until: data.pause_until,
    is_static: data.is_static ?? false,
    last_updated: new Date().toISOString(),
  };
  
  return { updates, deletedTraitIds, deletedTopicIds };
}

// =============================================================================
// HUMAN SERIALIZATION
// =============================================================================

export function humanToYAML(human: HumanEntity): string {
  const data: EditableHumanData = {
    facts: human.facts.map(f => ({ ...f, _delete: false })),
    traits: human.traits.map(t => ({ ...t, _delete: false })),
    topics: human.topics.map(t => ({ ...t, _delete: false })),
    people: human.people.map(p => ({ ...p, _delete: false })),
  };
  
  return YAML.stringify(data, {
    lineWidth: 0,
  });
}

export interface HumanYAMLResult {
  facts: Fact[];
  traits: Trait[];
  topics: Topic[];
  people: Person[];
  deletedFactIds: string[];
  deletedTraitIds: string[];
  deletedTopicIds: string[];
  deletedPersonIds: string[];
}

export function humanFromYAML(yamlContent: string): HumanYAMLResult {
  const data = YAML.parse(yamlContent) as EditableHumanData;
  
  const deletedFactIds: string[] = [];
  const deletedTraitIds: string[] = [];
  const deletedTopicIds: string[] = [];
  const deletedPersonIds: string[] = [];
  
  const facts: Fact[] = [];
  for (const f of data.facts ?? []) {
    if (f._delete) {
      deletedFactIds.push(f.id);
    } else {
      const { _delete, ...fact } = f;
      facts.push(fact);
    }
  }
  
  const traits: Trait[] = [];
  for (const t of data.traits ?? []) {
    if (t._delete) {
      deletedTraitIds.push(t.id);
    } else {
      const { _delete, ...trait } = t;
      traits.push(trait);
    }
  }
  
  const topics: Topic[] = [];
  for (const t of data.topics ?? []) {
    if (t._delete) {
      deletedTopicIds.push(t.id);
    } else {
      const { _delete, ...topic } = t;
      topics.push(topic);
    }
  }
  
  const people: Person[] = [];
  for (const p of data.people ?? []) {
    if (p._delete) {
      deletedPersonIds.push(p.id);
    } else {
      const { _delete, ...person } = p;
      people.push(person);
    }
  }
  
  return {
    facts,
    traits,
    topics,
    people,
    deletedFactIds,
    deletedTraitIds,
    deletedTopicIds,
    deletedPersonIds,
  };
}

// =============================================================================
// SETTINGS SERIALIZATION
// =============================================================================

interface EditableSettingsData {
  default_model?: string | null;
  time_mode?: "24h" | "12h" | "local" | "utc" | null;
  name_display?: string | null;
  ceremony?: {
    time: string;
    decay_rate?: number | null;
    explore_threshold?: number | null;
  };
  opencode?: {
    integration?: boolean | null;
    polling_interval_ms?: number | null;
  };
}

export function settingsToYAML(settings: HumanSettings | undefined): string {
  // Always show all editable fields, using null for unset values so YAML displays them
  const data: EditableSettingsData = {
    default_model: settings?.default_model ?? null,
    time_mode: settings?.time_mode ?? null,
    name_display: settings?.name_display ?? null,
    ceremony: {
      time: settings?.ceremony?.time ?? "09:00",
      decay_rate: settings?.ceremony?.decay_rate ?? null,
      explore_threshold: settings?.ceremony?.explore_threshold ?? null,
    },
    opencode: {
      integration: settings?.opencode?.integration ?? null,
      polling_interval_ms: settings?.opencode?.polling_interval_ms ?? null,
    },
  };
  
  return YAML.stringify(data, {
    lineWidth: 0,
  });
}

export function settingsFromYAML(yamlContent: string, original: HumanSettings | undefined): HumanSettings {
  const data = YAML.parse(yamlContent) as EditableSettingsData;
  
  const nullToUndefined = <T>(value: T | null | undefined): T | undefined => 
    value === null ? undefined : value;
  
  let ceremony: CeremonyConfig | undefined;
  if (data.ceremony) {
    ceremony = {
      time: data.ceremony.time,
      decay_rate: nullToUndefined(data.ceremony.decay_rate),
      explore_threshold: nullToUndefined(data.ceremony.explore_threshold),
      last_ceremony: original?.ceremony?.last_ceremony,
    };
  }
  
  let opencode: OpenCodeSettings | undefined;
  if (data.opencode) {
    opencode = {
      integration: nullToUndefined(data.opencode.integration),
      polling_interval_ms: nullToUndefined(data.opencode.polling_interval_ms),
      last_sync: original?.opencode?.last_sync,
      extraction_point: original?.opencode?.extraction_point,
    };
  }
  
  return {
    ...original,
    default_model: nullToUndefined(data.default_model),
    time_mode: nullToUndefined(data.time_mode),
    name_display: nullToUndefined(data.name_display),
    ceremony,
    opencode,
  };
}


/**
 * Validate that a model spec (e.g. "Anthropic:sonnet") references a real provider.
 * Case-insensitive match — auto-corrects casing to the actual provider name.
 * Throws if no matching provider found (caller's catch triggers re-edit).
 */
export function validateModelProvider(
  modelSpec: string | undefined,
  accounts: ProviderAccount[]
): string | undefined {
  if (!modelSpec) return undefined;
  
  const colonIdx = modelSpec.indexOf(":");
  const providerPart = colonIdx >= 0 ? modelSpec.substring(0, colonIdx) : modelSpec;
  const modelPart = colonIdx >= 0 ? modelSpec.substring(colonIdx + 1) : undefined;
  
  const match = accounts.find(a => a.name.toLowerCase() === providerPart.toLowerCase());
  
  if (!match) {
    const available = accounts.map(a => a.name).join(", ");
    throw new Error(
      available
        ? `No provider named "${providerPart}". Available: ${available}`
        : `No provider named "${providerPart}". Create one with /provider new`
    );
  }
  
  return modelPart ? `${match.name}:${modelPart}` : match.name;
}

// =============================================================================
// QUOTE SERIALIZATION
// =============================================================================

interface EditableQuote extends Quote {
  _delete?: boolean;
}

interface EditableQuoteData {
  quotes: EditableQuote[];
}

export function quotesToYAML(quotes: Quote[]): string {
  const data: EditableQuoteData = {
    quotes: quotes.map(q => ({
      ...q,
      _delete: false,
    })),
  };
  
  return YAML.stringify(data, {
    lineWidth: 0,
  });
}

export interface QuotesYAMLResult {
  quotes: Quote[];
  deletedQuoteIds: string[];
}

export function quotesFromYAML(yamlContent: string): QuotesYAMLResult {
  const data = YAML.parse(yamlContent) as EditableQuoteData;
  
  const deletedQuoteIds: string[] = [];
  const quotes: Quote[] = [];
  
  for (const q of data.quotes ?? []) {
    if (q._delete) {
      deletedQuoteIds.push(q.id);
    } else {
      const { _delete, ...quote } = q;
      quotes.push(quote);
    }
  }
  
  return {
    quotes,
    deletedQuoteIds,
  };
}


// =============================================================================
// PROVIDER ACCOUNT SERIALIZATION
// =============================================================================

interface EditableProviderData {
  name: string;
  type: "llm" | "storage";
  url: string;
  api_key?: string;
  default_model?: string;
  extra_headers?: Record<string, string>;
  enabled?: boolean;
}


function resolveEnvVar(value: string | undefined): string | undefined {
  if (!value || !value.startsWith("$")) return value;
  const varName = value.slice(1);
  return process.env[varName] || value;
}
const PLACEHOLDER_PROVIDER: EditableProviderData = {
  name: "My Provider",
  type: "llm",
  url: "https://api.example.com/v1",
  api_key: "your-api-key-or-$ENVAR",
  default_model: "model-name",
  extra_headers: {},
  enabled: true,
};

/**
 * Generate YAML template for a NEW provider account
 */
export function newProviderToYAML(): string {
  return YAML.stringify(PLACEHOLDER_PROVIDER, {
    lineWidth: 0,
  });
}

/**
 * Parse YAML for a NEW provider account
 */
export function newProviderFromYAML(yamlContent: string): ProviderAccount {
  const data = YAML.parse(yamlContent) as EditableProviderData;
  
  if (!data.name || data.name === PLACEHOLDER_PROVIDER.name) {
    throw new Error("Provider name is required");
  }
  if (!data.url || data.url === PLACEHOLDER_PROVIDER.url) {
    throw new Error("Provider URL is required");
  }
  if (data.api_key === PLACEHOLDER_PROVIDER.api_key) {
    data.api_key = undefined;
  }
  if (data.default_model === PLACEHOLDER_PROVIDER.default_model) {
    data.default_model = undefined;
  }
  
  return {
    id: crypto.randomUUID(),
    name: data.name,
    type: (data.type === "storage" ? "storage" : "llm") as ProviderType,
    url: data.url,
    api_key: resolveEnvVar(data.api_key),
    default_model: data.default_model,
    extra_headers: data.extra_headers && Object.keys(data.extra_headers).length > 0 ? data.extra_headers : undefined,
    enabled: data.enabled ?? true,
    created_at: new Date().toISOString(),
  };
}

/**
 * Serialize existing provider account to YAML for editing
 */
export function providerToYAML(account: ProviderAccount): string {
  const data: EditableProviderData = {
    name: account.name,
    type: account.type as "llm" | "storage",
    url: account.url,
    api_key: account.api_key,
    default_model: account.default_model,
    extra_headers: account.extra_headers,
    enabled: account.enabled ?? true,
  };
  
  return YAML.stringify(data, {
    lineWidth: 0,
  });
}

/**
 * Parse YAML for an existing provider account (preserves id and created_at)
 */
export function providerFromYAML(yamlContent: string, original: ProviderAccount): ProviderAccount {
  const data = YAML.parse(yamlContent) as EditableProviderData;
  
  if (!data.name) {
    throw new Error("Provider name is required");
  }
  if (!data.url) {
    throw new Error("Provider URL is required");
  }
  
  return {
    id: original.id,
    name: data.name,
    type: (data.type === "storage" ? "storage" : "llm") as ProviderType,
    url: data.url,
    api_key: resolveEnvVar(data.api_key),
    default_model: data.default_model,
    extra_headers: data.extra_headers && Object.keys(data.extra_headers).length > 0 ? data.extra_headers : undefined,
    enabled: data.enabled ?? true,
    created_at: original.created_at,
  };
}