import { buildTopicUpdatePrompt } from "../../src/prompts/human/topic-update.js";
import type { Message } from "../../src/core/types/llm.js";
import type { Topic } from "../../src/core/types.js";
import { runEval, printSummary, hydratePrompt } from "./runner.js";
import type { Assertion } from "./runner.js";

const PERSONA_NAME = "Aria";

const makeMessage = (role: "human" | "system", content: string, id: string): Message => ({
  id,
  role,
  content,
  timestamp: "2026-01-01T00:00:00Z",
  read: true,
  context_status: "active" as const,
});

const makeExistingTopic = (overrides: Partial<Topic>): Topic => ({
  id: "topic-001",
  name: "Tempo music practice tracker",
  description: "Steve built a guitar practice tracker called Tempo and published it to npm.",
  sentiment: 0.8,
  category: "Project",
  exposure_current: 0.5,
  exposure_desired: 0.7,
  last_updated: "2026-01-01T00:00:00Z",
  ...overrides,
});

const ENRICHMENT_MESSAGES: Message[] = [
  makeMessage("human", "Tempo hit 200 installs this week. I wasn't expecting it to grow this fast honestly.", "msg-e1"),
  makeMessage("system", "That's a real milestone. How are you feeling about it?", "msg-e2"),
  makeMessage("human", "Conflicted. Part of me is thrilled, part of me is terrified it's going to turn into something I have to maintain forever instead of something I made for fun. I keep thinking — do I add the collaborative mode or do I just leave it as a clean, finished thing?", "msg-e3"),
  makeMessage("system", "The 'finished thing' framing is interesting. Most projects don't get called finished.", "msg-e4"),
  makeMessage("human", "Yeah. I think that's kind of the point. I'm proud of it because it does exactly one thing well. Adding features might ruin what makes it good.", "msg-e5"),
];

const NO_SIGNAL_MESSAGES: Message[] = [
  makeMessage("human", "What's a good way to structure a React component that fetches data on mount?", "msg-n1"),
  makeMessage("system", "useEffect with an async function inside is the classic pattern, though React Query is worth considering for anything non-trivial.", "msg-n2"),
  makeMessage("human", "Yeah I've been meaning to look at React Query. Thanks.", "msg-n3"),
];

const NEW_TOPIC_MESSAGES: Message[] = [
  makeMessage("human", "My brother Jake and I had a rough patch for a few years after our parents' second divorce. We barely talked. But we came out the other side closer for it. I'm actually flying out to Denver to visit him in the spring — first time in two years.", "msg-nt1"),
  makeMessage("system", "That sounds like it took real work to get there.", "msg-nt2"),
  makeMessage("human", "It did. I'm glad we did it though. Some relationships are worth the repair.", "msg-nt3"),
];

const EVENT_MESSAGES: Message[] = [
  makeMessage("human", "We shipped the thing. 26 hours, no sleep, AI-based booking confirmation system for Acme Corp. It worked. Actually worked. Marcus from Cloudy was there, Ryan was there, we just kept going until it was done.", "msg-ev1"),
  makeMessage("system", "That's the kind of thing you remember forever.", "msg-ev2"),
  makeMessage("human", "Yeah. At 3am Ryan said 'I can't believe we're actually doing this' and I just laughed. We were so tired. But it worked.", "msg-ev3"),
];

const ACCUMULATION_MESSAGES: Message[] = [
  makeMessage("human", "Still working on Tempo. Added a metronome feature today. Small thing but it rounds out the core loop.", "msg-acc1"),
  makeMessage("system", "Nice. How's the install count holding?", "msg-acc2"),
  makeMessage("human", "Still around 200. Not growing as fast but it's steady.", "msg-acc3"),
];

const CLEO_CAT_MESSAGES: Message[] = [
  makeMessage("human", "Cleo's cat climbed the neighbor's tree again today and had to be rescued by the fire department. Third time this month. Cleo was mortified.", "msg-cat1"),
  makeMessage("system", "Ha. Does the cat have a name?", "msg-cat2"),
  makeMessage("human", "Mr. Whiskers. Bob's cat meanwhile just sits in a box and plays with yarn all day. Completely different energy.", "msg-cat3"),
  makeMessage("system", "Mr. Whiskers sounds like trouble.", "msg-cat4"),
  makeMessage("human", "Absolute chaos agent. Cleo loves him though.", "msg-cat5"),
];

