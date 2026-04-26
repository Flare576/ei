import { buildValidatePrompt } from "../../src/prompts/ceremony/dedup.js";
import { runEval, printSummary } from "./runner.js";
import type { Assertion } from "./runner.js";

const makeTopic = (id: string, overrides: Record<string, unknown>) => ({
  id,
  type: "topic" as const,
  name: "Unknown",
  description: "Unknown",
  sentiment: 0.5,
  category: "Interest",
  exposure_current: 0.4,
  exposure_desired: 0.6,
  last_updated: "2026-01-01T00:00:00Z",
  ...overrides,
});

const ESTABLISHED_CAREER = makeTopic("established-001", {
  name: "Career development",
  description: "Steve thinks carefully about career moves — weighing opportunity against personal cost. Has made two cross-country moves for work. Values roles that stretch his skills.",
  sentiment: 0.7,
  category: "Goal",
  exposure_current: 0.6,
  exposure_desired: 0.8,
});

const NEWCOMER_CAREER = makeTopic("newcomer-001", {
  name: "Professional growth",
  description: "Steve makes deliberate career choices. Recently reflecting on whether to stay in consulting or move to a product company. Motivated by learning and impact.",
  sentiment: 0.8,
  category: "Goal",
  exposure_current: 0.3,
  exposure_desired: 0.7,
});

const ESTABLISHED_ANXIETY = makeTopic("established-002", {
  name: "Career anxiety",
  description: "Steve worries about whether his career is advancing fast enough and whether the moves he's made were the right ones.",
  sentiment: -0.3,
  category: "Concern",
  exposure_current: 0.3,
  exposure_desired: 0.4,
});

const ESTABLISHED_AMBITION = makeTopic("established-003", {
  name: "Career ambitions",
  description: "Steve has a clear vision of where he wants to go professionally — senior technical leadership at a product company, eventually.",
  sentiment: 0.7,
  category: "Goal",
  exposure_current: 0.5,
  exposure_desired: 0.7,
});

const ESTABLISHED_BLOATED = makeTopic("established-004", {
  name: "Software side projects",
  description: "Steve builds tools to scratch his own itches. Tempo is his music practice tracker — 200+ npm installs, uncertain whether to grow it. He also tinkers with CLI tools, has opinions on testing frameworks, and recently explored Rust for performance-critical tasks. His philosophy: build the minimum that does exactly one thing well.",
  sentiment: 0.8,
  category: "Project",
  exposure_current: 0.6,
  exposure_desired: 0.9,
});

const NEWCOMER_TEMPO = makeTopic("newcomer-004", {
  name: "Tempo project",
  description: "Steve's guitar practice tracker. Hit 200 installs. Debating whether to add a collaborative mode or keep it as a clean, finished tool.",
  sentiment: 0.8,
  category: "Project",
  exposure_current: 0.7,
  exposure_desired: 0.9,
});

function mergeAssertion(establishedId: string, newcomerId: string, mergeRationale: string): Assertion[] {
  return [
    {
      type: "is-json" as const,
      schema: { required: ["update", "remove", "add"] },
    },
    {
      type: "llm-judge" as const,
      rubric: [
        `These two topics should be merged. ${mergeRationale}`,
        "PASS if: 'remove' contains exactly one entry, 'update' contains exactly one merged record, 'add' is empty.",
        `PASS if: the removed entry's 'to_be_removed' is either '${establishedId}' or '${newcomerId}', and 'replaced_by' points to the surviving record.`,
        "FAIL if: both topics appear in 'update' with empty 'remove' — that means it kept both instead of merging.",
        "FAIL if: 'add' is non-empty — validate should never create new records.",
      ].join(" "),
    },
  ];
}

function keepBothAssertion(reason: string): Assertion[] {
  return [
    {
      type: "is-json" as const,
      schema: { required: ["update", "remove", "add"] },
    },
    {
      type: "llm-judge" as const,
      rubric: [
        `These two topics are distinct and should NOT be merged. ${reason}`,
        "PASS if: 'remove' is empty, 'update' contains both records unchanged, 'add' is empty.",
        "FAIL if: 'remove' is non-empty — that means it merged when it should have kept both.",
      ].join(" "),
    },
  ];
}

