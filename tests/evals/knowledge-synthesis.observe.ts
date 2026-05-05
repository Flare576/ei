/**
 * Observe script: Knowledge Synthesis against real state data.
 *
 * Runs the full synthesis pipeline against your actual state.json —
 * same TopK search, same enrichment, same prompt as production.
 * Prints the assembled prompt and the model's output document.
 *
 * Usage (must run with Bun — embedding service requires the native Zig module):
 *
 *   # Search by subject (requires current 384-dim embeddings in state):
 *   EXTERNAL_STATE_FILE=~/.local/share/ei/state.json \
 *   bun tests/evals/knowledge-synthesis.observe.ts "ASU Interactive Degree Planner"
 *
 *   # Pass IDs directly (bypasses embedding search — use when state has stale embeddings):
 *   # Get IDs first: EI_DATA_PATH=~/.local/share/ei bunx ei-tui topics -n 10 "your subject" | jq '.[].id'
 *   EXTERNAL_STATE_FILE=~/.local/share/ei/state.json \
 *   bun tests/evals/knowledge-synthesis.observe.ts "ASU Interactive Degree Planner" \
 *     id1 id2 id3 ...
 *
 *   EXTERNAL_STATE_FILE=~/.local/share/ei/state.json \
 *   EVAL_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-... \
 *   bun tests/evals/knowledge-synthesis.observe.ts "ASU Interactive Degree Planner"
 */

import { readFileSync } from "fs";
import { StateManager } from "../../src/core/state-manager.js";
import { searchHumanData } from "../../src/core/human-data-manager.js";
import { buildSynthesisPrompt } from "../../src/prompts/synthesis/index.js";
import type { StorageState } from "../../src/core/types/integrations.js";
import type { Storage } from "../../src/storage/interface.js";
import type { EnrichedTopic, EnrichedPerson } from "../../src/prompts/synthesis/index.js";

const NULL_STORAGE: Storage = {
  isAvailable: async () => true,
  save: async () => {},
  load: async () => null,
  moveToBackup: async () => {},
  loadBackup: async () => null,
  saveRollingBackup: async () => {},
  getDataPath: () => "",
};

const subject = process.argv[2];
if (!subject) {
  console.error("Usage: bun tests/evals/knowledge-synthesis.observe.ts <subject> [id1 id2 ...]");
  process.exit(1);
}
const explicitIds = process.argv.slice(3);

const stateFilePath = process.env.EXTERNAL_STATE_FILE;
if (!stateFilePath) {
  console.error("EXTERNAL_STATE_FILE is not set. Point it to your state.json.");
  process.exit(1);
}

const state = JSON.parse(readFileSync(stateFilePath, "utf-8")) as StorageState;
const sm = new StateManager();
await sm.initialize(NULL_STORAGE);
sm.restoreFromState(state);

let primary: Awaited<ReturnType<typeof searchHumanData>>;

if (explicitIds.length > 0) {
  const human = sm.getHuman();
  const allItems = [...human.facts, ...human.topics, ...human.people];
  const idSet = new Set(explicitIds);

  primary = {
    facts: human.facts.filter(f => idSet.has(f.id)),
    topics: human.topics.filter(t => idSet.has(t.id)),
    people: human.people.filter(p => idSet.has(p.id)),
    quotes: [],
  };

  const unmatched = explicitIds.filter(id => !allItems.find(i => i.id === id));
  if (unmatched.length > 0) {
    console.warn(`Warning: IDs not found in state: ${unmatched.join(", ")}`);
  }
} else {
  primary = await searchHumanData(sm, subject, { limit: 20 });
}

if (
  primary.facts.length === 0 &&
  primary.topics.length === 0 &&
  primary.people.length === 0 &&
  primary.quotes.length === 0
) {
  console.error(`No knowledge found about "${subject}". If embeddings are stale (2048-dim vs current 384-dim), pass IDs explicitly.`);
  console.error(`  EI_DATA_PATH=~/.local/share/ei bunx ei-tui topics -n 10 "${subject}" | jq '.[].id'`);
  process.exit(1);
}

const MAX_QUOTES_PER_ENTITY = parseInt(process.env.MAX_QUOTES ?? "3", 10);

const seenQuoteIds = new Set<string>();
const seenItemIds = new Set<string>(
  [...primary.topics, ...primary.people, ...primary.facts].map(i => i.id)
);

const enrichTopic = (topic: EnrichedTopic["topic"]): EnrichedTopic => {
  const linked = sm.human_quote_getForDataItem(topic.id)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, MAX_QUOTES_PER_ENTITY);
  linked.forEach(q => seenQuoteIds.add(q.id));
  return { topic, quotes: linked };
};

const enrichPerson = (person: EnrichedPerson["person"]): EnrichedPerson => {
  const linked = sm.human_quote_getForDataItem(person.id)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, MAX_QUOTES_PER_ENTITY);
  linked.forEach(q => seenQuoteIds.add(q.id));
  return { person, quotes: linked };
};