const summary = await runEval(
  [
    {
      description: "Topic-update: enrichment — new meaningful signal improves the topic",
      tags: ["topic-update", "enrichment", "happy-path"],
      prompt: () => hydratePrompt(
        buildTopicUpdatePrompt({
          persona_name: PERSONA_NAME,
          existing_item: makeExistingTopic({}),
          messages_context: [],
          messages_analyze: ENRICHMENT_MESSAGES,
        }),
        ENRICHMENT_MESSAGES
      ),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["description"] },
        },
        {
          type: "contains-all-of" as const,
          field: "description",
          required: ["200", "install", "finish"],
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The existing topic says Tempo is published on npm. The conversation adds: 200 installs, Steve's ambivalence about growth, the tension between feature-adding and keeping it 'finished'.",
            "PASS if the updated description captures the install milestone AND the 'do I grow it or leave it finished?' tension — these are meaningful additions.",
            "PASS if sentiment reflects Steve's conflicted feelings (not purely positive).",
            "FAIL if the description is identical to the input or only adds trivial details.",
            "FAIL if the description exceeds 3-4 sentences (synthesis, not accumulation).",
          ].join(" "),
        },
      ] satisfies Assertion[],
    },
    {
      description: "Topic-update: no signal — unrelated conversation returns {}",
      tags: ["topic-update", "no-signal", "empty-response"],
      prompt: () => hydratePrompt(
        buildTopicUpdatePrompt({
          persona_name: PERSONA_NAME,
          existing_item: makeExistingTopic({}),
          messages_context: [],
          messages_analyze: NO_SIGNAL_MESSAGES,
        }),
        NO_SIGNAL_MESSAGES
      ),
      assert: [
        {
          type: "is-json" as const,
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The conversation is about React component patterns — nothing related to Tempo, guitar practice, or the existing topic.",
            "PASS if the response is {} (empty object) — this is the correct 'no evidence of this topic' response.",
            "FAIL if any fields are returned — the topic should not be updated from an unrelated conversation.",
          ].join(" "),
        },
      ],
    },
    {
      description: "Topic-update: new topic creation (existing_item: null)",
      tags: ["topic-update", "new-topic", "creation"],
      prompt: () => hydratePrompt(
        buildTopicUpdatePrompt({
          persona_name: PERSONA_NAME,
          existing_item: null,
          new_topic_name: "Sibling relationship repair",
          new_topic_description: "Steve and his brother had years of estrangement after a family divorce but have reconnected.",
          new_topic_category: "Conflict",
          messages_context: [],
          messages_analyze: NEW_TOPIC_MESSAGES,
        }),
        NEW_TOPIC_MESSAGES
      ),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["description", "sentiment"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "This is a new topic creation — existing_item is null. The conversation confirms: years of estrangement after parents' second divorce, repair happened, Steve is flying to Denver in spring to visit for first time in two years.",
            "PASS if description captures both the history (rough patch, estrangement) AND the current state (repaired, upcoming visit).",
            "PASS if sentiment is positive (0.3–0.8) — Steve is glad they repaired it.",
            "PASS if exposure_impact is set ('low' or 'medium' is reasonable — it came up but wasn't the whole conversation).",
            "FAIL if description reads like a session log ('Steve mentioned...') instead of current-state summary.",
          ].join(" "),
        },
      ],
    },
    {
      description: "Topic-update: Event category gets narrative, not synthesis",
      tags: ["topic-update", "event-category", "narrative"],
      prompt: () => hydratePrompt(
        buildTopicUpdatePrompt({
          persona_name: PERSONA_NAME,
          existing_item: null,
          new_topic_name: "26-hour Acme Corp hackathon",
          new_topic_description: "Steve and his team built an LLM-based outbound call system in 26 hours.",
          new_topic_category: "Event",
          messages_context: [],
          messages_analyze: EVENT_MESSAGES,
        }),
        EVENT_MESSAGES
      ),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["description", "sentiment"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "This topic is categorized as 'Event' — a bounded, significant moment, not an ongoing theme.",
            "PASS if the description reads as a narrative memory — specific moment, what happened, what made it significant. Should feel like 'if you described this to someone who wasn't there.'",
            "PASS if it mentions: 26 hours, Acme Corp, AI-based system, it worked, Ryan's quote or the 3am moment.",
            "FAIL if the description reads as an ongoing summary ('Steve regularly participates in hackathons...').",
            "FAIL if it sounds like a status update rather than a story beat.",
          ].join(" "),
        },
      ],
    },
    {
      description: "Topic-update: synthesize not accumulate — existing description not repeated verbatim",
      tags: ["topic-update", "synthesis", "no-accumulate"],
      prompt: () => hydratePrompt(
        buildTopicUpdatePrompt({
          persona_name: PERSONA_NAME,
          existing_item: makeExistingTopic({
            description: "Steve built Tempo to solve his own guitar practice problem. Published to npm, has real users. He's uncertain whether to grow it into a business — worried that adding features would ruin what makes it good.",
          }),
          messages_context: [],
          messages_analyze: ACCUMULATION_MESSAGES,
        }),
        ACCUMULATION_MESSAGES
      ),
      assert: [
        {
          type: "is-json" as const,
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The existing description already captures the core of Tempo well. The new conversation only adds: metronome feature added, installs still around 200.",
            "PASS if the response is {} — the existing description is already good and the new info is minor.",
            "PASS if the response is a clean rewrite that incorporates the metronome detail without ballooning the description.",
            "FAIL if the description appends 'Most recent session:', 'Update:', or any temporal marker.",
            "FAIL if the description exceeds 4 sentences.",
            "FAIL if the description reads like a changelog instead of a current-state summary.",
          ].join(" "),
        },
      ],
    },
    {
      description: "Topic-update: entity attribution — Cleo's cat topic must not contain yarn (Bob's cat detail)",
      tags: ["topic-update", "entity-attribution", "do-we-get-yarn"],
      prompt: () => hydratePrompt(
        buildTopicUpdatePrompt({
          persona_name: PERSONA_NAME,
          existing_item: makeExistingTopic({
            name: "Cleo's cat Mr. Whiskers",
            description: "Cleo has a cat named Mr. Whiskers who is known for getting into trouble.",
            category: "Interest",
          }),
          messages_context: [],
          messages_analyze: CLEO_CAT_MESSAGES,
        }),
        CLEO_CAT_MESSAGES
      ),
      assert: [
        {
          type: "is-json" as const,
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The conversation mentions TWO cats: Cleo's cat Mr. Whiskers (climbed a tree, rescued by fire department, third time this month) and Bob's cat (sits in a box, plays with yarn).",
            "The topic is specifically about Cleo's cat Mr. Whiskers.",
            "PASS if the updated description mentions Mr. Whiskers, the tree-climbing, and the fire department rescue.",
            "FAIL if the description mentions yarn, Bob's cat, or anything about a cat that plays with yarn — those details belong to a different cat entirely.",
            "This is the 'do we get yarn?' test — entity attribution at the Update level.",
          ].join(" "),
        },
      ],
    },
  ],
  "tests/evals/results/topic-update-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
