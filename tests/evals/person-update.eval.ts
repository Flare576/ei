import { buildPersonUpdatePrompt } from "../../src/prompts/human/person-update.js";
import type { Message } from "../../src/core/types/llm.js";
import type { Person } from "../../src/core/types.js";
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

const makeExistingPerson = (overrides: Partial<Person>): Person => ({
  id: "person-001",
  name: "Ryan",
  description: "Steve's brother. They had a rough patch after their parents' divorce but reconnected. Lives in Denver.",
  sentiment: 0.7,
  relationship: "Brother",
  exposure_current: 0.3,
  exposure_desired: 0.5,
  last_updated: "2026-01-01T00:00:00Z",
  identifiers: [],
  ...overrides,
});

const NEW_PERSON_MESSAGES: Message[] = [
  makeMessage("human", `My manager Chris pulled me into a one-on-one today. He's been at Gears and Grids for eight years — knows where every body is buried. He mentioned he's thinking about moving me onto a new client account next quarter. I'm cautiously optimistic.`, "msg-np1"),
  makeMessage("system", `How do you feel about Chris as a manager?`, "msg-np2"),
  makeMessage("human", `He's direct, which I appreciate. Doesn't sugarcoat things. He told me once 'I only give feedback when it matters' and I've never forgotten that.`, "msg-np3"),
];

const ENRICHMENT_MESSAGES: Message[] = [
  makeMessage("human", `Talked to Ryan this week. He's been doing trail running — ran his first half marathon last month. He seemed really proud of it. We're still on for the spring visit.`, "msg-e1"),
  makeMessage("system", `That's great. Is he still in Denver?`, "msg-e2"),
  makeMessage("human", `Yeah, loves it out there. He said the mountains are what got him into running in the first place.`, "msg-e3"),
];

const NO_SIGNAL_MESSAGES: Message[] = [
  makeMessage("human", `Spent the morning debugging a race condition in the async queue. Turns out the timestamp update was happening after the await instead of before it.`, "msg-ns1"),
  makeMessage("system", `Classic async timing issue. Fixed?`, "msg-ns2"),
  makeMessage("human", `Yeah. Three line change.`, "msg-ns3"),
];

const MULTI_PERSON_MESSAGES: Message[] = [
  makeMessage("human", `Had lunch with Sam and Ryan today. Sam's stressed about the new client deadline — been working weekends. Ryan just flew in from Denver for a conference and we grabbed an hour together. He looks good, healthy.`, "msg-mp1"),
  makeMessage("system", `Nice that Ryan made time. How's he settling into the new city?`, "msg-mp2"),
  makeMessage("human", `Really well. Said he finally feels like he belongs somewhere.`, "msg-mp3"),
];


// Cross-attribution: the target record (Ryan) is updated while the window also
// mentions a separate coworker (Marcus) whose handle must NOT land on Ryan.
const CROSS_ATTRIBUTION_MESSAGES: Message[] = [
  makeMessage("human", `Ryan called from Denver — training for another half marathon. My coworker Marcus was on the call too; Marcus's GitHub is @mcodes and he offered to help Ryan set up a running-stats site.`, "msg-ca1"),
  makeMessage("system", `Generous of Marcus. Is Ryan into the tech side of it?`, "msg-ca2"),
  makeMessage("human", `Not really, but he appreciated the offer. Mostly he just wants to keep running.`, "msg-ca3"),
];

// Confirm path (I1 positive counterpart): the window EXPLICITLY names a new handle for the
// target person (Ryan). Forwarded via suggested_identifiers, the validate-or-disprove block
// must KEEP it — the mirror image of the cross-attribution (disprove) case above.
const CONFIRM_PATH_MESSAGES: Message[] = [
  makeMessage("human", `Ryan set up a running blog from Denver — he told me his GitHub is @ryanruns, that's where he pushes the site. Said to follow him there.`, "msg-cp1"),
  makeMessage("system", `Nice. Is that where he tracks the trail runs?`, "msg-cp2"),
  makeMessage("human", `Yeah, @ryanruns is all his running-stats code — race splits, elevation, the works.`, "msg-cp3"),
];

