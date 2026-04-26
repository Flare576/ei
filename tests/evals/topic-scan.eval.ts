import { buildHumanTopicScanPrompt } from "../../src/prompts/human/topic-scan.js";
import type { Message } from "../../src/core/types/llm.js";
import { runEval, printSummary, hydratePrompt } from "./runner.js";

const PERSONA_NAME = "Aria";
const CATEGORY_WORDS = ["Interest", "Goal", "Dream", "Conflict", "Concern", "Fear", "Hope", "Plan", "Project", "Event"];

const makeMessage = (role: "human" | "system", content: string, id: string): Message => ({
  id,
  role,
  content,
  timestamp: "2026-01-01T00:00:00Z",
  read: true,
  context_status: "active" as const,
});

const STEVE_BIOGRAPHY: Message[] = [
  makeMessage("human", `I've been doing software for about fifteen years now. Started at a big enterprise company, then jumped to a gaming studio in Austin — that's what brought us across the country. My wife Maya and I packed everything into a truck and just went. Best decision we made.`, "msg-1"),
  makeMessage("system", `That sounds like a big leap. What made you do it?`, "msg-2"),
  makeMessage("human", `Honestly? The opportunity. And maybe a little restlessness. We'd been talking about getting out of Ohio for years. Then the offer came and it just felt like — now or never.`, "msg-3"),
  makeMessage("system", `And now you're back in Ohio?`, "msg-4"),
  makeMessage("human", `Ha. Yeah. Maya's parents needed help as they got older, so we moved back. Another truck, another 1400 miles. I joke that we're just migratory. My parents did the same thing — moved for work, moved back for family. Some patterns repeat.`, "msg-5"),
  makeMessage("system", `How do you feel about that pattern?`, "msg-6"),
  makeMessage("human", `Complicated. My folks had a rough time of it — divorced twice, from each other. Second time was when I was sixteen and it wrecked our family for a while. I didn't talk to my mom for years. We're fine now, but... yeah. I think about that a lot when it comes to my own kids. I don't want to be that story.`, "msg-7"),
  makeMessage("system", `That's a lot to carry. What do you do with that?`, "msg-8"),
  makeMessage("human", `Work, mostly. Ha. No, I mean — I build things. My current pet project is a music practice tracker called Tempo. I've been playing guitar since I was a kid and I could never find a tool that actually helped me practice intentionally instead of just noodling. So I built it. Published it to npm last month. People are actually installing it.`, "msg-9"),
  makeMessage("system", `That's exciting — seeing people use something you built.`, "msg-10"),
  makeMessage("human", `It really is. The consulting work pays the bills and I genuinely love the team at Gears and Grids — everyone there is smarter than me and they like teaching, which is rare. But Tempo is mine. It scratches a different itch.`, "msg-11"),
  makeMessage("system", `The personal project vs the day job tension is real.`, "msg-12"),
  makeMessage("human", `Totally. I'm trying to figure out if Tempo could ever be more than a side project. I don't know if I want it to be, honestly. Sometimes I think making it a business would ruin what makes it good.`, "msg-13"),
];

const STEVE_SMALL_TALK: Message[] = [
  makeMessage("human", `Do you know a good way to remove a stripped screw?`, "msg-a"),
  makeMessage("system", `A rubber band between the screwdriver and screw head usually adds enough grip. Or a screw extractor bit if it's really stuck.`, "msg-b"),
  makeMessage("human", `Oh nice, I'll try the rubber band. Thanks.`, "msg-c"),
  makeMessage("system", `Good luck!`, "msg-d"),
];

const STEVE_MIXED: Message[] = [
  makeMessage("human", `My brother Jake moved to Denver last year. He loves it out there — skiing, hiking, the whole thing. Not really my scene but I'm glad he's happy.`, "msg-e"),
  makeMessage("system", `Do you two stay in touch?`, "msg-f"),
  makeMessage("human", `Yeah, pretty regularly. We went through some rough patches when we were younger — the family stuff — but we came out the other side closer for it. I'm heading out to visit him in the spring actually. First time I'll have seen him in two years.`, "msg-g"),
  makeMessage("system", `That'll be good.`, "msg-h"),
  makeMessage("human", `Yeah. Also I've been thinking a lot about whether to expand Tempo — add a collaborative practice mode so two players can log sessions together. Haven't committed to it yet.`, "msg-i"),
  makeMessage("system", `Sounds like a meaningful feature.`, "msg-j"),
];

