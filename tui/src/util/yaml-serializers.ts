import YAML from "yaml";
import type { 
  PersonaEntity, 
  HumanEntity, 
  Fact, 
  Trait, 
  Topic, 
  Person,
  PersonaTopic,
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
  name: string;
  aliases?: string[];
  short_description?: string;
  long_description?: string;
  model?: string;
  group_primary?: string | null;
  groups_visible?: string[];
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
    name,
    long_description: PLACEHOLDER_LONG_DESC,
    model: undefined,
    group_primary: "General",
    groups_visible: ["General"],
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
  
  return {
    long_description: stripPlaceholder(data.long_description, PLACEHOLDER_LONG_DESC),
    model: data.model,
    group_primary: data.group_primary ?? "General",
    groups_visible: data.groups_visible ?? ["General"],
    traits,
    topics,
    heartbeat_delay_ms: data.heartbeat_delay_ms,
    context_window_hours: data.context_window_hours,
  };
}

export function personaToYAML(persona: PersonaEntity): string {
  const useTraitPlaceholder = persona.traits.length === 0;
  const useTopicPlaceholder = persona.topics.length === 0;
  
  const data: EditablePersonaData = {
    display_name: persona.display_name,
    aliases: persona.aliases,
    short_description: persona.short_description,
    long_description: persona.long_description || PLACEHOLDER_LONG_DESC,
    model: persona.model,
    group_primary: persona.group_primary,
    groups_visible: persona.groups_visible,
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
  
  const updates: Partial<PersonaEntity> = {
    display_name: data.display_name,
    aliases: data.aliases,
    short_description: data.short_description,
    long_description: stripPlaceholder(data.long_description, PLACEHOLDER_LONG_DESC),
    model: data.model,
    group_primary: data.group_primary,
    groups_visible: data.groups_visible,
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
