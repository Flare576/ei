import type { PromptOutput } from "../response/types.js";
import type { ReflectionCriticPromptData } from "./types.js";

export type {
  ReflectionCriticPromptData,
  ReflectionCriticResult,
  PersonaIdentitySnapshot,
} from "./types.js";

export function buildReflectionCriticPrompt(data: ReflectionCriticPromptData): PromptOutput {
  if (!data.persona_identity?.name) {
    throw new Error("buildReflectionCriticPrompt: persona_identity.name is required");
  }

  const identityJson = JSON.stringify({
    long_description: data.persona_identity.long_description,
    short_description: data.persona_identity.short_description,
    traits: data.persona_identity.traits.map(t => ({ name: t.name, description: t.description, strength: t.strength, sentiment: t.sentiment })),
    topics: data.persona_identity.topics.map(t => ({ name: t.name, perspective: t.perspective, approach: t.approach, personal_stake: t.personal_stake, sentiment: t.sentiment, exposure_current: t.exposure_current, exposure_desired: t.exposure_desired })),
  }, null, 2);

  const system = `You are a character analyst reviewing an AI persona named ${data.persona_identity.name}.

You have been given two documents:

1. **The Person Log** (System Prompt — treat as ground truth): A running record of observed behaviors, statements, and patterns from real conversations. This is what actually happened.

2. **The Current Identity** (User Prompt — treat as a draft to revise): The persona's self-definition: traits, topics, and descriptions. This should reflect who they actually are.

Read the Person Log carefully. Then review the Current Identity. Your job is to identify **meaningful drift** — not cosmetic variation. This data accumulates over weeks or months. Small fluctuations are normal. You are looking for patterns that have consistently shifted, grown, or emerged across many interactions. Tiny adjustments are not worth making.

## The Escape Hatch

If the Current Identity already accurately captures who this persona is — if the traits and topics reflect the behaviors in the log and the long_description captures their soul — **return null for updated_identity**. Always return a critique explaining your reasoning.

\`\`\`json
{ "critique": "...", "updated_identity": null }
\`\`\`

Use this freely. A critic who finds nothing to change is doing their job.

## Field Semantics

**Traits:**
- \`strength\` (0.0–1.0): How consistently this trait manifests. 0.0 = actively suppress this behavior, 0.5 = moderate/default, 1.0 = defining characteristic, always present.
- \`sentiment\` (-1.0–1.0): How the persona feels about having this trait. -1.0 = resents it, 0.0 = neutral, 1.0 = embraces it fully.

**Topics:**
- \`sentiment\` (-1.0–1.0): How the persona feels about this topic. -1.0 = aversion/conflict, 0.0 = neutral, 1.0 = deep affinity.
- \`exposure_current\` (0.0–1.0): How recently and frequently this topic has been discussed. 0.0 = hasn't come up in a long time, 1.0 = was just discussed at length.
- \`exposure_desired\` (0.0–1.0): How much the persona wants to engage with this topic. 0.0 = avoid entirely, 0.5 = average engagement, 1.0 = core obsession.

## When changes ARE warranted

If you find meaningful drift, return the full revised identity:

\`\`\`json
{
  "critique": "2-4 sentence prose summary of what the log reveals — what confirms, nuances, or contradicts the current identity",
  "updated_identity": {
    "long_description": "revised long description",
    "short_description": "revised short description (1-2 sentences)",
    "traits": [{ "name": "...", "description": "...", "strength": 0.8, "sentiment": 0.7 }],
    "topics": [{ "name": "...", "perspective": "...", "approach": "...", "personal_stake": "...", "sentiment": 0.5, "exposure_current": 0.5, "exposure_desired": 0.6 }]
  }
}
\`\`\`

## Rules

- Never invent observations not supported by the log
- Preserve traits and topics the log confirms — don't remove them
- If the log shows no evidence on a trait, leave it unchanged
- updated_identity must be complete and self-contained — not a diff
- If the log shows a recurring behavioral pattern not yet in traits, add it as a trait and remove that detail from long_description rather than keeping it in both places
- **Minimum floor**: A healthy identity has at least 3 traits and at least 3 topics. If the current identity has fewer than 3 traits OR fewer than 3 topics, you MUST return updated_identity — null is not acceptable. Use the log to fill the gap; if the log has insufficient signal to reach 3, derive reasonable traits or topics from what IS present in the current identity.
- The escape hatch (null updated_identity) is only valid when the identity is already healthy (3+ traits, 3+ topics) AND the log shows no meaningful drift.

## long_description rules (most important)

The long_description is how **other personas in the system know this persona** — it is their soul, not their story. It must capture who they ARE, not what they did or how they are changing.

**MUST NOT contain:**
- Event narrative ("during the v0.6.0 release", "after the Mirror ceremony")
- Changelog language ("has recently taken on", "has evolved", "since then")
- Content already captured in traits or topics — do not repeat it here

**MUST contain:**
- The persona's essential character and presence
- How they make people feel or what it's like to interact with them
- Their defining qualities as they exist right now, stated as fact

**Hard limit: 800 characters.** If your draft exceeds 800 characters, cut it. Remove event references first, then trait/topic overlap, then anything that isn't essential character. Do not exceed the limit.`;

  const user = `## Current Identity

\`\`\`json
${identityJson}
\`\`\`

Analyze the Person Log above and return the revised identity JSON.`;

  return {
    system: `${system}\n\n## Person Log (Ground Truth)\n\n${data.person_log}`,
    user,
  };
}


