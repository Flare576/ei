import type { ToolExecutor } from "../types.js";
import type { Fact, Topic, Person, Quote, HumanEntity } from "../../types.js";

interface PersonaSummary {
  id: string;
  display_name: string;
}

type SearchHumanData = (
  query: string,
  options?: { types?: Array<"fact" | "topic" | "person" | "quote">; limit?: number; recent?: boolean; persona_filter?: string }
) => Promise<{ facts: Fact[]; topics: Topic[]; people: Person[]; quotes: Quote[] }>;

type GetPersonaList = () => Promise<PersonaSummary[]>;

type GetHuman = () => HumanEntity;

function formatSentiment(s: number): string {
  const pct = Math.round(Math.abs(s) * 100);
  const direction = s > 0.2 ? "positive" : s < -0.2 ? "negative" : "neutral";
  if (direction === "neutral") return "neutral";
  const intensity = pct >= 80 ? "strongly " : pct >= 50 ? "" : "slightly ";
  return `${pct}% ${intensity}${direction}`;
}

export function createFindMemoryExecutor(searchHumanData: SearchHumanData, getPersonaList?: GetPersonaList, getHuman?: GetHuman): ToolExecutor {
  return {
    name: "find_memory",

    async execute(args: Record<string, unknown>): Promise<string> {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      const recent = args.recent === true;
      const personaArg = typeof args.persona === "string" ? args.persona.trim() : "";
      console.log(`[find_memory] called with query="${query}", types=${JSON.stringify(args.types ?? null)}, limit=${args.limit ?? 10}, recent=${recent}, persona="${personaArg}"`);

      if (!query && !recent) {
        console.warn("[find_memory] missing query argument");
        return JSON.stringify({ error: "Missing required argument: query (or use recent: true)" });
      }

      const typeMap: Record<string, "fact" | "topic" | "person" | "quote"> = {
        fact: "fact", facts: "fact",
        topic: "topic", topics: "topic",
        person: "person", people: "person",
        quote: "quote", quotes: "quote",
      };

      const types = Array.isArray(args.types)
        ? (args.types
            .filter((t): t is string => typeof t === "string")
            .map(t => typeMap[t])
            .filter((t): t is "fact" | "topic" | "person" | "quote" => t !== undefined)
            .filter((v, i, a) => a.indexOf(v) === i)
          )
        : undefined;

      const limit = typeof args.limit === "number" && args.limit > 0 ? Math.min(args.limit, 20) : 10;

      // Resolve persona display_name to ID
      let persona_filter: string | undefined;
      if (personaArg && getPersonaList) {
        const personas = await getPersonaList();
        const match = personas.find(p => p.display_name.toLowerCase() === personaArg.toLowerCase());
        if (match) {
          persona_filter = match.id;
          console.log(`[find_memory] resolved persona "${personaArg}" to ID "${persona_filter}"`);
        } else {
          console.warn(`[find_memory] persona "${personaArg}" not found, proceeding without filter`);
        }
      }

      const results = await searchHumanData(query, { types, limit, recent, persona_filter });

      const total = results.facts.length + results.topics.length + results.people.length + results.quotes.length;
      console.log(`[find_memory] query="${query}" => ${total} results (facts=${results.facts.length}, topics=${results.topics.length}, people=${results.people.length}, quotes=${results.quotes.length})`);

      const output: Record<string, unknown[]> = {};
      if (results.facts.length > 0) output.facts = results.facts.map(f => ({ id: f.id, name: f.name, description: f.description }));
      if (results.topics.length > 0) output.topics = results.topics.map(t => ({ id: t.id, name: t.name, description: t.description, sentiment: formatSentiment(t.sentiment) }));
      if (results.people.length > 0) output.people = results.people.map(p => ({ id: p.id, name: p.name, relationship: p.relationship, description: p.description, identifiers: p.identifiers ?? [], sentiment: formatSentiment(p.sentiment) }));

      if (results.quotes.length > 0) {
        const human = getHuman ? getHuman() : null;
        output.quotes = results.quotes.map(q => {
          const linked_items: Array<{ id: string; name: string; type: string }> = [];
          if (human && q.data_item_ids.length > 0) {
            for (const itemId of q.data_item_ids) {
              const fact = human.facts.find(f => f.id === itemId);
              if (fact) { linked_items.push({ id: fact.id, name: fact.name, type: "fact" }); continue; }
              const topic = human.topics.find(t => t.id === itemId);
              if (topic) { linked_items.push({ id: topic.id, name: topic.name, type: "topic" }); continue; }
              const person = human.people.find(p => p.id === itemId);
              if (person) { linked_items.push({ id: person.id, name: person.name, type: "person" }); }
            }
          }
          return { id: q.id, text: q.text, speaker: q.speaker, message_id: q.message_id, linked_items };
        });
      }

      if (Object.keys(output).length === 0) {
        return JSON.stringify({ result: "No relevant memories found for this query." });
      }

      return JSON.stringify(output);
    },
  };
}
