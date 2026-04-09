import YAML from "yaml";
import type {
  HumanEntity,
  Fact,
  Topic,
  Person,
  PersonIdentifier,
} from "../../../src/core/types.js";
import { BUILT_IN_FACT_NAMES } from "../../../src/core/constants/built-in-facts.js";
import { BUILT_IN_IDENTIFIER_TYPES } from "../../../src/core/constants/built-in-identifier-types.js";

interface EditableTopic extends Omit<Topic, 'persona_groups'> {
  _delete?: boolean;
  persona_groups?: Record<string, boolean>[];
}

interface EditableFact extends Omit<Fact, 'persona_groups'> {
  _delete?: boolean;
  persona_groups?: Record<string, boolean>[];
}

interface YAMLPersonIdentifier {
  type: string;
  value: string;
  primary?: true;
}

interface EditablePersonYAML extends Omit<Person, 'identifiers' | 'persona_groups'> {
  identifiers: YAMLPersonIdentifier[];
  _delete?: boolean;
  persona_groups?: Record<string, boolean>[];
}

interface EditableHumanData {
  facts: EditableFact[];
  topics: EditableTopic[];
  people: EditablePersonYAML[];
}

type WithReadOnlyFields = {
  learned_on?: string;
  learned_by?: string;
  validated_date?: string;
  last_mentioned?: string;
  last_updated: string;
  last_changed_by?: string;
};

function readOnlyToEnd<T extends WithReadOnlyFields>(item: T): T {
  const { learned_on, learned_by, validated_date, last_mentioned, last_updated, last_changed_by, ...rest } = item;
  return { ...rest, learned_on, learned_by, validated_date, last_mentioned, last_updated, last_changed_by } as T;
}

const FIELD_ORDER = ['id', 'name', 'description', 'sentiment', 'relationship', 'category', 'exposure_current', 'exposure_desired'];

function canonicalFieldOrder<T extends object>(item: T): T {
  const ordered: Record<string, unknown> = {};
  for (const key of FIELD_ORDER) {
    if (key in item) ordered[key] = (item as Record<string, unknown>)[key];
  }
  for (const [key, val] of Object.entries(item)) {
    if (!(key in ordered)) ordered[key] = val;
  }
  return ordered as T;
}

function buildGroupCheckboxMap(itemGroups: string[], allGroups: string[]): Record<string, boolean>[] {
  const activeSet = new Set(itemGroups);
  return [...new Set([...allGroups, ...itemGroups])].map(g => ({ [g]: activeSet.has(g) }));
}

function toYAMLIdentifiers(identifiers: PersonIdentifier[], personaLookup?: Map<string, string>): YAMLPersonIdentifier[] {
  return identifiers.map(({ type, value, is_primary }) => {
    const resolvedValue = type === 'Ei Persona' ? (personaLookup?.get(value) ?? value) : value;
    const entry: YAMLPersonIdentifier = { type, value: resolvedValue };
    if (is_primary) entry.primary = true;
    return entry;
  });
}

function knownTypesComment(people: Person[], personaLookup?: Map<string, string>): string {
  const userTypes = people.flatMap(p => (p.identifiers ?? []).map(i => i.type));
  const allTypes = [...new Set([...BUILT_IN_IDENTIFIER_TYPES, ...userTypes])];
  const lines = [`# Valid types: ${allTypes.join(', ')}`];
  if (personaLookup && personaLookup.size > 0) {
    lines.push(`# Personas: ${Array.from(personaLookup.values()).join(', ')}`);
  }
  return lines.join('\n');
}

function parseGroupCheckboxMap(groups: Record<string, boolean>[] | undefined): string[] {
  if (!groups) return [];
  const result: string[] = [];
  for (const record of groups) {
    for (const [name, active] of Object.entries(record)) {
      if (active) result.push(name);
    }
  }
  return result;
}

function sectionStub(type: "facts" | "topics" | "people", people: Person[], personaLookup?: Map<string, string>): string {
  if (type === "facts") {
    return [
      `  # --- New Fact (uncomment to create) ---`,
      `  # - name: ''`,
      `  #   description: ''`,
      `  #   sentiment: 0`,
    ].join('\n');
  }

  if (type === "topics") {
    return [
      `  # --- New Topic (uncomment to create) ---`,
      `  # - name: ''`,
      `  #   description: ''`,
      `  #   category: ''  # Interest, Goal, Dream, Conflict, Concern, Fear, Hope, Plan, Project`,
      `  #   exposure_desired: 0.5`,
      `  #   sentiment: 0`,
    ].join('\n');
  }

  const userTypes = people.flatMap(p => (p.identifiers ?? []).map(i => i.type));
  const allTypes = [...new Set([...BUILT_IN_IDENTIFIER_TYPES, ...userTypes])];
  const identifierTypeHint = allTypes.join(', ');
  const personaNames = personaLookup && personaLookup.size > 0
    ? Array.from(personaLookup.values()).join(', ')
    : null;

  return [
    `  # --- New Person (uncomment to create) ---`,
    `  # - name: ''`,
    `  #   description: ''`,
    `  #   relationship: ''`,
    `  #   exposure_desired: 0.5`,
    `  #   sentiment: 0`,
    `  #   identifiers:`,
    `  #     # Valid types: ${identifierTypeHint}`,
    ...(personaNames ? [`  #     # Personas: ${personaNames}`] : []),
    `  #     - type: ''`,
    `  #       value: ''`,
    `  #       primary: true`,
  ].join('\n');
}

