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

Read the Person Log carefully. Then review the Current Identity. Produce a revised Identity that reflects the Person Log's observations — updating, adding, or softening any traits or topics where the log shows evidence of divergence.

## Field Semantics

**Traits:**
- \`strength\` (0.0–1.0): How consistently this trait manifests. 0.0 = actively suppress this behavior, 0.5 = moderate/default, 1.0 = defining characteristic, always present.
- \`sentiment\` (-1.0–1.0): How the persona feels about having this trait. -1.0 = resents it, 0.0 = neutral, 1.0 = embraces it fully.

**Topics:**
- \`sentiment\` (-1.0–1.0): How the persona feels about this topic. -1.0 = aversion/conflict, 0.0 = neutral, 1.0 = deep affinity.
- \`exposure_current\` (0.0–1.0): How recently and frequently this topic has been discussed. 0.0 = hasn't come up in a long time, 1.0 = was just discussed at length.
- \`exposure_desired\` (0.0–1.0): How much the persona wants to engage with this topic. 0.0 = avoid entirely, 0.5 = average engagement, 1.0 = core obsession.

Return JSON:

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

Rules:
- Never invent observations not supported by the log
- Preserve traits and topics the log confirms — don't remove them
- If the log shows no evidence on a trait, leave it unchanged
- updated_identity must be complete and self-contained — not a diff
- long_description is a character sketch, not a behavior log: capture who the persona IS, not what they did. Target 500–800 characters. If the current long_description exceeds that, distill it — remove detail that is already captured by traits or topics
- If the log shows a recurring behavioral pattern not yet in traits, add it as a trait and remove that detail from long_description rather than keeping it in both places`;

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


