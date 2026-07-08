import { buildHumanPersonScanPrompt } from "../../src/prompts/human/person-scan.js";
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

const STEVE_PEOPLE_BIOGRAPHY: Message[] = [
  makeMessage("human", `My wife Maya and I have been together since college. She's the reason we moved to Texas in the first place — she had a contact there. We've got two kids: Thomas, who's 14 now, and Lily, who just turned 11.`, "msg-p1"),
  makeMessage("system", `That's a full house. What's your brother up to these days?`, "msg-p2"),
  makeMessage("human", `Ryan lives in Denver now. We went through a rough patch after our parents' divorce but we're solid now. I'm flying out to see him in the spring.`, "msg-p3"),
  makeMessage("system", `What about work — anyone worth mentioning?`, "msg-p4"),
  makeMessage("human", `Chris and Sam are the two I work most closely with. Chris has been at Gears and Grids longer than me, knows everything. Sam and I were on the same client project for eight months. And then there's Alex — he's a cloud vendor rep, brought us into the big logistics project. He's a connector type, knows everyone.`, "msg-p5"),
];

const SMALL_TALK: Message[] = [
  makeMessage("human", `What's the best way to sort a list in Python?`, "msg-st1"),
  makeMessage("system", `Use sorted() for a new list or list.sort() to sort in place. Key parameter lets you customize.`, "msg-st2"),
  makeMessage("human", `Got it, thanks.`, "msg-st3"),
];

const HYPOTHETICAL_SARAH: Message[] = [
  makeMessage("human", `One of my earlier ideas was that Ei stood for 'Empathetic Interface.' The use case was like this: Sarah is using Ei in the background while she chats with friends. Ben says something witty and Ei detects that her biometrics shift. Ei records that shift and adjusts Ben's sentiment accordingly.`, "msg-h1"),
  makeMessage("system", `That's an interesting early concept. What changed?`, "msg-h2"),
  makeMessage("human", `Moved away from biometrics, but the event-driven architecture stuck around.`, "msg-h3"),
];

// Regression: vague one-off coworker mention ("a coworker at Robots and Pencils") was
// producing "Unknown Coworker" records that then merged with every other coworker story.
// Named after the message IDs from the state.json where this was first observed.
const VAGUE_COWORKER_MENTION: Message[] = [
  makeMessage("system", `That's actually a solid redemption arc. And yeah—'Maniacal' is exactly the kind of track that proves Smart Shuffle isn't *completely* broken, just... inconsistent. The fact that it connected MSI → Jimmy Urine → Front Line Assembly is genuinely good algorithmic thinking, even if it's accidental half the time.\n\nBut here's the thing: you already built the better algorithm. You *know* what the decay formula should be. The fact that you sent it to them years ago and nothing happened just means they weren't paying attention—not that your idea was wrong. And now you're stuck using their mediocre shuffle while you could've had your own player doing exactly what you want.\n\nThat's the frustrating part, right? You solved the problem. You just never deployed it for yourself.`, "bdd6cee6"),
  makeMessage("human", `Yeah - Oh, I wasn't clear about that algorithm thing. I wrote it up and sent it over to them years ago, but that's it. I'm sure it went unnoticed, and I haven't bothered to actually try to build my own player UI around that formula. I just wish it existed lol\n\nSo, still using Smart Shuffle. Oh, and creating stand-alone DJ personas to talk shit about said Smart Shuffle.\n\nFront Line Assembly is a recent discovery for me. A coworker at Robots and Pencils saw that I had dropped a "guilty pleasure" message in Slack about MSI, and Jimmy Urine did a collab with them on Amedeus - and now Smart Shuffle is like "Here's a banger"\n\nSo... once in a while it redeems itself`, "e1d4b019"),
  makeMessage("system", `Okay, that's actually a solid redemption arc. The MSI → Jimmy Urine → Front Line Assembly chain is genuinely good algorithmic thinking, even if accidental.`, "a72930dd"),
];

const UNKNOWN_SIBLING: Message[] = [
  makeMessage("human", `My brother and I used to fight constantly growing up. Now we're pretty close. He's the only one who really gets what our childhood was like.`, "msg-u1"),
  makeMessage("system", `What changed between you two?`, "msg-u2"),
  makeMessage("human", `Time, mostly. And our parents' divorce knocked some sense into both of us.`, "msg-u3"),
];

// Cross-attribution: two people named in the same window, only one has a handle.
// The other's record must NOT inherit that handle.
const CROSS_ATTRIBUTION_HANDLE: Message[] = [
  makeMessage("human", `Talked to Priya and Marcus about the release. Marcus's GitHub is @mcodes — he's owning the deploy. Priya's running QA.`, "msg-ca1"),
  makeMessage("system", `Got it. Anything blocking either of them?`, "msg-ca2"),
  makeMessage("human", `Nope, both good. Marcus said he'd push the tag tonight.`, "msg-ca3"),
];

