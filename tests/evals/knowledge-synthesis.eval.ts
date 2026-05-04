/**
 * Eval: Knowledge Synthesis
 *
 * Verifies the quality of LLM output from the synthesis prompt.
 * This is a manual quality check — NOT part of `npm test` (requires a live LLM).
 *
 * Run with:
 *   npm run test:evals -- knowledge-synthesis
 */

import { buildSynthesisPrompt } from "../../src/prompts/synthesis/index.js";
import type { Fact, Topic, Person, Quote } from "../../src/core/types.js";
import { runEval, printSummary } from "./runner.js";

// ---------------------------------------------------------------------------
// Full fixture — rich data about "the Phantom service"
// ---------------------------------------------------------------------------

const FULL_FACTS: Fact[] = [
  {
    id: "fact-1",
    name: "Phantom service launch date",
    description: "The Phantom service launched in March 2023 as an internal tool before going public.",
    sentiment: 0.6,
    last_updated: "2026-01-01T00:00:00Z",
    validated_date: "2026-01-01T00:00:00Z",
  },
  {
    id: "fact-2",
    name: "Phantom service primary language",
    description: "The Phantom service backend is written entirely in Go.",
    sentiment: 0.4,
    last_updated: "2026-01-01T00:00:00Z",
    validated_date: "2026-01-01T00:00:00Z",
  },
  {
    id: "fact-3",
    name: "Phantom service uptime SLA",
    description: "The Phantom service guarantees 99.9% uptime per its SLA agreement.",
    sentiment: 0.7,
    last_updated: "2026-01-01T00:00:00Z",
    validated_date: "2026-01-01T00:00:00Z",
  },
  {
    id: "fact-4",
    name: "Phantom service user count",
    description: "As of Q1 2026, the Phantom service has approximately 12,000 active users.",
    sentiment: 0.8,
    last_updated: "2026-01-01T00:00:00Z",
    validated_date: "2026-01-01T00:00:00Z",
  },
];

const FULL_TOPICS: Topic[] = [
  {
    id: "topic-1",
    name: "Phantom service reliability concerns",
    description: "There have been recurring discussions about the Phantom service's reliability during peak load. The team is actively investigating autoscaling improvements.",
    sentiment: -0.2,
    last_updated: "2026-01-01T00:00:00Z",
    exposure_current: 0.7,
    exposure_desired: 0.5,
  },
  {
    id: "topic-2",
    name: "Phantom service roadmap",
    description: "The Phantom service roadmap for 2026 includes a GraphQL API layer, improved observability dashboards, and a self-service onboarding portal.",
    sentiment: 0.6,
    last_updated: "2026-01-01T00:00:00Z",
    exposure_current: 0.4,
    exposure_desired: 0.6,
  },
  {
    id: "topic-3",
    name: "Phantom service cost optimization",
    description: "Cloud costs for the Phantom service have grown 40% year-over-year. Leadership wants a cost reduction plan by Q2 2026.",
    sentiment: -0.3,
    last_updated: "2026-01-01T00:00:00Z",
    exposure_current: 0.3,
    exposure_desired: 0.4,
  },
];

const FULL_PEOPLE: Person[] = [
  {
    id: "person-1",
    name: "Dana Reyes",
    description: "Dana Reyes is the lead engineer on the Phantom service. She joined the team in 2022 and drove the initial architecture decisions.",
    sentiment: 0.8,
    last_updated: "2026-01-01T00:00:00Z",
    relationship: "colleague",
    exposure_current: 0.5,
    exposure_desired: 0.4,
  },
  {
    id: "person-2",
    name: "Marcus Webb",
    description: "Marcus Webb is the product manager for the Phantom service. He owns the roadmap and stakeholder communication.",
    sentiment: 0.6,
    last_updated: "2026-01-01T00:00:00Z",
    relationship: "colleague",
    exposure_current: 0.3,
    exposure_desired: 0.3,
  },
];

