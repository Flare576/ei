import type { HumanEntity, PersonaEntity, Fact, Trait, Topic, Person, Quote, PersonaTopic } from "../types.ts";
export type CrossFindResult =
  | { type: "fact"        } & Fact
  | { type: "trait"       } & Trait
  | { type: "topic"       } & Topic
  | { type: "person"      } & Person
  | { type: "quote"       } & Quote
  | { type: "persona"     } & PersonaEntity
  | { type: "personaTopic"; personaId: string } & PersonaTopic
  | { type: "personaTrait"; personaId: string } & Trait;

export function crossFind(
  id: string,
  human: HumanEntity,
  personas?: PersonaEntity[],
): CrossFindResult | null {

  const fact  = human.facts.find(f => f.id === id);
  if (fact)  return { type: "fact",   ...fact };

  const trait = human.traits.find(t => t.id === id);
  if (trait) return { type: "trait",  ...trait };

  const person = human.people.find(p => p.id === id);
  if (person) return { type: "person", ...person };

  const topic = human.topics.find(t => t.id === id);
  if (topic) return { type: "topic",  ...topic };

  const quote = human.quotes.find(q => q.id === id);
  if (quote) return { type: "quote",  ...quote };

  for (const persona of personas ?? []) {
    if (persona.id === id) return { type: "persona", ...persona };

    const pTopic = persona.topics.find(t => t.id === id);
    if (pTopic) return { type: "personaTopic", personaId: persona.id, ...pTopic };

    const pTrait = persona.traits.find(t => t.id === id);
    if (pTrait) return { type: "personaTrait", personaId: persona.id, ...pTrait };
  }

  return null;
}
