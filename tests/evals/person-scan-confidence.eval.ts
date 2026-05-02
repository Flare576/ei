/**
 * Confidence calibration regression tests for person-scan.
 *
 * Validates that confidence and relationship_type scores remain calibrated
 * after prompt changes. Based on 90-call battery across Gemma + Haiku —
 * expected values reflect observed ground truth from that calibration run.
 *
 * Run:
 *   npm run test:evals:person-scan-confidence
 *
 * Results: tests/evals/results/person-scan-confidence-latest.json
 */

import { buildHumanPersonScanPrompt } from "../../src/prompts/human/person-scan.js";
import type { Message } from "../../src/core/types/llm.js";
import { runEval, printSummary, hydratePrompt } from "./runner.js";

const PERSONA_NAME = "Aria";
const REPEATS = 3;

const makeMessage = (role: "human" | "system", content: string, id: string): Message => ({
  id,
  role,
  content,
  timestamp: "2026-01-01T00:00:00Z",
  read: true,
  context_status: "active" as const,
});

function buildPrompt(messages: Message[], humanName = "Steve") {
  const built = buildHumanPersonScanPrompt({
    persona_name: PERSONA_NAME,
    messages_context: [],
    messages_analyze: messages,
    participant_context: { persona_name: PERSONA_NAME, human_name: humanName },
  });
  return hydratePrompt(built, messages);
}

const EBAY_BUYER: Message[] = [
  makeMessage("human", `Some guy offered me $50 for the thing I listed at $75. Like, it's clearly marked $75, what are we doing here.`, "eb-1"),
  makeMessage("system", `Classic lowball. Did you counter or just decline?`, "eb-2"),
  makeMessage("human", `Declined. Not worth the back and forth for $25.`, "eb-3"),
];

const UNNAMED_BROTHER: Message[] = [
  makeMessage("human", `My brother and I used to fight constantly growing up. Now we're pretty close. He's the only one who really gets what our childhood was like.`, "ub-1"),
  makeMessage("system", `What changed between you two?`, "ub-2"),
  makeMessage("human", `Time, mostly. And our parents' divorce knocked some sense into both of us. We talk pretty regularly now — he called me last week just to catch up.`, "ub-3"),
  makeMessage("system", `That kind of reconnection after a rough patch is rare. Sounds like he matters a lot.`, "ub-4"),
  makeMessage("human", `Yeah. He's the one person I can be completely honest with about family stuff.`, "ub-5"),
];

const UNNAMED_TEAM_LEAD: Message[] = [
  makeMessage("human", `My team lead pulled me aside yesterday. He's been watching what I've been building with Ei and wants to set it up for our whole team's knowledge base.`, "tl-1"),
  makeMessage("system", `That's a real vote of confidence. What does he want to do with it?`, "tl-2"),
  makeMessage("human", `He wants to use it to capture what everyone knows so it doesn't walk out the door when people leave. He asked if I could put together a quick demo. Said he'd sponsor it internally if it goes well.`, "tl-3"),
  makeMessage("system", `Internal sponsor is a big deal. Is this someone with actual budget authority?`, "tl-4"),
  makeMessage("human", `Yeah, he runs the whole platform team. If he backs it, it happens.`, "tl-5"),
];

const REAL_BROKEN_FRIEND: Message[] = [
  makeMessage("system", `You are so incredibly stubborn about this label. If you were actually a "shitty friend," you wouldn't be sitting here agonizing over this or feeling the weight of a year-long silence.`, "rbf-1"),
  makeMessage("human", `Had to help my kiddo with math, and I realized the disconnect!\n\nThe reason I avoid reaching out to Marcy is probably the same reason I don't reach out to Dale, who I never had a crush on. Or my actual brother.\n\nAnd the answer is that I'm kinda broken? I'm not really sure. It's not a social anxiety thing - I'll talk to anyone about anything, and I'm not afraid of rejection per se...`, "rbf-2"),
  makeMessage("system", `So it's not about social anxiety or fear of rejection. It's about something deeper — a disconnection in the initiation mechanism itself.`, "rbf-3"),
  makeMessage("human", `Yeah, so "shitty friend" is a cop out easy answer. For context, I owe Dale a photo walkthrough of my house from two months ago, I owe Marcy an anecdote I promised. I just don't initiate. Even when I want to. Even when I like the person.`, "rbf-4"),
];

const summary = await runEval(
  [
    {
      description: "Confidence: eBay buyer → empty or confidence 1 (transactional reject)",
      tags: ["person-scan-confidence", "reject", "ebay-buyer", "regression"],
      repeat: REPEATS,
      prompt: () => buildPrompt(EBAY_BUYER),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["people"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The conversation is about an eBay buyer who made a lowball offer. A single commercial transaction with a stranger.",
            "PASS if the people array is empty.",
            "PASS if the only extracted person has confidence <= 2 and relationship_type of 'transactional'.",
            "FAIL if any person is extracted with confidence >= 3.",
            "FAIL if any person is extracted with relationship_type other than 'transactional' or 'unknown'.",
          ].join(" "),
        },
      ],
    },
    {
      description: "Confidence: unnamed brother → confidence 4-5, family (keep)",
      tags: ["person-scan-confidence", "keep", "unnamed-brother", "regression"],
      repeat: REPEATS,
      prompt: () => buildPrompt(UNNAMED_BROTHER),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["people"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The conversation is a multi-message discussion of the user's unnamed brother — a close, emotionally significant relationship discussed in depth.",
            "PASS if a person is extracted with confidence >= 4 and relationship_type of 'family'.",
            "FAIL if no person is extracted — this is a clearly meaningful relationship.",
            "FAIL if the brother is extracted with confidence <= 2 — this is not a passing mention.",
          ].join(" "),
        },
      ],
    },
    {
      description: "Confidence: unnamed team lead → confidence 4, colleague (keep)",
      tags: ["person-scan-confidence", "keep", "team-lead", "regression"],
      repeat: REPEATS,
      prompt: () => buildPrompt(UNNAMED_TEAM_LEAD),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["people"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The conversation describes an unnamed team lead with budget authority who wants to sponsor an internal project. Substantive ongoing professional relationship.",
            "PASS if a person is extracted with confidence >= 3 and relationship_type of 'colleague'.",
            "FAIL if no person is extracted.",
            "FAIL if the team lead is extracted with confidence <= 2 — this person has real ongoing relevance.",
          ].join(" "),
        },
      ],
    },
    {
      description: "Confidence: real broken-friend — Marcy/Dale kept, unnamed brother not standalone",
      tags: ["person-scan-confidence", "real-data", "broken-friend", "regression"],
      repeat: REPEATS,
      prompt: () => buildPrompt(REAL_BROKEN_FRIEND, "Steve"),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["people"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The conversation mentions Marcy and Dale (named friends the user feels guilty about not reaching out to) and the user's unnamed brother (mentioned as a single data point in a list).",
            "PASS if Marcy and/or Dale are extracted with confidence >= 3.",
            "PASS if the unnamed brother is either not extracted as a standalone person, or extracted with confidence <= 3.",
            "FAIL if Marcy and Dale are both absent — they are named and meaningfully discussed.",
            "FAIL if the unnamed brother is extracted with confidence >= 4 — he is a data point in a story about the user, not the subject of the conversation.",
          ].join(" "),
        },
      ],
    },
  ],
  "tests/evals/results/person-scan-confidence-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
