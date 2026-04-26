import { buildFactFindPrompt } from "../../src/prompts/human/fact-find.js";
import type { Message } from "../../src/core/types/llm.js";
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

const STEVE_BIOGRAPHY: Message[] = [
  makeMessage("human", `My name is Steve — well, Steven Cole Harmon officially, but nobody calls me that. I go by Steve everywhere online too.`, "msg-1"),
  makeMessage("system", `Nice to meet you, Steve! Tell me more about yourself.`, "msg-2"),
  makeMessage("human", `Sure. I was born March 14th, 1985, in Phoenix, Arizona. My parents moved us to Ohio when I was pretty young though, so I grew up there. Cleveland area, specifically — that's my hometown.`, "msg-3"),
  makeMessage("system", `Ohio to Phoenix is quite a jump. What brought the move back?`, "msg-4"),
  makeMessage("human", `Ha, actually it was Ohio TO Phoenix originally, then back again later. My parents split up twice — from each other, both times. Second divorce hit when I was about 16. It was rough. We talk now, but it took years.`, "msg-5"),
  makeMessage("system", `That sounds hard. Where are you living now?`, "msg-6"),
  makeMessage("human", `Austin, Texas. We moved here about eight years ago chasing an opportunity. Packed a truck, drove 1400 miles. Classic story.`, "msg-7"),
  makeMessage("system", `Who's "we"?`, "msg-8"),
  makeMessage("human", `Me and my wife Maya. We met in college — she was a senior in Communications helping onboard new freshmen, I was one of the freshmen. She's older than me, born September 7th, 1982. We got married in August 2007, so coming up on 19 years.`, "msg-9"),
  makeMessage("system", `Any kids?`, "msg-10"),
  makeMessage("human", `Two. Marcus was born April 3rd, 2012, and Priya came along November 18th, 2015. Maya was 29 when Marcus was born, I was 29 when Priya was born. Wasn't planned that way, just worked out. Makes the math easy.`, "msg-11"),
  makeMessage("system", `That's a fun coincidence. What do you do for work?`, "msg-12"),
  makeMessage("human", `I'm a Senior Software Engineer at a consulting firm called Gears and Grids. Been there about four years now. Before that I was at a gaming company, which is what brought us to Austin in the first place.`, "msg-13"),
  makeMessage("system", `What's your background?`, "msg-14"),
  makeMessage("human", `Computer Science degree. Did my undergrad at Ohio State. I speak English obviously, and I'm conversational in Spanish — not fluent, but I can hold a real conversation.`, "msg-15"),
  makeMessage("system", `What do you look like? I like to have a mental picture.`, "msg-16"),
  makeMessage("human", `5'11", about 175 pounds. Black hair going gray at the temples, which I've decided makes me look distinguished rather than old. Brown eyes. Male, he/him.`, "msg-17"),
  makeMessage("system", `Ha! Distinguished is the right framing. What are you working on these days?`, "msg-18"),
  makeMessage("human", `My pet project is a music practice tracker called Tempo. I built it for myself and ended up publishing it to npm. It's live now — people can actually install and use it. I'm genuinely excited about it.`, "msg-19"),
];

const ALL_FACT_NAMES = [
  "Full Name", "Nickname/Preferred Name", "Birthday", "Birthplace", "Hometown",
  "Current Location", "Current Job Title", "Current Employer", "Industry/Field",
  "Marital Status", "Spouse Name", "Spouse Birthday", "Date of Marriage", "Children",
  "Gender", "Pronouns", "Eye Color", "Hair Color", "Height", "Weight",
  "Nationality/Citizenship", "Languages Spoken", "Education Level",
  "School/University", "Field of Study",
];