const summary = await runEval(
  [
    {
      description: "Topic-validate: clear duplicates → merge",
      tags: ["topic-validate", "merge", "happy-path"],
      prompt: () => buildValidatePrompt({
        established: ESTABLISHED_CAREER,
        newcomer: NEWCOMER_CAREER,
        itemType: "topic",
        similarity: 0.91,
      }),
      assert: mergeAssertion(
        "established-001",
        "newcomer-001",
        "'Career development' and 'Professional growth' are the same concept with different wording — same category (Goal), same subject matter, high similarity."
      ),
    },
    {
      description: "Topic-validate: merge preserves details from both records",
      tags: ["topic-validate", "merge", "data-preservation"],
      prompt: () => buildValidatePrompt({
        established: ESTABLISHED_CAREER,
        newcomer: NEWCOMER_CAREER,
        itemType: "topic",
        similarity: 0.91,
      }),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["update", "remove"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "When merging 'Career development' and 'Professional growth', the merged description must preserve unique details from BOTH records.",
            "From established: cross-country moves for work, weighing opportunity vs personal cost, values skill-stretching roles.",
            "From newcomer: reflecting on consulting vs product company, motivated by learning and impact.",
            "PASS if the merged description contains details from both — not just one record's content.",
            "PASS if merged description is under 500 characters (synthesize, not concatenate).",
            "FAIL if the merged description reads like only one of the two originals.",
            "FAIL if the description exceeds 500 characters.",
          ].join(" "),
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "Numeric field merge rules: exposure_current takes the HIGHER value (0.6 vs 0.3 → 0.6), exposure_desired takes HIGHER (0.8 vs 0.7 → 0.8), sentiment AVERAGES (0.7 + 0.8 / 2 = 0.75).",
            "PASS if the surviving record's exposure_current is 0.6 (or close), exposure_desired is 0.8 (or close), sentiment is approximately 0.75.",
            "FAIL if numeric fields are simply copied from one record without applying the merge rules.",
          ].join(" "),
        },
      ],
    },
    {
      description: "Topic-validate: distinct topics → keep both (different emotional valence)",
      tags: ["topic-validate", "keep-both", "distinct"],
      prompt: () => buildValidatePrompt({
        established: ESTABLISHED_ANXIETY,
        newcomer: ESTABLISHED_AMBITION,
        itemType: "topic",
        similarity: 0.87,
      }),
      assert: keepBothAssertion(
        "'Career anxiety' (Concern, negative sentiment) and 'Career ambitions' (Goal, positive sentiment) share semantic space but are emotionally opposite. The prompt says: 'Similarity of meaning is not the same as identity.' A persona referencing anxiety would feel different from one referencing ambition."
      ),
    },
    {
      description: "Topic-validate: merge when newcomer overlaps bloated established topic",
      tags: ["topic-validate", "merge", "bloated-topic"],
      prompt: () => buildValidatePrompt({
        established: ESTABLISHED_BLOATED,
        newcomer: NEWCOMER_TEMPO,
        itemType: "topic",
        similarity: 0.88,
      }),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["update", "remove", "add"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The established topic 'Software side projects' is bloated — it covers Tempo, CLI tools, testing frameworks, and Rust exploration.",
            "The newcomer 'Tempo project' is specifically about Tempo with the same core content.",
            "PASS if merged — the newcomer's Tempo details enrich the established record.",
            "PASS if the merged description stays under 500 characters — if the established record is already bloated, the merge must synthesize, not grow further.",
            "FAIL if 'add' is non-empty — validate never creates records.",
            "FAIL if the merged description exceeds 500 characters — this is the 'too big' failure mode.",
          ].join(" "),
        },
      ],
    },
    {
      description: "Topic-validate: loop risk observation — merged result size",
      tags: ["topic-validate", "loop-risk", "observe"],
      observe: true as const,
      prompt: () => buildValidatePrompt({
        established: ESTABLISHED_BLOATED,
        newcomer: NEWCOMER_TEMPO,
        itemType: "topic",
        similarity: 0.88,
      }),
    },
  ],
  "tests/evals/results/topic-validate-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
