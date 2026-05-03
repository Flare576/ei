import type { ToolExecutor } from "../types.js";
import type { Fact, Topic, Person, Quote, HumanEntity } from "../../types.js";

type GetHuman = () => HumanEntity;

function cleanFact(f: Fact): Record<string, unknown> {
  const { embedding, rewrite_checked, persona_groups, ...rest } = f;
  void embedding; void rewrite_checked; void persona_groups;
  return rest;
}

function cleanTopic(t: Topic): Record<string, unknown> {
  const { embedding, rewrite_checked, persona_groups, last_ei_asked, ...rest } = t;
  void embedding; void rewrite_checked; void persona_groups; void last_ei_asked;
  return rest;
}

function cleanPerson(p: Person): Record<string, unknown> {
  const { embedding, rewrite_checked, persona_groups, last_ei_asked, ...rest } = p;
  void embedding; void rewrite_checked; void persona_groups; void last_ei_asked;
  return rest;
}

function cleanQuote(
  q: Quote,
  facts: Fact[],
  topics: Topic[],
  people: Person[]
): Record<string, unknown> {
  const { embedding, persona_groups, data_item_ids, ...rest } = q;
  void embedding; void persona_groups;

  const related_items: Array<{ id: string; name: string; type: string }> = [];
  for (const id of data_item_ids) {
    const fact = facts.find(f => f.id === id);
    if (fact) { related_items.push({ id: fact.id, name: fact.name, type: "fact" }); continue; }
    const topic = topics.find(t => t.id === id);
    if (topic) { related_items.push({ id: topic.id, name: topic.name, type: "topic" }); continue; }
    const person = people.find(p => p.id === id);
    if (person) { related_items.push({ id: person.id, name: person.name, type: "person" }); continue; }
  }

  return { ...rest, related_items };
}

export function createFetchMemoryExecutor(getHuman: GetHuman): ToolExecutor {
  return {
    name: "fetch_memory",

    async execute(args: Record<string, unknown>): Promise<string> {
      const id = typeof args.id === "string" ? args.id.trim() : "";
      console.log(`[fetch_memory] called with id="${id}"`);

      if (!id) {
        console.warn("[fetch_memory] missing id argument");
        return JSON.stringify({ error: "Missing required argument: id" });
      }

      const human = getHuman();

      const fact = human.facts.find(f => f.id === id);
      if (fact) {
        console.log(`[fetch_memory] found fact id="${id}" name="${fact.name}"`);
        return JSON.stringify({ type: "fact", ...cleanFact(fact) });
      }

      const topic = human.topics.find(t => t.id === id);
      if (topic) {
        console.log(`[fetch_memory] found topic id="${id}" name="${topic.name}"`);
        return JSON.stringify({ type: "topic", ...cleanTopic(topic) });
      }

      const person = human.people.find(p => p.id === id);
      if (person) {
        console.log(`[fetch_memory] found person id="${id}" name="${person.name}"`);
        return JSON.stringify({ type: "person", ...cleanPerson(person) });
      }

      const quote = human.quotes.find(q => q.id === id);
      if (quote) {
        console.log(`[fetch_memory] found quote id="${id}"`);
        return JSON.stringify({
          type: "quote",
          ...cleanQuote(quote, human.facts, human.topics, human.people),
        });
      }

      console.log(`[fetch_memory] no entity found for id="${id}"`);
      return JSON.stringify({ error: "No accessible record found for this ID" });
    },
  };
}