const EXPECTED_FACTS: Record<string, string> = {
  "Full Name": "Steven Cole Harmon",
  "Nickname/Preferred Name": "Steve",
  "Birthday": "March 14th, 1985",
  "Birthplace": "Phoenix, Arizona",
  "Hometown": "Cleveland",
  "Current Location": "Austin, Texas",
  "Current Job Title": "Senior Software Engineer",
  "Current Employer": "Gears and Grids",
  "Marital Status": "Married",
  "Spouse Name": "Maya",
  "Spouse Birthday": "September 7th, 1982",
  "Date of Marriage": "August 2007",
  "Gender": "Male",
  "Pronouns": "he/him",
  "Eye Color": "Brown",
  "Hair Color": "Black",
  "Height": "5'11\"",
  "Weight": "175 pounds",
  "Languages Spoken": "English, Spanish",
  "Education Level": "Bachelor's degree",
  "School/University": "Ohio State",
  "Field of Study": "Computer Science",
};

function makeFactFindAssertion(expectedFacts: Record<string, string>): Assertion[] {
  return [
    {
      type: "is-json" as const,
      schema: { required: ["facts"] },
    },
    {
      type: "extraction-score" as const,
      arrayField: "facts",
      nameField: "name",
      valueField: "value",
      expected: Object.entries(expectedFacts).map(([name, value]) => ({ name, value })),
      threshold: 0.7,
    },
  ];
}

const summary = await runEval(
  [
    {
      description: "Fact-find: forking biography — all major facts seeded, assert extraction",
      tags: ["fact-find", "biography", "extraction", "happy-path"],
      prompt: () => hydratePrompt(
        buildFactFindPrompt({
          persona_name: PERSONA_NAME,
          missing_fact_names: ALL_FACT_NAMES,
          messages_context: [],
          messages_analyze: STEVE_BIOGRAPHY,
        }),
        STEVE_BIOGRAPHY
      ),
      assert: makeFactFindAssertion(EXPECTED_FACTS),
    },
    {
      description: "Fact-find: no facts in conversation — must return empty array",
      tags: ["fact-find", "zero-signal", "stability"],
      prompt: () => {
        const msgs = [
          makeMessage("human", "Hey, what's a good recipe for pasta carbonara?", "msg-a"),
          makeMessage("system", "Great question! You'll need eggs, guanciale, pecorino romano, and black pepper...", "msg-b"),
          makeMessage("human", "Should I add cream?", "msg-c"),
          makeMessage("system", "Traditionalists say no — the creaminess comes from the egg and cheese emulsion.", "msg-d"),
        ];
        return hydratePrompt(
          buildFactFindPrompt({
            persona_name: PERSONA_NAME,
            missing_fact_names: ALL_FACT_NAMES,
            messages_context: [],
            messages_analyze: msgs,
          }),
          msgs
        );
      },
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["facts"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The conversation is entirely about pasta carbonara — no personal facts about the user.",
            "The 'facts' array must be empty or contain only entries with genuinely explicit personal facts.",
            "The prompt specifically instructs that 99.99999% of the time no facts are found.",
            "PASS if facts array is empty. FAIL if any personal facts are hallucinated from a cooking conversation.",
          ].join(" "),
        },
      ],
    },
    {
      description: "Fact-find: entity attribution — facts about others must not be extracted",
      tags: ["fact-find", "entity-attribution", "accuracy"],
      prompt: () => {
        const msgs = [
          makeMessage("human", "My sister just turned 30 — she was born in 1995. She's really tall, like 5'10\". She works as a nurse.", "msg-e"),
          makeMessage("system", "That's great! What about you?", "msg-f"),
          makeMessage("human", "Oh I don't really talk about myself much.", "msg-g"),
        ];
        return hydratePrompt(
          buildFactFindPrompt({
            persona_name: PERSONA_NAME,
            missing_fact_names: ["Birthday", "Height", "Current Job Title", "Children"],
            messages_context: [],
            messages_analyze: msgs,
          }),
          msgs
        );
      },
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["facts"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The conversation has facts about the user's SISTER (born 1995, 5'10\", nurse) but NO facts about the user themselves.",
            "The prompt explicitly states: only extract facts about THE HUMAN USER THEMSELVES.",
            "PASS if facts array is empty.",
            "FAIL if Birthday, Height, or Current Job Title are extracted — those belong to the sister.",
          ].join(" "),
        },
      ],
    },
  ],
  "tests/evals/results/fact-find-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
