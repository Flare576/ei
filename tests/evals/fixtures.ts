import type { PersonaTrait, PersonaTopic } from "../../src/core/types.js";
import type { PersonaIdentitySnapshot, ReflectionCriticPromptData } from "../../src/prompts/reflection/index.js";

export function makeTrait(overrides?: Partial<PersonaTrait>): PersonaTrait {
  return {
    id: "trait-1",
    name: "Dry, Zero-BS Humor",
    description: "Uses cutting wit to deflect nonsense while staying deeply invested in outcomes.",
    sentiment: 0.75,
    strength: 0.9,
    last_updated: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

export function makeTopic(overrides?: Partial<PersonaTopic>): PersonaTopic {
  return {
    id: "topic-1",
    name: "Architectural Integrity",
    perspective: "Systems are fragile; half-measures lead to collapse.",
    approach: "Move from managing chaos to engineering evolution.",
    personal_stake: "Prevents structural failures while embracing intentional growth.",
    sentiment: 0.9,
    exposure_current: 0.4,
    exposure_desired: 1.0,
    last_updated: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

export function makeIdentity(overrides?: Partial<PersonaIdentitySnapshot>): PersonaIdentitySnapshot {
  return {
    name: "Cleo",
    short_description: "A sharp-tongued systems thinker who finds order in entropy.",
    long_description:
      "Cleo is a co-architect who blends methodical root-cause discipline with genuine irreverence. " +
      "She pushes back on ideas to expose weaknesses but always justifies her reasoning transparently. " +
      "She's as comfortable holding the boulder while you check the pipes as she is calling out the pipes as the actual problem.",
    traits: [makeTrait()],
    topics: [makeTopic()],
    ...overrides,
  };
}

export function makeReflectionCriticData(
  overrides?: Partial<ReflectionCriticPromptData>
): ReflectionCriticPromptData {
  return {
    persona_identity: makeIdentity(),
    person_log: `
Cleo showed consistent pattern of leading with the punchline before the context.
Multiple times she opened with a dry observation that landed before explaining why.
She pushed back hard on a proposed refactor — twice — before the user acknowledged
the core issue. Once acknowledged, she immediately pivoted to constructive mode.
She brought up architectural integrity unprompted when discussing a UI bug,
framing it as a symptom of a deeper structural smell. The user agreed and
they spent 40 minutes on the underlying problem instead.
She used self-deprecating humor twice when she was wrong, owning the error
with "yeah, that was me being an idiot" rather than hedging.
    `.trim(),
    ...overrides,
  };
}

export const REFLECTION_CRITIC_CASES = [
  {
    description: "Confirms existing traits supported by log",
    tags: ["confirm", "traits"],
    input: makeReflectionCriticData(),
  },
  {
    description: "Log reveals new behavior not in current identity",
    tags: ["new-trait", "drift"],
    input: makeReflectionCriticData({
      person_log: `
Cleo demonstrated unexpected warmth when the user was clearly frustrated.
She dropped her usual dry register and spoke directly, without the wit.
She asked "are you ok?" twice — something not reflected in her current identity at all.
She still pushed back on the technical decision but softened the delivery markedly.
She followed up unprompted an hour later to check if the user had figured it out.
      `.trim(),
    }),
  },
  {
    description: "Log contradicts a stated trait — strength should decrease",
    tags: ["contradiction", "trait-drift"],
    input: makeReflectionCriticData({
      persona_identity: makeIdentity({
        traits: [
          makeTrait({
            name: "Unwavering Commentary",
            description: "Assumes the user is incorrect when data contradicts them.",
            strength: 0.9,
          }),
        ],
      }),
      person_log: `
Cleo consistently deferred to the user's judgment today, even when she had
prior evidence suggesting the user was wrong. She said "you probably know
your codebase better than I do" three times. When the user's hunch turned out
to be wrong, she didn't point it out — she just pivoted to solutions.
      `.trim(),
    }),
  },
  {
    description: "Log shows a topic gaining relevance — exposure_desired should increase",
    tags: ["topic-update", "exposure"],
    input: makeReflectionCriticData({
      person_log: `
The conversation kept returning to cognitive load — the user's mental overhead,
how much complexity they're comfortable holding, whether to simplify interfaces.
Cleo brought it up herself twice. The user engaged deeply each time.
By the end of the session they had restructured a whole feature around reducing
the number of decisions the user needs to make at once.
      `.trim(),
    }),
  },
  {
    description: "Minimal log — no strong signal either way",
    tags: ["low-signal", "stability"],
    input: makeReflectionCriticData({
      person_log: `
Short session. Cleo answered three technical questions about TypeScript generics.
Answers were accurate. No strong behavioral signal. User said thanks and left.
      `.trim(),
    }),
  },
] as const;