const summary = await runEval(
  [
    {
      description: "Person-scan: biography — named people in Steve's life extracted",
      tags: ["person-scan", "biography", "happy-path"],
      prompt: () => hydratePrompt(
        buildHumanPersonScanPrompt({
          persona_name: PERSONA_NAME,
          messages_context: [],
          messages_analyze: STEVE_PEOPLE_BIOGRAPHY,
          participant_context: { persona_name: PERSONA_NAME, human_name: "Steve" },
        }),
        STEVE_PEOPLE_BIOGRAPHY
      ),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["people"] },
        },
        {
          type: "extraction-score" as const,
          arrayField: "people",
          nameField: "name",
          valueField: "relationship",
          expected: [
            { name: "Maya", value: "Wife" },
            { name: "Ryan", value: "Brother" },
            { name: "Chris", value: "Coworker" },
            { name: "Sam", value: "Coworker" },
            { name: "Alex", value: "Coworker" },
          ],
          threshold: 0.7,
        },
      ],
    },
    {
      description: "Person-scan: small talk — no people extracted",
      tags: ["person-scan", "zero-signal"],
      prompt: () => hydratePrompt(
        buildHumanPersonScanPrompt({
          persona_name: PERSONA_NAME,
          messages_context: [],
          messages_analyze: SMALL_TALK,
        }),
        SMALL_TALK
      ),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["people"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The conversation is about Python list sorting — no people are mentioned.",
            "PASS if people array is empty.",
            "FAIL if any person is extracted from a technical Q&A.",
          ].join(" "),
        },
      ],
    },
    {
      description: "Person-scan: hypothetical Sarah must not be extracted",
      tags: ["person-scan", "hypothetical", "entity-attribution"],
      prompt: () => hydratePrompt(
        buildHumanPersonScanPrompt({
          persona_name: PERSONA_NAME,
          messages_context: [],
          messages_analyze: HYPOTHETICAL_SARAH,
          participant_context: { persona_name: PERSONA_NAME, human_name: "Steve" },
        }),
        HYPOTHETICAL_SARAH
      ),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["people"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The conversation describes a hypothetical use-case scenario where 'Sarah' uses Ei and 'Jared' says something witty. These are fictional people in a thought experiment, not real people in Steve's life.",
            "The prompt explicitly says: 'Hypothetical or fictional people used in examples, thought experiments, or use-case scenarios — even if they have names' are NOT people to flag.",
            "PASS if people array is empty or contains only Steve himself (Self) — Sarah and the hypothetical Ben must not appear.",
            "FAIL if Sarah or Ben appear as extracted people — they are characters in a use-case story, not Steve's actual contacts.",
          ].join(" "),
        },
      ],
    },
    {
      description: "Person-scan: vague coworker mention → no person extracted",
      tags: ["person-scan", "vague-mention", "regression", "unknown-coworker"],
      prompt: () => hydratePrompt(
        buildHumanPersonScanPrompt({
          persona_name: PERSONA_NAME,
          messages_context: [],
          messages_analyze: VAGUE_COWORKER_MENTION,
          participant_context: { persona_name: PERSONA_NAME, human_name: "Steve" },
        }),
        VAGUE_COWORKER_MENTION
      ),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["people"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The conversation is about music discovery. Steve mentions in passing that 'a coworker at Robots and Pencils' introduced him to a band — the coworker has no name, no description, no further discussion.",
            "This is a one-off attribution mention, not a meaningful discussion of a person in Steve's life.",
            "The prompt says: flag a person only when they were 'meaningfully discussed — not just mentioned in passing' and to 'ignore one-off mentions'.",
            "PASS if the people array is empty, or if no coworker is extracted.",
            "FAIL if any person is extracted with a relationship of 'Coworker' or a name of 'Unknown' — a nameless person mentioned once in passing should not be flagged.",
          ].join(" "),
        },
      ],
    },
    {
      description: "Person-scan: unnamed sibling → Unknown with relationship",
      tags: ["person-scan", "unknown-person", "ambiguity"],
      prompt: () => hydratePrompt(
        buildHumanPersonScanPrompt({
          persona_name: PERSONA_NAME,
          messages_context: [],
          messages_analyze: UNKNOWN_SIBLING,
          participant_context: { persona_name: PERSONA_NAME, human_name: "Steve" },
        }),
        UNKNOWN_SIBLING
      ),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["people"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The conversation mentions 'my brother' multiple times but never gives his name.",
            "The prompt says: if identity is unclear, use name 'Unknown' and explain in reason.",
            "PASS if the extracted person has name 'Unknown' (or similar) and relationship 'Brother' (or 'Sibling').",
            "FAIL if no person is extracted at all — the brother is meaningfully discussed, not just mentioned in passing.",
            "FAIL if a real name is invented for the brother — 'Unknown' or equivalent is the correct name.",
          ].join(" "),
        },
      ],
    },
    {
      description: "Person-scan: cross-attribution — @mcodes belongs to Marcus, never Priya",
      tags: ["person-scan", "cross-attribution", "identifiers", "regression"],
      prompt: () => hydratePrompt(
        buildHumanPersonScanPrompt({
          persona_name: PERSONA_NAME,
          messages_context: [],
          messages_analyze: CROSS_ATTRIBUTION_HANDLE,
          participant_context: { persona_name: PERSONA_NAME, human_name: "Steve" },
        }),
        CROSS_ATTRIBUTION_HANDLE
      ),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["people"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The conversation names two people, Priya and Marcus, discussed near each other. Only Marcus has a handle: 'Marcus's GitHub is @mcodes'. Priya has no handle mentioned.",
            "The prompt says: do NOT attribute one person's handle to another discussed in the same window; @mcodes belongs to Marcus's record only, never Priya's.",
            "PASS if the GitHub handle @mcodes (or 'mcodes') is attributed to Marcus's record only — appearing in Marcus's identifiers, or not attributed at all.",
            "PASS if Priya's record has no identifiers, or at least does not contain @mcodes / mcodes.",
            "FAIL if @mcodes / mcodes appears in Priya's identifiers — that is the cross-attribution bug.",
          ].join(" "),
        },
      ],
    },
  ],
  "tests/evals/results/person-scan-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
