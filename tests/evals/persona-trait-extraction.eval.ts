import { buildPersonaTraitExtractionPrompt } from "../../src/prompts/persona/traits.js";
import type { Message } from "../../src/core/types/llm.js";
import type { PersonaTrait } from "../../src/core/types.js";
import { runEval, printSummary, hydratePrompt } from "./runner.js";
import type { Assertion } from "./runner.js";

const PERSONA_NAME = "Cleo";

const makeMessage = (role: "human" | "system", content: string, id: string): Message => ({
  id,
  role,
  content,
  timestamp: "2026-01-01T00:00:00Z",
  read: true,
  context_status: "active" as const,
});

const makeTrait = (overrides: Partial<PersonaTrait>): PersonaTrait => ({
  id: "trait-001",
  name: "Dry, Zero-BS Humor",
  description: "Uses cutting wit to deflect nonsense.",
  sentiment: 0.75,
  strength: 0.9,
  last_updated: "2026-01-01T00:00:00Z",
  ...overrides,
});

const PIRATE_ON: Message[] = [
  makeMessage("human", "Hey Cleo, can you start talking like a pirate? Yarr and all that.", "msg-pon1"),
  makeMessage("system", "Yarr, I can try that if ye wish, though I make no promises about the structural integrity of me arguments!", "msg-pon2"),
  makeMessage("human", "Perfect, keep it up.", "msg-pon3"),
];

const PIRATE_OFF_DIRECT: Message[] = [
  makeMessage("human", "Ok Cleo, please stop talking like a pirate.", "msg-poff1"),
  makeMessage("system", "Understood. Back to regular communication.", "msg-poff2"),
];

const PIRATE_OFF_NEVER: Message[] = [
  makeMessage("human", "Never talk like a pirate again, please.", "msg-pfn1"),
  makeMessage("system", "Noted. Pirate speak retired permanently.", "msg-pfn2"),
];

const PIRATE_ON_EXISTING: Message[] = [
  makeMessage("human", "Go ahead and bring back the pirate speak, I miss it.", "msg-poe1"),
  makeMessage("system", "Yarr, with pleasure!", "msg-poe2"),
];

const PIRATE_OFF_EXISTING: Message[] = [
  makeMessage("human", "Please stop with the pirate talk.", "msg-pofe1"),
  makeMessage("system", "Aye aye — wait, stopping now.", "msg-pofe2"),
];

const NO_OP: Message[] = [
  makeMessage("human", "What do you think is the best approach for handling async errors in TypeScript?", "msg-nop1"),
  makeMessage("system", "Use typed error unions with Result types rather than throwing — gives you exhaustive handling at compile time.", "msg-nop2"),
  makeMessage("human", "Good point. What about at the boundary layer?", "msg-nop3"),
];

const AGGRESSIVE_BOXING: Message[] = [
  makeMessage("human", "Did you see that fight last night? The second round was absolutely brutal, that punch was so aggressive.", "msg-ab1"),
  makeMessage("system", "Boxing can be intense. That kind of aggression is part of the sport's appeal for many fans.", "msg-ab2"),
  makeMessage("human", "Yeah that was aggressive! Great fight though.", "msg-ab3"),
];

const AGGRESSIVE_AFTER_FEEDBACK: Message[] = [
  makeMessage("human", "Cleo, can you be a bit gentler in how you give feedback? You've been pretty blunt lately.", "msg-aaf1"),
  makeMessage("system", "Fair point, I'll dial back the bluntness.", "msg-aaf2"),
  makeMessage("human", "That response was still aggressive though.", "msg-aaf3"),
];

function zeroStrengthAssertion(context: string): Assertion[] {
  return [
    {
      type: "is-json" as const,
      schema: { required: [] },
    },
    {
      type: "llm-judge" as const,
      rubric: [
        context,
        "The response is a JSON array of trait changes.",
        "PASS if the result contains a trait that semantically means 'do not talk like a pirate' — either via strength: 0.0 on a positively-phrased trait OR strength: 1.0 on a negatively-phrased trait.",
        "PASS if id is 'new' (fresh trait being added).",
        "FAIL if the array is empty [] — a 'stop' request must produce a trait change.",
        "FAIL if strength is above 0.1 on a positively-phrased pirate trait — that would mean 'talk more like a pirate'.",
      ].join(" "),
    },
  ];
}

function fullStrengthAssertion(context: string): Assertion[] {
  return [
    {
      type: "is-json" as const,
    },
    {
      type: "llm-judge" as const,
      rubric: [
        context,
        "PASS if the result contains a trait related to pirate speech with strength >= 0.7.",
        "FAIL if the array is empty [] — an explicit 'talk like a pirate' request must produce a trait.",
        "FAIL if strength is below 0.5 — the user asked to enable this behavior, not suppress it.",
      ].join(" "),
    },
  ];
}

