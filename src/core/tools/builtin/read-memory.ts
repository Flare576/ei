import type { ToolExecutor } from "../types.js";
import type { Fact, Topic, Person, Quote } from "../../types.js";

interface PersonaSummary {
  id: string;
  display_name: string;
}

type SearchHumanData = (
  query: string,
  options?: { types?: Array<"fact" | "topic" | "person" | "quote">; limit?: number; recent?: boolean; persona_filter?: string }
) => Promise<{ facts: Fact[]; topics: Topic[]; people: Person[]; quotes: Quote[] }>;

type GetPersonaList = () => Promise<PersonaSummary[]>;

export function createReadMemoryExecutor(searchHumanData: SearchHumanData, getPersonaList?: GetPersonaList): ToolExecutor {
  return {
    name: "read_memory",

    async execute(args: Record<string, unknown>): Promise<string> {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      const recent = args.recent === true;
      const personaArg = typeof args.persona === "string" ? args.persona.trim() : "";
      console.log(`[read_memory] called with query="${query}", types=${JSON.stringify(args.types ?? null)}, limit=${args.limit ?? 10}, recent=${recent}, persona="${personaArg}"`);

      if (!query && !recent) {
        console.warn("[read_memory] missing query argument");
        return JSON.stringify({ error: "Missing required argument: query (or use recent: true)" });
      }

      const types = Array.isArray(args.types)
        ? (args.types.filter(
            t => typeof t === "string" && ["fact", "topic", "person", "quote"].includes(t)
          ) as Array<"fact" | "topic" | "person" | "quote">)
        : undefined;

      const limit = typeof args.limit === "number" && args.limit > 0 ? Math.min(args.limit, 20) : 10;

      // Resolve persona display_name to ID
      let persona_filter: string | undefined;
      if (personaArg && getPersonaList) {
        const personas = await getPersonaList();
        const match = personas.find(p => p.display_name.toLowerCase() === personaArg.toLowerCase());
        if (match) {
          persona_filter = match.id;
          console.log(`[read_memory] resolved persona "${personaArg}" to ID "${persona_filter}"`);
        } else {
          console.warn(`[read_memory] persona "${personaArg}" not found, proceeding without filter`);
        }
      }

      const results = await searchHumanData(query, { types, limit, recent, persona_filter });

      const total = results.facts.length + results.topics.length + results.people.length + results.quotes.length;
      console.log(`[read_memory] query="${query}" => ${total} results (facts=${results.facts.length}, topics=${results.topics.length}, people=${results.people.length}, quotes=${results.quotes.length})`);

      const output: Record<string, unknown[]> = {};
      if (results.facts.length > 0) output.facts = results.facts.map(f => ({ name: f.name, description: f.description }));
      if (results.topics.length > 0) output.topics = results.topics.map(t => ({ name: t.name, description: t.description }));
      if (results.people.length > 0) output.people = results.people.map(p => ({ name: p.name, relationship: p.relationship, description: p.description }));
      if (results.quotes.length > 0) output.quotes = results.quotes.map(q => ({ text: q.text, speaker: q.speaker }));

      if (Object.keys(output).length === 0) {
        return JSON.stringify({ result: "No relevant memories found for this query." });
      }

      return JSON.stringify(output);
    },
  };
}
