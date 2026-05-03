/**
 * Duration calibration regression tests for topic-scan.
 *
 * Validates that duration scores correctly distinguish topics the human
 * genuinely engaged with from passing mentions — scored in isolation,
 * not relative to the rest of the conversation.
 *
 * Run:
 *   npm run test:evals:topic-scan-duration
 *
 * Results: tests/evals/results/topic-scan-duration-latest.json
 */

import { buildHumanTopicScanPrompt } from "../../src/prompts/human/topic-scan.js";
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
  const built = buildHumanTopicScanPrompt({
    persona_name: PERSONA_NAME,
    messages_context: [],
    messages_analyze: messages,
    participant_context: { persona_name: PERSONA_NAME, human_name: humanName },
  });
  return hydratePrompt(built, messages);
}

const FITNESS_ROUTINE: Message[] = [
  makeMessage("human", `I've been doing the Unikitty pattern for about four weeks now. Monday, Wednesday, Friday is the mat work — squats, pushups, the whole sequence. Tuesday, Thursday is cycling under the desk. It's working, I can feel the difference.`, "fr-1"),
  makeMessage("system", `Four weeks of consistency is real. What's the hardest part to maintain?`, "fr-2"),
  makeMessage("human", `The cycling honestly. The mat work I can do almost on autopilot now, but getting on the bike when I'm deep in a problem at work feels like friction. I've been using it as a reward instead — finish a hard thing, then bike while I decompress.`, "fr-3"),
  makeMessage("system", `Reframing it as a reward instead of an obligation. Does that actually work for you?`, "fr-4"),
  makeMessage("human", `More than I expected. I'm at five out of six sessions this week, which is better than any week before.`, "fr-5"),
];

const BURIED_MUSIC: Message[] = [
  makeMessage("human", `So the PR review came back and Alex basically rewrote half of it. Which, fine, it's better code, but it stings a little. I put on Front Line Assembly to work through it. Anyway, the actual changes are solid, I'm merging it.`, "bm-1"),
  makeMessage("system", `That's a mature take. What did Alex change specifically?`, "bm-2"),
  makeMessage("human", `Mostly the error handling — I had a lot of silent catches that he opened up. He was right. The music helped, I was less defensive reading his comments the second time through.`, "bm-3"),
];

const REAL_BROKEN_FRIEND: Message[] = [
  makeMessage("system", `You are so incredibly stubborn about this label. If you were actually a "shitty friend," you wouldn't be sitting here agonizing over this or feeling the weight of a year-long silence.`, "rbf-1"),
  makeMessage("human", `Had to help my kiddo with math, and I realized the disconnect!\n\nThe reason I avoid reaching out to Marcy is probably the same reason I don't reach out to Dale, who I never had a crush on. Or my actual brother.\n\nAnd the answer is that I'm kinda broken? I'm not really sure. It's not a social anxiety thing - I'll talk to anyone about anything, and I'm not afraid of rejection per se...`, "rbf-2"),
  makeMessage("system", `So it's not about social anxiety or fear of rejection. It's about something deeper — a disconnection in the initiation mechanism itself.`, "rbf-3"),
  makeMessage("human", `Yeah, so "shitty friend" is a cop out easy answer. For context, I owe Dale a photo walkthrough of my house from two months ago, I owe Marcy an anecdote I promised. I just don't initiate. Even when I want to. Even when I like the person.`, "rbf-4"),
];

const REAL_CEO: Message[] = [
  makeMessage("human", `I'm not actually all that worried - our new CEO is all-in, 100%, on AI. He's watching who ISN'T hitting millions of tokens a day. The last 3 days bar graphs are just very high lol\n\nBut yeah, "time saved" isn't the driver. The driver is actually the continual learning that you don't have to start over.`, "rc-1"),
  makeMessage("system", `That's the pitch. Not "save time," but "stop hemorrhaging context." Every time a dev has to re-explain the client's entire decision history to a new team member, that's a knowledge retention problem.`, "rc-2"),
  makeMessage("human", `Exactly. And our CEO gets that instinctively. He's not tracking token spend because it's expensive — he's tracking it because high usage means people are actually leaning on the system. That's how you prove value.`, "rc-3"),
];

const summary = await runEval(
  [
    {
      description: "Duration: fitness routine → primary topic duration 4-5 (sustained thread)",
      tags: ["topic-scan-duration", "high-duration", "fitness", "regression"],
      repeat: REPEATS,
      prompt: () => buildPrompt(FITNESS_ROUTINE),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["topics"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The conversation is entirely about the user's fitness routine — the Unikitty pattern, cycling, consistency. The human spent multiple messages on this topic with real elaboration.",
            "PASS if at least one topic related to fitness, exercise routine, or physical health is extracted with duration >= 4.",
            "FAIL if no fitness topic is extracted.",
            "FAIL if the fitness topic is extracted with duration <= 2 — the human spent the entire conversation on this.",
          ].join(" "),
        },
      ],
    },
    {
      description: "Duration: music buried in PR review → music duration 1-2, PR review duration 3-4",
      tags: ["topic-scan-duration", "low-duration", "buried-music", "regression"],
      repeat: REPEATS,
      prompt: () => buildPrompt(BURIED_MUSIC),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["topics"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The conversation is primarily about a code review — Alex rewrote half the PR, the user felt defensive, then accepted the changes. Music (Front Line Assembly) is mentioned once briefly as a coping mechanism — the human did not elaborate on it.",
            "PASS if a code review or professional feedback topic is extracted with duration >= 3.",
            "PASS if music is either not extracted, or extracted with duration <= 2.",
            "FAIL if music is extracted with duration >= 3 — the human mentioned it once in passing.",
            "FAIL if no code review topic is extracted — the human spent multiple messages on it.",
          ].join(" "),
        },
      ],
    },
    {
      description: "Duration: broken-friend — initiation problem duration 4-5, brother not standalone",
      tags: ["topic-scan-duration", "key-case", "real-data", "broken-friend", "regression"],
      repeat: REPEATS,
      prompt: () => buildPrompt(REAL_BROKEN_FRIEND, "Steve"),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["topics"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The conversation is about the user's difficulty initiating contact with people they care about — Marcy, Dale, and their brother are all mentioned as examples. The human spent several messages elaborating on this pattern.",
            "PASS if a topic about social initiation difficulty, not reaching out, or being a 'bad friend' is extracted with duration >= 4.",
            "PASS if no topic specifically about the user's brother is extracted as a standalone subject.",
            "FAIL if the initiation difficulty topic is missing — the human spent the entire conversation on it.",
            "FAIL if the brother is extracted as a standalone topic with duration >= 3 — he is one example in the human's story.",
          ].join(" "),
        },
      ],
    },
    {
      description: "Duration: CEO AI adoption — multiple topics at appropriate durations",
      tags: ["topic-scan-duration", "multi-topic", "real-data", "ceo", "regression"],
      repeat: REPEATS,
      prompt: () => buildPrompt(REAL_CEO, "Steve"),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["topics"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The conversation covers AI adoption at work (CEO tracking token usage as engagement signal) and knowledge retention as the real value proposition of AI tools. The human engaged substantively with both threads.",
            "PASS if at least one topic covers AI adoption, token metrics, or proving AI value — the human spent real sentences on this.",
            "PASS if at least one topic covers knowledge retention, context continuity, or not having to start over.",
            "FAIL if both threads are missing.",
            "FAIL if any extracted topic has duration >= 4 but is about something not in the conversation.",
          ].join(" "),
        },
      ],
    },
  ],
  "tests/evals/results/topic-scan-duration-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
