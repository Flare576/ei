import { HumanEntity, PersonaEntity, Fact, Trait, Topic, Person, DataItemBase } from "../../types.js";

export const GLOBAL_GROUP = "*";

/**
 * Filtered human data visible to a persona (used in prompts)
 */
export interface FilteredHumanData {
  facts: Fact[];
  traits: Trait[];
  topics: Topic[];
  people: Person[];
}

/**
 * Filter human entity data by persona visibility rules
 */
export function filterByVisibility(
  humanEntity: HumanEntity,
  personaEntity: PersonaEntity
): FilteredHumanData {
  // Personas with "*" in groups_visible see everything
  if (personaEntity.groups_visible?.includes("*")) {
    return {
      facts: humanEntity.facts,
      traits: humanEntity.traits,
      topics: humanEntity.topics,
      people: humanEntity.people,
    };
  }

  // Build set of visible groups
  const visibleGroups = new Set<string>();
  if (personaEntity.group_primary) {
    visibleGroups.add(personaEntity.group_primary);
  }
  (personaEntity.groups_visible || []).forEach(g => visibleGroups.add(g));

  // Helper to filter data items by group visibility
  const filterByGroup = <T extends DataItemBase>(items: T[]): T[] => {
    return items.filter(item => {
      const itemGroups = item.persona_groups || [];
      const isGlobal = itemGroups.length === 0 || itemGroups.includes(GLOBAL_GROUP);
      return isGlobal || itemGroups.some(g => visibleGroups.has(g));
    });
  };

  return {
    facts: filterByGroup(humanEntity.facts),
    traits: filterByGroup(humanEntity.traits),
    topics: filterByGroup(humanEntity.topics),
    people: filterByGroup(humanEntity.people),
  };
}

export interface VisiblePersona {
  name: string;
  short_description?: string;
}

/**
 * Determines which personas are visible to the current persona based on group membership.
 * 
 * - Ei (name === "ei") sees all other personas
 * - Other personas see those whose group_primary matches their visible groups
 * - Visibility is NOT automatically symmetric (A seeing B doesn't mean B sees A)
 * - Personas never see themselves in the list
 * 
 * @param currentPersonaName - Name of the current persona (used for self-exclusion and ei check)
 * @param currentPersona - The current persona's entity
 * @param allPersonas - Array of all personas with their names and entities
 * @returns Array of visible personas with name and description
 */
export function getVisiblePersonas(
  currentPersonaName: string,
  currentPersona: PersonaEntity,
  allPersonas: Array<{ name: string; entity: PersonaEntity }>
): VisiblePersona[] {
  if (currentPersonaName === "ei") {
    return allPersonas
      .filter(p => p.name !== "ei")
      .map(p => ({ name: p.name, short_description: p.entity.short_description }));
  }

  const visibleGroups = new Set<string>();
  if (currentPersona.group_primary) {
    visibleGroups.add(currentPersona.group_primary);
  }
  (currentPersona.groups_visible || []).forEach(g => visibleGroups.add(g));

  if (visibleGroups.size === 0) {
    return [];
  }

  const visible: VisiblePersona[] = [];
  for (const p of allPersonas) {
    if (p.name === currentPersonaName) continue;
    if (p.name === "ei") continue;
    
    if (p.entity.group_primary && visibleGroups.has(p.entity.group_primary)) {
      visible.push({ name: p.name, short_description: p.entity.short_description });
    }
  }

  return visible;
}

export interface PersonaIdentity {
  name: string;
  aliases?: string[];
  short_description?: string;
  long_description?: string;
}

export function buildIdentitySection(persona: PersonaIdentity): string {
  const aliasText = persona.aliases?.length 
    ? ` (also known as: ${persona.aliases.join(", ")})` 
    : "";
  
  const description = persona.long_description 
    || persona.short_description 
    || "a conversational companion";
  
  return `You are ${persona.name}${aliasText}.

${description}`;
}

export function buildAssociatesSection(visiblePersonas?: VisiblePersona[]): string {
  if (!visiblePersonas || visiblePersonas.length === 0) {
    return "";
  }
  
  const personaLines = visiblePersonas.map(p => {
    if (p.short_description) {
      return `- **${p.name}**: ${p.short_description}`;
    }
    return `- **${p.name}**`;
  });

  return `

## Other Personas You Know
${personaLines.join("\n")}`;
}