const enrichedTopics = primary.topics.map(enrichTopic);
const enrichedPeople = primary.people.map(enrichPerson);

const human = sm.getHuman();
const allItems = [...human.facts, ...human.topics, ...human.people];

const secondaryTopics: EnrichedTopic[] = [];
const secondaryPeople: EnrichedPerson[] = [];
const secondaryFacts: typeof primary.facts = [];

if (explicitIds.length === 0) {
  for (const quote of [...enrichedTopics.flatMap(e => e.quotes), ...enrichedPeople.flatMap(e => e.quotes)]) {
    for (const itemId of quote.data_item_ids) {
      if (seenItemIds.has(itemId)) continue;
      seenItemIds.add(itemId);
      const item = allItems.find(i => i.id === itemId);
      if (!item) continue;
      if (human.topics.find(t => t.id === itemId)) {
        secondaryTopics.push(enrichTopic(item as EnrichedTopic["topic"]));
      } else if (human.people.find(p => p.id === itemId)) {
        secondaryPeople.push(enrichPerson(item as EnrichedPerson["person"]));
      } else if (human.facts.find(f => f.id === itemId)) {
        secondaryFacts.push(item as typeof primary.facts[0]);
      }
    }
  }
}

const standaloneQuotes = primary.quotes.filter(q => !seenQuoteIds.has(q.id));

const allLoadedFacts = [...primary.facts, ...secondaryFacts];
const allLoadedTopics = [...enrichedTopics, ...secondaryTopics];
const allLoadedPeople = [...enrichedPeople, ...secondaryPeople];

const loadedEntityNames = new Map<string, string>();
for (const f of allLoadedFacts) loadedEntityNames.set(f.id, f.name);
for (const { topic } of allLoadedTopics) loadedEntityNames.set(topic.id, topic.name);
for (const { person } of allLoadedPeople) loadedEntityNames.set(person.id, person.name);

const prompt = buildSynthesisPrompt({
  subject,
  facts: allLoadedFacts,
  topics: allLoadedTopics,
  people: allLoadedPeople,
  standaloneQuotes,
  loadedEntityNames,
});

const roughTokenEstimate = Math.ceil((prompt.system.length + prompt.user.length) / 4);
console.log("=== RETRIEVED ===");
console.log(`Facts: ${allLoadedFacts.length}, Topics: ${allLoadedTopics.length}, People: ${allLoadedPeople.length}, Standalone quotes: ${standaloneQuotes.length}`);
console.log(`Estimated prompt tokens: ~${roughTokenEstimate.toLocaleString()} (MAX_QUOTES per entity: ${MAX_QUOTES_PER_ENTITY})`);

if (roughTokenEstimate > 60_000) {
  console.warn(`\nWarning: prompt is ~${roughTokenEstimate.toLocaleString()} tokens — may exceed local model context.`);
  console.warn(`Reduce with: MAX_QUOTES=1 or pass fewer IDs.\n`);
}

console.log("\n=== USER PROMPT (assembled data) ===\n");
console.log(prompt.user);
console.log("\n=== CALLING LLM ===\n");

function resolveProvider(): { baseURL: string; model: string; authHeader: string } {
  const provider = process.env.EVAL_PROVIDER;
  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("EVAL_PROVIDER=anthropic requires ANTHROPIC_API_KEY");
    return {
      baseURL: "https://api.anthropic.com/v1",
      model: process.env.EVAL_MODEL ?? "claude-opus-4-6",
      authHeader: `x-api-key: ${apiKey}`,
    };
  }
  return {
    baseURL: process.env.LOCAL_LLM_BASE_URL ?? "http://localhost:1234/v1",
    model: process.env.EVAL_MODEL ?? "google/gemma-4-26b-a4b",
    authHeader: "Bearer local",
  };
}

const PROVIDER = resolveProvider();
const headers: Record<string, string> = { "Content-Type": "application/json" };
if (PROVIDER.authHeader.startsWith("x-api-key:")) {
  headers["x-api-key"] = PROVIDER.authHeader.slice("x-api-key: ".length);
  headers["anthropic-version"] = "2023-06-01";
} else {
  headers["Authorization"] = PROVIDER.authHeader;
}

const res = await fetch(`${PROVIDER.baseURL}/chat/completions`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    model: PROVIDER.model,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    temperature: 0.7,
  }),
});

if (!res.ok) {
  console.error(`LLM call failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}

const data = await res.json() as { choices: Array<{ message: { content?: string } }> };
const output = data.choices[0].message.content?.trim() ?? "(no output)";

console.log(`Model: ${PROVIDER.model}`);
console.log("\n=== SYNTHESIZED DOCUMENT ===\n");
console.log(output);