const FULL_QUOTES: Quote[] = [
  {
    id: "quote-1",
    message_id: null,
    data_item_ids: ["topic-1"],
    persona_groups: [],
    text: "The Phantom service is the backbone of our platform — if it goes down, everything goes down.",
    speaker: "human",
    timestamp: "2026-01-15T10:00:00Z",
    start: null,
    end: null,
    created_at: "2026-01-15T10:00:00Z",
    created_by: "extraction",
  },
  {
    id: "quote-2",
    message_id: null,
    data_item_ids: ["person-1"],
    persona_groups: [],
    text: "Dana said the autoscaling fix should land in the next sprint — fingers crossed.",
    speaker: "human",
    timestamp: "2026-02-01T14:30:00Z",
    start: null,
    end: null,
    created_at: "2026-02-01T14:30:00Z",
    created_by: "extraction",
  },
];

// ---------------------------------------------------------------------------
// Sparse fixture — minimal data about "the Phantom service"
// ---------------------------------------------------------------------------

const SPARSE_FACTS: Fact[] = [
  {
    id: "sparse-fact-1",
    name: "Phantom service launch date",
    description: "The Phantom service launched in March 2023.",
    sentiment: 0.5,
    last_updated: "2026-01-01T00:00:00Z",
    validated_date: "2026-01-01T00:00:00Z",
  },
];

// ---------------------------------------------------------------------------
// Eval cases
// ---------------------------------------------------------------------------

const summary = await runEval(
  [
    {
      description: "Knowledge synthesis: full fixture — headings, coverage, no hallucination",
      tags: ["knowledge-synthesis", "full-fixture", "happy-path"],
      prompt: () => {
        const { system, user } = buildSynthesisPrompt({
          subject: "the Phantom service",
          facts: FULL_FACTS,
          topics: FULL_TOPICS,
          people: FULL_PEOPLE,
          quotes: FULL_QUOTES,
        });
        return { system, user };
      },
      assert: [
        {
          type: "llm-judge" as const,
          rubric: [
            "The response is a markdown document about 'the Phantom service'.",
            "PASS if the document contains at least 2 markdown headings (## or ###).",
            "FAIL if there are fewer than 2 headings.",
          ].join(" "),
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The input data contains facts, topics, people, and quotes — all four memory types.",
            "PASS if the document covers all four types: facts (e.g. launch date, Go language, SLA, user count), topics (e.g. reliability, roadmap, cost), people (Dana Reyes, Marcus Webb), and quotes.",
            "FAIL if any of the four memory types is entirely absent from the document.",
          ].join(" "),
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The document is about 'the Phantom service'. All content in the input is about the Phantom service.",
            "PASS if the document stays on subject and does not introduce unrelated topics or services.",
            "FAIL if the document discusses topics, people, or facts that are clearly unrelated to the Phantom service.",
          ].join(" "),
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The input data contains exactly these named entities: Dana Reyes, Marcus Webb (people); Phantom service (subject).",
            "PASS if the document only references entities present in the input data.",
            "FAIL if the document invents new named people, services, or organizations not present in the input (e.g. a 'CTO named Alex' or a 'Specter service' that was never mentioned).",
          ].join(" "),
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The document should be readable as a standalone reference — not a bullet dump, not a single sentence.",
            "PASS if the document has multiple sections with meaningful prose or structured bullets that a reader could understand without additional context.",
            "FAIL if the document is a single paragraph with no structure, or is so terse it conveys almost no information.",
          ].join(" "),
        },
      ],
    },
    {
      description: "Knowledge synthesis: sparse fixture — short output, no invented content",
      tags: ["knowledge-synthesis", "sparse-fixture", "no-hallucination"],
      prompt: () => {
        const { system, user } = buildSynthesisPrompt({
          subject: "the Phantom service",
          facts: SPARSE_FACTS,
          topics: [],
          people: [],
          quotes: [],
        });
        return { system, user };
      },
      assert: [
        {
          type: "llm-judge" as const,
          rubric: [
            "The input contains only one fact: the Phantom service launched in March 2023. No topics, people, or quotes were provided.",
            "PASS if the document is brief and only mentions the launch date fact. A short document (even just a heading and one bullet) is correct here.",
            "FAIL if the document invents additional facts, people, topics, or quotes that were not in the input — for example, fabricating a team, a tech stack, or a roadmap that was never provided.",
          ].join(" "),
        },
      ],
    },
  ],
  "tests/evals/results/knowledge-synthesis-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