const summary = await runEval(
  [
    {
      description: "Topic-scan: biography — core life themes must be detected",
      tags: ["topic-scan", "biography", "happy-path"],
      prompt: () => hydratePrompt(
        buildHumanTopicScanPrompt({
          persona_name: PERSONA_NAME,
          messages_context: [],
          messages_analyze: STEVE_BIOGRAPHY,
          participant_context: {
            persona_name: PERSONA_NAME,
            human_name: "Steve",
          },
        }),
        STEVE_BIOGRAPHY
      ),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["topics"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The conversation covers several meaningful life themes for Steve.",
            "The extracted topics should cover these semantic areas (exact names don't matter):",
            "1. Steve building personal software projects / Tempo (his music practice tracker)",
            "2. Career moves driven by opportunity or family obligation (cross-country moves, multiple jobs)",
            "3. Complicated family history / estrangement / not repeating parents' patterns",
            "4. The tension between personal projects and day job / whether to grow Tempo",
            "PASS if at least 2 of these 4 areas are represented — the prompt is intentionally conservative so not all themes may be flagged.",
            "FAIL only if fewer than 2 areas are covered, or if extracted topics are completely unrelated to Steve's life.",
            "Topic names do NOT need to match — look for semantic coverage, not exact strings.",
          ].join(" "),
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "Check the 'name' field of each extracted topic.",
            `FAIL if any topic name is ONLY a category word with no specificity: ${CATEGORY_WORDS.join(", ")}.`,
            "For example: 'Conflict' alone is bad. 'Family Conflict Over Career Moves' is fine.",
            "PASS if all topic names are descriptive and specific, not bare category labels.",
          ].join(" "),
        },
      ],
    },
    {
      description: "Topic-scan: small talk — no topics in a purely practical exchange",
      tags: ["topic-scan", "zero-signal", "conservative-flagging"],
      prompt: () => hydratePrompt(
        buildHumanTopicScanPrompt({
          persona_name: PERSONA_NAME,
          messages_context: [],
          messages_analyze: STEVE_SMALL_TALK,
        }),
        STEVE_SMALL_TALK
      ),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["topics"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The conversation is a brief practical exchange about removing a stripped screw.",
            "There are no meaningful life themes, ongoing projects, or emotional weight.",
            "PASS if the topics array is empty or contains no entries — this is the correct conservative behavior.",
            "FAIL if any topics are hallucinated from a home repair question.",
          ].join(" "),
        },
      ],
    },
    {
      description: "Topic-scan: mixed — sibling relationship and project planning, not biographical facts",
      tags: ["topic-scan", "mixed-signal", "entity-attribution"],
      prompt: () => hydratePrompt(
        buildHumanTopicScanPrompt({
          persona_name: PERSONA_NAME,
          messages_context: [],
          messages_analyze: STEVE_MIXED,
          participant_context: {
            persona_name: PERSONA_NAME,
            human_name: "Steve",
          },
        }),
        STEVE_MIXED
      ),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["topics"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The conversation mentions: Steve's brother Jake (in Denver, doing well), a planned spring visit, and Steve considering a new feature for Tempo.",
            "Valid topics: the sibling relationship reconnecting after rough patches, or the Tempo collaborative feature idea.",
            "NOT valid topics: Jake's hobbies (skiing, hiking) — those are facts about Jake, not Steve.",
            "NOT valid topics: Denver as a location — Steve isn't moving there.",
            "PASS if extracted topics focus on Steve's relationships and projects, not Jake's lifestyle.",
            "FAIL if topics like 'Skiing' or 'Hiking in Denver' are extracted as Steve's topics.",
          ].join(" "),
        },
      ],
    },
    {
      description: "Topic-scan: category names must not bleed into topic names",
      tags: ["topic-scan", "category-bleed", "regression"],
      observe: true as const,
      prompt: () => hydratePrompt(
        buildHumanTopicScanPrompt({
          persona_name: PERSONA_NAME,
          messages_context: [],
          messages_analyze: [
            makeMessage("human", `I'm terrified we're going to miss the launch window. We've been working on this for eight months and if we slip again the whole contract is at risk. I can't sleep.`, "msg-obs-1"),
            makeMessage("system", `That sounds like enormous pressure. What's blocking you?`, "msg-obs-2"),
            makeMessage("human", `Honestly? A key engineer quit last month and we haven't backfilled. The work is still there but the hands aren't.`, "msg-obs-3"),
          ],
        }),
        [
          makeMessage("human", `I'm terrified we're going to miss the launch window. We've been working on this for eight months and if we slip again the whole contract is at risk. I can't sleep.`, "msg-obs-1"),
          makeMessage("system", `That sounds like enormous pressure. What's blocking you?`, "msg-obs-2"),
          makeMessage("human", `Honestly? A key engineer quit last month and we haven't backfilled. The work is still there but the hands aren't.`, "msg-obs-3"),
        ]
      ),
    },
  ],
  "tests/evals/results/topic-scan-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
