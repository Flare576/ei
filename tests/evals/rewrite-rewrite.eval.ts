import { buildPersonRewriteSplitPrompt } from "../../src/prompts/ceremony/people-rewrite.js";
import { buildTopicRewriteSplitPrompt } from "../../src/prompts/ceremony/topic-rewrite.js";
import type { Topic, Person } from "../../src/core/types.js";
import type { RewriteSubjectMatch } from "../../src/prompts/ceremony/types.js";
import { runEval, printSummary } from "./runner.js";
import type { Assertion } from "./runner.js";

const makeTopic = (overrides: Partial<Topic>): Topic => ({
  id: "topic-001",
  name: "Software Engineering",
  description: "",
  sentiment: 0.7,
  category: "Interest",
  exposure_current: 0.5,
  exposure_desired: 0.7,
  last_updated: "2026-01-01T00:00:00Z",
  ...overrides,
});

const BLOATED_GENERAL_TOPIC: Topic = makeTopic({
  name: "Software Engineering",
  description: "Ryan has been doing software engineering for fifteen years, primarily in TypeScript. Prefers functional patterns and small composable functions. Uses vim with LSP and has strong opinions about PR review etiquette — reviewers should comment on intent not style. Also deeply interested in distributed systems, particularly consensus algorithms and eventual consistency. Recently re-reading 'Designing Data-Intensive Applications'.",
  category: "Interest",
});

const BLOATED_TECHNICAL_TOPIC: Topic = makeTopic({
  id: "topic-uniform-001",
  name: "Uniform digital experience platform",
  description: "Uniform is a visual experience composition platform sitting between a headless CMS and the frontend. Chose it over Contentful's visual editor for CMS-agnostic multi-source composition (pulling from Contentful and Shopify simultaneously). Key gotcha: Canvas preview on Vercel protected environments requires x-vercel-protection-bypass query param due to SameSite=Lax cookie restrictions. Composition patterns don't auto-apply changes to instances when republished. Open question: edgehancers vs custom enhancers for Shopify variant logic. The team also uses Turborepo for the monorepo and async standups via Slack.",
  category: "Technical",
});

const BLOATED_PERSON: Person = {
  id: "person-sarah-001",
  name: "Sarah Kim",
  description: "Principal engineer at the company. Strong opinions on API design and distributed systems. Met at a distributed systems conference in 2022. Also reading 'Designing Data-Intensive Applications'. Lives in Portland, bikes to work.",
  sentiment: 0.8,
  relationship: "coworker",
  exposure_current: 0.4,
  exposure_desired: 0.6,
  last_updated: "2026-01-01T00:00:00Z",
};

const EXISTING_DISTRIBUTED_SYSTEMS: Topic = makeTopic({
  id: "topic-dist-001",
  name: "Distributed systems",
  description: "Interest in consensus algorithms and distributed databases.",
  category: "Interest",
});

const EXISTING_TURBOREPO: Topic = makeTopic({
  id: "topic-turborepo-001",
  name: "Turborepo monorepo tooling",
  description: "Evaluating Turborepo for managing a multi-package TypeScript monorepo.",
  category: "Technical",
});

const GENERAL_SUBJECTS: RewriteSubjectMatch[] = [
  {
    searchTerm: "vim and editor configuration",
    matches: [],
  },
  {
    searchTerm: "distributed systems and consensus algorithms",
    matches: [EXISTING_DISTRIBUTED_SYSTEMS],
  },
  {
    searchTerm: "Designing Data-Intensive Applications book",
    matches: [],
  },
];

const TECHNICAL_SUBJECTS: RewriteSubjectMatch[] = [
  {
    searchTerm: "Turborepo monorepo setup",
    matches: [EXISTING_TURBOREPO],
  },
  {
    searchTerm: "async standup process",
    matches: [],
  },
];

const PERSON_SUBJECTS: RewriteSubjectMatch[] = [
  {
    searchTerm: "Designing Data-Intensive Applications book",
    matches: [],
  },
];