const summary = await runEval(
  [
    {
      description: "Person-update (People): new person creation — bootstrap from conversation",
      tags: ["person-update", "people", "new-person", "creation"],
      prompt: () => hydratePrompt(
        buildPersonUpdatePrompt({
          persona_name: PERSONA_NAME,
          existing_item: null,
          new_person_name: "Chris",
          new_person_relationship: "Manager",
          messages_context: [],
          messages_analyze: NEW_PERSON_MESSAGES,
          participant_context: { persona_name: PERSONA_NAME, human_name: "Steve" },
        }),
        NEW_PERSON_MESSAGES
      ),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["description", "sentiment", "relationship"] },
        },
        {
          type: "contains-all-of" as const,
          field: "description",
          required: ["manager", "gears"],
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "This is a new person record for Chris, Steve's manager at Gears and Grids.",
            "PASS if description captures at least two of: 8 years at Gears and Grids, direct communication style, 'only gives feedback when it matters'.",
            "PASS if relationship is 'Manager' or similar.",
            "PASS if description is 1-3 sentences — bootstrap, not a biography.",
            "FAIL if description exceeds 4 sentences.",
            "FAIL if description invents details not in the conversation.",
          ].join(" "),
        },
      ] satisfies Assertion[],
    },

    {
      description: "Person-update (People): enrichment — existing record gains new details",
      tags: ["person-update", "people", "enrichment"],
      prompt: () => hydratePrompt(
        buildPersonUpdatePrompt({
          persona_name: PERSONA_NAME,
          existing_item: makeExistingPerson({}),
          messages_context: [],
          messages_analyze: ENRICHMENT_MESSAGES,
          participant_context: { persona_name: PERSONA_NAME, human_name: "Steve" },
        }),
        ENRICHMENT_MESSAGES
      ),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["description", "sentiment"] },
        },
        {
          type: "contains-all-of" as const,
          field: "description",
          required: ["denver", "run"],
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The existing record says Ryan lives in Denver and reconnected with Steve. The conversation adds: trail running, completed a half marathon, mountains inspired him, spring visit still planned.",
            "PASS if updated description is a synthesized current-state summary including the new trail running detail.",
            "PASS if description does NOT read like a session log ('This week Ryan mentioned...').",
            "FAIL if description exceeds 4 sentences.",
          ].join(" "),
        },
      ] satisfies Assertion[],
    },

    {
      description: "Person-update (People): no signal — unrelated conversation returns {}",
      tags: ["person-update", "people", "no-signal"],
      prompt: () => hydratePrompt(
        buildPersonUpdatePrompt({
          persona_name: PERSONA_NAME,
          existing_item: makeExistingPerson({}),
          messages_context: [],
          messages_analyze: NO_SIGNAL_MESSAGES,
          participant_context: { persona_name: PERSONA_NAME, human_name: "Steve" },
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
            "The conversation is entirely about debugging an async race condition — Ryan is not mentioned.",
            "PASS if response is {} (empty object).",
            "FAIL if any fields are returned — the target person is not in this conversation.",
          ].join(" "),
        },
      ],
    },

    {
      description: "Person-update (People): entity focus — only target person updated, not others",
      tags: ["person-update", "people", "entity-focus"],
      prompt: () => hydratePrompt(
        buildPersonUpdatePrompt({
          persona_name: PERSONA_NAME,
          existing_item: makeExistingPerson({}),
          messages_context: [],
          messages_analyze: MULTI_PERSON_MESSAGES,
          participant_context: { persona_name: PERSONA_NAME, human_name: "Steve" },
        }),
        MULTI_PERSON_MESSAGES
      ),
      assert: [
        {
          type: "is-json" as const,
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The conversation mentions both Sam (stressed about deadline, working weekends) and Ryan (flew in from Denver, looks healthy, feels like he belongs).",
            "The target person record is Ryan (Brother).",
            "PASS if the updated description reflects Ryan's visit and 'finally feels like he belongs somewhere'.",
            "FAIL if Sam's stress or work situation appears in Ryan's description — that belongs to Sam's record.",
          ].join(" "),
        },
      ],
    },

    {
      description: "Person-update (People): cross-attribution — another person's handle is not added to this record",
      tags: ["person-update", "people", "cross-attribution", "identifiers", "regression"],
      prompt: () => hydratePrompt(
        buildPersonUpdatePrompt({
          persona_name: PERSONA_NAME,
          existing_item: makeExistingPerson({}),
          messages_context: [],
          messages_analyze: CROSS_ATTRIBUTION_MESSAGES,
          participant_context: { persona_name: PERSONA_NAME, human_name: "Steve" },
        }),
        CROSS_ATTRIBUTION_MESSAGES
      ),
      assert: [
        {
          type: "is-json" as const,
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The target record is Ryan (Steve's brother). The conversation mentions Ryan AND a separate coworker, Marcus, whose GitHub is @mcodes.",
            "The prompt says: only add an identifier explicitly stated about THIS SPECIFIC PERSON; do not attribute one person's handle to another discussed nearby. Example: do NOT add @mcodes to Priya's record; it belongs to Marcus only.",
            "PASS if the response does NOT add @mcodes (or any GitHub handle) to Ryan's identifiers_to_add — @mcodes belongs to Marcus, not Ryan.",
            "PASS if the response is {} or updates only Ryan's description/relationship without borrowing Marcus's handle.",
            "FAIL if @mcodes / mcodes appears in identifiers_to_add for Ryan — that is the cross-attribution bug.",
          ].join(" "),
        },
      ] satisfies Assertion[],
    },
    {
      description: "Person-update (People): confirm path — a scan-flagged handle confirmed for THIS person is added",
      tags: ["person-update", "identifiers", "confirm-path"],
      prompt: () => hydratePrompt(
        buildPersonUpdatePrompt({
          persona_name: PERSONA_NAME,
          existing_item: makeExistingPerson({}),
          messages_context: [],
          messages_analyze: CONFIRM_PATH_MESSAGES,
          participant_context: { persona_name: PERSONA_NAME, human_name: "Steve" },
          suggested_identifiers: [{ type: "GitHub", value: "@ryanruns" }],
        }),
        CONFIRM_PATH_MESSAGES
      ),
      assert: [
        {
          type: "is-json" as const,
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The target record is Ryan (Steve's brother). The scan flagged a possible identifier for him: GitHub @ryanruns.",
            "The conversation EXPLICITLY confirms @ryanruns is Ryan's GitHub — he stated it himself and it hosts his running-stats code.",
            "The prompt instructs: for each scan-flagged identifier, add it to identifiers_to_add ONLY if the Most Recent Messages confirm it belongs to THIS SPECIFIC PERSON.",
            "PASS if identifiers_to_add includes a GitHub identifier with value @ryanruns (or ryanruns) for Ryan.",
            "FAIL if @ryanruns is omitted from identifiers_to_add — the window confirms it belongs to Ryan, so the forward-and-validate path must keep it.",
          ].join(" "),
        },
      ] satisfies Assertion[],
    },
  ],
  "tests/evals/results/person-update-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
