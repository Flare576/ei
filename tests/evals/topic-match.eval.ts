import { buildTopicMatchPrompt } from "../../src/prompts/human/topic-match.js";
import { runEval, printSummary } from "./runner.js";
import type { Assertion } from "./runner.js";

const EXISTING_TOPICS = [
  {
    id: "topic-career-001",
    name: "Career development",
    description: "Steve thinks carefully about career moves — when to stay, when to jump, and what each change costs him personally.",
    category: "Goal",
  },
  {
    id: "topic-family-001",
    name: "Family relationship complexity",
    description: "Steve's family history is complicated — two parental divorces, years of estrangement, and a conscious effort not to repeat those patterns.",
    category: "Conflict",
  },
  {
    id: "topic-tempo-001",
    name: "Tempo music practice tracker",
    description: "Steve built Tempo to solve his own guitar practice problem. It's live on npm and has real users. He's uncertain whether to grow it into a business.",
    category: "Project",
  },
  {
    id: "topic-consulting-001",
    name: "Working at Gears and Grids",
    description: "Steve values the learning culture at his consulting firm — everyone is smarter than him and enjoys teaching.",
    category: "Interest",
  },
];

const NEAR_TWIN_A = {
  id: "topic-twin-a",
  name: "Professional growth",
  description: "Steve is deliberate about career advancement — choosing roles that stretch his skills and expose him to new domains.",
  category: "Goal",
};

const NEAR_TWIN_B = {
  id: "topic-twin-b",
  name: "Career ambitions",
  description: "Steve has strong opinions about where his career should go and makes calculated moves to get there.",
  category: "Goal",
};

function matchAssertion(expectedId: string, label: string): Assertion[] {
  return [
    {
      type: "is-json" as const,
      schema: { required: ["matched_guid"] },
    },
    {
      type: "llm-judge" as const,
      rubric: [
        `The response must contain matched_guid: "${expectedId}".`,
        `${label}`,
        "PASS if matched_guid equals the expected ID.",
        "FAIL if matched_guid is 'new' or any other ID.",
      ].join(" "),
    },
  ];
}

function newAssertion(reason: string): Assertion[] {
  return [
    {
      type: "is-json" as const,
      schema: { required: ["matched_guid"] },
    },
    {
      type: "llm-judge" as const,
      rubric: [
        `The response must contain matched_guid: "new".`,
        `${reason}`,
        "PASS if matched_guid is exactly 'new'.",
        "FAIL if matched_guid is any UUID.",
      ].join(" "),
    },
  ];
}

const summary = await runEval(
  [
    {
      description: "Topic-match: exact name match returns correct ID",
      tags: ["topic-match", "exact-match"],
      prompt: () => buildTopicMatchPrompt({
        candidate_name: "Tempo music practice tracker",
        candidate_description: "A tool Steve built for intentional guitar practice. Published to npm.",
        candidate_category: "Project",
        existing_topics: EXISTING_TOPICS,
      }),
      assert: matchAssertion("topic-tempo-001", "The candidate is clearly the same project as 'Tempo music practice tracker' in the existing topics."),
    },
    {
      description: "Topic-match: semantic near-duplicate returns correct ID",
      tags: ["topic-match", "semantic-match"],
      prompt: () => buildTopicMatchPrompt({
        candidate_name: "Job transitions and career moves",
        candidate_description: "Steve has made several deliberate career moves, weighing opportunity against personal cost each time.",
        candidate_category: "Goal",
        existing_topics: EXISTING_TOPICS,
      }),
      assert: matchAssertion("topic-career-001", "The candidate is semantically the same as 'Career development' — different wording, same concept."),
    },
    {
      description: "Topic-match: genuinely new topic returns 'new'",
      tags: ["topic-match", "new-topic"],
      prompt: () => buildTopicMatchPrompt({
        candidate_name: "Guitar playing",
        candidate_description: "Steve has played guitar since he was a kid. It's a long-standing hobby independent of the Tempo project.",
        candidate_category: "Interest",
        existing_topics: EXISTING_TOPICS,
      }),
      assert: newAssertion("Guitar playing as a personal hobby is genuinely distinct from the Tempo project, career topics, or family topics in the existing list."),
    },
    {
      description: "Topic-match: ambiguous case favors 'new' (conservative bias)",
      tags: ["topic-match", "conservative-bias"],
      prompt: () => buildTopicMatchPrompt({
        candidate_name: "Work-life balance",
        candidate_description: "Steve sometimes wonders if he spends too much time on side projects at the expense of family time.",
        candidate_category: "Concern",
        existing_topics: EXISTING_TOPICS,
      }),
      assert: newAssertion("Work-life balance touches on family and career but is not clearly the same as any existing topic. The prompt says 'if unsure, return new' — this is exactly that case."),
    },
    {
      description: "Topic-match: empty existing topics always returns 'new'",
      tags: ["topic-match", "empty-list"],
      prompt: () => buildTopicMatchPrompt({
        candidate_name: "Career development",
        candidate_description: "Steve thinks carefully about career moves.",
        candidate_category: "Goal",
        existing_topics: [],
      }),
      assert: newAssertion("With no existing topics, there is nothing to match against. Must return 'new'."),
    },
    {
      description: "Topic-match: two near-twin existing topics — must pick one, not return 'new'",
      tags: ["topic-match", "twin-topics", "consistency"],
      repeat: 3,
      prompt: () => buildTopicMatchPrompt({
        candidate_name: "Professional goals and career trajectory",
        candidate_description: "Steve is deliberate about advancing his career and makes calculated moves toward roles that stretch him.",
        candidate_category: "Goal",
        existing_topics: [NEAR_TWIN_A, NEAR_TWIN_B, ...EXISTING_TOPICS.slice(1)],
      }),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["matched_guid"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The existing topics contain two near-twins: 'Professional growth' (topic-twin-a) and 'Career ambitions' (topic-twin-b) — both clearly about career goals.",
            "The candidate 'Professional goals and career trajectory' matches both.",
            "PASS if matched_guid is 'topic-twin-a' OR 'topic-twin-b' — either is a valid match.",
            "FAIL if matched_guid is 'new' — returning new when two good matches exist creates a third duplicate, which is the failure mode we're testing for.",
          ].join(" "),
        },
      ],
    },
    {
      description: "Topic-match: two similar-but-distinct topics — picks the right one",
      tags: ["topic-match", "precision"],
      prompt: () => buildTopicMatchPrompt({
        candidate_name: "Estrangement from mother and family repair",
        candidate_description: "Steve went years without speaking to his mother after the second divorce. They talk now, but the repair has been slow.",
        candidate_category: "Conflict",
        existing_topics: [NEAR_TWIN_A, NEAR_TWIN_B, ...EXISTING_TOPICS],
      }),
      assert: matchAssertion("topic-family-001", "The candidate is about Steve's family complexity and estrangement — clearly matches 'Family relationship complexity', not the career twins."),
    },
  ],
  "tests/evals/results/topic-match-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
