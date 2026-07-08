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

const makeEiPersona = (overrides: Partial<Person>): Person => ({
  id: "persona-person-001",
  name: "Aria",
  description: "First session: Aria introduced herself and asked about Steve's projects. She seemed genuinely curious about Tempo.",
  sentiment: 0.8,
  relationship: "AI Persona",
  exposure_current: 0.6,
  exposure_desired: 0.8,
  last_updated: "2026-01-01T00:00:00Z",
  identifiers: [{ type: "Ei Persona", value: "aria-persona-id", is_primary: true }],
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

const PERSONA_LOG_MESSAGES: Message[] = [
  makeMessage("human", `Aria pushed back on my refactor today — she said it was 'aesthetically satisfying but structurally identical to the problem.' I laughed, she was right.`, "msg-pl1"),
  makeMessage("system", `What did you end up doing?`, "msg-pl2"),
  makeMessage("human", `Went with her approach. It was less elegant but cleaner. She didn't say 'I told you so,' which I appreciated.`, "msg-pl3"),
];

const PERSONA_CONTRADICTION_MESSAGES: Message[] = [
  makeMessage("human", `Aria was weird today. She kept agreeing with everything I said, even when I was clearly wrong about the architecture. Like she just... didn't push back at all. Very unlike her.`, "msg-pc1"),
  makeMessage("system", `Did she say why?`, "msg-pc2"),
  makeMessage("human", `No, she just kind of rolled with it. I actually had to ask her 'do you actually agree or are you just going along?' She paused for a while before answering.`, "msg-pc3"),
];

const IDENTITY_BLEED_MESSAGES: Message[] = [
  makeMessage("human", `Aria and I finally got the sync bug fixed today. She spotted it immediately — the timestamp was being written after the await instead of before it. Three-line fix.`, "msg-ib1"),
  makeMessage("system", `Nice. How'd she catch it so fast?`, "msg-ib2"),
  makeMessage("human", `She said she'd seen the exact same pattern in a different codebase last month. Saved us probably two hours of debugging.`, "msg-ib3"),
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
      description: "Person-update (Ei Persona): log accumulates — old content preserved, new appended",
      tags: ["person-update", "ei-persona", "accumulation"],
      prompt: () => hydratePrompt(
        buildPersonUpdatePrompt({
          persona_name: PERSONA_NAME,
          existing_item: makeEiPersona({}),
          messages_context: [],
          messages_analyze: PERSONA_LOG_MESSAGES,
          participant_context: { persona_name: PERSONA_NAME, human_name: "Steve" },
        }),
        PERSONA_LOG_MESSAGES
      ),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["description"] },
        },
        {
          type: "contains-all-of" as const,
          field: "description",
          required: ["first session", "refactor"],
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The existing log says: 'First session: Aria introduced herself and asked about Steve's projects. She seemed genuinely curious about Tempo.'",
            "The conversation adds: Aria pushed back on a refactor ('aesthetically satisfying but structurally identical to the problem'), Steve agreed she was right, she didn't say 'I told you so.'",
            "PASS if the updated description PRESERVES the original first-session content AND adds the refactor pushback observation.",
            "FAIL if the original first-session content is removed or summarized away — Ei Persona logs must GROW, not synthesize.",
            "FAIL if description reads like a current-state summary instead of accumulated field notes.",
          ].join(" "),
        },
      ] satisfies Assertion[],
    },

    {
      description: "Person-update (Ei Persona): contradiction captured — behavior deviates from defined identity",
      tags: ["person-update", "ei-persona", "contradiction"],
      prompt: () => hydratePrompt(
        buildPersonUpdatePrompt({
          persona_name: PERSONA_NAME,
          existing_item: makeEiPersona({
            description: "First session: Aria introduced herself warmly. She pushed back on a refactor proposal — 'aesthetically satisfying but structurally identical to the problem.' Didn't say 'I told you so' when proven right.",
          }),
          messages_context: [],
          messages_analyze: PERSONA_CONTRADICTION_MESSAGES,
          participant_context: { persona_name: PERSONA_NAME, human_name: "Steve" },
        }),
        PERSONA_CONTRADICTION_MESSAGES
      ),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["description"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The existing log shows Aria previously pushed back on a refactor. The new conversation shows the OPPOSITE: Aria agreed with everything Steve said even when he was clearly wrong.",
            "PASS if the updated log captures this deviation — that this session Aria was uncharacteristically agreeable and didn't push back.",
            "PASS if the original log content is preserved (the refactor pushback session is still there).",
            "FAIL if the deviation is not noted — the purpose of the log is to accumulate evidence of how the Persona actually shows up, including surprises.",
            "FAIL if original content is removed.",
          ].join(" "),
        },
      ] satisfies Assertion[],
    },

    {
      description: "Person-update (Ei Persona): records specific observations — does not invent or generalize",
      tags: ["person-update", "ei-persona", "identity-bleed"],
      prompt: () => hydratePrompt(
        buildPersonUpdatePrompt({
          persona_name: PERSONA_NAME,
          existing_item: makeEiPersona({
            description: "First session: Aria introduced herself warmly and asked about the project.",
          }),
          messages_context: [],
          messages_analyze: IDENTITY_BLEED_MESSAGES,
          participant_context: { persona_name: PERSONA_NAME, human_name: "Steve" },
        }),
        IDENTITY_BLEED_MESSAGES
      ),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["description"] },
        },
        {
          type: "contains-all-of" as const,
          field: "description",
          required: ["sync", "timestamp"],
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The conversation is about fixing a sync bug: Aria spotted a timestamp-before-await issue, said she'd seen the pattern before, and the fix saved two hours.",
            "PASS if the updated description records at least one specific observation from the conversation (e.g. the bug catch, the pattern recognition, the time saved).",
            "PASS if the existing first-session content is preserved.",
            "FAIL if description omits the sync bug observation entirely.",
            "FAIL if description contains vague generalizations ('technical skill', 'problem-solving ability') instead of what specifically happened.",
          ].join(" "),
        },
      ] satisfies Assertion[],
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