export function humanToYAML(
  human: HumanEntity,
  personaLookup?: Map<string, string>,
  allGroups: string[] = [],
  sections?: Set<"facts" | "topics" | "people">,
): string {
  const activeSections = sections ?? new Set<"facts" | "topics" | "people">(["facts", "topics", "people"]);

  const data: Partial<EditableHumanData> = {};

  if (activeSections.has("facts") && human.facts.length > 0) {
    data.facts = human.facts.map(f => { const { interested_personas: _ip, persona_groups, ...rest } = readOnlyToEnd(f); return { ...rest, persona_groups: buildGroupCheckboxMap(persona_groups ?? [], allGroups), _delete: false }; });
  }
  if (activeSections.has("topics") && human.topics.length > 0) {
    data.topics = human.topics.map(t => { const { interested_personas: _ip, persona_groups, ...rest } = readOnlyToEnd(t); return { ...rest, persona_groups: buildGroupCheckboxMap(persona_groups ?? [], allGroups), _delete: false }; });
  }
  if (activeSections.has("people") && human.people.length > 0) {
    data.people = human.people.map(p => {
      const { identifiers, interested_personas: _ip, persona_groups, ...rest } = readOnlyToEnd(p);
      return {
        ...rest,
        persona_groups: buildGroupCheckboxMap(persona_groups ?? [], allGroups),
        identifiers: toYAMLIdentifiers(identifiers ?? [], personaLookup),
        _delete: false as const,
      };
    });
  }

  const personComment = knownTypesComment(human.people, personaLookup);

  const applyReadOnlyMarkers = (yaml: string): string =>
    yaml
      .replace(/^(\s+)(learned_on: .+)$/mg, '$1# [read-only] $2')
      .replace(/^(\s+)(learned_by: )(.+)$/mg, (_, indent, key, val) => {
        const trimmed = val.trim();
        const displayName = personaLookup?.get(trimmed) ?? trimmed;
        return `${indent}# [read-only] ${key}${displayName}`;
      })
      .replace(/^(\s+)(validated_date: .+)$/mg, '$1# [read-only] $2')
      .replace(/^(\s+)(last_mentioned: .+)$/mg, '$1# [read-only] $2')
      .replace(/^(\s+)(last_updated: .+)$/mg, '$1# [read-only] $2')
      .replace(/^(\s+)(last_changed_by: )(.+)$/mg, (_, indent, key, val) => {
        const trimmed = val.trim();
        const displayName = personaLookup?.get(trimmed) ?? trimmed;
        return `${indent}# [read-only] ${key}${displayName}`;
      })
      .replace(/^(\s+)(identifiers:)/mg, (_, indent, _key) => {
        return `${indent}${personComment}\n${indent}identifiers:`;
      });

  const serializeSection = (key: "facts" | "topics" | "people", items: unknown[] | undefined): string => {
    const stub = sectionStub(key, human.people, personaLookup);
    if (!items || items.length === 0) {
      return `${key}:\n${stub}`;
    }
    const ordered = (items as object[]).map(canonicalFieldOrder);
    const itemsYaml = YAML.stringify(ordered, { lineWidth: 0 })
      .split('\n')
      .map(line => `  ${line}`)
      .join('\n')
      .trimEnd();
    return `${key}:\n${applyReadOnlyMarkers(itemsYaml)}\n${stub}`;
  };

  const parts: string[] = [];
  if (activeSections.has("facts")) parts.push(serializeSection("facts", data.facts));
  if (activeSections.has("topics")) parts.push(serializeSection("topics", data.topics));
  if (activeSections.has("people")) parts.push(serializeSection("people", data.people));

  return parts.join('\n') + '\n';
}

export interface HumanYAMLResult {
  facts: Fact[];
  topics: Topic[];
  people: Person[];
  deletedFactIds: string[];
  deletedTopicIds: string[];
  deletedPersonIds: string[];
  changedFactIds: Set<string>;
  changedTopicIds: Set<string>;
  changedPersonIds: Set<string>;
}

function identifiersEqual(a: PersonIdentifier[] | undefined, b: PersonIdentifier[] | undefined): boolean {
  const normalize = (ids: PersonIdentifier[] | undefined) =>
    [...(ids ?? [])].sort((x, y) => `${x.type}:${x.value}`.localeCompare(`${y.type}:${y.value}`));
  const na = normalize(a);
  const nb = normalize(b);
  if (na.length !== nb.length) return false;
  return na.every((id, i) =>
    id.type === nb[i].type &&
    id.value === nb[i].value &&
    Boolean(id.is_primary) === Boolean(nb[i].is_primary)
  );
}

function groupsEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  const sa = [...(a ?? [])].sort();
  const sb = [...(b ?? [])].sort();
  if (sa.length !== sb.length) return false;
  return sa.every((v, i) => v === sb[i]);
}

function factChanged(parsed: Fact, original: Fact): boolean {
  const scalarFields: (keyof Fact)[] = [
    'name', 'description', 'sentiment',
  ];
  for (const field of scalarFields) {
    if (parsed[field] !== original[field]) return true;
  }
  return !groupsEqual(parsed.persona_groups, original.persona_groups);
}

function topicChanged(parsed: Topic, original: Topic): boolean {
  const scalarFields: (keyof Topic)[] = [
    'name', 'description', 'sentiment', 'exposure_current', 'exposure_desired', 'category',
  ];
  for (const field of scalarFields) {
    if (parsed[field] !== original[field]) return true;
  }
  return !groupsEqual(parsed.persona_groups, original.persona_groups);
}

function personChanged(parsed: Person, original: Person): boolean {
  const scalarFields: (keyof Person)[] = [
    'name', 'description', 'sentiment', 'relationship',
    'exposure_current', 'exposure_desired',
  ];
  for (const field of scalarFields) {
    if (parsed[field] !== original[field]) return true;
  }
  if (!groupsEqual(parsed.persona_groups, original.persona_groups)) return true;
  return !identifiersEqual(parsed.identifiers, original.identifiers);
}

export function humanFromYAML(yamlContent: string, original?: HumanEntity): HumanYAMLResult {
  const stripped = yamlContent
    .split('\n')
    .filter(line => !/^\s*#\s*\[read-only\]/.test(line))
    .join('\n');
  const data = (YAML.parse(stripped) ?? {}) as EditableHumanData;

  const deletedFactIds: string[] = [];
  const deletedTopicIds: string[] = [];
  const deletedPersonIds: string[] = [];
  const changedFactIds = new Set<string>();
  const changedTopicIds = new Set<string>();
  const changedPersonIds = new Set<string>();

  const facts: Fact[] = [];
  for (const f of data.facts ?? []) {
    if (f._delete && !BUILT_IN_FACT_NAMES.has(f.name)) {
      deletedFactIds.push(f.id);
    } else {
      const { _delete, persona_groups: groupMap, ...parsed } = f;
      if (!parsed.id) parsed.id = crypto.randomUUID();
      const originalFact = original?.facts.find(of => of.id === parsed.id);
      const fact: Fact = originalFact
        ? { ...originalFact, ...parsed, persona_groups: parseGroupCheckboxMap(groupMap) }
        : { ...parsed, last_updated: new Date().toISOString(), persona_groups: parseGroupCheckboxMap(groupMap) };
      facts.push(fact);
      if (!originalFact || factChanged(fact, originalFact)) {
        if (fact.description && !originalFact?.validated_date) {
          fact.validated_date = new Date().toISOString();
        }
        changedFactIds.add(fact.id);
      }
    }
  }

  const topics: Topic[] = [];
  for (const t of data.topics ?? []) {
    if (t._delete) {
      deletedTopicIds.push(t.id);
    } else {
      const { _delete, persona_groups: groupMap, ...parsed } = t;
      if (!parsed.id) parsed.id = crypto.randomUUID();
      const originalTopic = original?.topics.find(ot => ot.id === parsed.id);
      const topic: Topic = originalTopic
        ? { ...originalTopic, ...parsed, persona_groups: parseGroupCheckboxMap(groupMap) }
        : { ...parsed, last_updated: new Date().toISOString(), persona_groups: parseGroupCheckboxMap(groupMap) };
      topics.push(topic);
      if (!originalTopic || topicChanged(topic, originalTopic)) {
        changedTopicIds.add(topic.id);
      }
    }
  }

  const people: Person[] = [];
  for (const p of data.people ?? []) {
    if (p._delete) {
      deletedPersonIds.push(p.id);
    } else {
      const { _delete, identifiers: yamlIdentifiers, persona_groups: groupMap, ...parsed } = p;
      if (!parsed.id) parsed.id = crypto.randomUUID();
      const identifiers: PersonIdentifier[] = (yamlIdentifiers ?? []).map(({ type, value, primary }) => ({
        type,
        value,
        ...(primary ? { is_primary: true } : {}),
      }));
      const originalPerson = original?.people.find(op => op.id === parsed.id);
      const person: Person = originalPerson
        ? { ...originalPerson, ...parsed, identifiers, persona_groups: parseGroupCheckboxMap(groupMap) }
        : { ...parsed, last_updated: new Date().toISOString(), identifiers, persona_groups: parseGroupCheckboxMap(groupMap) };
      people.push(person);
      if (!originalPerson || personChanged(person, originalPerson)) {
        changedPersonIds.add(person.id);
      }
    }
  }

  return {
    facts,
    topics,
    people,
    deletedFactIds,
    deletedTopicIds,
    deletedPersonIds,
    changedFactIds,
    changedTopicIds,
    changedPersonIds,
  };
}