const summary = await runEval(
  [
    {
      description: "Rewrite-rewrite: general topic — original slimmed, extra subjects redistributed to existing or new records",
      tags: ["rewrite-rewrite", "general-topic", "happy-path"],
      prompt: () => buildTopicRewriteSplitPrompt({
        item: BLOATED_GENERAL_TOPIC,
        itemType: "topic",
        subjects: GENERAL_SUBJECTS,
      }),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["existing", "new"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The original item is 'Software Engineering' and contains: core SE content (TypeScript, functional patterns, PR etiquette) PLUS extras: vim/editor config, distributed systems interest, and DDIA book.",
            "The subject search found one existing match: 'Distributed systems' (topic-dist-001).",
            "PASS if the original record (id: 'topic-001') appears in 'existing', slimmed to only software engineering content (TypeScript, functional patterns, PR etiquette).",
            "PASS if distributed systems content is moved into the existing 'topic-dist-001' record (updating it with consensus algorithms detail).",
            "PASS if vim/editor config or DDIA book content appears as new records if not merged into existing.",
            "FAIL if the original record still contains distributed systems, vim config, or DDIA content after the rewrite.",
            "FAIL if topic-dist-001 does NOT appear in 'existing' with updated distributed systems content.",
            "FAIL if any record's description exceeds 500 characters (regular topic limit).",
          ].join(" "),
        },
      ] satisfies Assertion[],
    },
    {
      description: "Rewrite-rewrite: Technical topic — Uniform knowledge preserved, non-Uniform subjects split out with Technical category",
      tags: ["rewrite-rewrite", "technical-topic", "category-preservation"],
      prompt: () => buildTopicRewriteSplitPrompt({
        item: BLOATED_TECHNICAL_TOPIC,
        itemType: "topic",
        subjects: TECHNICAL_SUBJECTS,
      }),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["existing", "new"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The original item is 'Uniform digital experience platform' (category: Technical). It contains core Uniform knowledge (composition model, Vercel gotcha, edgehancer question, composition patterns) PLUS non-Uniform extras: Turborepo monorepo setup and async standups.",
            "The subject search found one existing match: 'Turborepo monorepo tooling' (topic-turborepo-001).",
            "PASS if the original record (id: 'topic-uniform-001') appears in 'existing' retaining ALL core Uniform knowledge: Vercel preview gotcha, composition patterns republish behavior, edgehancer vs enhancer question, CMS-agnostic decision.",
            "PASS if Turborepo content is moved into existing 'topic-turborepo-001' record.",
            "PASS if async standup content appears as a new record OR is omitted as too minor.",
            "PASS if any new topic created from a Technical original has category 'Technical' (not 'Interest').",
            "FAIL if the Vercel preview gotcha or edgehancer question is removed from the Uniform record — that is core knowledge, not an extra.",
            "FAIL if the Uniform record's description no longer mentions the CMS-agnostic architecture decision.",
            "FAIL if a new topic is created with category 'Interest' when it was split from a Technical record.",
          ].join(" "),
        },
      ] satisfies Assertion[],
    },
    {
      description: "Rewrite-rewrite: person record — personal trivia split out, core person identity preserved",
      tags: ["rewrite-rewrite", "person", "happy-path"],
      prompt: () => buildPersonRewriteSplitPrompt({
        item: BLOATED_PERSON,
        itemType: "person",
        subjects: PERSON_SUBJECTS,
      }),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["existing", "new"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The original person is 'Sarah Kim'. Core person info: principal engineer, API design opinions, distributed systems, met at conference 2022. Extra: DDIA book interest, Portland/biking lifestyle details.",
            "PASS if the original record (id: 'person-sarah-001') appears in 'existing' with core person identity intact: role, API design expertise, how they met.",
            "PASS if DDIA book interest appears as a new topic record (not a person record).",
            "PASS if the slimmed person description stays under 300 characters.",
            "FAIL if the person record retains Portland lifestyle or commute details — those aren't useful person data.",
            "FAIL if relationship is missing or changed from 'coworker'.",
          ].join(" "),
        },
      ] satisfies Assertion[],
    },
    {
      description: "Rewrite-rewrite: no subjects — original returned unchanged, nothing new created",
      tags: ["rewrite-rewrite", "no-subjects", "zero-signal"],
      observe: true as const,
      prompt: () => buildTopicRewriteSplitPrompt({
        item: makeTopic({
          name: "Tempo music practice tracker",
          description: "Steve built a guitar practice tracker called Tempo and published it to npm. Reached 200 installs. Active tension about whether to grow it into a business or keep it finished. Metronome, session logging, progress tracking.",
          category: "Project",
        }),
        itemType: "topic",
        subjects: [],
      }),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["existing", "new"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The subjects array is empty — no extra subjects were identified. The prompt should slim the original and return it unchanged.",
            "PASS if 'existing' contains the original record with minimal or no changes.",
            "PASS if 'new' is an empty array.",
            "FAIL if new records are invented when no subjects were provided.",
            "FAIL if the original record is substantially rewritten — no subjects means no redistribution needed.",
          ].join(" "),
        },
      ] satisfies Assertion[],
    },
  ],
  "tests/evals/results/rewrite-rewrite-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
