import { buildPersonRewriteScanPrompt } from "../../src/prompts/ceremony/people-rewrite.js";
import { buildTopicRewriteScanPrompt } from "../../src/prompts/ceremony/topic-rewrite.js";
import type { Topic, Person } from "../../src/core/types.js";
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

const makePerson = (overrides: Partial<Person>): Person => ({
  id: "person-001",
  name: "Maya Chen",
  description: "",
  sentiment: 0.8,
  relationship: "coworker",
  exposure_current: 0.4,
  exposure_desired: 0.6,
  last_updated: "2026-01-01T00:00:00Z",
  ...overrides,
});

const BLOATED_GENERAL_TOPIC: Topic = makeTopic({
  name: "Software Engineering",
  description: "Ryan has been doing software engineering for about fifteen years, primarily in TypeScript and Node.js. Prefers functional patterns, immutability, and small composable functions over class hierarchies. Uses vim with LSP for most editing, git with conventional commits, and has strong opinions about PR review etiquette — specifically that reviewers should comment on intent not style. Also deeply interested in distributed systems, particularly consensus algorithms and eventual consistency. Recently started reading 'Designing Data-Intensive Applications' for the third time. Side note: Ryan's cat Mr. Whiskers keeps knocking his keyboard off the desk during late-night coding sessions.",
  category: "Interest",
});

const BLOATED_TECHNICAL_TOPIC: Topic = makeTopic({
  id: "topic-uniform-001",
  name: "Uniform digital experience platform",
  description: "Uniform is a visual experience composition platform sitting between a headless CMS and the frontend. Chose it over Contentful's visual editor for CMS-agnostic multi-source composition (pulling from Contentful and Shopify simultaneously). Key gotcha: Canvas preview on Vercel protected environments requires x-vercel-protection-bypass query param due to SameSite=Lax cookie restrictions. Composition patterns don't auto-apply changes to instances when republished — must manually update existing instances. Open question: edgehancers (CDN-edge, no-code, built-in caching) vs custom enhancers for Shopify variant logic. Ryan also mentioned that his team uses a monorepo with Turborepo for the project, that standups are async via Slack, and that he's been reading about micro-frontend architecture as a potential future direction for the platform.",
  category: "Technical",
});

const COHESIVE_TOPIC: Topic = makeTopic({
  name: "Tempo music practice tracker",
  description: "Steve built a guitar practice tracker called Tempo and published it to npm. Reached 200 installs. Tension about whether to grow it into a business or keep it as a clean, finished personal project. Currently has metronome, session logging, and progress tracking. Built in TypeScript.",
  category: "Project",
});

const BLOATED_PERSON: Person = makePerson({
  name: "Sarah Kim",
  description: "Sarah is a principal engineer at the company. Known for clear technical writing and strong opinions on API design. Met through a distributed systems conference in 2022. Also has a rescue greyhound named Toast who apparently attends all her video calls. Interested in the same DDIA book Ryan is reading. Lives in Portland, bikes to work, makes excellent sourdough, and Ryan ran into her at a local climbing gym last month.",
});

const summary = await runEval(
  [
    {
      description: "Rewrite-scan: bloated general topic — identifies multiple distinct extra subjects",
      tags: ["rewrite-scan", "general-topic", "happy-path"],
      prompt: () => buildTopicRewriteScanPrompt({ item: BLOATED_GENERAL_TOPIC, itemType: "topic" }),
      assert: [
        {
          type: "is-json" as const,
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The item is named 'Software Engineering' but its description contains multiple unrelated subjects: vim/editor config, git/PR workflow, distributed systems interest, a book (DDIA), and a personal anecdote about a cat.",
            "PASS if the returned array includes at least 2 distinct extra subjects — some combination of: editor/vim configuration, git workflow or PR etiquette, distributed systems, DDIA book, or the cat anecdote.",
            "PASS if the primary subject (software engineering, TypeScript, Node.js, functional patterns) is NOT in the returned array — those belong under the record's name.",
            "FAIL if the array is empty — there are clearly extra subjects here.",
            "FAIL if the primary software engineering subject is returned as an 'extra' subject.",
            "FAIL if the array contains vague catch-alls like 'personal life' instead of specific subjects.",
          ].join(" "),
        },
      ] satisfies Assertion[],
    },
    {
      description: "Rewrite-scan: bloated Technical topic — identifies non-Uniform subjects without discarding technical knowledge",
      tags: ["rewrite-scan", "technical-topic", "happy-path"],
      prompt: () => buildTopicRewriteScanPrompt({ item: BLOATED_TECHNICAL_TOPIC, itemType: "topic" }),
      assert: [
        {
          type: "is-json" as const,
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The item is named 'Uniform digital experience platform'. Its description contains core Uniform knowledge (composition model, Vercel gotcha, composition patterns, edgehancer question) AND unrelated subjects: Turborepo monorepo setup, async standup process, micro-frontend architecture research.",
            "PASS if the returned array identifies subjects like: monorepo/Turborepo setup, async standups, or micro-frontend architecture.",
            "PASS if core Uniform knowledge (composition, Vercel preview, edgehancers) is NOT returned as extra subjects — those belong under this record's name.",
            "FAIL if the array is empty — there are clearly non-Uniform subjects buried here.",
            "FAIL if any of: Vercel preview gotcha, edgehancer vs enhancer, composition patterns, CMS-agnostic decision appear in the returned array — those are the primary subject.",
          ].join(" "),
        },
      ] satisfies Assertion[],
    },
    {
      description: "Rewrite-scan: cohesive topic — returns empty array (no extra subjects)",
      tags: ["rewrite-scan", "cohesive", "zero-signal"],
      prompt: () => buildTopicRewriteScanPrompt({ item: COHESIVE_TOPIC, itemType: "topic" }),
      assert: [
        {
          type: "is-json" as const,
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The item 'Tempo music practice tracker' is cohesive — everything in the description directly relates to Tempo (features, install count, decision tension, tech stack).",
            "PASS if the returned array is empty [] — this is the correct response for a cohesive record.",
            "FAIL if any subjects are returned — there are no unrelated subjects to extract here.",
          ].join(" "),
        },
      ] satisfies Assertion[],
    },
    {
      description: "Rewrite-scan: bloated person — identifies non-person subjects mixed into person record",
      tags: ["rewrite-scan", "person", "happy-path"],
      prompt: () => buildPersonRewriteScanPrompt({ item: BLOATED_PERSON, itemType: "person" }),
      assert: [
        {
          type: "is-json" as const,
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The item is about Sarah Kim. Her description contains: core person info (principal engineer, API design, distributed systems conference) AND personal trivia not useful for a person record: her dog's name (Toast), a shared book interest, her city/commute/hobbies, and a gym encounter.",
            "PASS if the returned array identifies extra subjects like: shared book interest (DDIA), personal hobbies/lifestyle, or the gym encounter.",
            "PASS if core person details (her role, API design opinions, how they met) are NOT returned as extra subjects.",
            "FAIL if the array is empty — there are clearly non-essential personal details here.",
          ].join(" "),
        },
      ] satisfies Assertion[],
    },
  ],
  "tests/evals/results/rewrite-scan-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
