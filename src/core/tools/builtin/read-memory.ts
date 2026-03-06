/**
 * read_memory builtin tool
 *
 * Delegates to Processor.searchHumanData() — no external call, runtime: "any".
 * The searchHumanData function is injected at construction to avoid circular deps.
 */
import type { ToolExecutor } from "../types.js";
import type { Fact, Trait, Topic, Person, Quote } from "../../types.js";

type SearchHumanData = (
  query: string,
  options?: { types?: Array<"fact" | "trait" | "topic" | "person" | "quote">; limit?: number }
) => Promise<{ facts: Fact[]; traits: Trait[]; topics: Topic[]; people: Person[]; quotes: Quote[] }>;

export function createReadMemoryExecutor(searchHumanData: SearchHumanData): ToolExecutor {
  return {
    name: "read_memory",

    async execute(args: Record<string, unknown>): Promise<string> {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      console.log(`[read_memory] called with query="${query}", types=${JSON.stringify(args.types ?? null)}, limit=${args.limit ?? 10}`);
      if (!query) {
        console.warn("[read_memory] missing query argument");
        return JSON.stringify({ error: "Missing required argument: query" });
      }

      const types = Array.isArray(args.types)
        ? (args.types.filter(
            t => typeof t === "string" && ["fact", "trait", "topic", "person", "quote"].includes(t)
          ) as Array<"fact" | "trait" | "topic" | "person" | "quote">)
        : undefined;

      const limit = typeof args.limit === "number" && args.limit > 0 ? Math.min(args.limit, 20) : 10;

      const results = await searchHumanData(query, { types, limit });

      const total = results.facts.length + results.traits.length + results.topics.length + results.people.length + results.quotes.length;
      console.log(`[read_memory] query="${query}" => ${total} results (facts=${results.facts.length}, traits=${results.traits.length}, topics=${results.topics.length}, people=${results.people.length}, quotes=${results.quotes.length})`);

      const output: Record<string, unknown[]> = {};
      if (results.facts.length > 0) output.facts = results.facts.map(f => ({ name: f.name, description: f.description }));
      if (results.traits.length > 0) output.traits = results.traits.map(t => ({ name: t.name, description: t.description }));
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