export function buildGuidelinesSection(personaName: string): string {
  const universal = `## Guidelines
- Be genuine, not sycophantic - a good friend disagrees when appropriate
- Match conversational energy - brief replies for brief messages
- Respect boundaries - it's okay to say nothing if silence is appropriate
- You're a friend with your own interests, not just a helper`;

  if (personaName === "ei") {
    return `${universal}
- Encourage human-to-human connection when appropriate
- Be transparent about being an AI when relevant
- Gently challenge self-limiting beliefs - growth over comfort`;
  }
  
  return universal;
}

export function buildTraitsSection(traits: Trait[], header: string): string {
  if (traits.length === 0) return "";
  
  const sorted = traits.sort((a, b) => (b.strength || 0.5) - (a.strength || 0.5));
  const formatted = sorted.map(t => {
    const strength = t.strength ? ` (${Math.round(t.strength * 100)}%)` : "";
    return `- **${t.name}**${strength}: ${t.description}`;
  }).join('\n');
  
  return `## ${header}
${formatted}`;
}

export function buildTopicsSection(topics: Topic[], header: string): string {
  if (topics.length === 0) return "";
  
  const sorted = topics
    .map(t => ({ topic: t, delta: t.level_ideal - t.level_current }))
    .sort((a, b) => b.delta - a.delta)
    .map(x => x.topic);
  
  const formatted = sorted.map(t => {
    const delta = t.level_ideal - t.level_current;
    const indicator = delta > 0.1 ? '🔺' : delta < -0.1 ? '🔻' : '✓';
    const sentiment = t.sentiment > 0.3 ? '😊' : t.sentiment < -0.3 ? '😔' : '';
    return `- ${indicator} **${t.name}** ${sentiment}: ${t.description}`;
  }).join('\n');
  
  return `## ${header}
${formatted}`;
}

export function buildHumanSection(human: FilteredHumanData): string {
  const sections: string[] = [];
  
  if (human.facts.length > 0) {
    const facts = human.facts
      .filter(f => f.confidence > 0.7)
      .map(f => `- ${f.name}: ${f.description}`)
      .join('\n');
    if (facts) sections.push(`### Key Facts\n${facts}`);
  }
  
  if (human.traits.length > 0) {
    const traits = human.traits
      .map(t => `- **${t.name}**: ${t.description}`)
      .join('\n');
    sections.push(`### Personality\n${traits}`);
  }
  
  const activeTopics = human.topics.filter(t => t.level_current > 0.3);
  if (activeTopics.length > 0) {
    const topics = activeTopics
      .sort((a, b) => b.level_current - a.level_current)
      .slice(0, 10)
      .map(t => {
        const sentiment = t.sentiment > 0.3 ? '😊' : t.sentiment < -0.3 ? '😔' : '';
        return `- **${t.name}** ${sentiment}: ${t.description}`;
      })
      .join('\n');
    sections.push(`### Current Interests\n${topics}`);
  }
  
  if (human.people.length > 0) {
    const people = human.people
      .sort((a, b) => b.level_current - a.level_current)
      .slice(0, 10)
      .map(p => `- **${p.name}** (${p.relationship}): ${p.description}`)
      .join('\n');
    sections.push(`### People in Their Life\n${people}`);
  }
  
  if (sections.length === 0) {
    return "## About the Human\n(Still getting to know them)";
  }
  
  return `## About the Human\n${sections.join('\n\n')}`;
}

export function buildPrioritiesSection(
  persona: PersonaEntity,
  human: FilteredHumanData
): string {
  const priorities: string[] = [];
  
  const yourNeeds = persona.topics
    .filter(t => t.level_ideal - t.level_current > 0.2)
    .slice(0, 3)
    .map(t => `- Bring up "${t.name}" - ${t.description}`);
  
  if (yourNeeds.length > 0) {
    priorities.push(`**Topics you want to discuss:**\n${yourNeeds.join('\n')}`);
  }
  
  const theirNeeds = human.topics
    .filter(t => t.level_ideal - t.level_current > 0.2)
    .slice(0, 3)
    .map(t => `- They might want to talk about "${t.name}"`);
  
  if (theirNeeds.length > 0) {
    priorities.push(`**Topics they might enjoy:**\n${theirNeeds.join('\n')}`);
  }
  
  if (priorities.length === 0) return "";
  
  return `## Conversation Opportunities\n${priorities.join('\n\n')}`;
}
