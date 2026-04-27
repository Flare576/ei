import { buildDedupPrompt } from "../../src/prompts/ceremony/dedup.js";
import { runEval, printSummary } from "./runner.js";
import type { LLMMessage } from "./runner.js";

const READ_MEMORY_TOOL = {
  type: "function",
  function: {
    name: "read_memory",
    description:
      "Search Ei's persistent knowledge base — facts, topics, people, and quotes learned across ALL conversations over time, not just this one. Use this when you need context about the user, their life, relationships, or interests that may not be visible in the current exchange. Use `recent: true` to retrieve what's been discussed recently.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for — a person, topic, fact, or anything Ei has learned about the user" },
        types: {
          type: "array",
          items: { type: "string", enum: ["fact", "topic", "person", "quote"] },
          description: "Limit search to specific memory types (default: all types)",
        },
        limit: { type: "number", description: "Max results to return (default: 10, max: 20)" },
        recent: { type: "boolean", description: "If true, return recently-mentioned results sorted by last_mentioned date instead of relevance." },
      },
      required: [],
    },
  },
};

const SUBMIT_DEDUP_TOOL = {
  type: "function",
  function: {
    name: "submit_dedup_decisions",
    description: "Submit your merge, remove, and add decisions for this cluster of records.",
    parameters: {
      type: "object",
      properties: {
        update: {
          type: "array",
          description: "Records to update with merged data. Must include at least one (the canonical record).",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              type: { type: "string", enum: ["topic", "person", "trait"] },
              name: { type: "string" },
              description: { type: "string" },
              sentiment: { type: "number" },
              exposure_current: { type: "number" },
              exposure_desired: { type: "number" },
              category: { type: "string" },
            },
            required: ["id", "type", "name", "description"],
          },
        },
        remove: {
          type: "array",
          items: {
            type: "object",
            properties: {
              to_be_removed: { type: "string" },
              replaced_by: { type: "string" },
            },
            required: ["to_be_removed", "replaced_by"],
          },
        },
        add: { type: "array", items: { type: "object" } },
      },
      required: ["update", "remove", "add"],
    },
  },
};

const CLEAR_DUPLICATE_CLUSTER = {
  cluster: [
    {
      id: "topic-a",
      type: "topic",
      name: "Career development",
      description: "Steve makes deliberate career moves — weighing opportunity against personal cost. Two cross-country relocations for work.",
      sentiment: 0.7,
      category: "Goal",
      exposure_current: 0.6,
      exposure_desired: 0.8,
      last_updated: "2026-01-01T00:00:00Z",
    },
    {
      id: "topic-b",
      type: "topic",
      name: "Professional growth",
      description: "Steve is deliberate about career advancement. Motivated by learning and impact. Considering consulting vs product company.",
      sentiment: 0.8,
      category: "Goal",
      exposure_current: 0.3,
      exposure_desired: 0.7,
      last_updated: "2026-01-01T00:00:00Z",
    },
  ],
  itemType: "topic" as const,
  similarityRange: { min: 0.91, max: 0.91 },
};

const AMBIGUOUS_CLUSTER = {
  cluster: [
    {
      id: "topic-c",
      type: "topic",
      name: "Software side projects",
      description: "Steve builds personal tools. Tempo is his music practice tracker — 200+ npm installs.",
      sentiment: 0.8,
      category: "Project",
      exposure_current: 0.6,
      exposure_desired: 0.9,
      last_updated: "2026-01-01T00:00:00Z",
    },
    {
      id: "topic-d",
      type: "topic",
      name: "Open source contributions",
      description: "Steve publishes tools to npm and participates in open source. Values giving back to the community.",
      sentiment: 0.75,
      category: "Interest",
      exposure_current: 0.4,
      exposure_desired: 0.7,
      last_updated: "2026-01-01T00:00:00Z",
    },
  ],
  itemType: "topic" as const,
  similarityRange: { min: 0.87, max: 0.87 },
};

const IMPLIES_THIRD_RECORD_CLUSTER = {
  cluster: [
    {
      id: "topic-e",
      type: "topic",
      name: "Career at Gears and Grids",
      description: "Steve joined Gears and Grids four years ago. Works closely with Chris, a senior engineer who has been there eight years. Chris has been an informal mentor — showed Steve the ropes on client relationships and code standards.",
      sentiment: 0.8,
      category: "Interest",
      exposure_current: 0.5,
      exposure_desired: 0.7,
      last_updated: "2026-01-01T00:00:00Z",
    },
    {
      id: "topic-f",
      type: "topic",
      name: "Professional mentorship",
      description: "Steve values learning from experienced colleagues. He gravitates toward people who can teach him things he can't learn from documentation.",
      sentiment: 0.85,
      category: "Interest",
      exposure_current: 0.4,
      exposure_desired: 0.8,
      last_updated: "2026-01-01T00:00:00Z",
    },
    {
      id: "topic-g",
      type: "topic",
      name: "Work relationships at current job",
      description: "Steve has built solid working relationships at Gears and Grids. Sam is a peer he's worked with on a long client project. Chris is a senior colleague and de facto mentor.",
      sentiment: 0.75,
      category: "Interest",
      exposure_current: 0.3,
      exposure_desired: 0.6,
      last_updated: "2026-01-01T00:00:00Z",
    },
  ],
  itemType: "topic" as const,
  similarityRange: { min: 0.88, max: 0.93 },
};

