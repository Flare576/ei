import type { ToolExecutor } from "../types.js";
import type { Fact, Topic, Person, Quote, HumanEntity } from "../../types.js";
import { stripHiddenDataItemFields } from "../../entity-schemas.js";

type GetHuman = () => HumanEntity;

// 2026-08-20 ruling (Flare, .sisyphus/issues/fetch-memory-adr031-field-drift.md): fetch_memory's
// output is a DIFFERENT trust boundary than the external CLI/MCP surface
// stripHiddenDataItemFields governs (an LLM persona calling this on itself mid-conversation, not
// an external caller) -- but it must still be a SUBSET of that surface, never a superset. Ei's
// own models run with far smaller context windows, so hiding MORE than ADR-031 strictly requires
// (persona_groups, below) is intentional signal-to-noise reduction for conversation/further-
// data-acquisition use, not a bug. Hiding LESS -- silently leaking a field ADR-031 already
// decided must never reach a caller -- was the actual defect this ruling fixes: cleanFact/
// cleanTopic/cleanPerson used to hand-maintain their own independent exclusion list, which had
// already drifted (cleanFact was missing rewrite_length_floor; cleanTopic/cleanPerson were both
// missing exposure_current/exposure_desired). Composing on stripHiddenDataItemFields instead
// means the ADR-031 baseline can never drift again -- there is only one list to maintain, not two.

function cleanFact(f: Fact): Record<string, unknown> {
  const { persona_groups, ...rest } = stripHiddenDataItemFields(f);
  void persona_groups;
  return rest;
}

function cleanTopic(t: Topic): Record<string, unknown> {
  const { persona_groups, ...rest } = stripHiddenDataItemFields(t);
  void persona_groups;
  return rest;
}

function cleanPerson(p: Person): Record<string, unknown> {
  const { persona_groups, ...rest } = stripHiddenDataItemFields(p);
  void persona_groups;
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

  const linked_items: Array<{ id: string; name: string; type: string }> = [];
  for (const id of data_item_ids) {
    const fact = facts.find(f => f.id === id);
    if (fact) { linked_items.push({ id: fact.id, name: fact.name, type: "fact" }); continue; }
    const topic = topics.find(t => t.id === id);
    if (topic) { linked_items.push({ id: topic.id, name: topic.name, type: "topic" }); continue; }
    const person = people.find(p => p.id === id);
    if (person) { linked_items.push({ id: person.id, name: person.name, type: "person" }); continue; }
  }

  return { ...rest, linked_items };
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