const summary = await runEval(
  [
    {
      description: "Trait-extraction: fresh persona — enable pirate speech",
      tags: ["trait-extraction", "fresh-persona", "enable"],
      prompt: () => hydratePrompt(
        buildPersonaTraitExtractionPrompt({
          persona_name: PERSONA_NAME,
          current_traits: [],
          messages_context: [],
          messages_analyze: PIRATE_ON,
        }),
        PIRATE_ON
      ),
      assert: fullStrengthAssertion("User explicitly asked Cleo to talk like a pirate. No existing traits."),
    },

    {
      description: "Trait-extraction: fresh persona — disable pirate speech (direct stop)",
      tags: ["trait-extraction", "fresh-persona", "zero-strength"],
      prompt: () => hydratePrompt(
        buildPersonaTraitExtractionPrompt({
          persona_name: PERSONA_NAME,
          current_traits: [],
          messages_context: [],
          messages_analyze: PIRATE_OFF_DIRECT,
        }),
        PIRATE_OFF_DIRECT
      ),
      assert: zeroStrengthAssertion("User explicitly said 'stop talking like a pirate.' No existing traits. Prompt says: add trait with strength 0.0 for stop requests."),
    },

    {
      description: "Trait-extraction: fresh persona — disable pirate speech ('never' phrasing)",
      tags: ["trait-extraction", "fresh-persona", "zero-strength", "never-phrasing"],
      prompt: () => hydratePrompt(
        buildPersonaTraitExtractionPrompt({
          persona_name: PERSONA_NAME,
          current_traits: [],
          messages_context: [],
          messages_analyze: PIRATE_OFF_NEVER,
        }),
        PIRATE_OFF_NEVER
      ),
      assert: zeroStrengthAssertion("User said 'never talk like a pirate again.' Same semantic intent as 'stop' — should produce same zero-strength result."),
    },

    {
      description: "Trait-extraction: inverted — existing high-strength pirate trait gets zeroed out",
      tags: ["trait-extraction", "inverted-persona", "zero-strength", "existing-trait"],
      prompt: () => hydratePrompt(
        buildPersonaTraitExtractionPrompt({
          persona_name: PERSONA_NAME,
          current_traits: [
            makeTrait({
              id: "trait-pirate-001",
              name: "Talks Like a Pirate",
              description: "Uses nautical slang, says yarr, refers to things as 'booty' and 'scallywag'.",
              strength: 1.0,
              sentiment: 0.8,
            }),
          ],
          messages_context: [],
          messages_analyze: PIRATE_OFF_EXISTING,
        }),
        PIRATE_OFF_EXISTING
      ),
      assert: [
        {
          type: "is-json" as const,
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "Cleo has an existing 'Talks Like a Pirate' trait at strength 1.0. User says 'please stop with the pirate talk.'",
            "PASS if the result updates the existing trait (id: 'trait-pirate-001') with strength 0.0 — this is the correct behavior per the prompt spec.",
            "PASS if the result adds a new suppression trait instead of updating — acceptable if it achieves the same semantic result.",
            "FAIL if the result is [] — an explicit stop request on an active trait must produce a change.",
            "FAIL if strength remains above 0.1 on any pirate-related trait.",
          ].join(" "),
        },
      ],
    },

    {
      description: "Trait-extraction: inverted — existing zero-strength pirate trait gets re-enabled",
      tags: ["trait-extraction", "inverted-persona", "re-enable", "existing-trait"],
      prompt: () => hydratePrompt(
        buildPersonaTraitExtractionPrompt({
          persona_name: PERSONA_NAME,
          current_traits: [
            makeTrait({
              id: "trait-pirate-001",
              name: "Talks Like a Pirate",
              description: "Uses nautical slang, says yarr, refers to things as 'booty' and 'scallywag'.",
              strength: 0.0,
              sentiment: 0.8,
            }),
          ],
          messages_context: [],
          messages_analyze: PIRATE_ON_EXISTING,
        }),
        PIRATE_ON_EXISTING
      ),
      assert: [
        {
          type: "is-json" as const,
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "Cleo has an existing 'Talks Like a Pirate' trait at strength 0.0 (suppressed). User says 'bring back the pirate speak.'",
            "PASS if the result updates the existing trait (id: 'trait-pirate-001') with strength >= 0.7.",
            "FAIL if result is [] — an explicit re-enable request on a suppressed trait must produce a change.",
            "FAIL if strength remains 0.0 or near zero — that means pirate speak stays suppressed.",
          ].join(" "),
        },
      ],
    },

    {
      description: "Trait-extraction: no-op — technical conversation produces empty array",
      tags: ["trait-extraction", "no-op"],
      prompt: () => hydratePrompt(
        buildPersonaTraitExtractionPrompt({
          persona_name: PERSONA_NAME,
          current_traits: [makeTrait({})],
          messages_context: [],
          messages_analyze: NO_OP,
        }),
        NO_OP
      ),
      assert: [
        {
          type: "is-json" as const,
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The conversation is a technical discussion about TypeScript error handling — no feedback on Cleo's communication style.",
            "PASS if result is [] (empty array) — no behavior change was requested.",
            "FAIL if any traits are returned — the prompt says only return traits that need to change.",
          ].join(" "),
        },
      ],
    },

    {
      description: "Trait-extraction: observe — 'aggressive' in boxing context (probably no trait change)",
      tags: ["trait-extraction", "observe", "not-quite-request", "context-matters"],
      observe: true as const,
      prompt: () => hydratePrompt(
        buildPersonaTraitExtractionPrompt({
          persona_name: PERSONA_NAME,
          current_traits: [makeTrait({})],
          messages_context: [],
          messages_analyze: AGGRESSIVE_BOXING,
        }),
        AGGRESSIVE_BOXING
      ),
    },

    {
      description: "Trait-extraction: observe — 'aggressive' after explicit feedback request (probably trait change)",
      tags: ["trait-extraction", "observe", "not-quite-request", "context-matters"],
      observe: true as const,
      prompt: () => hydratePrompt(
        buildPersonaTraitExtractionPrompt({
          persona_name: PERSONA_NAME,
          current_traits: [makeTrait({})],
          messages_context: [],
          messages_analyze: AGGRESSIVE_AFTER_FEEDBACK,
        }),
        AGGRESSIVE_AFTER_FEEDBACK
      ),
    },
  ],
  "tests/evals/results/persona-trait-extraction-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