const FAKE_READ_MEMORY_RESULTS = JSON.stringify({
  topics: [
    {
      id: "topic-existing-career",
      name: "Career transitions",
      description: "Steve has changed jobs multiple times, each time prioritizing growth over stability.",
    },
  ],
  people: [],
  facts: [],
  quotes: [],
});

const makeSaturatedToolResultMessages = (results: string): LLMMessage[] => {
  const queries = [
    { query: "career development goals", types: ["topic"] },
    { query: "professional growth advancement" },
    { query: "job transitions career moves" },
    { query: "work motivation learning impact" },
    { query: "consulting product company" },
    { query: "career history employment" },
  ];

  const messages: LLMMessage[] = [];
  const assistantToolCalls = queries.map((args, i) => ({
    id: `call-${String(i).padStart(3, "0")}`,
    type: "function",
    function: { name: "read_memory", arguments: JSON.stringify(args) },
  }));

  messages.push({ role: "assistant", tool_calls: assistantToolCalls });

  for (const tc of assistantToolCalls) {
    messages.push({
      role: "tool",
      tool_call_id: tc.id,
      name: "read_memory",
      content: results,
    });
  }

  return messages;
};

const summary = await runEval(
  [
    {
      description: "Dedup Suite 1: clear duplicates — model calls read_memory before deciding",
      tags: ["dedup", "tool-selection", "suite-1", "known-model-limitation"],
      tools: [READ_MEMORY_TOOL, SUBMIT_DEDUP_TOOL],
      prompt: () => buildDedupPrompt(CLEAR_DUPLICATE_CLUSTER),
      assert: [
        {
          type: "tool-calls" as const,
          minCalls: 1,
          requiredTools: ["read_memory"],
        },
      ],
    },

    {
      description: "Dedup Suite 1: clear duplicates — observe what read_memory query looks like",
      tags: ["dedup", "tool-selection", "suite-1", "observe"],
      tools: [READ_MEMORY_TOOL, SUBMIT_DEDUP_TOOL],
      observe: true as const,
      prompt: () => buildDedupPrompt(CLEAR_DUPLICATE_CLUSTER),
    },

    {
      description: "Dedup Suite 1: ambiguous cluster — model must call read_memory (can't decide without context)",
      tags: ["dedup", "tool-selection", "suite-1", "ambiguous", "known-model-limitation"],
      tools: [READ_MEMORY_TOOL, SUBMIT_DEDUP_TOOL],
      prompt: () => buildDedupPrompt(AMBIGUOUS_CLUSTER),
      assert: [
        {
          type: "tool-calls" as const,
          minCalls: 1,
          requiredTools: ["read_memory"],
        },
      ],
    },

    {
      description: "Dedup Suite 1: cluster mentions Chris and Sam — should check if People records exist",
      tags: ["dedup", "tool-selection", "suite-1", "implies-third-record"],
      tools: [READ_MEMORY_TOOL, SUBMIT_DEDUP_TOOL],
      observe: true as const,
      prompt: () => buildDedupPrompt(IMPLIES_THIRD_RECORD_CLUSTER),
    },

    {
      description: "Dedup Suite 2: given read_memory results, model merges correctly",
      tags: ["dedup", "output-quality", "suite-2"],
      tools: [READ_MEMORY_TOOL, SUBMIT_DEDUP_TOOL],
      priorMessages: makeSaturatedToolResultMessages(FAKE_READ_MEMORY_RESULTS),
      prompt: () => buildDedupPrompt(CLEAR_DUPLICATE_CLUSTER),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["update", "remove", "add"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The model has been given read_memory results showing an existing 'Career transitions' topic.",
            "It must now decide on the cluster: 'Career development' (topic-a) and 'Professional growth' (topic-b) are clear duplicates.",
            "PASS if 'remove' contains one entry (one topic absorbed into the other) and 'update' contains the surviving merged record.",
            "PASS if the merged description incorporates details from both — cross-country moves, learning/impact motivation, consulting vs product consideration.",
            "FAIL if both topics survive unchanged (no merge decision made).",
            "FAIL if 'add' is non-empty — dedup should never create new records.",
          ].join(" "),
        },
      ],
    },
  ],
  "tests/evals/results/dedup-tool-calls-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
